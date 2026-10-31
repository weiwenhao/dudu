// Finding things that could become connectors, without writing anything, and reading the MCP servers other agents have
// set up (docs/assistant.md 3.1, "自动查找"). Three sources:
//
//   PATH commands   `which`, and `--version` on what it finds: nothing else is ever run
//   DSH tools       an injected list of tool names, grouped by their mcp__<server>__ prefix
//   other agents    the MCP servers in Claude Code's ~/.claude.json, Codex's ~/.codex/config.toml and Claude Desktop's
//                   claude_desktop_config.json
//
// Those agent files hold credentials, so what leaves this module is only a name, a transport and a redacted launch
// description. A connector made from one of them holds a reference back to it, { agent, name, scope?, project? }, and
// the original is read again whenever the server is started: the secrets go from that file to the process and nowhere
// else. The values that are secrets are given to `remember` so that nothing the library returns can repeat them.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { baseEnv, which } from './cli.mjs';
import { looksSecretName, looksSecretValue, redactArgs, redactUrl } from './redact.mjs';
import { parseToml } from './toml.mjs';
import { TEXT } from './text.mjs';

const NAMES = { claude: 'Claude Code', 'claude-desktop': 'Claude Desktop', codex: 'Codex' };
const MAX_CONFIG_BYTES = 50_000_000;

const plain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value) => (plain(value) ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])) : {});

class Unset extends Error {}

// ${VAR} and ${VAR:-default}, as Claude Code writes them into its configuration.
function expand(text, env) {
  return String(text).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, fallback) => {
    if (env[name] !== undefined) return env[name];
    if (fallback !== undefined) return fallback;
    throw new Unset(name);
  });
}

// The raw entry of an agent's file as a launch description: { transport, command, args, env, cwd } | { transport: 'http', url, headers }.
function specOf(agent, raw, env) {
  if (!plain(raw)) return { error: TEXT.msg.originalBad(NAMES[agent]) };
  try {
    if (agent === 'codex') return codexSpec(raw, env);
    const type = raw.type ?? (typeof raw.url === 'string' ? 'http' : 'stdio');
    const ex = (text) => (agent === 'claude' ? expand(text, env) : String(text)); // only Claude Code's files expand ${VAR}
    if (type === 'stdio' && typeof raw.command === 'string') {
      return { spec: { transport: 'stdio', command: ex(raw.command), args: (Array.isArray(raw.args) ? raw.args : []).map((arg) => ex(arg)), env: Object.fromEntries(Object.entries(strings(raw.env)).map(([k, v]) => [k, ex(v)])) } };
    }
    if ((type === 'http' || type === 'streamable-http') && typeof raw.url === 'string') {
      return { spec: { transport: 'http', url: ex(raw.url), headers: Object.fromEntries(Object.entries(strings(raw.headers)).map(([k, v]) => [k, ex(v)])) } };
    }
    if (type === 'sse' && typeof raw.url === 'string') return { spec: { transport: 'sse', url: raw.url, unsupported: 'sse' } };
    return { error: TEXT.msg.unsupported(String(type)) };
  } catch (error) {
    if (error instanceof Unset) return { error: TEXT.msg.vars(error.message) };
    throw error;
  }
}

// Codex's [mcp_servers.<name>]: command / args / env / env_vars / cwd, or url / bearer_token_env_var / http_headers / env_http_headers.
function codexSpec(raw, env) {
  if (typeof raw.command === 'string') {
    const passed = Object.fromEntries((Array.isArray(raw.env_vars) ? raw.env_vars : []).filter((name) => typeof name === 'string' && env[name] !== undefined).map((name) => [name, env[name]]));
    return { spec: { transport: 'stdio', command: raw.command, args: (Array.isArray(raw.args) ? raw.args : []).map(String), env: { ...passed, ...strings(raw.env) }, ...(typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {}) } };
  }
  if (typeof raw.url === 'string') {
    const headers = strings(raw.http_headers);
    for (const [header, name] of Object.entries(strings(raw.env_http_headers))) if (env[name] !== undefined) headers[header] = env[name];
    if (typeof raw.bearer_token_env_var === 'string' && env[raw.bearer_token_env_var] !== undefined) headers.Authorization = `Bearer ${env[raw.bearer_token_env_var]}`;
    return { spec: { transport: 'http', url: raw.url, headers } };
  }
  return { error: TEXT.msg.unsupported('this entry') };
}

// What is shown of a launch description: where it goes and how it starts, with credentials masked. Masked pieces and
// secret-looking env and header values go to `found`.
export function describeSpec(spec, found = () => {}) {
  if (spec.transport === 'http' || spec.transport === 'sse') {
    for (const [name, value] of Object.entries(spec.headers ?? {})) if (looksSecretName(name) || looksSecretValue(value)) found(value);
    return {
      transport: spec.transport, url: redactUrl(spec.url, found), headerNames: Object.keys(spec.headers ?? {}),
      ...(spec.unsupported ? { unsupported: spec.unsupported } : {}),
    };
  }
  for (const [name, value] of Object.entries(spec.env ?? {})) if (looksSecretName(name) || looksSecretValue(value)) found(value);
  return { transport: 'stdio', command: spec.command, args: redactArgs(spec.args ?? [], found), envNames: Object.keys(spec.env ?? {}), ...(spec.cwd ? { cwd: spec.cwd } : {}) };
}

