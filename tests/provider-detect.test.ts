import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, detectHarness, findExecutable, parseVersion } from '../host/providers/detect.mjs';

async function sandbox(t: { after: (callback: () => Promise<unknown>) => void }) {
  const home = await mkdtemp(join(tmpdir(), 'dudu-detect-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

async function cli(directory: string, name: string, output: string, mode = 0o755) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\necho "${output}"\n`);
  await chmod(path, mode);
  return path;
}

const noShell = async () => [];
// The machine's own /usr/local/bin may hold the very CLIs under test; the tests look only inside their sandbox.
const isolated = { systemDirectories: [], shellPath: noShell };

test('versions are read from the usual CLI banners and compared numerically', () => {
  assert.deepEqual(parseVersion('2.1.312 (Claude Code)')?.parts, [2, 1, 312]);
  assert.deepEqual(parseVersion('codex-cli 0.162.1')?.parts, [0, 162, 1]);
  assert.deepEqual(parseVersion('v1.2.3-rc.1')?.text, '1.2.3-rc.1');
  assert.equal(parseVersion('no version here'), undefined);
  assert.equal(compareVersions([0, 162, 1], [0, 136, 0]), 1);
  assert.equal(compareVersions([0, 9, 0], [0, 10, 0]), -1);
  assert.equal(compareVersions([2, 1, 3], [2, 1, 3]), 0);
});

test('a CLI outside the inherited PATH is still found in the usual install directories', async (t) => {
  const home = await sandbox(t);
  const claude = await cli(join(home, '.local', 'bin'), 'claude', '2.1.312 (Claude Code)');
  const found = await findExecutable('claude', { env: { PATH: '/nonexistent' }, home, ...isolated });
  assert.deepEqual(found, { path: claude, source: 'common' });
});

test('the inherited PATH wins over the usual directories, and a configured path wins over both', async (t) => {
  const home = await sandbox(t);
  await cli(join(home, '.local', 'bin'), 'claude', 'common');
  const onPath = await cli(join(home, 'on-path'), 'claude', 'path');
  const custom = await cli(join(home, 'custom'), 'my-claude', 'custom');
  assert.deepEqual(await findExecutable('claude', { env: { PATH: join(home, 'on-path') }, home, ...isolated }), { path: onPath, source: 'path' });
  assert.deepEqual(await findExecutable('claude', { override: custom, env: { PATH: join(home, 'on-path') }, home, ...isolated }), { path: custom, source: 'configured' });
  assert.equal(await findExecutable('claude', { override: join(home, 'missing'), env: { PATH: '' }, home, ...isolated }), undefined);
});

test('the login shell is asked only when the cheaper places miss', async (t) => {
  const home = await sandbox(t);
  let asked = 0;
  await cli(join(home, 'on-path'), 'codex', '0.162.1');
  await findExecutable('codex', { env: { PATH: join(home, 'on-path') }, home, systemDirectories: [], shellPath: async () => { asked++; return []; } });
  assert.equal(asked, 0);
  const hidden = await cli(join(home, 'only-in-shell'), 'codex', '0.162.1');
  const found = await findExecutable('codex', { env: { PATH: '' }, home, systemDirectories: [], shellPath: async () => { asked++; return [join(home, 'only-in-shell')]; } });
  assert.deepEqual(found, { path: hidden, source: 'login-shell' });
  assert.equal(asked, 1);
});

test('a file that is not executable is not a CLI', async (t) => {
  const home = await sandbox(t);
  await cli(join(home, 'bin'), 'claude', '1.0.0', 0o644);
  assert.equal(await findExecutable('claude', { env: { PATH: join(home, 'bin') }, home, ...isolated }), undefined);
});

test('a harness is ready, outdated, broken or missing, with the reason the settings page shows', async (t) => {
  const home = await sandbox(t);
  const env = { PATH: join(home, 'bin') };
  assert.equal((await detectHarness({ name: 'claude', env, home, ...isolated })).state, 'missing');

  await cli(join(home, 'bin'), 'claude', '2.1.312 (Claude Code)');
  const ready = await detectHarness({ name: 'claude', minVersion: '2.0.0', env, home, ...isolated });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.version, '2.1.312');

  await cli(join(home, 'bin'), 'codex', 'codex-cli 0.100.0');
  const outdated = await detectHarness({ name: 'codex', minVersion: '0.136.0', env, home, ...isolated });
  assert.equal(outdated.state, 'outdated');
  assert.match(outdated.reason, /older than 0\.136\.0/);

  await cli(join(home, 'bin'), 'grok', 'banner without a number');
  assert.equal((await detectHarness({ name: 'grok', env, home, ...isolated })).state, 'broken');

  const configured = await detectHarness({ name: 'claude', override: join(home, 'nowhere'), env, home, ...isolated });
  assert.equal(configured.state, 'missing');
  assert.match(configured.reason, /is not an executable file/);
});
