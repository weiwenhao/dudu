import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * What a harness said of its models the last time it was read, kept on disk with what it was said for: the `version` and the `command` (the path) of the harness, and the `mark` (what the harness's
 * cheap way of listing its models said then, '' for a harness that has none). The list stays good until someone asks for it to be read again (owner, 2026-11-27: kept for good, and read anew only
 * when a person asks, the harness was updated, or there is nothing yet): a restart finds it, and a harness whose models can be checked without a session (`agy models` makes no conversation, and
 * OAR's reading of Antigravity's models does) is read in full only when the mark is not what it was.
 */
export function createModelCache(file) {
  let entries;
  const load = async () => {
    if (entries) return entries;
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      entries = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch { entries = {}; } // none yet, or unreadable: nothing is known, and the harness is read in full
    return entries;
  };
  let writing = Promise.resolve();
  return {
    /** The entry of harness `id`, or undefined when there is none or it is not what was written. */
    async get(id) {
      const entry = (await load())[id];
      if (!entry || typeof entry.mark !== 'string' || typeof entry.version !== 'string' || !Array.isArray(entry.models)) return undefined;
      const models = entry.models.filter((model) => typeof model?.id === 'string' && model.id);
      return models.length ? { mark: entry.mark, version: entry.version, command: typeof entry.command === 'string' ? entry.command : '', models } : undefined;
    },
    set(id, { mark, version, command = '', models }) {
      writing = writing.then(async () => {
        const all = await load();
        all[id] = { mark, version, command, models, at: Date.now() };
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(all)}\n`, { mode: 0o600 });
        await rename(temporary, file);
      }).catch(() => { /* the next reading is a full one, which costs a session and nothing else */ });
      return writing;
    },
  };
}
