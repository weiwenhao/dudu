import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { desktopPackageIdentity, matchesDesktopRuntime, waitForDesktopRuntime, writeDesktopRuntime } from '../host/desktop-runtime.mjs';
import { acquireUpdateLock, activateDesktopUpdate, assertDesktopContinuity, parseUpdateArguments, requestDesktopReload, runsInsideDesktop } from '../scripts/update-desktop.mjs';

async function temporary(t: any) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-update-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('desktop identity detects code changes even when the package version stays the same', async (t) => {
  const folder = await temporary(t);
  await mkdir(join(folder, 'dist'));
  for (const [name, text] of Object.entries({
    'package.json': JSON.stringify({ name: 'dsh-dudu', version: '0.4.0' }),
    'index.mjs': 'export const name = "dudu";',
    'client.js': 'window.ready = true;',
    'cordis.patch.yml': '[]',
    'dist/server.mjs': 'export const ready = true;',
  })) await writeFile(join(folder, name), text);
  const first = await desktopPackageIdentity(folder);
  assert.deepEqual(await desktopPackageIdentity(folder), first);
  await writeFile(join(folder, 'client.js'), 'window.ready = false;');
  const client = await desktopPackageIdentity(folder);
  assert.equal(client.version, first.version);
  assert.notEqual(client.fingerprint, first.fingerprint);
  await writeFile(join(folder, 'dist/server.mjs'), 'export const ready = false;');
  assert.notEqual((await desktopPackageIdentity(folder)).fingerprint, client.fingerprint);
});

