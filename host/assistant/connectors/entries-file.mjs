// What the two registries share: CONNECTORS.md and COLLECTORS.md are both a Markdown file of `##` sections that the owner can read and edit
// (sources.mjs reads them). This is the part that touches the file: reading it, writing one change at a time against what was read (a file
// that changed meanwhile is never overwritten). (There was a journal that undid a change, until 2026-11-12: the owner took every undo off but the dashboard's.)
// What an entry may say, and every message, belongs to the registry that uses this (connectors/index.mjs, collectors/index.mjs).
//
//   const entries = createEntriesFile({ file, messages: { changed, unreadable } })
//   entries.load()                         -> { text, parsed }       throws when the file is closed or too big
//   entries.append(load, section)          -> { outcome }            `section` is the rendered lines of a new entry
//   entries.replace(load, entry, section)  /  entries.remove(load, entry)
//   entries.guard(run)                     the same call, answering { outcome: 'error' } instead of throwing
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readText, writeText } from './markdown.mjs';
import { parseSources } from './sources.mjs';

export const wrong = (message) => ({ outcome: 'needs_clarification', message });

export function createEntriesFile({ file, messages }) {
  let closed = false;

  const load = () => {
    const read = readText(file);
    if (closed) throw new Error('The registry is closed.');
    if (read.tooBig) throw new Error('The file is too large to read.');
    return { text: read.text, parsed: parseSources(read.text) };
  };

  const guard = (run) => (...args) => {
    try { return run(...args); } catch { return { outcome: 'error', message: messages.unreadable }; }
  };

  function commit(before, after) {
    if (readText(file).text !== before) return wrong(messages.changed);
    if (after === before) return { outcome: 'no_op' };
    mkdirSync(dirname(file), { recursive: true });
    writeText(file, after);
    return { outcome: 'success' };
  }

  const append = ({ text, parsed }, section) => commit(text, `${text}${text.endsWith(parsed.eol) ? '' : parsed.eol}${parsed.eol}${section}`);

  function replace({ text, parsed }, entry, section) {
    const lines = [...parsed.lines];
    lines.splice(entry.start, entry.end - entry.start, section);
    return commit(text, lines.join(parsed.eol));
  }

  function remove({ text, parsed }, entry) {
    const lines = [...parsed.lines];
    lines.splice(entry.start, entry.end - entry.start);
    return commit(text, lines.join(parsed.eol));
  }

  return {
    load, guard, append, replace, remove,
    close() { closed = true; },
  };
}
