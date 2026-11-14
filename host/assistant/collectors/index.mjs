// A collector is one job of reading (docs/assistant.md 3.1): which connector to read through, what to collect, and how often. One connector can
// have several collectors (an @-mention feed and an alerts feed on the same service), each with its own pace and its own words. The records it
// brings, the runs and the issues made from them are all kept under the collector's id.
//
//   const collectors = createCollectors({ file, connectors, onRemoved })     connectors() -> the connectors registry (connectors/index.mjs) | null;
//                                                                  onRemoved(id) is called once a collector was removed (by the owner or by 嘟嘟), to clear what it brought
//   collectors.owner.list() / add(input) / update(id, patch) / remove(id)     the owner's, from the settings page
//   collectors.dudu.list() / register(input) / update / remove                the same, as 嘟嘟's tools call them
//   collectors.resolve()      -> { outcome, collectors: [{ ...collector, via: connector | null }] }    what a collection needs: the connector it reads through
//   collectors.close()
//
// A collector is { id, name, connector, prompt, frequency, notify, source: 'owner' | 'dudu' }: `prompt` says what to collect (the connector says how to
// get in), `frequency` is text such as 15m, 2h, 1d or a cron expression, empty for the default. Every answer is
// { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', ... }.
import { randomBytes } from 'node:crypto';
import { createEntriesFile, wrong } from '../connectors/entries-file.mjs';
import { findSecret } from '../memory/secrets.mjs';
import { parseFrequency } from '../schedule/index.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

const MESSAGES = {
  changed: 'The collectors changed. Read them again before editing.',
  unreadable: 'The collectors could not be read or saved.',
};
const KEYS = ['name', 'connector', 'prompt', 'frequency', 'notify'];

const view = ({ id, name, connector, prompt, frequency, notify, source }) => ({ id, name, connector, prompt, frequency: frequency ?? null, notify: notify === true, source });

