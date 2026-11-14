// A connector is how 嘟嘟 gets into one service (docs/assistant.md 3.1): either a Prompt that says how (which command, which skill, where the
// sign-in is), or an MCP server 嘟嘟 reaches itself (an address, or a command it starts). It collects nothing by itself and has no schedule: what to
// collect, and how often, belong to the collectors that read through it (collectors/index.mjs). DSH owns the skills and the credential store; the
// tokens, the keys and the values of environment variables are in that store, never in this file.
//
//   const connectors = createConnectors({ file, inUse? })     inUse(id) -> [names of the collectors that read through it]
//   connectors.owner.list() / add(input) / update(id, patch) / remove(id)     the owner's, from the settings page
//   connectors.dudu.list() / register(input) / update / remove                the same, as 嘟嘟's tools call them
//   connectors.close()
//
// A connector is { id, name, kind: 'prompt' | 'mcp', prompt, spec, via, legacy, source: 'owner' | 'dudu' }. A Prompt connector has its text and no spec;
// an MCP connector has its `spec`, { url } or { command, args, env: [names] }, and no text. `via` is the id of the catalog item it was made from (its icon
// and its line come from there), or ''. An entry from before 嘟嘟 held its own connections (`kind: mcp | server: <a server of DSH>`) has no spec: it is
// `legacy`, is listed so that it can be removed, and cannot be made or changed any more. A connector that is still in use by a collector is not removed.
// Every answer is { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', ... }.
import { randomBytes } from 'node:crypto';
import { findSecret } from '../memory/secrets.mjs';
import { createEntriesFile, wrong } from './entries-file.mjs';

export const KINDS = ['prompt', 'mcp'];
export const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

const MESSAGES = {
  changed: 'The connectors changed. Read them again before editing.',
  unreadable: 'The connectors could not be read or saved.',
};

const view = ({ id, name, kind, prompt, server, spec, via, source }) => ({
  id, name, kind, prompt: kind === 'prompt' ? prompt : '', server: kind === 'mcp' ? server : '', spec: kind === 'mcp' ? spec ?? null : null, via: via ?? '',
  legacy: kind === 'mcp' && !spec, source,
});

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The spec of an MCP connector as it would be saved, or the reason it cannot be: { spec } | { problem }. */
function checkSpec(spec) {
  if (!plain(spec)) return { problem: wrong('Give the address or the command of the MCP server.') };
  if (typeof spec.url === 'string' && spec.url.trim()) {
    let url;
    try { url = new URL(spec.url.trim()); } catch { return { problem: wrong('Give a whole address, such as https://mcp.example.com/mcp.') }; }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return { problem: wrong('An MCP server away from this computer is reached over https.') };
    if (url.username || url.password) return { problem: wrong('Keep credentials in the credential store, not in the address.') };
    const out = { url: url.toString() };
    // An address that holds a secret is kept whole in the credential store; the file keeps only where it is.
    if (spec.secretUrl === true) { url.search = ''; url.hash = ''; return { spec: { url: url.toString(), secretUrl: true } }; }
    if (findSecret(out.url)) return { problem: wrong('Keep credentials in the credential store, not in the address.') };
    return { spec: out };
  }
  if (typeof spec.command === 'string' && spec.command.trim()) {
    const command = spec.command.trim();
    const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
    const env = Array.isArray(spec.env) ? spec.env.map(String) : [];
    if (command.length > 1000 || /[\r\n]/.test(command)) return { problem: wrong('The command is one line.') };
    if (args.length > 60 || args.some((arg) => arg.length > 2000 || /[\r\n]/.test(arg))) return { problem: wrong('The command has too many arguments.') };
    if (env.length > 40 || env.some((name) => !ENV_NAME.test(name))) return { problem: wrong('An environment variable has a name of letters, digits and underscores.') };
    if (findSecret([command, ...args].join(' '))) return { problem: wrong('Keep credentials in the credential store, not in the command.') };
    return { spec: { command, args, env } };
  }
  return { problem: wrong('Give the address or the command of the MCP server.') };
}

