// Offline recovery for the importer's missing system head. Original bytes are backed up before an atomic replacement.
import { execFile, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

const app = '/Applications/DeepSeek Harness.app';
const executable = join(app, 'Contents/MacOS/DeepSeek Harness');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const supported = new Set([
  'permission/preset', 'sandbox/mode', 'approval/policy', 'model/selection', 'session/title', 'session/title-llm-request',
  'session/end-seed', 'turn/start', 'turn/end', 'step/start', 'step/end', 'system/message', 'developer/message',
  'user/message', 'assistant/message', 'assistant/attempt', 'tool/call', 'tool/result',
  'agent/inbox/spliced', 'request/header', 'request/context', 'command/run', 'command/done',
  'compaction/summary', 'compaction/prune', 'image/offload',
]);

function frameEnd(bytes, start) {
  let offset = start;
  const take = (size) => {
    if (offset + size > bytes.length) throw new Error('Refusing an incomplete Zstandard frame.');
    const previous = offset;
    offset += size;
    return previous;
  };
  if (bytes.readUInt32LE(take(4)) !== 0xfd2fb528) throw new Error('Invalid Zstandard frame magic.');
  const descriptor = bytes[take(1)];
  if (descriptor & 24) throw new Error('Invalid Zstandard frame header.');
  const contentFlag = descriptor >>> 6;
  const single = (descriptor & 32) !== 0;
  const dictionaryFlag = descriptor & 3;
  take((single ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (contentFlag === 0 ? (single ? 1 : 0) : 1 << contentFlag));
  let last = false;
  while (!last) {
    const block = bytes.readUIntLE(take(3), 3);
    const type = (block >>> 1) & 3;
    if (type === 3) throw new Error('Invalid Zstandard block type.');
    take(type === 1 ? 1 : block >>> 3);
    last = (block & 1) !== 0;
  }
  if (descriptor & 4) take(4);
  return offset;
}

export function decodeArtifact(bytes, compressed) {
  const chunks = [];
  if (compressed) {
    for (let offset = 0; offset < bytes.length;) {
      // Node's one-shot decoder consumes one frame; DSH appends independently checksummed frames.
      const end = frameEnd(bytes, offset);
      chunks.push(zstdDecompressSync(bytes.subarray(offset, end)));
      offset = end;
    }
  } else chunks.push(bytes);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.endsWith('\n')) throw new Error('Refusing a session with an incomplete JSONL tail.');
  return text.slice(0, -1).split('\n').map((line) => JSON.parse(line));
}

/** DSH reads metadata from the first frame independently of the event log. */
export function validateArtifactEncoding(bytes, compressed) {
  if (compressed) {
    const header = zstdDecompressSync(bytes.subarray(0, frameEnd(bytes, 0)));
    if (header.length === 0 || header.indexOf(10) !== header.length - 1) {
      throw new Error('The first Zstandard frame must contain exactly one header line.');
    }
  }
  return decodeArtifact(bytes, compressed);
}

export function encodeArtifact(rows, compressed) {
  const line = (row) => Buffer.from(JSON.stringify(row) + '\n');
  if (!compressed) return Buffer.concat(rows.map(line));
  const compress = (bytes) => zstdCompressSync(bytes, { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
  const frames = [compress(line(rows[0]))];
  let batch = [], size = 0;
  for (const row of rows.slice(1)) {
    const bytes = line(row);
    // Bound event batches without splitting a JSONL record across frames.
    if (size && size + bytes.length > 1024 * 1024) {
      frames.push(compress(Buffer.concat(batch, size)));
      batch = [];
      size = 0;
    }
    batch.push(bytes);
    size += bytes.length;
  }
  if (size) frames.push(compress(Buffer.concat(batch, size)));
  return Buffer.concat(frames);
}

/** Insert one empty head, changing only same-log coordinates. Captured model input and native IDs remain byte-for-byte values. */
export function restoreImportedHead(rows) {
  const [header, ...events] = rows;
  if (header?.version !== 4 || header.type !== 'session' || header.isSeeded !== false || header.parentSession) {
    throw new Error('Only unseeded v4 imported sessions can be recovered.');
  }
  const index = events.findIndex((event) => event.surfaceOp !== undefined);
  if (events[index]?.type === 'system/message') return null;
  const expected = ['permission/preset', 'sandbox/mode', 'approval/policy', 'model/selection', 'turn/start', 'step/start'];
  if (index !== expected.length || expected.some((type, i) => events[i]?.type !== type) ||
      events[index]?.type !== 'user/message' || events[index].surfaceOp !== 'append') {
    throw new Error('The session does not have the legacy native-import prefix.');
  }
  const route = events[3].data.provider;
  const reply = events.find((event) => event.type === 'assistant/message')?.data?.message?.source;
  if (!['codex', 'claude'].includes(route) || reply?.provider !== route ||
      reply.replayState?.harness !== route || !reply.replayState.nativeSessionId) {
    throw new Error('The native import identity could not be established.');
  }
  for (const [seq, event] of events.entries()) {
    if (event.seq !== seq || !supported.has(event.type)) throw new Error(`Unsupported event at seq ${seq}: ${event.type}.`);
  }
  const anchor = events[index];
  const step = events[index - 1].data;
  const head = {
    type: 'system/message', seq: index, time: anchor.time, surfaceOp: 'append',
    data: {
      turn: step.turn, step: step.step,
      message: {
        id: `dudu-import-head-${randomUUID()}`, role: 'system',
        source: { kind: 'system-prompt' }, content: [],
      },
    },
  };
  const updated = events.map((event) => {
    if (event.seq < index) return event;
    const reference = (seq) => {
      if (!Number.isSafeInteger(seq) || seq < 0 || seq >= event.seq) throw new Error(`Invalid local reference at seq ${event.seq}.`);
      return seq < index ? seq : seq + 1;
    };
    let data = event.data;
    switch (event.type) {
      case 'developer/message':
        if (data.headerSeq !== undefined) data = { ...data, headerSeq: reference(data.headerSeq) };
        break;
      case 'command/done':
        if (data.sourceEventSeq !== undefined) data = { ...data, sourceEventSeq: reference(data.sourceEventSeq) };
        break;
      case 'session/title':
      case 'session/title-llm-request':
        data = { ...data, messageSeqs: data.messageSeqs.map(reference) };
        break;
      case 'compaction/summary':
      case 'compaction/prune':
        data = {
          ...data, shadowedSeqs: data.shadowedSeqs.map(reference),
          shadowedRange: { ...data.shadowedRange, start: reference(data.shadowedRange.start), end: reference(data.shadowedRange.end) },
        };
        break;
      case 'image/offload':
        data = { ...data, targets: data.targets.map((target) => ({ ...target, seq: reference(target.seq) })) };
        break;
    }
    return {
      ...event, seq: event.seq + 1, data,
      ...(event.sourceEventSeqs ? { sourceEventSeqs: event.sourceEventSeqs.map(reference) } : {}),
      ...(event.surfaceOp && event.surfaceOp !== 'append' ? {
        surfaceOp: { ...event.surfaceOp, startSeq: reference(event.surfaceOp.startSeq), endSeq: reference(event.surfaceOp.endSeq) },
      } : {}),
    };
  });
  updated.splice(index, 0, head);
  return [header, ...updated];
}

export function validateArtifact(rows, catalog) {
  const restore = catalog.createRestore(rows[0], { validation: 'current' });
  for (const row of rows.slice(1)) restore.decodeRow(row);
  return restore.finish();
}

/** A caller must supply DSH's own nonblocking session lock and keep the runtime stopped throughout publication. */
export async function recoverArtifact({ file, catalog, apply = false, backupRoot = join(root, '.local/session-repairs'), acquireLock, assertStopped }) {
  file = resolve(file);
  const compressed = file.endsWith('.jsonl.zstd');
  if (!compressed && !file.endsWith('.jsonl')) throw new Error('Expected a DSH JSONL session artifact.');
  const lease = apply ? await acquireLock(dirname(file)) : null;
  try {
    if (apply) await assertStopped();
    const original = await readFile(file);
    const rows = decodeArtifact(original, compressed);
    const restored = restoreImportedHead(rows);
    let framingRepaired = false;
    try { validateArtifactEncoding(original, compressed); }
    catch (error) {
      if (!String(error).includes('exactly one header line')) throw error;
      framingRepaired = true;
    }
    if (!restored && !framingRepaired) {
      validateArtifact(rows, catalog);
      return { changed: false, sessionId: rows[0].id };
    }
    try { validateArtifact(rows, catalog); }
    catch (error) {
      if (!restored || !String(error).includes('system/message requires a protected first surface head')) throw error;
    }
    const repaired = restored ?? rows;
    validateArtifact(repaired, catalog);
    const replacement = encodeArtifact(repaired, compressed);
    validateArtifact(validateArtifactEncoding(replacement, compressed), catalog);
    const result = {
      changed: true, applied: false, sessionId: rows[0].id, headRestored: Boolean(restored), framingRepaired,
      eventsBefore: rows.length - 1, eventsAfter: repaired.length - 1, sha256Before: digest(original),
    };
    if (!apply) return result;
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    // Use a distinct directory for each attempt so a previous backup can never be overwritten.
    const folder = await mkdtemp(join(backupRoot, 'import-'));
    const backup = join(folder, `original${compressed ? '.jsonl.zstd' : '.jsonl'}`);
    const saved = await open(backup, 'wx', 0o600);
    try { await saved.writeFile(original); await saved.sync(); } finally { await saved.close(); }
    const temporary = join(dirname(file), `.dudu-system-head-${randomUUID()}.tmp`);
    try {
      const output = await open(temporary, 'wx', (await stat(file)).mode & 0o777);
      try { await output.writeFile(replacement); await output.sync(); } finally { await output.close(); }
      await assertStopped();
      if (!(await readFile(file)).equals(original)) throw new Error('The source changed during recovery; the original remains active.');
      await rename(temporary, file);
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
    const receipt = { ...result, applied: true, backup, sha256After: digest(replacement) };
    await writeFile(`${backup}.receipt.json`, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return receipt;
  } finally { await lease?.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('node scripts/repair-imported-session.mjs /absolute/path/session.v4.jsonl.zstd [--apply]');
    console.log('Default: validate a lossless repair without writing. --apply requires Desktop to be closed and keeps an original backup.');
    return;
  }
  if (args.length > 2 || (args[1] && args[1] !== '--apply')) throw new Error('Unexpected recovery arguments.');
  if (!process.versions.electron) {
    const result = spawnSync(executable, ['--expose-internals', fileURLToPath(import.meta.url), ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }
  const require = createRequire(join(app, 'Contents/Resources/app.asar/dsh/package.json'));
  const { sessionFormatCatalog } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session-format-catalog')).href);
  const { tryLockExclusive } = await import(pathToFileURL(require.resolve('@deepseek-ai/node-addon-system/flock')).href);
  console.log(JSON.stringify(await recoverArtifact({
    file: args[0], apply: args.includes('--apply'), catalog: sessionFormatCatalog,
    assertStopped: async () => {
      const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,comm=']);
      if (stdout.split('\n').some((line) => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        return match && Number(match[1]) !== process.pid && match[2] === executable;
      })) throw new Error('Close DeepSeek Harness normally before applying a session recovery.');
    },
    acquireLock: async (folder) => {
      const path = join(folder, 'session.lock');
      const handle = await open(path, 'a', 0o600);
      try {
        await tryLockExclusive(handle.fd);
        const held = await handle.stat(), current = await stat(path);
        if (held.ino !== current.ino || held.dev !== current.dev) throw new Error('The session lock changed.');
        return handle;
      } catch (error) { await handle.close(); throw error; }
    },
  }), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
