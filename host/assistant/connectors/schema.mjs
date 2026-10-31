// What a connector's json block may hold, and the one place that checks it (docs/assistant.md 3.1, section 5).
//
//   { "kind": "cli", "command": "lark-cli", "allow": ["calendar +agenda --start {date}", { "run": "task +get-my-tasks", "readOnly": true }] }
//   { "kind": "mcp", "transport": "stdio", "command": "npx", "args": ["-y", "some-server"], "env": { "TOKEN": { "secret": "some-ref" } }, "tools": ["search"] }
//   { "kind": "mcp", "transport": "http", "url": "https://example.com/mcp", "headers": { "Authorization": { "secret": "ref", "prefix": "Bearer " } } }
//   { "kind": "mcp", "from": { "agent": "claude", "name": "notion" }, "launch": "<fingerprint>" }
//   { "kind": "dsh", "server": "notion", "tools": ["notion-search"] }
//
// A value in env or headers is text, or a reference that is resolved when the process is started or the request is sent:
// { "secret": "<reference>" } asks the credential store, { "env": "<NAME>" } reads this process's environment. Secrets
// are never written into the file. `strict` is for what dudu proposes (register, update): unknown fields are refused,
// so are plain-text secrets, a shell or interpreter as the command of a command connector, and an http address that is
// not on this computer. What the owner writes into the file is read as it is.
import { basename, isAbsolute } from 'node:path';
import { compileTemplate, TemplateError } from './cli.mjs';
import { looksSecretName, looksSecretValue, redactArgs } from './redact.mjs';
import { TEXT } from './text.mjs';

export const KINDS = ['cli', 'mcp', 'dsh'];
export const ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const AGENTS = ['claude', 'claude-desktop', 'codex'];
const OP_NAME = /^[a-z0-9][a-z0-9_]{0,28}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;
const SECRET_REF = /^[A-Za-z0-9._:/@-]{1,200}$/;
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// Programs that run whatever they are given: with one of these as the command, an allow list limits nothing.
const RUNS_ANYTHING = /^(?:sh|bash|zsh|fish|dash|ksh|csh|tcsh|cmd|powershell|pwsh|env|xargs|sudo|doas|su|nohup|exec|eval|osascript|node|deno|bun|npx|bunx|uvx|pipx|python[\d.]*|ruby|perl|php|lua|awk|ssh|find|make|open)$/;
// Environment names that change how a program loads code or where it talks to: not for a connector dudu adds to set.
const BLOCKED_ENV = /^(?:PATH|HOME|SHELL|IFS|ENV|BASH_ENV|LD_.*|DYLD_.*|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|PYTHON.*|RUBY.*|PERL.*|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|GIT_.*|SSH_.*|SSL_CERT_.*|.*_PROXY)$/i;

const KEYS = {
  cli: ['command', 'allow', 'env'],
  mcp: ['transport', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'from', 'launch', 'tools'],
  dsh: ['server', 'tools'],
};
// What only the owner sets: which tools of a server are offered, and the fingerprint of a launch the owner approved.
const OWNER_KEYS = new Set(['tools', 'launch']);

const plain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const loopback = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');

