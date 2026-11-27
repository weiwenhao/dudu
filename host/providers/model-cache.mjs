import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * What a harness said of its models the last time it was asked, kept on disk with what it was said for: `mark` (what the harness's cheap way of listing its models said then) and the
 * `version` of the harness. A harness whose models can be checked without a session (`agy models` makes no conversation, and OAR's reading of Antigravity's models does) is read in full only
 * when the mark or the version is not what it was (owner, 2026-11-27: asking agy for models must not open a conversation if it can be helped).
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
      return models.length ? { mark: entry.mark, version: entry.version, models } : undefined;
    },
    set(id, { mark, version, models }) {
      writing = writing.then(async () => {
        const all = await load();
        all[id] = { mark, version, models, at: Date.now() };
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, `${JSON.stringify(all)}\n`, { mode: 0o600 });
        await rename(temporary, file);
      }).catch(() => { /* the next reading is a full one, which costs a session and nothing else */ });
      return writing;
    },
  };
}
