import { readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { antigravityConversationsRoot } from './native/antigravity-store.mjs';

// What a harness leaves behind when the plugin reads its models, and the clearing of it. Antigravity gives its models only in the answer to `session/new`, and makes the conversation
// at that moment: `session/close` does not delete it, and nothing else does (2026-11-27: 745 empty conversations in four days, about 410 MB with their folders and logs, one for every
// reading). A reading runs in a folder of its own (`createOarProvider`'s `listingFolder`), which is how its conversation is told from anyone's work: each conversation database records the
// folder it was made for.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only a conversation that was written to since the reading began is looked at (a folder can hold a thousand of them, and every one that is looked at is a database that is opened), with this
// much to spare for clocks; and no more than this many are removed in one pass, so that a mistake in what is recognised cannot take many.
const SLACK_MS = 10_000;
const MOST = 20;

/** Whether `directory` holds nothing but empty folders. */
async function onlyFolders(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !(await onlyFolders(join(directory, entry.name)))) return false;
  }
  return true;
}

/**
 * Remove the conversations that Antigravity made for the reading of its models in `folder` that began at `since`: those written to since then whose database has no step, says in its
 * metadata that it was made for that folder, and whose `brain` folder holds nothing but empty folders. Anything else is left alone, and so is a conversation whose database cannot be
 * read as expected (a later agy may keep these in another way). Antigravity's own index (`conversation_summaries.db`) is not touched: it is reconciled with the folder every time agy starts.
 * @returns how many conversations were removed.
 */
export async function removeAntigravityListings({ env, folder, since = 0 }) {
  const root = antigravityConversationsRoot(env);
  const brain = join(dirname(root), 'brain');
  const marks = [pathToFileURL(folder).href, folder];
  let names;
  try { names = await readdir(root); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    const match = /^(.*)\.db$/.exec(name);
    if (!match || !ID.test(match[1])) continue;
    const file = join(root, name);
    if (removed >= MOST) break;
    try {
      if ((await stat(file)).mtimeMs < since - SLACK_MS) continue;
      let ours = false;
      const database = new DatabaseSync(file, { readOnly: true, timeout: 500 });
      try {
        if (database.prepare('select count(*) as n from steps').get().n === 0) {
          const metadata = Buffer.from(database.prepare('select data from trajectory_metadata_blob').get()?.data ?? []).toString('latin1');
          ours = marks.some((mark) => metadata.includes(mark));
        }
      } finally { database.close(); }
      if (!ours) continue;
      const own = join(brain, match[1]);
      let hasFolder = true;
      try { await stat(own); } catch { hasFolder = false; }
      if (hasFolder && !(await onlyFolders(own))) continue;
      for (const path of [file, `${file}-wal`, `${file}-shm`]) await rm(path, { force: true });
      if (hasFolder) await rm(own, { recursive: true, force: true });
      removed++;
    } catch { /* not readable, or in use: left alone */ }
  }
  return removed;
}