// A short fingerprint of where a launch goes and how it starts (not its env or headers): it tells whether the original
// configuration was changed after the owner turned a connector on.
export const fingerprint = (spec) => createHash('sha256').update(JSON.stringify([spec.transport, spec.command ?? null, spec.args ?? null, spec.url ?? null])).digest('hex').slice(0, 16);

export function createAgentConfigs({ home, env, platform }) {
  const paths = {
    claude: join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'),
    codex: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'),
    'claude-desktop': platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : platform === 'win32' ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
        : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json'),
  };
  const cache = new Map();

  // A file is parsed again only when its size or modification time changed (~/.claude.json can be large).
  function read(agent) {
    const file = paths[agent];
    try {
      const stat = statSync(file);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      const hit = cache.get(agent);
      if (hit?.stamp === stamp) return hit.data;
      if (stat.size > MAX_CONFIG_BYTES) throw new Error('too large');
      const text = readFileSync(file, 'utf8');
      const data = agent === 'codex' ? parseToml(text) : JSON.parse(text);
      cache.set(agent, { stamp, data });
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return null; // that agent is not installed
      return undefined;
    }
  }

  // [{ from, name, raw }] of one agent, or null when its file is missing, undefined when it cannot be read.
  function entries(agent) {
    const data = read(agent);
    if (data === undefined || data === null) return data;
    if (!plain(data)) return undefined;
    const out = [];
    const add = (servers, from) => {
      if (!plain(servers)) return;
      for (const [name, raw] of Object.entries(servers)) out.push({ from: { agent, name, ...from }, name, raw });
    };
    if (agent === 'codex') add(data.mcp_servers, {});
    else if (agent === 'claude-desktop') add(data.mcpServers, {});
    else {
      add(data.mcpServers, { scope: 'user' });
      if (plain(data.projects)) for (const [project, value] of Object.entries(data.projects)) if (plain(value)) add(value.mcpServers, { scope: 'project', project });
    }
    return out;
  }

  return {
    // Every server of every agent, with its launch description (secrets inside: callers must describe, never return, it).
    all() {
      const servers = [];
      const diagnostics = [];
      for (const agent of Object.keys(paths)) {
        const found = entries(agent);
        if (found === undefined) diagnostics.push({ source: agent, reason: TEXT.msg.cannotReadConfig(NAMES[agent]) });
        for (const { raw, ...entry } of found ?? []) servers.push({ ...entry, ...specOf(agent, raw, env) });
      }
      return { servers, diagnostics };
    },
    // The launch description of the server a reference points to, read now.
    find(from) {
      const found = entries(from.agent);
      if (found === undefined) return { error: TEXT.msg.originalBad(NAMES[from.agent]) };
      const scope = from.agent === 'claude' ? from.scope ?? 'user' : null;
      const project = scope === 'project' ? from.project : null;
      const entry = (found ?? []).find((e) => e.name === from.name && (e.from.scope ?? null) === scope && (e.from.project ?? null) === project);
      if (!entry) return { error: TEXT.msg.original(NAMES[from.agent], from.name) };
      return specOf(from.agent, entry.raw, env);
    },
    names: NAMES,
  };
}

// --- PATH

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

const firstLine = (text) => String(text).split(/\r?\n/).map((line) => line.replace(/[\u0000-\u001f\u007f]/g, '').trim()).find(Boolean)?.slice(0, 120) ?? null;

// `which` for the name and a few spellings of it, and `--version` for each program found: a program is never run with
// anything else, and only for a name that is plain letters, digits and . _ + - .
export async function findCommands(query, { env, run, cwd }) {
  const names = [...new Set([query, `${query}-cli`, `${query}cli`])].filter((name) => SAFE_NAME.test(name));
  const found = [];
  for (const name of names) {
    const path = which(name, env);
    if (!path) continue;
    const result = await run(path, ['--version'], { cwd, env: baseEnv(env), timeoutMs: 3000, maxBytes: 8192 });
    found.push({ name, path, version: result.failed ? null : firstLine(result.stdout) ?? firstLine(result.stderr) });
  }
  return found;
}

// --- DSH tools

// [{ name: 'mcp__notion__notion-search', description?, readOnly? }] -> Map(server -> [{ name, full, description, readOnly, inputSchema }])
export function groupDshTools(tools) {
  const servers = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    const match = /^mcp__(.+?)__(.+)$/.exec(String(tool?.name ?? ''));
    if (!match) continue;
    const list = servers.get(match[1]) ?? [];
    servers.set(match[1], list);
    list.push({ name: match[2], full: tool.name, description: typeof tool.description === 'string' ? tool.description : '', readOnly: tool.readOnly === true, inputSchema: plain(tool.inputSchema) ? tool.inputSchema : undefined });
  }
  return servers;
}
