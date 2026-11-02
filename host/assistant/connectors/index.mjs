// A connector is an owner prompt saying where and what to collect. DSH owns tools, skills, credentials and execution.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { findSecret } from '../memory/secrets.mjs';
import { digestOf, readText, writeText } from './markdown.mjs';
import { parseSources } from './sources.mjs';

export const PREFIX = 'connector_';
const wrong = (message) => ({ outcome: 'needs_clarification', message });
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const view = ({ start: _start, end: _end, line: _line, ...entry }) => entry;

export function createConnectors({ file, now = Date.now }) {
  const journal = new Map();
  let closed = false;
  const load = () => {
    const read = readText(file);
    if (closed) throw new Error('The source registry is closed.');
    if (read.tooBig) throw new Error('CONNECTORS.md is too large to read.');
    return { text: read.text, parsed: parseSources(read.text) };
  };
  const render = (entry, eol) => [`## ${entry.name}`, `<!-- id: ${entry.id} | source: ${entry.source} -->`, '', entry.prompt, ''].join(eol);
  const guard = (run) => (...args) => {
    try { return run(...args); } catch { return { outcome: 'error', message: 'The source prompts could not be read or saved.' }; }
  };
  function commit(before, after) {
    if (readText(file).text !== before) return wrong('The source prompts changed. Read them again before editing.');
    if (after === before) return { outcome: 'no_op' };
    mkdirSync(dirname(file), { recursive: true });
    writeText(file, after);
    const token = randomBytes(12).toString('hex');
    journal.set(token, { before, after: digestOf(after) });
    if (journal.size > 30) journal.delete(journal.keys().next().value);
    return { outcome: 'success', undo: token };
  }
  const list = guard(() => {
    const { parsed } = load();
    return { outcome: 'success', connectors: parsed.entries.map(view), diagnostics: parsed.diagnostics };
  });
  const register = guard((input) => {
    if (!plain(input)) return wrong('Give a source name and prompt.');
    if (Object.keys(input).some((key) => !['id', 'name', 'prompt', 'description'].includes(key))) return wrong('A source only has a name and a prompt. Use DSH tools and skills to collect it.');
    const name = String(input.name ?? '').trim();
    const prompt = String(input.prompt ?? input.description ?? '').trim();
    if (!name || name.length > 200 || /[\r\n<>]/.test(name) || !prompt || prompt.length > 20_000 || /^ {0,3}##?\s/m.test(prompt)) return wrong('Give a short source name and a prompt describing where and what to collect.');
    if (findSecret(name) || findSecret(prompt)) return wrong('Keep credentials in the existing tools, not in source prompts.');
    const id = input.id ?? `source-${randomBytes(6).toString('hex')}`;
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(id)) return wrong('Use a short source id.');
    const { text, parsed } = load();
    if (parsed.entries.some((entry) => entry.id === id)) return wrong('This source already exists. Update its prompt.');
    if (parsed.entries.length >= 100) return wrong('There are too many source prompts.');
    const entry = { id, name, prompt, description: prompt, source: 'dudu', since: now() };
    const result = commit(text, `${text}${text.endsWith(parsed.eol) ? '' : parsed.eol}${parsed.eol}${render(entry, parsed.eol)}`);
    return { ...result, connector: view(entry) };
  });
  const update = guard((id, patch) => {
    if (!plain(patch)) return wrong('Give a name or prompt to update.');
    if (Object.keys(patch).some((key) => !['name', 'prompt', 'description'].includes(key))) return wrong('A source only has a name and a prompt. Use DSH tools and skills to collect it.');
    const { text, parsed } = load();
    const entry = parsed.entries.find((item) => item.id === id);
    if (!entry) return wrong('This source no longer exists.');
    const name = String(patch.name ?? entry.name).trim();
    const prompt = String(patch.prompt ?? patch.description ?? entry.prompt).trim();
    if (!name || /[\r\n<>]/.test(name) || name.length > 200 || !prompt || prompt.length > 20_000 || /^ {0,3}##?\s/m.test(prompt) || findSecret(name) || findSecret(prompt)) return wrong('Give a source name and a prompt without credentials.');
    const lines = [...parsed.lines];
    lines.splice(entry.start, entry.end - entry.start, render({ ...entry, name, prompt }, parsed.eol));
    return commit(text, lines.join(parsed.eol));
  });
  const remove = guard((id) => {
    const { text, parsed } = load();
    const entry = parsed.entries.find((item) => item.id === id);
    if (!entry) return { outcome: 'no_op' };
    const lines = [...parsed.lines];
    lines.splice(entry.start, entry.end - entry.start);
    return commit(text, lines.join(parsed.eol));
  });
  const undo = guard((token) => {
    const saved = journal.get(token);
    if (!saved) return wrong('That undo is no longer available.');
    const { text } = load();
    if (digestOf(text) !== saved.after) return wrong('The source prompts changed after that edit.');
    const result = commit(text, saved.before);
    if (result.outcome === 'success') journal.delete(token);
    return result;
  });
  return {
    dudu: { list, register, update, remove, undo },
    owner: { list, remove, undo },
    async close() { closed = true; journal.clear(); },
  };
}