test('runtime receipts are private and identify a fresh, exact build rather than installed files alone', async (t) => {
  const folder = await temporary(t);
  const expected = { version: '0.3.21', fingerprint: 'a'.repeat(64) };
  const runtime = await writeDesktopRuntime(folder, expected, 3170);
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'runtime.json'), 'utf8')), runtime);
  assert.equal((await stat(join(folder, 'runtime.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(folder), ['runtime.json']);
  assert.equal(matchesDesktopRuntime(runtime, expected, runtime.startedAt), true);
  assert.equal(matchesDesktopRuntime(runtime, expected, runtime.startedAt + 1), false);
  assert.equal(matchesDesktopRuntime(runtime, { ...expected, fingerprint: 'b'.repeat(64) }), false);
  assert.equal(matchesDesktopRuntime({ ...runtime, port: 0 }, expected), false);
});

test('readiness requires the expected live runtime and a responding native service', async (t) => {
  const folder = await temporary(t);
  const expected = { version: '0.3.21', fingerprint: 'a'.repeat(64) };
  await writeDesktopRuntime(folder, expected, 3170);
  const options = { folder, expected, timeoutMs: 0, probe: async () => true };
  assert.equal(await waitForDesktopRuntime({ ...options, alive: () => false }), undefined);
  assert.equal(await waitForDesktopRuntime({ ...options, probe: async () => false }), undefined);
  assert.equal(await waitForDesktopRuntime({ ...options, expected: { ...expected, version: '0.3.22' } }), undefined);
  let attempts = 0;
  const ready = await waitForDesktopRuntime({
    ...options, timeoutMs: 100, intervalMs: 1,
    probe: async (port: number) => { assert.equal(port, 3170); return ++attempts > 1; },
  });
  assert.equal(ready?.fingerprint, expected.fingerprint);
  assert.ok(attempts > 1);
});

test('successful plugin hot reload leaves the desktop application running', async () => {
  const actions: string[] = [];
  const processes = [{ pid: 30, parent: 20, command: '/DSH', startedAt: 'before' }];
  const runtime = { version: '0.3.21', pid: 30 };
  const result = await activateDesktopUpdate({
    running: true, restartRequired: false,
    assertHotRuntime: async (loaded?: { pid: number }) => assertDesktopContinuity(processes, [...processes], loaded),
    requestReload: async () => { actions.push('reload'); },
    waitForRuntime: async () => { actions.push('ready'); return runtime; },
    restart: async () => { throw new Error('Must not restart an already updated runtime.'); },
  });
  assert.deepEqual(result, { mode: 'hot', runtime });
  assert.deepEqual(actions, ['reload', 'ready']);
});

test('an unsuccessful hot reload leaves Desktop open and never reports an unready build as installed', async () => {
  const actions: string[] = [];
  await assert.rejects(activateDesktopUpdate({
    running: true, restartRequired: false,
    assertHotRuntime: async () => {},
    requestReload: async () => { actions.push('reload'); },
    waitForRuntime: async () => { actions.push('wait'); return undefined; },
    restart: async () => { actions.push('restart'); },
  }), /did not become ready/);
  assert.deepEqual(actions, ['reload', 'wait']);
});

test('a ready replacement host or restarted Desktop cannot be reported as a successful hot reload', async () => {
  const before = [
    { pid: 20, parent: 1, command: '/DSH', startedAt: 'before' },
    { pid: 30, parent: 20, command: '/DSH', startedAt: 'before' },
  ];
  assert.doesNotThrow(() => assertDesktopContinuity(before, [...before], { pid: 30 }));
  for (const after of [
    [],
    [before[0], { ...before[1], pid: 31 }],
    before.map((entry) => ({ ...entry, pid: entry.pid + 100, parent: entry.parent === 1 ? 1 : 120 })),
    [before[0], { ...before[1], startedAt: 'reused PID' }],
  ]) {
    const actions: string[] = [];
    await assert.rejects(activateDesktopUpdate({
      running: true, restartRequired: false,
      assertHotRuntime: async (runtime?: { pid: number }) => assertDesktopContinuity(before, actions.includes('wait') ? after : before, runtime),
      requestReload: async () => { actions.push('reload'); },
      waitForRuntime: async () => { actions.push('wait'); return { pid: 31 }; },
      restart: async () => { assert.fail('A crash must never trigger an automatic restart.'); },
    }), { code: 'DESKTOP_PROCESS_CHANGED' });
    assert.deepEqual(actions, ['reload', 'wait']);
  }
  assert.throws(() => assertDesktopContinuity(before, [...before], { pid: 99 }), { code: 'DESKTOP_PROCESS_CHANGED' });
  await assert.rejects(activateDesktopUpdate({
    running: true, restartRequired: false,
    assertHotRuntime: async () => assertDesktopContinuity(before, []),
    requestReload: async () => { assert.fail('A host lost during installation must be reported before requesting another reload.'); },
    waitForRuntime: async () => { assert.fail('Do not wait for a new app after the original host has exited.'); },
    restart: async () => { assert.fail('Do not restart Desktop automatically.'); },
  }), { code: 'DESKTOP_PROCESS_CHANGED' });
});

test('readiness checks host continuity before waiting and again after the service responds', async (t) => {
  const folder = await temporary(t);
  const expected = { version: '0.3.21', fingerprint: 'a'.repeat(64) };
  await writeDesktopRuntime(folder, expected, 3170);
  let changed = false;
  const options = {
    folder, expected, timeoutMs: 0, alive: () => true,
    probe: async () => { changed = true; return true; },
    assertRunning: async () => { if (changed) throw Object.assign(new Error('Host exited'), { code: 'DESKTOP_PROCESS_CHANGED' }); },
  };
  await assert.rejects(waitForDesktopRuntime(options), { code: 'DESKTOP_PROCESS_CHANGED' });
  await assert.rejects(waitForDesktopRuntime({
    ...options,
    probe: async () => { assert.fail('An interrupted hot reload must not keep waiting for a replacement.'); },
  }), { code: 'DESKTOP_PROCESS_CHANGED' });
});

test('only an explicit restart bypasses hot reload; an unopened Desktop can be started', async () => {
  for (const options of [{ running: true, restartRequired: true }, { running: false, restartRequired: false }]) {
    const actions: string[] = [];
    const result = await activateDesktopUpdate({
      ...options,
      assertHotRuntime: async () => { assert.fail('An explicit launch does not require the previous host to survive.'); },
      requestReload: async () => { assert.fail('No running profile should be reloaded.'); },
      waitForRuntime: async () => { actions.push('ready'); return { pid: 123 }; },
      restart: async () => { actions.push('start'); },
    });
    assert.equal(result.mode, 'restart');
    assert.deepEqual(actions, ['start', 'ready']);
  }
});

test('reload changes patch contents on every request, preserving configuration, comments and file permissions', async (t) => {
  const folder = await temporary(t);
  const patch = join(folder, 'cordis.patch.yml');
  const original = '# owner comment\r\n- id: dudu\r\n  config:\r\n    port: 3170\r\n';
  await writeFile(patch, original, { mode: 0o600 });
  for (const fingerprint of ['a'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)]) {
    const before = await readFile(patch, 'utf8');
    await requestDesktopReload(folder, fingerprint);
    const changed = await readFile(patch, 'utf8');
    assert.notEqual(changed, before, 'DSH ignores unchanged patch contents, including a same-build retry');
    assert.equal(changed.split('\r\n').slice(1).join('\r\n'), original);
    assert.equal((changed.match(/# dudu desktop update:/g) ?? []).length, 1);
    assert.equal((await stat(patch)).mode & 0o777, 0o600);
  }
  assert.deepEqual(await readdir(folder), ['cordis.patch.yml']);
  await assert.rejects(requestDesktopReload(folder, 'not-a-fingerprint'), /fingerprint/);
});

test('desktop updates recognize their own harness workers through shell and npm ancestors', () => {
  const executable = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
  const processes = [
    { pid: 20, parent: 1, command: executable },
    { pid: 30, parent: 20, command: 'codex' },
    { pid: 40, parent: 30, command: '/bin/zsh' },
    { pid: 50, parent: 40, command: 'npm' },
    { pid: 60, parent: 50, command: 'node' },
    { pid: 70, parent: 1, command: '/bin/zsh' },
    { pid: 80, parent: 70, command: 'node' },
  ];
  assert.equal(runsInsideDesktop(60, processes, executable), true);
  assert.equal(runsInsideDesktop(80, processes, executable), false);
  assert.equal(runsInsideDesktop(90, processes, executable), false);
  assert.equal(runsInsideDesktop(60, processes, '/Applications/Other.app/Contents/MacOS/DeepSeek Harness'), false);
  assert.equal(runsInsideDesktop(60, [{ pid: 60, parent: 60, command: 'node' }], executable), false);
});

test('--force reloads even from a task inside DSH; nothing else changes, and an unknown option is still refused', () => {
  assert.deepEqual(parseUpdateArguments([]), { app: '/Applications/DeepSeek Harness.app', restartRequired: false, force: false });
  assert.deepEqual(parseUpdateArguments(['--force']), { app: '/Applications/DeepSeek Harness.app', restartRequired: false, force: true });
  assert.deepEqual(parseUpdateArguments(['--restart', '--app', '/x/DSH.app']), { app: '/x/DSH.app', restartRequired: true, force: false });
  assert.deepEqual(parseUpdateArguments(['--force', '--restart']).force && parseUpdateArguments(['--force', '--restart']).restartRequired, true);
  assert.throws(() => parseUpdateArguments(['--forced']), /Unknown or incomplete option: --forced/);
  assert.throws(() => parseUpdateArguments(['--app']), /Unknown or incomplete option: --app/);
});

test('the update lock is held by a live update, and taken over from one that was killed', async (t) => {
  const folder = await temporary(t);
  const lockPath = join(folder, 'update.lock');
  const first = await acquireUpdateLock(lockPath);
  await first.writeFile(JSON.stringify({ pid: 4242 }) + '\n');
  await first.close();
  await assert.rejects(acquireUpdateLock(lockPath, (pid: number) => pid === 4242), /Another desktop update holds/);
  const second = await acquireUpdateLock(lockPath, () => false); // its holder is gone: a forced reload ended the task that ran it
  await second.close();
  await writeFile(lockPath, 'not json');
  const third = await acquireUpdateLock(lockPath, () => true); // an unreadable lock has no live holder
  await third.close();
  await rm(lockPath, { force: true });
});
