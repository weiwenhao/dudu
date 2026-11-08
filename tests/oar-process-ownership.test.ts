import assert from 'node:assert/strict';
import { execFile, fork, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const signals = ['exit', 'SIGTERM', 'SIGINT', 'SIGHUP'] as const;

async function alive(pid: number) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'win32') return true;
    const { stdout } = await exec('ps', ['-o', 'stat=', '-p', String(pid)]);
    return stdout.trim().length > 0 && !stdout.trim().startsWith('Z');
  } catch { return false; }
}

async function untilGone(pids: number[]) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!(await Promise.all(pids.map(alive))).some(Boolean)) return;
    await delay(20);
  }
  assert.deepEqual(await Promise.all(pids.map(alive)), pids.map(() => false), 'owned processes must exit with their host');
}

async function owner(t: TestContext, args: string[] = []) {
  const child = fork(new URL('./fixtures/oar-process-owner.mjs', import.meta.url), args, {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let errors = '';
  child.stdout!.resume();
  child.stderr!.on('data', (chunk) => { errors += chunk; });
  const messages: any[] = [];
  child.on('message', (message) => messages.push(message));
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  const waitFor = async (kind: string) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const message = messages.find((message) => message.kind === kind);
      if (message) return message;
      if (child.exitCode !== null || child.signalCode !== null) assert.fail(`Owner exited before ${kind}: ${errors}`);
      await delay(10);
    }
    assert.fail(`Owner did not report ${kind}: ${errors}`);
  };
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    for (const message of messages.filter((message) => message.kind === 'ready')) {
      for (const pid of [message.pid, message.descendant]) {
        if (await alive(pid)) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
        }
      }
    }
  });
  return { child, exited, waitFor, ready: await waitFor('ready') };
}

for (const mode of signals) test(`OAR releases its detached process tree when its owner exits through ${mode}`, {
  skip: process.platform === 'win32' && mode !== 'exit', timeout: 15_000,
}, async (t) => {
  const external: ChildProcess = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const externalExit = once(external, 'exit');
  t.after(async () => { external.kill('SIGTERM'); await externalExit; });
  await once(external, 'spawn');
  const { child, ready, exited } = await owner(t);
  assert.equal(await alive(ready.pid), true);
  assert.equal(await alive(ready.descendant), true);
  if (mode === 'exit') child.send('exit');
  else child.kill(mode);
  const [code, signal] = await exited;
  assert.deepEqual([code, signal], mode === 'exit' ? [0, null] : [null, mode], 'cleanup must preserve the host exit status');
  await untilGone([ready.pid, ready.descendant]);
  assert.equal(await alive(external.pid!), true, 'a process outside OAR ownership must be left alone');
});

for (const mode of signals) test(`OAR keeps captured descendant ownership after root close through ${mode}`, {
  skip: process.platform === 'win32', timeout: 15_000,
}, async t => {
  const { child, ready, exited } = await owner(t, ['--pending-cleanup']);
  assert.equal(await alive(ready.pid), false, 'the original root has already closed');
  assert.equal(await alive(ready.descendant), true, 'its captured descendant still needs cleanup');
  assert.notDeepEqual(ready.after, ready.before, 'the exit hook must remain while captured cleanup is pending');
  if (mode === 'exit') child.send('exit');
  else child.kill(mode);
  const [code, signal] = await exited;
  assert.deepEqual([code, signal], mode === 'exit' ? [0, null] : [null, mode]);
  await untilGone([ready.descendant]);
});

test('releasing the last captured descendant removes the exit hooks after root close', {
  skip: process.platform === 'win32', timeout: 15_000,
}, async t => {
  const { child, ready, waitFor } = await owner(t, ['--pending-cleanup']);
  child.send('dispose');
  const disposed = await waitFor('disposed');
  await untilGone([ready.descendant]);
  assert.deepEqual(disposed.after, disposed.before);
});

test('a handled host signal keeps OAR work running, and disposing it removes the exit hooks for hot reload', {
  skip: process.platform === 'win32', timeout: 15_000,
}, async (t) => {
  const { child, ready, waitFor } = await owner(t, ['--handle-term']);
  child.kill('SIGTERM');
  await waitFor('handled');
  assert.equal(await alive(ready.pid), true, 'the host is still running and has not requested disposal');
  assert.equal(await alive(ready.descendant), true);
  child.send('dispose');
  const disposed = await waitFor('disposed');
  await untilGone([ready.pid, ready.descendant]);
  assert.deepEqual(disposed.after, disposed.before, 'a released runtime must not leave signal listeners across hot reloads');
});
