import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { removeAntigravityListings } from '../host/providers/listing-leftovers.mjs';

// 2026-11-27: every reading of Antigravity's models (`session/new`) left an empty conversation in its own store, 745 in four days. The conversation database records the folder it was made
// for, so a reading in a folder of its own is told from anyone's work. What is removed is made here the way agy makes it: a database with a table of steps and one of metadata.

const FOLDER = '/work/model-listing';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function store(t: { after: (cleanup: () => Promise<void>) => void }) {
  const home = await mkdtemp(join(tmpdir(), 'dudu-listing-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, 'antigravity-cli');
  await mkdir(join(root, 'conversations'), { recursive: true });
  await mkdir(join(root, 'brain'), { recursive: true });
  /** A conversation: `steps` rows, the folder it was made for, and what is in its brain folder (`'empty'` folders, `'file'`, or none). */
  const conversation = async (n: number, { steps = 0, folder = FOLDER, brain = 'empty' as 'empty' | 'file' | 'none' } = {}) => {
    const file = join(root, 'conversations', `${uuid(n)}.db`);
    const database = new DatabaseSync(file);
    database.exec('create table steps (idx integer primary key, step_type integer)');
    database.exec('create table trajectory_metadata_blob (id text primary key, data blob)');
    for (let i = 0; i < steps; i++) database.prepare('insert into steps values (?, ?)').run(i, 14);
    database.prepare('insert into trajectory_metadata_blob values (?, ?)').run('main', Buffer.from(`\n\x20${pathToFileURL(folder).href}\x00\x01$2d9`, 'latin1'));
    database.close();
    if (brain !== 'none') {
      await mkdir(join(root, 'brain', uuid(n), 'scratch'), { recursive: true });
      await mkdir(join(root, 'brain', uuid(n), '.user_uploaded'), { recursive: true });
      if (brain === 'file') await writeFile(join(root, 'brain', uuid(n), 'scratch', 'notes.md'), 'kept');
    }
    return file;
  };
  const left = async () => (await readdir(join(root, 'conversations'))).filter((name) => name.endsWith('.db')).map((name) => Number(name.slice(24, 36))).sort((a, b) => a - b);
  const brains = async () => (await readdir(join(root, 'brain'))).map((name) => Number(name.slice(24, 36))).sort((a, b) => a - b);
  return { env: { GEMINI_HOME: home }, root, conversation, left, brains };
}

test('what a reading made is removed, and nothing that anyone worked in', async (t) => {
  const { env, conversation, left, brains } = await store(t);
  await conversation(1);                                        // the reading's: empty, made for the folder
  const walled = await conversation(2);                         // the same, with the files a database that was not closed leaves
  await writeFile(`${walled}-wal`, Buffer.alloc(64));
  await writeFile(`${walled}-shm`, Buffer.alloc(64));
  await conversation(3, { steps: 4 });                          // something was said in it
  await conversation(4, { folder: '/Users/someone' });          // another folder (the home folder: the readings of the old versions, and a person's own)
  await conversation(5, { brain: 'file' });                     // empty, but its brain folder has a file
  await conversation(6, { brain: 'none' });                     // the reading's, without a brain folder
  assert.equal(await removeAntigravityListings({ env, folder: FOLDER }), 3);
  assert.deepEqual(await left(), [3, 4, 5]);
  assert.deepEqual(await brains(), [3, 4, 5], 'the empty brain folders went with their conversations');
  assert.deepEqual((await readdir(join(env.GEMINI_HOME, 'antigravity-cli', 'conversations'))).filter((name) => /-(wal|shm)$/.test(name)), []);
  assert.equal(await removeAntigravityListings({ env, folder: FOLDER }), 0, 'and a second pass finds nothing');
});

test('only a conversation written to since the reading began is looked at, and no more than twenty go in one pass', async (t) => {
  const { env, conversation, left } = await store(t);
  for (let n = 1; n <= 25; n++) await conversation(n);
  assert.equal(await removeAntigravityListings({ env, folder: FOLDER, since: Date.now() + 3_600_000 }), 0, 'all of them were written long before this reading');
  assert.equal(await removeAntigravityListings({ env, folder: FOLDER, since: Date.now() - 60_000 }), 20);
  assert.equal((await left()).length, 5);
});

test('a store that cannot be read as expected is left as it is', async (t) => {
  const { env, root, left } = await store(t);
  await writeFile(join(root, 'conversations', `${uuid(1)}.db`), 'this is not a database');
  const other = new DatabaseSync(join(root, 'conversations', `${uuid(2)}.db`));
  other.exec('create table something_else (x)');            // a layout of a later agy
  other.close();
  await writeFile(join(root, 'conversations', 'notes.txt'), 'not a conversation');
  assert.equal(await removeAntigravityListings({ env, folder: FOLDER }), 0);
  assert.deepEqual(await left(), [1, 2]);
  assert.equal((await stat(join(root, 'conversations', 'notes.txt'))).isFile(), true);
  assert.equal(await removeAntigravityListings({ env: { GEMINI_HOME: join(root, 'missing') }, folder: FOLDER }), 0, 'no folder of conversations is none to remove');
});
