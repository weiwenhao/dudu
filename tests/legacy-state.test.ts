import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyState } from '../host/legacy-state.mjs';

async function home(t: { after: (callback: () => Promise<unknown>) => void }) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-legacy-state-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

test('the first start copies paired devices and settings, and leaves the old folder untouched', async (t) => {
  const dshHome = await home(t);
  await mkdir(join(dshHome, 'dsbot', 'diagnostics'), { recursive: true });
  await writeFile(join(dshHome, 'dsbot', 'devices.json'), '{"id":"computer","devices":[]}');
  await writeFile(join(dshHome, 'dsbot', 'settings.json'), '{"name":"Mac"}');
  await writeFile(join(dshHome, 'dsbot', 'runtime.json'), '{"pid":1}');
  await writeFile(join(dshHome, 'dsbot', 'diagnostics', 'upstream.jsonl'), '{}\n');

  const result = await migrateLegacyState({ dshHome });

  assert.deepEqual(result, { migrated: true, files: ['devices.json', 'settings.json'] });
  assert.equal(await readFile(join(dshHome, 'dudu', 'devices.json'), 'utf8'), '{"id":"computer","devices":[]}');
  assert.equal((await stat(join(dshHome, 'dudu', 'devices.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(dshHome, 'dudu'))).mode & 0o777, 0o700);
  // The receipt and diagnostics belong to the running instance and are not carried over.
  assert.deepEqual((await readdir(join(dshHome, 'dudu'))).sort(), ['devices.json', 'settings.json']);
  assert.equal(await readFile(join(dshHome, 'dsbot', 'runtime.json'), 'utf8'), '{"pid":1}');
  assert.ok((await readdir(dshHome)).every((name) => !name.startsWith('.dudu-migrating-')));
});

test('an existing dudu folder is never overwritten, and a missing old folder is not an error', async (t) => {
  const dshHome = await home(t);
  assert.deepEqual(await migrateLegacyState({ dshHome }), { migrated: false, reason: 'no-source', files: [] });

  await mkdir(join(dshHome, 'dsbot'));
  await writeFile(join(dshHome, 'dsbot', 'devices.json'), 'old');
  await mkdir(join(dshHome, 'dudu'));
  await writeFile(join(dshHome, 'dudu', 'devices.json'), 'new');
  assert.deepEqual(await migrateLegacyState({ dshHome }), { migrated: false, reason: 'target-exists', files: [] });
  assert.equal(await readFile(join(dshHome, 'dudu', 'devices.json'), 'utf8'), 'new');
});

test('a failed copy throws and leaves neither a partial folder nor the new folder', async (t) => {
  const dshHome = await home(t);
  await mkdir(join(dshHome, 'dsbot'));
  await writeFile(join(dshHome, 'dsbot', 'devices.json'), 'ok');
  // A directory where a file is expected makes the copy fail after the first file was staged.
  await mkdir(join(dshHome, 'dsbot', 'settings.json'));

  await assert.rejects(() => migrateLegacyState({ dshHome }));

  assert.deepEqual(await readdir(dshHome), ['dsbot']);
});