// One line of text: no line break of any kind, and (for text that is written into a Markdown line) nothing that would
// start a heading, a code block or a comment there.
export function oneLine(value, { max, label, markdown = false }) {
  if (typeof value !== 'string') return { problem: TEXT.config.oneLine(label) };
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(text)) return { problem: TEXT.config.oneLine(label) };
  if (markdown && /^(?:#|`|~|<!--|-->)/.test(text)) return { problem: TEXT.config.notMarkdown(label) };
  return { text };
}

export function normalizeConfig(raw, { strict = false } = {}) {
  const problems = [];
  const bad = (text) => problems.push(text);
  if (!plain(raw)) return { problems: [TEXT.config.notObject] };
  if (!KINDS.includes(raw.kind)) return { problems: [TEXT.config.badKind] };
  const { kind } = raw;
  const config = { kind };
  const allowed = new Set(['kind', 'timeoutSec', ...KEYS[kind].filter((key) => !(strict && OWNER_KEYS.has(key)))]);
  if (strict) for (const key of Object.keys(raw)) if (!allowed.has(key)) bad(OWNER_KEYS.has(key) ? TEXT.config.ownerOnly(key) : TEXT.config.unknownKey(key));

  if (raw.timeoutSec !== undefined) {
    if (Number.isInteger(raw.timeoutSec) && raw.timeoutSec >= 1 && raw.timeoutSec <= 120) config.timeoutSec = raw.timeoutSec;
    else bad(TEXT.config.timeout);
  }

  const command = (value, runsAnything) => {
    const ok = typeof value === 'string' && value.length > 0 && value.length <= 1000 && value === value.trim() && !/[\u0000\r\n]/.test(value) && (isAbsolute(value) || !/[\\/]/.test(value));
    if (!ok) return bad(TEXT.config.command);
    const name = basename(value).toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '');
    if (strict && runsAnything && RUNS_ANYTHING.test(name)) return bad(TEXT.config.runsAnything(name));
    config.command = value;
  };

  const values = (value, label, names) => {
    if (!plain(value)) return bad(TEXT.config.map(label));
    const out = {};
    const entries = Object.entries(value);
    if (entries.length > 30) bad(TEXT.config.map(label));
    for (const [key, entry] of entries.slice(0, 30)) {
      if (!names.test(key) || key === '__proto__') { bad(TEXT.config.mapName(label, key)); continue; }
      if (strict && label === 'env' && BLOCKED_ENV.test(key)) { bad(TEXT.config.envBlocked(key)); continue; }
      if (typeof entry === 'string') {
        if (entry.length > 2000 || entry.includes('\u0000')) bad(TEXT.config.mapValue(label, key));
        else if (strict && (looksSecretName(key) || looksSecretValue(entry))) bad(TEXT.config.literalSecret(label, key));
        else out[key] = entry;
        continue;
      }
      const reference = plain(entry) && (typeof entry.secret === 'string' ? ['secret', SECRET_REF] : typeof entry.env === 'string' ? ['env', ENV_NAME] : null);
      const prefixOk = reference && (entry.prefix === undefined || (typeof entry.prefix === 'string' && entry.prefix.length <= 50 && !/[\u0000-\u001f]/.test(entry.prefix)));
      if (reference && prefixOk && reference[1].test(entry[reference[0]]) && Object.keys(entry).every((k) => k === reference[0] || k === 'prefix')) {
        out[key] = { [reference[0]]: entry[reference[0]], ...(entry.prefix ? { prefix: entry.prefix } : {}) };
      } else {
        bad(TEXT.config.mapValue(label, key));
      }
    }
    return out;
  };

  const tools = (value) => {
    const ok = Array.isArray(value) && value.length <= 200 && value.every((tool) => typeof tool === 'string' && tool.length > 0 && tool.length <= 200 && !/[\u0000-\u001f]/.test(tool));
    if (ok) config.tools = [...new Set(value)];
    else bad(TEXT.config.tools);
  };

  const url = (value) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return bad(TEXT.config.url);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return bad(TEXT.config.url);
    if (strict) {
      if (parsed.protocol === 'http:' && !loopback(parsed.hostname)) return bad(TEXT.config.urlHttps);
      const secretInside = parsed.username || parsed.password || [...parsed.searchParams].some(([k, v]) => looksSecretName(k) || looksSecretValue(v))
        || parsed.pathname.split('/').some((part) => looksSecretValue(part));
      if (secretInside) return bad(TEXT.config.urlCredential);
    }
    config.url = value;
  };

  const from = (value) => {
    if (!plain(value) || !AGENTS.includes(value.agent) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200 || /[\u0000-\u001f]/.test(value.name)) return bad(TEXT.config.from);
    const out = { agent: value.agent, name: value.name };
    const extra = Object.keys(value).filter((key) => !['agent', 'name', 'scope', 'project'].includes(key));
    if (extra.length) return bad(TEXT.config.from);
    if (value.agent === 'claude' && value.scope !== undefined) {
      const projectOk = typeof value.project === 'string' && isAbsolute(value.project);
      if (value.scope === 'user' && value.project === undefined) out.scope = 'user';
      else if (value.scope === 'project' && projectOk) Object.assign(out, { scope: 'project', project: value.project });
      else return bad(TEXT.config.fromScope);
    } else if (value.scope !== undefined || value.project !== undefined) {
      return bad(TEXT.config.fromScope);
    }
    config.from = out;
  };

  if (kind === 'cli') {
    command(raw.command, true);
    allow(raw.allow, config, bad, strict);
    if (raw.env !== undefined) config.env = values(raw.env, 'env', ENV_NAME);
  } else if (kind === 'mcp') {
    if (raw.from !== undefined) {
      if (['command', 'args', 'env', 'cwd', 'url', 'headers', 'transport'].some((key) => raw[key] !== undefined)) bad(TEXT.config.fromExclusive);
      from(raw.from);
      if (raw.launch !== undefined) {
        if (typeof raw.launch === 'string' && /^[0-9a-f]{16}$/.test(raw.launch)) config.launch = raw.launch;
        else bad(TEXT.config.launch);
      }
    } else if (raw.transport === 'stdio') {
      config.transport = 'stdio';
      if (raw.url !== undefined || raw.headers !== undefined) bad(TEXT.config.mixed);
      command(raw.command, false);
      if (raw.args !== undefined) {
        if (!Array.isArray(raw.args) || raw.args.length > 50 || !raw.args.every((arg) => typeof arg === 'string' && arg.length <= 2000 && !arg.includes('\u0000'))) bad(TEXT.config.args);
        else if (strict && redactArgs(raw.args).some((arg, i) => arg !== raw.args[i])) bad(TEXT.config.argSecret);
        else config.args = [...raw.args];
      }
      if (raw.env !== undefined) config.env = values(raw.env, 'env', ENV_NAME);
      if (raw.cwd !== undefined) {
        if (typeof raw.cwd === 'string' && isAbsolute(raw.cwd)) config.cwd = raw.cwd;
        else bad(TEXT.config.cwd);
      }
    } else if (raw.transport === 'http') {
      config.transport = 'http';
      if (raw.command !== undefined || raw.args !== undefined || raw.env !== undefined || raw.cwd !== undefined) bad(TEXT.config.mixed);
      url(raw.url);
      if (raw.headers !== undefined) config.headers = values(raw.headers, 'headers', HEADER_NAME);
    } else {
      bad(TEXT.config.transport);
    }
    if (raw.tools !== undefined) tools(raw.tools);
  } else {
    if (typeof raw.server === 'string' && SERVER_NAME.test(raw.server)) config.server = raw.server;
    else bad(TEXT.config.server);
    if (raw.tools !== undefined) tools(raw.tools);
  }
  return problems.length ? { problems } : { config };
}

