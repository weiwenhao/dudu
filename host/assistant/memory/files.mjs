// The Markdown side of the memory: the files in the project folder (docs/assistant.md 3.5).
//
//   const files = createFiles({ dir, rename = fs.renameSync });
//
// What may be written: USER.md and MEMORY.md (entries), memory/<date>.md (the day's flow), reviews/<date>.md (what a tidy changed)
// and skills/<name>/SKILL.md. AGENTS.md, SOUL.md, TRIAGE.md and ASSIGN.md are the owner's rule files: they can be read, and every
// write path refuses them (FileError code PROTECTED). Anything else is refused too (NOT_ALLOWED), CONNECTORS.md included: it
// belongs to the connectors. Paths are checked against this list, not against a list of bad names, so "./AGENTS.md", "agents.md",
// "memory/../AGENTS.md" and friends never reach the disk. A link is never written through (SYMLINK).
//
// A write is read -> work -> check -> temp file + rename. `modify(rel, transform)` reads the file, calls transform(text), and
// before it replaces the file it reads it again: if the owner saved it in an editor meanwhile (the content hash differs) it reads
// again and redoes the work, up to 3 times, then throws CONFLICT. There is no cache: every call starts from what is on disk. The
// check and the rename are not one atomic step, so a save in that very instant is still lost; the window is microseconds.
//
// A curated file is a preamble (anything before the first entry, the owner's words included) and entries:
//     <!-- m3 | 2026-10-29 | active | turn:12,turn:40 -->
//     The body, until the next entry line.
// id | since (local date) | status (active | superseded) | src (comma separated sources: turn:<id> in the history index, or
// owner). Writing normalises line endings to LF and puts one blank line between entries; an entry's own text is kept as written.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import { findSecret, SECRET_LABELS } from './secrets.mjs';

export const PROTECTED = ['AGENTS.md', 'SOUL.md', 'TRIAGE.md', 'ASSIGN.md'];
// Budgets are characters (JavaScript string length) of what the model is given for the file: see renderContext.
export const CURATED = {
  USER: { file: 'USER.md', prefix: 'u', budget: 4000 },
  MEMORY: { file: 'MEMORY.md', prefix: 'm', budget: 8000 },
};
export const ENTRY_MAX = 800;
const MAX_FILE = 2_000_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