export function createConnectors({ file, inUse = () => [] }) {
  const entries = createEntriesFile({ file, messages: MESSAGES });
  const meta = (entry) => `<!-- id: ${entry.id} | source: ${entry.source} | kind: ${entry.kind}${entry.via ? ` | via: ${entry.via}` : ''}${entry.kind === 'mcp' && !entry.spec && entry.server ? ` | server: ${entry.server}` : ''} -->`;
  const render = (entry, eol) => [
    `## ${entry.name}`, meta(entry),
    ...(entry.kind === 'prompt' && entry.prompt ? ['', entry.prompt] : []),
    ...(entry.kind === 'mcp' && entry.spec ? ['', '```json', JSON.stringify(entry.spec), '```'] : []),
    '',
  ].join(eol);

  // The fields of a connector as they would be saved, or the reason they cannot be: { fields } | { problem }.
  function check({ name, kind, prompt, spec, via }, { keepEmptyPrompt = false } = {}) {
    name = String(name ?? '').trim();
    if (!name || name.length > 200 || /[\r\n<>]/.test(name)) return { problem: wrong('Give the source a short name.') };
    if (!KINDS.includes(kind)) return { problem: wrong('A connector is a Prompt or an MCP server.') };
    if (findSecret(name)) return { problem: wrong('Keep credentials in the existing tools, not in source prompts.') };
    via = via === undefined || via === null ? '' : String(via);
    if (via && !ID.test(via)) return { problem: wrong('Use a short catalog id.') };
    if (kind === 'mcp') {
      const checked = checkSpec(spec);
      if (checked.problem) return checked;
      return { fields: { name, kind, prompt: '', server: '', spec: checked.spec, via } };
    }
    prompt = String(prompt ?? '').trim();
    if (!prompt && !keepEmptyPrompt) return { problem: wrong('Give a prompt saying how to reach the service.') };
    if (prompt.length > 20_000) return { problem: wrong('The prompt is too long.') };
    if (/^ {0,3}##?\s/m.test(prompt)) return { problem: wrong('A line of the prompt cannot start with # or ## (it would be read as a heading).') };
    if (findSecret(prompt)) return { problem: wrong('Keep credentials in the existing tools, not in source prompts.') };
    return { fields: { name, kind, prompt, server: '', spec: null, via } };
  }

  const list = entries.guard(() => {
    const { parsed } = entries.load();
    return { outcome: 'success', connectors: parsed.entries.map(view), diagnostics: parsed.diagnostics };
  });

  // A new entry from `source`: 'dudu' when the model saves it for the owner, 'owner' when the owner types it in the settings page.
  const create = (input, source) => {
    if (!plain(input)) return wrong('Give a connector name, and a prompt or an MCP server.');
    if (input.server) return wrong('A connector reaches its MCP server by an address or a command now. Add it again with one.');
    if (Object.keys(input).some((key) => !['id', 'name', 'kind', 'prompt', 'spec', 'via'].includes(key))) return wrong('A connector only has a name and a prompt or an MCP server. What to collect, and how often, belong to a collector.');
    const checked = check({ ...input, kind: input.kind ?? 'prompt' });
    if (checked.problem) return checked.problem;
    const id = input.id ?? `connector-${randomBytes(6).toString('hex')}`;
    if (typeof id !== 'string' || !ID.test(id)) return wrong('Use a short connector id.');
    const read = entries.load();
    if (read.parsed.entries.some((entry) => entry.id === id)) return wrong('This connector already exists. Update it.');
    if (read.parsed.entries.length >= 100) return wrong('There are too many connectors.');
    const entry = { id, source, ...checked.fields };
    const result = entries.append(read, render(entry, read.parsed.eol));
    return { ...result, connector: view(entry) };
  };
  const register = entries.guard((input) => create(input, 'dudu'));
  const add = entries.guard((input) => create(input, 'owner'));

  const update = entries.guard((id, patch) => {
    if (!plain(patch)) return wrong('Give a name, a prompt or an MCP server to update.');
    if (patch.server) return wrong('A connector reaches its MCP server by an address or a command now. Add it again with one.');
    if (Object.keys(patch).some((key) => !['name', 'kind', 'prompt', 'spec', 'via'].includes(key))) return wrong('A connector only has a name and a prompt or an MCP server. What to collect, and how often, belong to a collector.');
    const read = entries.load();
    const entry = read.parsed.entries.find((item) => item.id === id);
    if (!entry) return wrong('This connector no longer exists.');
    const kind = patch.kind ?? entry.kind;
    // A connector made when the two were one has no prompt yet; it may stay without one until the owner writes it, but a prompt is not cleared.
    const checked = check({ name: patch.name ?? entry.name, kind, prompt: patch.prompt ?? entry.prompt, spec: patch.spec ?? (kind === entry.kind ? entry.spec : null), via: patch.via ?? entry.via }, { keepEmptyPrompt: !entry.prompt });
    if (checked.problem) return checked.problem;
    const next = { ...entry, ...checked.fields };
    const result = entries.replace(read, entry, render(next, read.parsed.eol));
    return result.outcome === 'success' ? { ...result, connector: view(next) } : result;
  });

  const remove = entries.guard((id) => {
    const read = entries.load();
    const entry = read.parsed.entries.find((item) => item.id === id);
    if (!entry) return { outcome: 'no_op' };
    const users = inUse(id);
    if (users.length) return { ...wrong('Collectors still read through this connector.'), code: 'in_use', collectors: users };
    return entries.remove(read, entry);
  });

  const api = { list, update, remove };
  return {
    dudu: { ...api, register },
    owner: { ...api, add },
    async close() { entries.close(); },
  };
}