// The allow list of a command connector. A plain template stays text in the file; one with more to say becomes an object.
function allow(value, config, bad, strict) {
  if (!Array.isArray(value) || !value.length) return bad(TEXT.config.noAllow);
  if (value.length > 50) return bad(TEXT.config.allowTooMany);
  const seen = new Set();
  const names = new Set();
  const out = [];
  for (const [index, item] of value.entries()) {
    const entry = typeof item === 'string' ? { run: item } : item;
    const fail = (why) => bad(TEXT.config.allow(index, why));
    if (!plain(entry) || typeof entry.run !== 'string' || Object.keys(entry).some((key) => !['run', 'name', 'description', 'readOnly'].includes(key))) {
      fail(TEXT.config.allowShape);
      continue;
    }
    let compiled;
    try {
      compiled = compileTemplate(entry.run);
    } catch (error) {
      if (!(error instanceof TemplateError)) throw error;
      fail(error.message);
      continue;
    }
    if (seen.has(compiled.text)) { fail(TEXT.config.allowTwice); continue; }
    if (strict && compiled.tokens.some((parts) => parts.every((part) => typeof part === 'string') && (looksSecretValue(parts.join('')) || /^--?[\w-]*(?:token|secret|passw|key)[\w-]*=.+/i.test(parts.join(''))))) { fail(TEXT.config.argSecret); continue; }
    seen.add(compiled.text);
    const clean = { run: compiled.text };
    if (entry.name !== undefined) {
      if (typeof entry.name !== 'string' || !OP_NAME.test(entry.name)) { fail(TEXT.config.allowName); continue; }
      if (names.has(entry.name)) { fail(TEXT.config.allowNameTwice); continue; }
      names.add(entry.name);
      clean.name = entry.name;
    }
    if (entry.description !== undefined) {
      const line = oneLine(entry.description, { max: 300, label: 'description' });
      if (line.problem) { fail(TEXT.config.allowDescription); continue; }
      clean.description = line.text;
    }
    if (entry.readOnly !== undefined) {
      if (typeof entry.readOnly !== 'boolean') { fail(TEXT.config.allowReadOnly); continue; }
      clean.readOnly = entry.readOnly;
    }
    out.push(Object.keys(clean).length === 1 ? clean.run : clean);
  }
  config.allow = out;
}
