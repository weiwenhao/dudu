// The project folder (docs/assistant.md 3.6): the folder of 嘟嘟's own Markdown files and the working directory of its session.
//
//   defaultFolder(dshHome?, { env }) -> '<dshHome | $DSH_HOME | ~/.dsh>/dudu/home'
//   checkFolder(path, { env, tempRoots }) -> { ok: true, path, real, exists, empty, marked } | { ok: false, code, reason }
//   ensureFolder(path, { env, tempRoots }) -> { ok: true, path, created: [names], kept: [names] } | { ok: false, code, reason }
//   migrate(from, to, { env, tempRoots, useRename = true }) -> { ok: true, from, to, moved, method } | { ok: false, code, reason }
//
// A refusal never throws: it is { ok: false, code, reason } where reason is a plain sentence for the settings page (REASONS, below).
// Checked for a folder, in this order: a full path (a leading ~ is the home folder); not in a temporary location, judged after
// fs.realpath so that a link pointing into one counts (os.tmpdir(), $TMPDIR/$TMP/$TEMP, /tmp, /private/tmp, /var/tmp, /var/folders,
// Windows %TEMP%; for a folder that does not exist yet, its nearest existing parent is resolved); DUDU_ALLOW_TEMP_HOME=1 in `env`
// switches that check off, for isolated test setups only; not a file; writable; and dedicated: a folder that has anything in it
// (but .DS_Store, .git and the like) must carry the marker, the first line of AGENTS.md being <!-- dudu-home -->, so that no
// other project is stirred in. ensureFolder repeats the checks, creates the folder and the seven template files, and never
// overwrites a file that exists. migrate moves a 嘟嘟 folder to an empty place (a rename, or a verified copy when that is
// another disk, then the old folder is removed), so the marker goes with it; the new folder cannot lie inside the old one.
import { accessSync, closeSync, constants, cpSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MARKER, TEMPLATES } from './templates.mjs';

export { MARKER };

// Sentences for the settings page, short and plain (reviewed in the owner's style, 2026-10-31).
export const REASONS = {
  empty: 'Enter a folder path.',
  relative: 'Use a full path.',
  temp: 'That is a temporary folder the system may clear. Choose another.',
  not_directory: 'That path is a file, not a folder.',
  not_dudu: 'That folder already has other files. Choose an empty one, or one 嘟嘟 made.',
  unwritable: '嘟嘟 can\'t write to that folder.',
  unreadable: '嘟嘟 can\'t read that folder.',
  link: 'That path is a link that leads nowhere.',
  source_link: 'The current folder is a link. Move its files yourself.',
  source_not_dudu: 'The current folder is not a 嘟嘟 folder, so nothing was moved.',
  destination_not_empty: 'The new folder must be empty.',
  nested: 'The new folder can\'t be inside the current one, or the other way round.',
  same: 'That is already the folder in use.',
  move_failed: 'The files could not be moved. Nothing was deleted.',
};

// Things a file manager or a version control drops into a folder that is otherwise empty.
const IGNORED = new Set(['.DS_Store', '.git', '.gitignore', '.gitattributes', 'Thumbs.db', 'desktop.ini', '.stfolder', '.stignore']);
const refuse = (code) => ({ ok: false, code, reason: REASONS[code] });

export function defaultFolder(dshHome, { env = process.env } = {}) {
  return join(dshHome || env.DSH_HOME || join(homedir(), '.dsh'), 'dudu', 'home');
}

/** The temporary locations of this machine (as written; checkFolder also compares their real paths). */
export function tempRoots(env = process.env) {
  const roots = new Set([tmpdir(), '/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders']);
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) if (env[name]) roots.add(env[name]);
  return [...roots];
}