export class FileError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date of a time in ms, 'YYYY-MM-DD'. */
export const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Local clock time of a time in ms, 'HH:MM'. */
export const timeOf = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// --- the curated format (pure functions on text)
const normalize = (text) => String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const HEADER = /^<!--[ \t]*([A-Za-z][A-Za-z0-9_-]{0,30})[ \t]*\|[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*\|[ \t]*(active|superseded)[ \t]*\|([^\n]*?)-->[ \t]*$/gm;

export const parseRefs = (value) => String(value ?? '').split(',').map((part) => part.trim()).filter(Boolean);

/** { preamble, entries: [{ id, since, status, src: [], text }] }. A line that is not an entry line is body text. */
export function parseCurated(input) {
  const text = normalize(input);
  const marks = [...text.matchAll(HEADER)];
  const preamble = (marks.length ? text.slice(0, marks[0].index) : text).trimEnd();
  const entries = marks.map((mark, i) => ({
    id: mark[1], since: mark[2], status: mark[3], src: parseRefs(mark[4]),
    text: text.slice(mark.index + mark[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length).trim(),
  }));
  return { preamble, entries };
}

export const renderEntry = ({ id, since, status, src, text }) => `<!-- ${id} | ${since} | ${status} | ${src.join(',')} -->${text ? `\n${text}` : ''}`;

export function serializeCurated({ preamble, entries }) {
  const parts = [];
  if (preamble.trim()) parts.push(preamble.trimEnd());
  for (const entry of entries) parts.push(renderEntry(entry));
  return parts.length ? `${parts.join('\n\n')}\n` : '';
}

export class EntryTextError extends Error {}

/**
 * The clean text of an entry, or EntryTextError saying why not: not text, empty, longer than ENTRY_MAX, containing <!-- or -->
 * (it could forge an entry line), or looking like a password, key or card number (see secrets.mjs). The message never repeats
 * the text.
 */
export function checkEntryText(value) {
  if (typeof value !== 'string') throw new EntryTextError('The text must be text.');
  const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().replace(/\n{3,}/g, '\n\n');
  if (!text) throw new EntryTextError('The text must not be empty.');
  if (text.length > ENTRY_MAX) throw new EntryTextError(`An entry is a short statement of at most ${ENTRY_MAX} characters. Shorten it or split it.`);
  if (/<!--|-->/.test(text)) throw new EntryTextError('The text cannot contain <!-- or -->.');
  const kind = findSecret(text);
  if (kind) throw new EntryTextError(`This looks like ${SECRET_LABELS[kind]}. Passwords, keys and card numbers are not stored. Say what it is for, without the value.`);
  return text;
}

export const findEntry = (parsed, id) => parsed.entries.find((entry) => entry.id === id) ?? null;

/** The next id for a file: its prefix and one more than the highest number in it (a deleted highest id is reused). */
export function nextId(parsed, prefix) {
  let max = 0;
  for (const { id } of parsed.entries) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

/** 'USER' or 'MEMORY' for an entry id (u3, m12), else null. */
export const curatedOf = (id) => (/^u\d+$/.test(id) ? 'USER' : /^m\d+$/.test(id) ? 'MEMORY' : null);

/** The text without <!-- ... --> comments (an unclosed one stays as text). Linear, however many openers there are. */
export function stripComments(text) {
  const value = String(text);
  let out = '';
  let from = 0;
  for (;;) {
    const open = value.indexOf('<!--', from);
    const close = open < 0 ? -1 : value.indexOf('-->', open + 4);
    if (close < 0) return out + value.slice(from);
    out += value.slice(from, open);
    from = close + 3;
  }
}

/**
 * What the model is given for a curated file: the preamble without HTML comments, then one line per ACTIVE entry
 * ("- [m3] (2026-10-29) text"). Over the budget, the oldest entries are left out first. Writes check the same number.
 */
export function renderContext(parsed, budget = Infinity) {
  const head = stripComments(parsed.preamble).replace(/\n{3,}/g, '\n\n').trim();
  const lines = parsed.entries.filter((entry) => entry.status === 'active').map((entry) => `- [${entry.id}] (${entry.since}) ${entry.text.replace(/\n/g, '\n  ')}`);
  const joined = (list) => [head, ...list].filter(Boolean).join('\n');
  let kept = lines;
  while (kept.length && joined(kept).length > budget) kept = kept.slice(1);
  let text = joined(kept);
  const cut = text.length > budget;
  if (cut) text = text.slice(0, budget);
  return { text, chars: text.length, truncated: cut || kept.length < lines.length, omitted: lines.length - kept.length };
}

// --- the folder
export function createFiles({ dir, rename = renameSync }) {
  const clean = (rel) => {
    const path = typeof rel === 'string' && rel && !rel.includes('\0') ? posix.normalize(rel.replaceAll('\\', '/')) : '..';
    if (path.startsWith('/') || path === '..' || path.startsWith('../') || /^[A-Za-z]:/.test(path)) throw new FileError('NOT_ALLOWED', 'That is not a file in the project folder.');
    return path;
  };
  const kindOf = (path) => {
    if (/^(?:USER|MEMORY)\.md$/.test(path)) return 'curated';
    if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) return 'daily';
    if (/^reviews\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) return 'review';
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
    return skill && NAME.test(skill[1]) ? 'skill' : null;
  };
  const target = (path) => join(dir, ...path.split('/'));
  function writable(rel) {
    const path = clean(rel);
    if (PROTECTED.some((name) => name.toLowerCase() === path.toLowerCase())) throw new FileError('PROTECTED', `${path} is a rule file. Only the owner changes it.`);
    if (!kindOf(path)) throw new FileError('NOT_ALLOWED', `${path} is not a file the memory writes.`);
    return { path, abs: target(path) };
  }
  function readable(rel) {
    const path = clean(rel);
    if (!PROTECTED.includes(path) && !kindOf(path)) throw new FileError('NOT_ALLOWED', `${path} is not a file the memory reads.`);
    return { path, abs: target(path) };
  }

  function snapshot(abs) {
    let stat;
    try {
      stat = statSync(abs);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { exists: false, text: '', hash: null };
      throw error;
    }
    if (!stat.isFile()) throw new FileError('NOT_ALLOWED', `${basename(abs)} is not a regular file.`);
    if (stat.size > MAX_FILE) throw new FileError('TOO_LARGE', `${basename(abs)} is too large to read.`);
    const buffer = readFileSync(abs);
    return { exists: true, text: buffer.toString('utf8'), hash: createHash('sha256').update(buffer).digest('hex') };
  }

  function ensureRoot() {
    let stat = null;
    try {
      stat = statSync(dir);
    } catch {}
    if (!stat?.isDirectory()) throw new FileError('NO_FOLDER', 'The project folder does not exist. Choose it again in the settings.');
  }

  function atomicWrite(abs, text, durable) {
    mkdirSync(dirname(abs), { recursive: true, mode: 0o700 });
    const temp = join(dirname(abs), `.${basename(abs)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeSync(fd, text);
      if (durable) fsyncSync(fd); // the day's flow is a convenience: it is written atomically but not forced to the disk
      closeSync(fd);
      fd = undefined;
      try {
        chmodSync(temp, statSync(abs).mode & 0o777); // keep the mode the owner gave an existing file
      } catch {}
      rename(temp, abs);
    } catch (error) {
      if (fd !== undefined) try { closeSync(fd); } catch {}
      try { unlinkSync(temp); } catch {}
      throw error;
    }
  }

  function refuseLink(abs) {
    let stat = null;
    try {
      stat = lstatSync(abs);
    } catch {}
    if (stat?.isSymbolicLink()) throw new FileError('SYMLINK', `${basename(abs)} is a link, not a file. The memory does not write through links.`);
  }

  /** transform(text) -> { text, result } to write, or null / the same text to leave the file alone. Returns { changed, result }. */
  function modify(rel, transform, { attempts = 3 } = {}) {
    const { path, abs } = writable(rel);
    ensureRoot();
    for (let attempt = 0; attempt < attempts; attempt++) {
      refuseLink(abs);
      const before = snapshot(abs);
      const out = transform(before.text);
      if (!out || typeof out.text !== 'string' || out.text === before.text) return { changed: false, result: out?.result };
      if (snapshot(abs).hash !== before.hash) continue; // saved in an editor while we worked: read again, redo
      atomicWrite(abs, out.text, kindOf(path) !== 'daily');
      return { changed: true, result: out.result };
    }
    throw new FileError('CONFLICT', `${path} kept changing while it was being written. Try again.`);
  }

  function read(rel) {
    const found = snapshot(readable(rel).abs);
    return found.exists ? { text: found.text, hash: found.hash } : null;
  }

  function remove(rel) {
    const { path, abs } = writable(rel);
    refuseLink(abs);
    try {
      unlinkSync(abs);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    if (kindOf(path) === 'skill') {
      try { rmdirSync(dirname(abs)); } catch {} // only when nothing else is in the skill's folder
    }
    return true;
  }

  function list(area) {
    if (!['memory', 'reviews', 'skills'].includes(area)) throw new FileError('NOT_ALLOWED', `${area} is not a folder the memory reads.`);
    let found;
    try {
      found = readdirSync(join(dir, area), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
      throw error;
    }
    if (area === 'skills') return found.filter((e) => e.isDirectory() && NAME.test(e.name)).map((e) => e.name).sort();
    return found.filter((e) => e.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name)).map((e) => e.name.slice(0, -3)).sort();
  }

  return {
    dir,
    /** { text, hash } of a file the memory may read (its own, and the four rule files), or null if it does not exist. */
    read,
    /** The parsed USER or MEMORY file ('USER' | 'MEMORY'); a missing file is an empty one. */
    readCurated: (name) => parseCurated(read(CURATED[name].file)?.text ?? ''),
    modify,
    /** Replaces a whole file (still atomic, still only the files the memory may write). */
    write: (rel, text) => modify(rel, () => ({ text: String(text) })),
    /** Deletes a file the memory may write (a skill's folder too, when nothing else is in it). Returns whether it existed. */
    remove,
    /** Day names ('2026-10-29') in memory/ and reviews/, folder names in skills/. */
    list,
    /** Appends lines to the day's flow, starting the file with its date. */
    appendDaily(day, lines) {
      if (!DAY.test(day)) throw new FileError('NOT_ALLOWED', 'A day looks like 2026-10-29.');
      const add = (Array.isArray(lines) ? lines : [lines]).join('\n');
      return modify(`memory/${day}.md`, (text) => ({ text: text ? `${text.replace(/\n*$/, '\n')}${add}\n` : `# ${day}\n\n${add}\n` }));
    },
    /** The "- ..." lines of every daily file for which predicate(line) is true: [{ day, line }]. */
    findDailyLines(predicate) {
      const found = [];
      for (const day of list('memory')) {
        for (const line of snapshot(target(`memory/${day}.md`)).text.split('\n')) if (line.startsWith('- ') && predicate(line)) found.push({ day, line });
      }
      return found;
    },
    /** Removes those lines; a file left with no lines is deleted. Returns how many were removed. */
    removeDailyLines(predicate) {
      let removed = 0;
      for (const day of list('memory')) {
        const rel = `memory/${day}.md`;
        const gone = (line) => line.startsWith('- ') && predicate(line);
        const text = snapshot(target(rel)).text;
        if (!text.split('\n').some(gone)) continue;
        if (!text.split('\n').some((line) => line.startsWith('- ') && !predicate(line))) {
          if (remove(rel)) removed += text.split('\n').filter(gone).length;
          continue;
        }
        let count = 0; // set, not added: the work is redone when the owner saved the file meanwhile
        modify(rel, (current) => {
          const lines = current.split('\n');
          const kept = lines.filter((line) => !gone(line));
          count = lines.length - kept.length;
          return { text: kept.join('\n') };
        });
        removed += count;
      }
      return removed;
    },
  };
}
