// CONNECTORS.md: the registry of connectors, a Markdown file the owner can read and edit (docs/assistant.md 3.1).
//
//   ## 飞书（命令行）
//   <!-- id: lark | enabled: false | source: dudu | since: 2026-10-29 -->
//   读日程和任务。
//
//   ```json
//   { "kind": "cli", "command": "lark-cli", "allow": ["calendar +agenda --start {date}"] }
//   ```
//
// One `##` section per connector: the heading is the name, the comment holds the metadata, the text up to the json
// block is the description, and the json block is the machine configuration (see schema.mjs). Everything else in the
// file is the owner's: the intro before the first section, notes inside or between sections, a `#` section of their
// own, examples inside code fences or comments. Reading never changes it, and a change to one connector rewrites only
// the lines that belong to that change, so the owner's text survives it byte for byte (line endings and a leading BOM
// included). A section that cannot be used is skipped with a diagnostic { id?, line, reason } and the rest load.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ID, normalizeConfig } from './schema.mjs';
import { TEXT } from './text.mjs';

export const MAX_BYTES = 1_000_000;
const METAKEY = /(?:^|\|)\s*id\s*:/i;

export const digestOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const startsEntry = (lines, i) => /^ {0,3}##[ \t]+\S/.test(lines[i]) && lines.slice(i + 1, i + 4).some((line) => /^ {0,3}<!--.*\bid\s*:/i.test(line));