export function createCollectors({ file, connectors = () => null, onRemoved = null }) {
  const entries = createEntriesFile({ file, messages: MESSAGES });
  const meta = (entry) => `<!-- id: ${entry.id} | source: ${entry.source} | connector: ${entry.connector}${entry.frequency ? ` | ${/^\d+[mhd]$/.test(entry.frequency) ? 'every' : 'cron'}: ${entry.frequency}` : ''}${entry.notify ? ' | notify: true' : ''} -->`;
  const render = (entry, eol) => [`## ${entry.name}`, meta(entry), '', entry.prompt, ''].join(eol);

  // How often: text such as 15m, or a cron expression; empty means the default. -> { frequency } | { problem }
  const frequencyOf = (value) => {
    if (value === undefined || value === null || String(value).trim() === '') return { frequency: null };
    const parsed = parseFrequency(value);
    return parsed.ok ? { frequency: parsed.frequency.text } : { problem: parsed.message };
  };

  /** The connectors there are, by id; null when they cannot be read. */
  function connectorIds() {
    try {
      const listed = connectors()?.owner.list();
      return listed?.outcome === 'success' ? new Map(listed.connectors.map((connector) => [connector.id, connector])) : null;
    } catch { return null; }
  }

  // The fields of a collector as they would be saved, or the reason they cannot be: { fields } | { problem }. `how` is what frequencyOf said of the
  // frequency, or { frequency } as it already is in the file (a bad one there does not stop the owner renaming the collector).
  function check({ name, connector, prompt, notify }, how) {
    name = String(name ?? '').trim();
    prompt = String(prompt ?? '').trim();
    if (!name || name.length > 200 || /[\r\n<>]/.test(name)) return { problem: wrong('Give the collector a short name.') };
    if (typeof connector !== 'string' || !connector.trim()) return { problem: wrong('Choose a connector.') };
    const known = connectorIds();
    if (!known) return { problem: wrong('The connectors could not be read or saved.') };
    if (!known.has(connector)) return { problem: wrong('Choose an existing connector.') };
    if (!prompt) return { problem: wrong('Give a prompt saying what to collect.') };
    if (prompt.length > 20_000) return { problem: wrong('The prompt is too long.') };
    if (/^ {0,3}##?\s/m.test(prompt)) return { problem: wrong('A line of the text cannot start with # or ## (it would be read as a heading).') };
    if (findSecret(name) || findSecret(prompt)) return { problem: wrong('Keep credentials in the existing tools, not in the collector.') };
    if (how.problem) return { problem: wrong(how.problem) };
    return { fields: { name, connector, prompt, frequency: how.frequency, notify: notify === true } };
  }

  const list = entries.guard(() => {
    const { parsed } = entries.load();
    return { outcome: 'success', collectors: parsed.entries.map(view), diagnostics: parsed.diagnostics };
  });

  const resolve = entries.guard(() => {
    const listed = list();
    if (listed.outcome !== 'success') return listed;
    const known = connectorIds();
    return { ...listed, collectors: listed.collectors.map((collector) => ({ ...collector, via: known?.get(collector.connector) ?? null })) };
  });

  // A new entry from `source`: 'dudu' when the model saves it for the owner, 'owner' when the owner types it in the settings page.
  const create = (input, source) => {
    if (!plain(input)) return wrong('Give a collector name, a connector and what to collect.');
    if (Object.keys(input).some((key) => key !== 'id' && !KEYS.includes(key))) return wrong('A collector only has a name, a connector, what to collect and how often.');
    const checked = check(input, frequencyOf(input.frequency));
    if (checked.problem) return checked.problem;
    const id = input.id ?? `collector-${randomBytes(6).toString('hex')}`;
    if (typeof id !== 'string' || !ID.test(id)) return wrong('Use a short collector id.');
    const read = entries.load();
    if (read.parsed.entries.some((entry) => entry.id === id)) return wrong('This collector already exists. Update it.');
    if (read.parsed.entries.length >= 100) return wrong('There are too many collectors.');
    const entry = { id, source, ...checked.fields };
    const result = entries.append(read, render(entry, read.parsed.eol));
    return { ...result, collector: view(entry) };
  };
  const register = entries.guard((input) => create(input, 'dudu'));
  const add = entries.guard((input) => create(input, 'owner'));

  const update = entries.guard((id, patch) => {
    if (!plain(patch)) return wrong('Give a name, a connector, what to collect or how often to update.');
    if (Object.keys(patch).some((key) => !KEYS.includes(key))) return wrong('A collector only has a name, a connector, what to collect and how often.');
    const read = entries.load();
    const entry = read.parsed.entries.find((item) => item.id === id);
    if (!entry) return wrong('This collector no longer exists.');
    const checked = check(
      { name: patch.name ?? entry.name, connector: patch.connector ?? entry.connector, prompt: patch.prompt ?? entry.prompt, notify: patch.notify ?? entry.notify },
      'frequency' in patch ? frequencyOf(patch.frequency) : { frequency: entry.frequency ?? null },
    );
    if (checked.problem) return checked.problem;
    const next = { ...entry, ...checked.fields };
    const result = entries.replace(read, entry, render(next, read.parsed.eol));
    return result.outcome === 'success' ? { ...result, collector: view(next) } : result;
  });

  const remove = entries.guard((id) => {
    const read = entries.load();
    const entry = read.parsed.entries.find((item) => item.id === id);
    if (!entry) return { outcome: 'no_op' };
    const result = entries.remove(read, entry);
    // What the collector brought and nobody dealt with goes with it; failing to clear it never takes the removal back.
    if (result.outcome === 'success') {
      try { onRemoved?.(id); } catch (error) { console.warn(`[dudu] The records of the removed collector ${id} could not be cleared: ${error?.message ?? error}`); }
    }
    return result;
  });

  const api = { list, update, remove };
  return {
    dudu: { ...api, register },
    owner: { ...api, add },
    resolve,
    async close() { entries.close(); },
  };
}
