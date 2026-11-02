import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { buildSessionEvents } from '../host/providers/native/session-events.mjs';
import { decodeArtifact, encodeArtifact, recoverArtifact, restoreImportedHead, validateArtifactEncoding } from '../scripts/repair-imported-session.mjs';

function legacy() {
  const history = {
    id: 'native-1', cwd: '/work', createdAt: 1000, title: 'Task',
    turns: [{
      prompt: 'Fix the issue', at: 1000, steps: [{ blocks: [
        { type: 'text', text: 'Checking' }, { type: 'tool-call', id: 'tool-1', name: 'Read', arguments: '{}' },
      ] }], results: new Map([['tool-1', { output: 'Original result.' }]]),
    }],
  };
  const { header, events } = buildSessionEvents({ history, route: 'codex', model: 'default', sessionId: 'session-original' });
  const old = events.filter((event: any) => event.type !== 'system/message').map((event: any, seq: number) => ({
    ...event, seq, ...(event.sourceEventSeqs ? { sourceEventSeqs: event.sourceEventSeqs.map((seq: number) => seq - 1) } : {}),
  }));
  return [{ type: 'session', ...header }, ...old];
}
const encode = (rows: any[]) => Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

test('offline recovery preserves every original event and remaps only local sequence references', () => {
  const rows = legacy();
  const userSeq = rows.find((row) => row.type === 'user/message')!.seq;
  const add = (type: string, data: any, extra = {}) => rows.push({ type, seq: rows.length - 1, time: 1000, data, ...extra });
  add('request/header', { header: { messages: [{ seq: userSeq, text: 'Captured input stays unchanged' }] } });
  const headerSeq = rows.at(-1)!.seq;
  add('developer/message', { headerSeq, message: { content: [{ type: 'tool-addition', toolName: 'Read' }] } });
  add('command/done', { sourceEventSeq: userSeq });
  add('session/title', { messageSeqs: [userSeq], title: 'Task' });
  add('compaction/summary', { shadowedRange: { start: userSeq, end: userSeq }, shadowedSeqs: [userSeq] });
  add('image/offload', { targets: [{ seq: userSeq, blockIndex: 0 }] });
  add('user/message', { content: 'Replacement' }, { surfaceOp: { op: 'replace', startSeq: userSeq, endSeq: userSeq }, sourceEventSeqs: [userSeq] });
  const original = structuredClone(rows);
  const result = restoreImportedHead(rows)!;
  assert.deepEqual(rows, original, 'planning never changes the source');
  assert.equal(result.length, rows.length + 1);
  assert.deepEqual(result[0], rows[0], 'session identity, native ID and metadata are retained');
  assert.equal(result[7].type, 'system/message');
  assert.deepEqual(result[7].data.message.content, []);
  assert.equal(restoreImportedHead(result), null, 'a repaired artifact is idempotent');
  for (const row of result.slice(1)) assert.equal(row.seq, result.indexOf(row) - 1);
  assert.deepEqual(result.find((row) => row.type === 'request/header')!.data, rows.find((row) => row.type === 'request/header')!.data);
  assert.equal(result.find((row) => row.type === 'developer/message')!.data.headerSeq, headerSeq + 1);
  assert.equal(result.find((row) => row.type === 'command/done')!.data.sourceEventSeq, userSeq + 1);
  assert.deepEqual(result.filter((row) => row.type === 'session/title').at(-1)!.data.messageSeqs, [userSeq + 1]);
  assert.deepEqual(result.find((row) => row.type === 'compaction/summary')!.data.shadowedSeqs, [userSeq + 1]);
  assert.equal(result.find((row) => row.type === 'image/offload')!.data.targets[0].seq, userSeq + 1);
  assert.deepEqual(result.at(-1)!.surfaceOp, { op: 'replace', startSeq: userSeq + 1, endSeq: userSeq + 1 });
  const toolResult = result.find((row) => row.type === 'tool/result')!;
  assert.equal(result[toolResult.sourceEventSeqs[0] + 1].type, 'tool/call');
  assert.equal(toolResult.data.message.content[0].text, 'Original result.');
});

test('offline recovery refuses unknown events, seed lineage and invalid references', () => {
  const rows = legacy();
  assert.throws(() => restoreImportedHead([{ ...rows[0], isSeeded: true }, ...rows.slice(1)]), /unseeded/);
  assert.throws(() => restoreImportedHead([...rows, { type: 'future/event', seq: rows.length - 1 }]), /Unsupported event/);
  const invalid = structuredClone(rows);
  invalid.find((row) => row.type === 'tool/result')!.sourceEventSeqs = [rows.length + 50];
  assert.throws(() => restoreImportedHead(invalid), /Invalid local reference/);
});