const fold = (path) => (process.platform === 'win32' || process.platform === 'darwin' ? path.toLowerCase() : path);
function isInside(child, parent) {
  const rel = relative(fold(parent), fold(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function insideTemp(real, roots) {
  return roots.some((root) => {
    const candidates = [root];
    try {
      candidates.push(realpathSync.native(root));
    } catch {}
    return candidates.some((candidate) => isInside(real, candidate));
  });
}

class Dangling extends Error {}
/** realpath, also for a path that does not exist yet: the nearest existing parent is resolved, the rest is appended. */
function realish(path) {
  const rest = [];
  let current = path;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...rest.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    let link = false;
    try {
      link = lstatSync(current).isSymbolicLink();
    } catch {}
    if (link) throw new Dangling();
    const parent = dirname(current);
    if (parent === current) return path;
    rest.push(basename(current));
    current = parent;
  }
}

function nearestExisting(path) {
  let current = path;
  for (;;) {
    try {
      statSync(current);
      return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function isMarked(dir) {
  try {
    const fd = openSync(join(dir, 'AGENTS.md'), 'r');
    try {
      const buffer = Buffer.alloc(256);
      const read = readSync(fd, buffer, 0, 256, 0);
      return buffer.toString('utf8', 0, read).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].trim() === MARKER;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function expand(input) {
  const text = input.trim();
  if (text === '~') return homedir();
  return text.startsWith('~/') || text.startsWith('~\\') ? join(homedir(), text.slice(2)) : text;
}

export function checkFolder(input, options = {}) {
  const env = options.env ?? process.env;
  if (typeof input !== 'string' || !input.trim()) return refuse('empty');
  const given = expand(input);
  if (!isAbsolute(given)) return refuse('relative');
  const path = resolve(given);
  let real;
  try {
    real = realish(path);
  } catch (error) {
    return refuse(error instanceof Dangling ? 'link' : 'unreadable');
  }
  if (env.DUDU_ALLOW_TEMP_HOME !== '1' && insideTemp(real, options.tempRoots ?? tempRoots(env))) return refuse('temp');
  let stat = null;
  try {
    stat = statSync(real);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return refuse('unreadable');
  }
  if (stat && !stat.isDirectory()) return refuse('not_directory');
  let empty = true;
  let marked = false;
  if (stat) {
    let names;
    try {
      names = readdirSync(real);
    } catch {
      return refuse('unreadable');
    }
    empty = names.every((name) => IGNORED.has(name));
    marked = isMarked(real);
    if (!empty && !marked) return refuse('not_dudu');
  } else if (!statSync(nearestExisting(real)).isDirectory()) {
    return refuse('not_directory');
  }
  try {
    accessSync(stat ? real : nearestExisting(real), constants.W_OK | constants.X_OK);
  } catch {
    return refuse('unwritable');
  }
  return { ok: true, path, real, exists: Boolean(stat), empty, marked };
}

export function ensureFolder(input, options = {}) {
  const check = checkFolder(input, options);
  if (!check.ok) return check;
  try {
    mkdirSync(check.path, { recursive: true, mode: 0o700 });
    const created = [];
    const kept = [];
    for (const [name, text] of Object.entries(TEMPLATES)) {
      try {
        writeFileSync(join(check.path, name), text, { flag: 'wx', mode: 0o600 }); // wx: an existing file is left alone
        created.push(name);
      } catch (error) {
        if (error.code === 'EEXIST') kept.push(name);
        else throw error;
      }
    }
    return { ok: true, path: check.path, created, kept };
  } catch {
    return refuse('unwritable');
  }
}

/** Every file and folder under root with its size (-1 for a link), as a Map of relative paths ('dir/' for folders). */
function tree(root) {
  const found = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        found.set(`${rel}/`, 0);
        walk(join(dir, entry.name), rel);
      } else {
        found.set(rel, entry.isSymbolicLink() ? -1 : statSync(join(dir, entry.name)).size);
      }
    }
  };
  walk(root, '');
  return found;
}

export function migrate(fromInput, toInput, options = {}) {
  const { useRename = true } = options;
  if (typeof fromInput !== 'string' || !fromInput.trim()) return refuse('empty');
  const from = resolve(expand(fromInput));
  let link;
  try {
    link = lstatSync(from);
  } catch (error) {
    if (error.code !== 'ENOENT') return refuse('unreadable');
    // Nothing to move yet: the new place just becomes the folder.
    const made = ensureFolder(toInput, options);
    return made.ok ? { ok: true, from, to: made.path, moved: 0, method: 'none' } : made;
  }
  if (link.isSymbolicLink()) return refuse('source_link');
  if (!link.isDirectory()) return refuse('not_directory');
  if (!isMarked(from)) return refuse('source_not_dudu');

  const check = checkFolder(toInput, options);
  if (!check.ok) return check;
  const fromReal = realpathSync.native(from);
  if (fold(fromReal) === fold(check.real)) return refuse('same');
  if (isInside(check.real, fromReal) || isInside(fromReal, check.real)) return refuse('nested');
  if (check.exists && !check.empty) return refuse('destination_not_empty');

  const before = tree(fromReal);
  let method = 'copy';
  if (useRename && !check.exists) {
    try {
      mkdirSync(dirname(check.path), { recursive: true, mode: 0o700 });
      renameSync(fromReal, check.path);
      method = 'rename';
    } catch {} // another disk, or anything else: copy instead
  }
  if (method === 'copy') {
    const there = check.exists ? tree(check.path) : new Map(); // what the new place held before (a .DS_Store, say)
    try {
      mkdirSync(check.path, { recursive: true, mode: 0o700 });
      cpSync(fromReal, check.path, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      const after = tree(check.path);
      for (const [rel, size] of before) if (after.get(rel) !== size) throw new Error('The copy differs from the original.');
      if (!isMarked(check.path)) throw new Error('The copy has no marker.');
    } catch {
      // Take back what the copy put there; the old folder was not touched.
      if (!check.exists) rmSync(check.path, { recursive: true, force: true });
      else {
        const added = [...tree(check.path).keys()].filter((rel) => !there.has(rel)).sort((a, b) => b.length - a.length);
        for (const rel of added) rmSync(join(check.path, rel), { recursive: true, force: true });
      }
      return refuse('move_failed');
    }
    rmSync(fromReal, { recursive: true, force: true }); // only after the copy was verified
  }
  return { ok: true, from: fromReal, to: check.path, moved: [...before.keys()].filter((rel) => !rel.endsWith('/')).length, method };
}
