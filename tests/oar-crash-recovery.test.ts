import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recoverOwnedProcess } from '@dudu/oar-adapter';
import { createSessionKernel, recoveryDecision, rememberOwnedProcess, spawnLineProcess } from '@dudu/oar-adapter/testing';

const owner = { pid: 700, ppid: 2, pgid: 700, start: 'old-host' };
const child = { pid: 701, ppid: owner.pid, pgid: 701, start: 'native-start' };
const key = 'claude:session-a';
const record = { v: 1, key, owner, child };
const host = { pid: process.pid, ppid: 1, pgid: process.pid, start: 'current-host' };
const snapshot = (...entries: typeof child[]) => new Map([host, ...entries].map(entry => [entry.pid, entry]));

test('crash recovery requires the recorded session, dead owner and exact orphan identity; live terminals and reused PIDs are protected', () => {
  assert.equal(recoveryDecision(record, key, snapshot(owner, child)), 'active');
  const orphan = { ...child, ppid: 1 };
  assert.equal(recoveryDecision(record, key, snapshot(orphan)), 'orphan');
  assert.equal(recoveryDecision(record, 'claude:another-session', snapshot(orphan)), 'unknown');
  assert.equal(recoveryDecision(undefined, key, snapshot(orphan)), 'unknown');
  assert.equal(recoveryDecision(record, key, snapshot({ ...orphan, start: 'unrelated-new-process' })), 'gone');
  assert.equal(recoveryDecision(record, key, snapshot({ ...owner, start: 'reused-host-pid' }, orphan)), 'orphan');
  assert.equal(recoveryDecision({ ...record, child: { ...child, ppid: 999 } }, key, snapshot(orphan)), 'unknown');
  if (process.platform !== 'win32') {
    assert.equal(recoveryDecision(record, key, snapshot({ ...orphan, ppid: 999 })), 'unknown');
    assert.equal(recoveryDecision(record, key, snapshot({ ...orphan, pgid: 999 })), 'unknown');
  }
});

test('a recorded crash survivor is released once before resume, while live ownership and later owners survive cleanup', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-crash-recovery-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const native = { ...child, ppid: host.pid };
  const release = await rememberOwnedProcess({ pid: native.pid }, key, { folder, table: () => snapshot(native) });
  const file = join(folder, readdirSync(folder)[0]);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  const stopped: number[][] = [];
  const stop = ((entries: typeof child[]) => {
    stopped.push(entries.map(entry => entry.pid));
    return { hostIdentified: true, failed: 0, signalled: entries.length, codes: [] };
  }) as any;
  assert.equal(await recoverOwnedProcess(key, { folder, table: () => snapshot(native), stop }), false);
  assert.deepEqual(stopped, []);
  const old = { ...stored, owner };
  old.child.ppid = owner.pid;
  writeFileSync(file, JSON.stringify(old), { mode: 0o600 });
  const orphan = { ...old.child, ppid: 1 };
  const descendant = { pid: 702, ppid: orphan.pid, pgid: 702, start: 'tool-start' };
  let observations = 0;
  assert.equal(await recoverOwnedProcess(key, {
    folder, table: () => snapshot(orphan, descendant), stop,
    observe: async () => ({ ok: true, table: ++observations === 1 ? snapshot(orphan) : snapshot(), skipped: 0, elapsedMs: 0, source: 'ps' }),
    pause: async () => {},
  }), true);
  assert.deepEqual(stopped, [[701, 702]], 'only the verified native process and its descendants are signalled');
  assert.equal(observations, 2, 'do not resume before the old writer has exited');
  assert.deepEqual(readdirSync(folder), []);
  assert.equal(await recoverOwnedProcess(key, { folder, stop }), false);
  const later = { ...native, start: 'later-native-owner' };
  const releaseLater = await rememberOwnedProcess({ pid: later.pid }, key, { folder, table: () => snapshot(later) });
  release();
  assert.equal(readdirSync(folder).length, 1, 'a delayed close cannot erase the replacement ownership record');
  releaseLater();
  assert.deepEqual(readdirSync(folder), []);
});

test('ownership admission runs only after spawn and a failed record waits for normal child teardown before rejecting', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-crash-admission-'));
  const prior = process.env.DUDU_OAR_OWNERSHIP_DIR;
  t.after(() => {
    if (prior === undefined) delete process.env.DUDU_OAR_OWNERSHIP_DIR;
    else process.env.DUDU_OAR_OWNERSHIP_DIR = prior;
    rmSync(folder, { recursive: true, force: true });
  });
  process.env.DUDU_OAR_OWNERSHIP_DIR = folder;
  const child = spawnLineProcess(process.execPath, ['--eval', 'process.stdin.resume()'], { ownershipKey: key, killTree: true });
  t.after(async () => { child.kill(); await child.exited; });
  await child.spawned;
  const file = join(folder, readdirSync(folder)[0]);
  const stored = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(stored.owner.pid, process.pid);
  assert.equal(stored.child.pid, child.pid);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  child.kill();
  await child.exited;

  const blockedFolder = join(folder, 'not-a-directory');
  writeFileSync(blockedFolder, '');
  process.env.DUDU_OAR_OWNERSHIP_DIR = blockedFolder;
  const blocked = spawnLineProcess(process.execPath, ['--eval', 'process.stdin.resume()'], { ownershipKey: key, killTree: true });
  t.after(async () => { blocked.kill(); await blocked.exited; });
  let exited = false;
  void blocked.exited.then(() => { exited = true; });
  await assert.rejects(blocked.spawned, { code: 'OAR_PROCESS_RECOVERY' });
  assert.equal(exited, true, 'a refused launch never leaves its native writer alive');

  const missing = spawnLineProcess(join(folder, 'missing-executable'), [], { ownershipKey: key });
  await assert.rejects(missing.spawned, { code: 'ENOENT' });
  await missing.exited;
});

test('OAR bounds old native/tool payloads after full live delivery, preserving text, usage, record order and cursor replay', () => {
  const kernel = createSessionKernel('retention-test', undefined, 128);
  const observed: any[] = [];
  kernel.rawEvents(record => observed.push(record));
  for (let index = 0; index < 4; index++) {
    kernel.frame({
      type: 'assistant', native: { huge: 'x'.repeat(1024) },
      events: [
        { kind: 'tool_call_ended', callId: `call-${index}`, result: 'ok', content: [{ type: 'text', text: 'complete output' }] },
        { kind: 'text_delta', messageId: `message-${index}`, text: `answer-${index}` },
        { kind: 'usage', usage: { total: { input: index, output: index } } },
      ],
    } as any);
  }
  assert.ok(observed.every(record => record.body.native.huge.length === 1024));
  assert.ok(observed.every(record => record.body.events[0].content[0].text === 'complete output'));
  const retained = kernel.records() as any[];
  assert.ok(retained.slice(0, -1).every(record => record.body.elided && record.body.native === null));
  assert.deepEqual(retained.map(record => record.seq), [0, 1, 2, 3]);
  assert.deepEqual(retained.map(record => record.body.events[1].text), ['answer-0', 'answer-1', 'answer-2', 'answer-3']);
  assert.deepEqual(retained.map(record => record.body.events[2].usage.total.output), [0, 1, 2, 3]);
  const replay: any[] = [];
  kernel.rawEvents(record => replay.push(record), { sessionId: 'retention-test', afterSeq: 1 });
  assert.deepEqual(replay.map(record => record.seq), [2, 3]);
});