test('every concatenated Zstandard frame is decoded, and incomplete tails are refused', () => {
  const rows = legacy();
  const bytes = Buffer.concat(rows.map((row) => zstdCompressSync(JSON.stringify(row) + '\n')));
  assert.deepEqual(decodeArtifact(bytes, true), rows);
  assert.throws(() => decodeArtifact(bytes.subarray(0, -2), true));
  assert.throws(() => decodeArtifact(encode(rows).subarray(0, -1), false), /incomplete/);
});

test('the first compressed frame contains only the header, with every event retained in checksummed frames', () => {
  const rows = restoreImportedHead(legacy())!;
  assert.throws(() => validateArtifactEncoding(zstdCompressSync(encode(rows)), true), /exactly one header line/);
  const bytes = encodeArtifact(rows, true);
  assert.ok(bytes[4] & 4, 'the header frame carries a checksum');
  assert.deepEqual(validateArtifactEncoding(bytes, true), rows);
  assert.deepEqual(validateArtifactEncoding(encodeArtifact(rows, false), false), rows);
  const damaged = Buffer.from(bytes);
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => validateArtifactEncoding(damaged, true), /checksum/i);
});

// File-publication tests inject only the validation/lock seams. Current Desktop's real validator is checked by the CLI and E2E.
const catalog = {
  createRestore: () => ({ decodeRow() {}, finish() {} }),
};
async function setup(t: any) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-recovery-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'session.v4.jsonl.zstd');
  const original = Buffer.concat(legacy().map((row) => zstdCompressSync(JSON.stringify(row) + '\n')));
  await writeFile(file, original, { mode: 0o600 });
  return { file, original, backupRoot: join(folder, 'backups'), catalog };
}

test('recovery defaults to read-only, then applies atomically with a private exact-byte backup and the same identity', async (t) => {
  const options = await setup(t);
  const dry = await recoverArtifact(options);
  assert.equal(dry.applied, false);
  assert.deepEqual(await readFile(options.file), options.original);
  await assert.rejects(stat(options.backupRoot), { code: 'ENOENT' });
  let released = false;
  const applied = await recoverArtifact({
    ...options, apply: true, assertStopped: async () => {},
    acquireLock: async () => ({ close: async () => { released = true; } }),
  });
  assert.equal(released, true);
  assert.equal(applied.applied, true);
  assert.equal(applied.sessionId, 'session-original');
  assert.deepEqual(await readFile(applied.backup!), options.original);
  assert.equal((await stat(applied.backup!)).mode & 0o777, 0o600);
  const repaired = decodeArtifact(await readFile(options.file), true);
  assert.equal(repaired.length, legacy().length + 1);
  assert.deepEqual(validateArtifactEncoding(await readFile(options.file), true), repaired);
  assert.equal((await recoverArtifact(options)).changed, false);
});

test('an already restored session with a combined header frame is reframed without changing any row or native identity', async (t) => {
  const options = await setup(t);
  const rows = restoreImportedHead(legacy())!;
  const original = zstdCompressSync(encode(rows));
  await writeFile(options.file, original);
  const result = await recoverArtifact({
    ...options, apply: true, assertStopped: async () => {},
    acquireLock: async () => ({ close: async () => {} }),
  });
  assert.equal(result.headRestored, false);
  assert.equal(result.framingRepaired, true);
  assert.equal(result.eventsBefore, result.eventsAfter);
  assert.deepEqual(await readFile(result.backup!), original);
  assert.deepEqual(validateArtifactEncoding(await readFile(options.file), true), rows);
  assert.equal((await recoverArtifact(options)).changed, false);
});

test('lock contention, a running runtime, source changes or validation refusal never replace the source', async (t) => {
  for (const failure of ['locked', 'running', 'changed', 'invalid']) {
    const options = await setup(t);
    let checked = 0;
    let released = false;
    const changed = Buffer.concat([options.original, zstdCompressSync('\n')]);
    await assert.rejects(recoverArtifact({
      ...options, apply: true,
      catalog: failure === 'invalid' ? { createRestore: () => { throw new Error('invalid'); } } : catalog,
      acquireLock: async () => {
        if (failure === 'locked') throw new Error('locked');
        return { close: async () => { released = true; } };
      },
      assertStopped: async () => {
        if (failure === 'running') throw new Error('running');
        if (failure === 'changed' && ++checked === 2) await writeFile(options.file, changed);
      },
    }), new RegExp(failure === 'changed' ? 'source changed' : failure));
    assert.deepEqual(await readFile(options.file), failure === 'changed' ? changed : options.original);
    assert.equal(released, failure !== 'locked');
  }
});
