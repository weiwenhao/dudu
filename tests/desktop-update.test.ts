import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { desktopPackageIdentity, matchesDesktopRuntime, waitForDesktopRuntime, writeDesktopRuntime } from '../host/desktop-runtime.mjs';
import { activateDesktopUpdate } from '../scripts/update-desktop.mjs';

async function temporary(t: any) {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-update-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('desktop identity detects code changes even when the package version stays the same', async (t) => {
  const folder = await temporary(t);
  await mkdir(join(folder, 'dist'));
  for (const [name, text] of Object.entries({
    'package.json': JSON.stringify({ name: 'dudu', version: '0.4.0' }),
    'index.mjs': 'export const name = "dsbot";',
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
  const runtime = { version: '0.3.21' };
  const result = await activateDesktopUpdate({
    running: true, restartRequired: false,
    touchProfile: async () => { actions.push('touch'); },
    waitForRuntime: async () => { actions.push('ready'); return runtime; },
    restart: async () => { throw new Error('Must not restart an already updated runtime.'); },
  });
  assert.deepEqual(result, { mode: 'hot', runtime });
  assert.deepEqual(actions, ['touch', 'ready']);
});

test('an unsuccessful hot reload restarts once and never reports an unready build as installed', async () => {
  const actions: string[] = [];
  await assert.rejects(activateDesktopUpdate({
    running: true, restartRequired: false,
    touchProfile: async () => { actions.push('touch'); },
    waitForRuntime: async () => { actions.push('wait'); return undefined; },
    restart: async () => { actions.push('restart'); },
  }), /did not become ready/);
  assert.deepEqual(actions, ['touch', 'wait', 'restart', 'wait']);
});
