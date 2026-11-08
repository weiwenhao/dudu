// The settings page edits the owner's rules. The memory and model tools keep their read-only access.
import { randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFiles, FileError } from './memory/files.mjs';

export const RULE_FILES = ['TRIAGE.md', 'ASSIGN.md'];

/** Replace exactly the revision shown in settings, preserving external edits and the existing file mode. */
export function updateOwnerRule(dir, { name, text, previous, projectFolder } = {}, { rename = renameSync } = {}) {
  if (!RULE_FILES.includes(name) || typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 2_000_000
    || (previous !== null && typeof previous !== 'string')) {
    return { outcome: 'needs_clarification', code: 'INVALID_RULE' };
  }
  if (projectFolder !== dir) return { outcome: 'error', code: 'FOLDER_CHANGED' };
  const files = createFiles({ dir });
  const path = join(dir, name);
  let temp;
  try {
    const inspect = () => {
      let stat;
      try { stat = lstatSync(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat?.isSymbolicLink()) throw new FileError('SYMLINK', 'Rule edits do not replace links.');
      return { stat, text: files.read(name)?.text ?? null };
    };
    const before = inspect();
    if (before.text !== previous) return { outcome: 'error', code: 'CONFLICT' };
    if (before.text === text) return { outcome: 'no_op', name, text };
    temp = join(dir, `.${name}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    writeFileSync(temp, text, { flag: 'wx', mode: 0o600 });
    if (before.stat) chmodSync(temp, before.stat.mode & 0o777);
    if (inspect().text !== previous) return { outcome: 'error', code: 'CONFLICT' };
    rename(temp, path);
    return { outcome: 'success', name, text };
  } catch (error) {
    return { outcome: 'error', code: error instanceof FileError ? error.code : 'WRITE_FAILED' };
  } finally {
    if (temp) try { unlinkSync(temp); } catch {}
  }
}