// --- reading the lines: headings, code fences and comments, the way Markdown sees them (a heading inside a fence or
// a multi-line comment is not a heading).
function scanOnce(lines, ignored) {
  const headings = [];
  const fences = [];
  const comments = [];
  let fence = null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        fence.close = i;
        fence = null;
        continue;
      }
      // JSON cannot hold a heading with a metadata comment under it, so a json block that runs into one was not closed:
      // that line starts the next connector. (The block stays unclosed; scan() reads it as plain text on the next pass.)
      if (fence.info.toLowerCase() !== 'json' || !startsEntry(lines, i)) continue;
      fence = null;
    }
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      const info = open[2].trim();
      if (ignored.has(i)) continue;
      fence = { open: i, close: -1, char: open[1][0], len: open[1].length, info };
      fences.push(fence);
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (heading) {
      headings.push({ index: i, level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const comment = /^ {0,3}<!--(.*)$/.exec(line);
    if (comment) {
      const end = comment[1].indexOf('-->');
      if (end < 0) inComment = true;
      else if (/^[ \t]*$/.test(comment[1].slice(end + 3))) comments.push({ index: i, inner: comment[1].slice(0, end) });
    }
  }
  return { headings, fences, comments };
}

// A code fence that is never closed would swallow the rest of the file, and with it every connector after it. Such a
// fence is read as plain text instead (and its own section is reported), so one broken block costs one entry.
function scan(lines) {
  const ignored = new Map();
  for (let pass = 0; pass < 10; pass++) {
    const found = scanOnce(lines, new Set(ignored.keys()));
    const unclosed = found.fences.filter((fence) => fence.close < 0);
    if (!unclosed.length) return { ...found, ignored };
    for (const fence of unclosed) ignored.set(fence.open, fence.info);
  }
  return { ...scanOnce(lines, new Set(ignored.keys())), ignored };
}

function readMeta(inner) {
  const meta = {};
  for (const part of inner.split('|')) {
    const pair = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/s.exec(part);
    if (pair) meta[pair[1].toLowerCase()] = pair[2];
  }
  return meta;
}

// Where a JSON syntax error is, without the text around it (V8 quotes a piece of the input, which could be anything).
function whereIs(error) {
  const message = String(error?.message ?? '');
  const line = /\(line (\d+) column (\d+)\)/.exec(message);
  if (line) return ` (line ${line[1]}, column ${line[2]})`;
  const position = /position (\d+)/.exec(message);
  return position ? ` (at position ${position[1]})` : '';
}

export function parseRegistry(text) {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(eol);
  const { headings, fences, comments, ignored } = scan(lines);
  // `unclosed`: the lines of code fences that are never closed. They are read as plain text, so the entries around them
  // load, but a section added at the end would close them and be swallowed: nothing is added to such a file.
  const parsed = { bom, eol, lines, entries: [], diagnostics: [], ids: new Set(), unclosed: [...ignored.keys()].map((open) => open + 1) };
  const sections = headings.filter((heading) => heading.level <= 2);
  const firstSeen = new Map();
  sections.forEach((heading, n) => {
    if (heading.level !== 2) return;
    const start = heading.index;
    const end = sections[n + 1]?.index ?? lines.length;
    const inside = (index) => index > start && index < end;
    const meta = comments.find((comment) => inside(comment.index) && METAKEY.test(comment.inner));
    const json = fences.filter((fence) => inside(fence.open) && fence.info.toLowerCase() === 'json');
    const unclosed = [...ignored].filter(([open, info]) => inside(open) && info.toLowerCase() === 'json');
    // Prose with neither a metadata comment nor a json block is the owner's, not a broken entry.
    if (!meta && !json.length && !unclosed.length) return;
    const fail = (reason, at = start, id) => parsed.diagnostics.push({ ...(id ? { id } : {}), line: at + 1, reason });
    if (!meta) return fail(TEXT.skipped.noMeta);
    const fields = readMeta(meta.inner);
    const id = fields.id;
    if (!id || !ID.test(id)) return fail(TEXT.skipped.badId, meta.index);
    parsed.ids.add(id);
    if (fields.enabled !== undefined && !/^(?:true|false)$/.test(fields.enabled)) return fail(TEXT.skipped.badEnabled, meta.index, id);
    if (unclosed.length) return fail(TEXT.skipped.unclosedJson, unclosed[0][0], id);
    if (!json.length) return fail(TEXT.skipped.noJson, start, id);
    if (json.length > 1) return fail(TEXT.skipped.manyJson, json[1].open, id);
    const fence = json[0];
    let raw;
    try {
      raw = JSON.parse(lines.slice(fence.open + 1, fence.close).join('\n'));
    } catch (error) {
      return fail(TEXT.skipped.badJson(whereIs(error)), fence.open, id);
    }
    const checked = normalizeConfig(raw);
    if (checked.problems) return fail(checked.problems.join(' '), fence.open, id);
    if (firstSeen.has(id)) return fail(TEXT.skipped.duplicate(firstSeen.get(id) + 1), start, id);
    firstSeen.set(id, start);
    const described = meta.index < fence.open ? lines.slice(meta.index + 1, fence.open).join('\n').trim() : '';
    parsed.entries.push({
      id, name: heading.text, enabled: fields.enabled === 'true', source: fields.source === 'dudu' ? 'dudu' : 'owner', since: fields.since ?? null,
      description: described, config: checked.config, raw, line: start + 1, start, end, metaIndex: meta.index, jsonOpen: fence.open, jsonClose: fence.close,
    });
  });
  return parsed;
}

// --- writing: each function returns the new text; nothing here touches the disk

export const renderEntry = ({ id, name, enabled, source, since, description, config }) => [
  `## ${name}`,
  `<!-- id: ${id} | enabled: ${enabled} | source: ${source}${since ? ` | since: ${since}` : ''} -->`,
  ...(description ? [description] : []),
  '',
  '```json',
  ...JSON.stringify(config, null, 2).split('\n'),
  '```',
];

const assemble = (parsed, lines) => parsed.bom + lines.join(parsed.eol);

// The section of an entry as the file has it, for the undo journal.
export const sectionOf = (parsed, entry) => parsed.lines.slice(entry.start, entry.end).join(parsed.eol);

// Sets `key: value` inside the metadata comment where it is, or adds it before the end of the comment.
export function setMeta(line, key, value) {
  const found = /^(\s*<!--)(.*?)(-->\s*)$/.exec(line);
  if (!found) return line;
  const parts = found[2].split('|');
  const at = parts.findIndex((part) => new RegExp(`^\\s*${key}\\s*:`, 'i').test(part));
  if (at >= 0) parts[at] = parts[at].replace(/^(\s*[A-Za-z][\w-]*\s*:\s*)[^]*?(\s*)$/, (_, head, tail) => `${head}${value}${tail}`);
  else parts.push(` ${key}: ${value} `);
  return `${found[1]}${parts.join('|')}${found[3]}`;
}

// Rewrites the parts of one entry that changed (any of name, description, config, metadata); the rest of its lines stay.
export function editEntry(parsed, entry, { name, description, config, meta = {} }) {
  const lines = [...parsed.lines];
  const edits = [];
  if (config !== undefined) edits.push({ from: entry.jsonOpen + 1, to: entry.jsonClose, lines: JSON.stringify(config, null, 2).split('\n') });
  if (description !== undefined && entry.metaIndex < entry.jsonOpen) edits.push({ from: entry.metaIndex + 1, to: entry.jsonOpen, lines: [...(description ? [description] : []), ''] });
  const keys = Object.keys(meta);
  if (keys.length) edits.push({ from: entry.metaIndex, to: entry.metaIndex + 1, lines: [keys.reduce((line, key) => setMeta(line, key, meta[key]), lines[entry.metaIndex])] });
  if (name !== undefined) edits.push({ from: entry.start, to: entry.start + 1, lines: [`## ${name}`] });
  for (const edit of edits.sort((a, b) => b.from - a.from)) lines.splice(edit.from, edit.to - edit.from, ...edit.lines);
  return assemble(parsed, lines);
}

// Replaces the lines of an entry's section with other lines (the undo of a change).
export function replaceSection(parsed, entry, sectionText) {
  const lines = [...parsed.lines];
  lines.splice(entry.start, entry.end - entry.start, ...sectionText.split(parsed.eol));
  return assemble(parsed, lines);
}

export function removeEntry(parsed, entry) {
  const lines = [...parsed.lines];
  lines.splice(entry.start, entry.end - entry.start);
  if (entry.end >= parsed.lines.length) while (lines.length > 1 && lines[lines.length - 1] === '' && lines[lines.length - 2] === '') lines.pop();
  return assemble(parsed, lines);
}

// Adds a section at the end, after a blank line, and leaves everything before it as it was.
export function appendSection(parsed, sectionLines) {
  const lines = [...parsed.lines];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
  lines.push(...sectionLines, '');
  return assemble(parsed, lines);
}

// --- the file: read whole, written whole through a temporary file and a rename

// A file that is too big is reported, never read, so that it can never be written back in part.
export function readText(file) {
  try {
    if (statSync(file).size > MAX_BYTES) return { exists: true, tooBig: true, text: '' };
    return { exists: true, tooBig: false, text: readFileSync(file, 'utf8') };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, tooBig: false, text: '' };
    throw error;
  }
}

// A symbolic link is followed: the file it points to is the one that is replaced, so the link (into a synced folder, a
// repository) stays a link.
export function writeText(file, text) {
  let target = file;
  try {
    target = realpathSync(file);
  } catch { /* a new file */ }
  let mode = 0o644;
  try {
    mode = statSync(target).mode & 0o777;
  } catch { /* a new file */ }
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, text, { mode });
    chmodSync(temporary, mode);
    renameSync(temporary, target);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* nothing was written */ }
    throw error;
  }
}
