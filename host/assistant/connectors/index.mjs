// The connectors of 嘟嘟: the inputs and outputs that reach outside it (docs/assistant.md 3.1). The registry is
// CONNECTORS.md in the project folder (markdown.mjs); the three kinds are command-line programs (cli.mjs), MCP servers
// (mcp.mjs, the only file that names the MCP SDK) and DSH tools; finding candidates is discover.mjs.
//
//   const connectors = createConnectors({ file, secrets, run, now, env, home, platform, dsh, mcp, limits, idleMs });
//
//   file      <project folder>/CONNECTORS.md
//   secrets   (ref) -> string | undefined, sync or async: the credential store. In a connector's env or headers a value can be
//             { "secret": "<ref>" }; it is looked up when a process starts or a request is sent and never written anywhere
//   run       (file, args, { cwd, env, timeoutMs, maxBytes, signal }) -> { code, signal, stdout, stderr, timedOut, truncated, failed }:
//             how a program is started. The default is child_process.execFile (cli.mjs); inject one to change the PATH or to record runs
//   env, home, platform   process.env, os.homedir(), process.platform: where the other agents' configuration files are, and the
//             environment programs start with (a fixed part of it plus what the connector asks for, never the rest)
//   dsh       { tools() -> [{ name: 'mcp__<server>__<tool>', description?, inputSchema?, readOnly? }], call(name, args) }: the tools
//             DSH has registered. They can only be used from inside the conversation, so code never reads through them
//   mcp       the MCP opener (default ./mcp.mjs: openMcp(spec, { connectTimeoutMs }) -> { tools, call, close, stderr, closed })
//   limits    { timeoutMs 30 s, connectTimeoutMs 20 s, maxChars 12000, maxBytes 1 MiB, listTtlMs 5 min, errorTtlMs 30 s }; idleMs 60 s
//
// It returns:
//
//   connectors.dudu    what the 嘟嘟 session gets    { list, discover, register, update, remove, test, tools, call, undo }
//   connectors.owner   what the settings page gets   { list, discover, enable, disable, tick, remove, test, call, undo }
//   connectors.read(name, args)   the intake path (code reading new items): runs a read operation, refuses anything else
//   connectors.readTools()        the operations read() can run, in the shape of tools()
//   connectors.close()            ends every MCP session and its process
//
// The groups are separate objects so that nothing owner-only can end up in 嘟嘟's tool list: only owner.enable and
// owner.disable change `enabled`, and only owner.tick chooses the tools of a server. dudu adds entries (always off, marked
// `source: dudu`), changes or removes only its own and only while they are off (a description or a name may change while
// one is on; what it runs may not), and each of its changes comes back with a `review` line for reviews/ and an `undo` token
// (kept in memory: it stops working when the process ends, and when the entry is changed afterwards). An undo never turns
// a connector on. A connector made from another agent's configuration holds a reference to it, not a copy; the launch the
// owner saw when turning it on is pinned, and a changed original stops it until the owner looks again.
//
// Results are { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', message?, next?, ... } and nothing here throws
// for what a person or the model can cause. Every string that comes out passes through a scrubber holding the secrets this
// library has handled, so none of them can be repeated.
//
//   tools()   [{ name: 'connector_<id>_<operation>', description, inputSchema, readOnly }] for the enabled connectors
//   call(name, args), read(name, args)   { outcome, connector, operation, untrusted: true, content, truncated, chars, text, ... }
//             `content` is the output (capped, control characters removed); `text` is the same inside a notice that it is material
//             from an outside program and not an instruction. Nothing in this library reads either as a command.
//   operations are read operations when: a command connector's allow entry says readOnly: true; an MCP tool carries the server's
//             readOnlyHint (only a hint, so the owner's tick decides what is offered at all); a DSH tool is marked readOnly.
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { baseEnv, buildArgv, cliOperations, inputSchemaOf, runProcess, which } from './cli.mjs';
import { createAgentConfigs, describeSpec, findCommands, fingerprint, groupDshTools } from './discover.mjs';
import {
  appendSection, digestOf, editEntry, parseRegistry, readText, removeEntry, renderEntry, replaceSection, sectionOf, setMeta, writeText,
} from './markdown.mjs';
import { openMcp } from './mcp.mjs';
import { createScrubber, looksSecretName, looksSecretValue, redactArgs, redactUrl } from './redact.mjs';
import { ID, normalizeConfig, oneLine } from './schema.mjs';
import { TEXT } from './text.mjs';

export const PREFIX = 'connector_';
const LIMITS = { timeoutMs: 30_000, connectTimeoutMs: 20_000, maxChars: 12_000, maxBytes: 1_048_576, listTtlMs: 300_000, errorTtlMs: 30_000 };
const MAX_CONNECTORS = 100;
const MAX_ARGS_JSON = 100_000;

// What dudu may give to register, and what it may change with update. The owner's fields are not in either list.
const NEW_KEYS = ['id', 'name', 'description', 'kind', 'command', 'allow', 'env', 'transport', 'args', 'cwd', 'url', 'headers', 'from', 'server', 'timeoutSec'];
const CONFIG_KEYS = ['command', 'allow', 'env', 'transport', 'args', 'cwd', 'url', 'headers', 'from', 'server', 'timeoutSec'];
const OWNER_ONLY = ['enabled', 'source', 'since', 'tools', 'launch'];

const clarify = (message, next = TEXT.hint.again, extra) => ({ outcome: 'needs_clarification', message, next, ...extra });
const failure = (message, next, extra) => ({ outcome: 'error', message, ...(next ? { next } : {}), ...extra });
const success = (extra) => ({ outcome: 'success', ...extra });
const noOp = (message, extra) => ({ outcome: 'no_op', message, ...extra });
const plain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// An error that is its own answer.
class Failure extends Error {}

// Text from a program or a server: line ends made alike, terminal escapes and control characters removed.
const sanitize = (text) => String(text).replace(/\r\n?/g, '\n').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\u001b[@-Z\\-_]/g, '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const brief = (text, max) => sanitize(text).replace(/\s+/g, ' ').trim().slice(0, max);
const slug = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
// JSON with the keys of every object in order, so two configs that say the same thing compare equal.
const canon = (value) => JSON.stringify(value, (_, entry) => (plain(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : 1))) : entry));

// Operation names for a connector: letters, digits, _ and -, unique inside it, short enough for a 64 character tool name.
function operationNames(id, sources) {
  const room = 64 - PREFIX.length - id.length - 1;
  const used = new Set();
  return sources.map((source) => {
    const base = (String(source).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool').slice(0, room);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base.slice(0, room - String(n).length - 1)}_${n}`;
    used.add(name);
    return name;
  });
}

export function createConnectors({
  file, secrets = () => undefined, run = runProcess, now = Date.now, env = process.env, home = homedir(), platform = process.platform,
  dsh = null, mcp = openMcp, limits = {}, idleMs = 60_000,
}) {
  const cap = { ...LIMITS, ...limits };
  const scrubber = createScrubber();
  const agents = createAgentConfigs({ home, env, platform });
  const folder = dirname(file);
  const tests = new Map(); // id -> { at, ok, message }: the last test of this run
  const listings = new Map(); // id -> { key, at, tools, error }: what an MCP server offered
  const inflight = new Map(); // id -> Promise of a listing being fetched
  const sessions = new Map(); // id -> { key, promise, handle, timer, active }
  const journal = new Map(); // undo token -> { id, before, after }
  let closed = false;

  // --- the registry file

  // A secret written into the file by hand is still not repeated by anything this library returns.
  function rememberLiterals(entry) {
    for (const map of [entry.config.env, entry.config.headers]) {
      for (const [name, value] of Object.entries(map ?? {})) if (typeof value === 'string' && (looksSecretName(name) || looksSecretValue(value))) scrubber.remember(value);
    }
  }

  function load() {
    const read = readText(file);
    if (read.tooBig) return { parsed: { entries: [], diagnostics: [{ line: 1, reason: TEXT.skipped.tooBig }], ids: new Set() }, tooBig: true };
    const parsed = parseRegistry(read.text);
    parsed.entries.forEach(rememberLiterals);
    return { parsed, tooBig: false };
  }

  // Reads the file, lets `change(parsed)` say what the new text is, and writes it through a temporary file and a rename.
  // The file is read once more just before the replacement; if the owner changed it in between, it starts over.
  function modify(change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = readText(file);
      if (before.tooBig) throw new Failure(TEXT.skipped.tooBig);
      const outcome = change(parseRegistry(before.text));
      if (outcome.text === undefined || outcome.text === before.text) return outcome.result;
      const again = readText(file);
      if (again.exists !== before.exists || again.text !== before.text) continue;
      writeText(file, outcome.text);
      return outcome.result;
    }
    throw new Failure(TEXT.msg.busy);
  }

  function find(parsed, id) {
    const entry = parsed.entries.find((candidate) => candidate.id === id);
    if (entry) return { entry };
    const broken = parsed.diagnostics.find((diagnostic) => diagnostic.id === id);
    if (broken) return { failure: failure(TEXT.msg.broken(id, broken.line, broken.reason)) };
    return { failure: failure(TEXT.msg.noConnector(id), TEXT.hint.list) };
  }

  const today = () => {
    const date = new Date(now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  // --- values, secrets and what a program is started with

  async function resolveValues(map = {}) {
    const values = {};
    for (const [key, entry] of Object.entries(map)) {
      if (typeof entry === 'string') {
        values[key] = entry;
        continue;
      }
      let value;
      if (entry.secret !== undefined) {
        try {
          value = await secrets(entry.secret);
        } catch {
          value = undefined;
        }
        if (typeof value !== 'string' || !value) return { error: TEXT.msg.noSecret(entry.secret) };
      } else {
        value = env[entry.env];
        if (typeof value !== 'string') return { error: TEXT.msg.noEnv(entry.env) };
      }
      scrubber.remember(value);
      values[key] = (entry.prefix ?? '') + value;
      scrubber.remember(values[key]);
    }
    return { values };
  }

  // The launch description of an MCP connector with everything resolved (this holds secrets: it never leaves this file).
  async function resolveSpec(entry) {
    const { config } = entry;
    if (config.from) {
      const found = agents.find(config.from);
      if (found.error) return { error: found.error };
      const { spec } = found;
      describeSpec(spec, scrubber.remember); // takes the values that look like secrets into the scrubber
      if (spec.unsupported) return { error: TEXT.msg.sse };
      if (config.launch && config.launch !== fingerprint(spec)) return { error: TEXT.msg.needsReview(entry.id), needsReview: true };
      return spec.transport === 'http'
        ? { spec: { transport: 'http', url: spec.url, headers: spec.headers } }
        : { spec: { transport: 'stdio', command: spec.command, args: spec.args, env: { ...baseEnv(env), ...spec.env }, cwd: spec.cwd ?? folder } };
    }
    if (config.transport === 'http') {
      const headers = await resolveValues(config.headers);
      return headers.error ? { error: headers.error } : { spec: { transport: 'http', url: config.url, headers: headers.values } };
    }
    const values = await resolveValues(config.env);
    if (values.error) return { error: values.error };
    return { spec: { transport: 'stdio', command: config.command, args: config.args ?? [], env: { ...baseEnv(env), ...values.values }, cwd: config.cwd ?? folder } };
  }

  // --- how a result looks: data, capped, and marked as coming from a connector

  function material(entry, operation, { text, outcome = 'success', message, extra }) {
    const raw = sanitize(text);
    const content = raw.length > cap.maxChars ? raw.slice(0, cap.maxChars) + TEXT.frame.truncated(cap.maxChars, raw.length) : raw;
    const tag = randomBytes(4).toString('hex');
    return {
      outcome, ...(message ? { message } : {}), connector: entry.id, operation, untrusted: true, content, truncated: raw.length > cap.maxChars, chars: raw.length,
      text: [TEXT.frame.notice(entry.id, operation), TEXT.frame.begin(tag), content || TEXT.frame.empty, TEXT.frame.end(tag)].join('\n'), ...extra,
    };
  }

  const timeoutOf = (entry) => (entry.config.timeoutSec ? entry.config.timeoutSec * 1000 : cap.timeoutMs);

  // --- command connectors

  async function runCli(entry, op, args, { signal } = {}) {
    const built = buildArgv(op.compiled, args);
    if (built.problems) return clarify(TEXT.msg.badArguments(built.problems));
    const values = await resolveValues(entry.config.env);
    if (values.error) return failure(values.error);
    const childEnv = { ...baseEnv(env), ...values.values };
    const program = which(entry.config.command, childEnv);
    if (!program) return failure(TEXT.msg.notFound(entry.config.command));
    const result = await run(program, built.argv, { cwd: folder, env: childEnv, timeoutMs: timeoutOf(entry), maxBytes: cap.maxBytes, signal });
    const output = [result.stdout, result.stderr && (result.code !== 0 || !result.stdout) ? result.stderr : ''].filter(Boolean).join('\n');
    const name = `${PREFIX}${entry.id}_${op.name}`;
    if (result.failed) return failure(result.failed === 'ENOENT' ? TEXT.msg.notFound(entry.config.command) : TEXT.msg.cannotRun(entry.config.command, result.failed));
    if (result.timedOut) return material(entry, name, { text: output, outcome: 'error', message: TEXT.msg.timedOut(timeoutOf(entry) / 1000) });
    if (result.signal && !result.truncated) return material(entry, name, { text: output, outcome: 'error', message: TEXT.msg.killed(result.signal) });
    if (result.code !== 0 && !result.truncated) return material(entry, name, { text: output, outcome: 'error', message: TEXT.msg.exited(result.code), extra: { exitCode: result.code } });
    return material(entry, name, { text: output, ...(result.truncated ? { message: TEXT.msg.outputCut, extra: { truncated: true } } : {}) });
  }

  // --- MCP connectors: one session per connector, started when it is needed and ended when it has been idle

  // Ends the session of a connector; resolves when its process is gone (a server that ignores both the end of its input and
  // SIGTERM is killed after about four seconds).
  function dropSession(id) {
    const session = sessions.get(id);
    if (!session) return Promise.resolve();
    sessions.delete(id);
    clearTimeout(session.timer);
    return session.promise.then((handle) => handle.close(), () => {});
  }

  const arm = (id, session) => {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => (session.active ? arm(id, session) : dropSession(id)), idleMs);
    session.timer.unref?.();
  };

  async function withSession(entry, spec, work) {
    const key = hash(spec);
    let session = sessions.get(entry.id);
    if (session && (session.key !== key || session.handle?.closed)) {
      dropSession(entry.id);
      session = undefined;
    }
    if (!session) {
      const created = { key, handle: null, timer: null, active: 0 };
      created.promise = mcp(spec, { connectTimeoutMs: cap.connectTimeoutMs }).then((handle) => {
        created.handle = handle;
        return handle;
      });
      created.promise.catch(() => { if (sessions.get(entry.id) === created) sessions.delete(entry.id); });
      sessions.set(entry.id, created);
      session = created;
    }
    const handle = await session.promise;
    if (closed) throw new Failure(TEXT.msg.closed);
    session.active++;
    clearTimeout(session.timer);
    try {
      return await work(handle);
    } catch (error) {
      error.stderr ??= handle.stderr;
      // A protocol answer about the request itself (bad arguments, no such tool) leaves the session as it was; anything else
      // (connection lost, timeout, an HTTP error such as a session the server forgot) ends it, and the next call starts afresh.
      const aboutTheRequest = error?.name === 'McpError' && [-32600, -32601, -32602, -32603].includes(error.code);
      if (handle.closed || !aboutTheRequest) void dropSession(entry.id);
      throw error;
    } finally {
      session.active--;
      if (!session.active && !handle.closed && sessions.get(entry.id) === session) arm(entry.id, session);
    }
  }

  // What went wrong with a server, as a sentence. The server's own words are not repeated except its last line of stderr.
  function describeError(error, spec) {
    const code = error?.code;
    let why;
    if (error instanceof Failure) why = error.message;
    else if (code === 'ENOENT') why = TEXT.msg.notFound(spec?.command ?? 'the program');
    else if (error?.name === 'UnauthorizedError' || code === 401) why = TEXT.msg.signIn;
    else if (code === -32001) why = TEXT.msg.timedOut(Math.round(cap.timeoutMs / 1000));
    else if (code === -32000) why = TEXT.msg.closed;
    else if (error?.cause?.code && /^E[A-Z]+$/.test(error.cause.code)) why = TEXT.msg.unreachable(error.cause.code); // fetch failed: refused, reset, not found
    else why = brief(error?.message ?? error, 200);
    const last = brief(String(error?.stderr ?? '').trim().split('\n').pop() ?? '', 160);
    return last && !(error instanceof Failure) ? `${why} (${last})` : why;
  }

  // Why a connector made from another agent's configuration cannot be used now: the original is gone, uses the SSE
  // transport, or was changed after the owner turned the connector on (its launch no longer matches what was approved).
  function staleReason(entry) {
    const { config } = entry;
    if (!config.from) return null;
    const found = agents.find(config.from);
    if (found.error) return found.error;
    if (found.spec.unsupported) return TEXT.msg.sse;
    return config.launch && config.launch !== fingerprint(found.spec) ? TEXT.msg.needsReview(entry.id) : null;
  }

  async function listing(entry, { force = false } = {}) {
    const stale = staleReason(entry);
    if (stale) return { key: null, at: now(), tools: null, error: stale };
    const { tools: _ticks, launch: _pin, ...offeredBy } = entry.raw;
    const key = hash(offeredBy);
    const cached = listings.get(entry.id);
    const age = cached ? now() - cached.at : Infinity;
    if (!force && cached?.key === key && age < (cached.error ? cap.errorTtlMs : cap.listTtlMs)) return cached;
    if (inflight.has(entry.id)) return inflight.get(entry.id);
    const pending = (async () => {
      const resolved = await resolveSpec(entry);
      let result;
      if (resolved.error) {
        result = { key, at: now(), tools: null, error: resolved.error };
      } else if (resolved.spec.transport === 'stdio' && !which(resolved.spec.command, resolved.spec.env)) {
        result = { key, at: now(), tools: null, error: TEXT.msg.notFound(resolved.spec.command) };
      } else {
        try {
          const tools = await withSession(entry, resolved.spec, (handle) => handle.tools({ timeoutMs: cap.connectTimeoutMs }));
          result = { key, at: now(), tools };
        } catch (error) {
          result = { key, at: now(), tools: null, error: TEXT.msg.cannotConnect(describeError(error, resolved.spec)) };
        }
      }
      listings.set(entry.id, result);
      return result;
    })().finally(() => inflight.delete(entry.id));
    inflight.set(entry.id, pending);
    return pending;
  }

  async function runMcp(entry, op, args, { signal } = {}) {
    if (!plain(args ?? {}) || JSON.stringify(args ?? {}).length > MAX_ARGS_JSON) return clarify(TEXT.msg.argObject);
    const resolved = await resolveSpec(entry);
    if (resolved.error) return failure(resolved.error);
    try {
      const reply = await withSession(entry, resolved.spec, (handle) => handle.call(op.tool, args ?? {}, { timeoutMs: timeoutOf(entry), signal }));
      const parts = reply.content.map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'image') return TEXT.frame.image(block.mimeType);
        if (block.type === 'audio') return TEXT.frame.audio(block.mimeType);
        if (block.type === 'resource_link') return TEXT.frame.link(block.uri);
        if (block.type === 'resource') return block.resource?.text ?? TEXT.frame.blob(block.resource?.uri ?? '');
        return '';
      });
      if (!parts.some(Boolean) && reply.structured) parts.push(JSON.stringify(reply.structured));
      return material(entry, `${PREFIX}${entry.id}_${op.name}`, { text: parts.join('\n'), ...(reply.isError ? { outcome: 'error', message: TEXT.msg.toolError } : {}) });
    } catch (error) {
      return failure(describeError(error, resolved.spec));
    }
  }

  // --- DSH tools

  async function dshTools(entry) {
    if (!dsh?.tools) return [];
    try {
      return groupDshTools(await dsh.tools()).get(entry.config.server) ?? [];
    } catch {
      return [];
    }
  }

  // --- the operations of a connector: what it offers, and (for the tools of a server) what the owner ticked

  // [{ name, label, description, inputSchema, readOnly, ticked, run }]; `error` when the server could not be asked.
  async function operationsOf(entry) {
    const { config } = entry;
    const id = entry.id;
    if (config.kind === 'cli') {
      return {
        ops: cliOperations(config).map((op) => ({
          name: `${PREFIX}${id}_${op.name}`, label: op.template, ticked: true, readOnly: op.readOnly, inputSchema: inputSchemaOf(op.compiled),
          description: brief(TEXT.op.named(entry.name, op.description || TEXT.op.cli(config.command, op.template)), 300),
          run: (args, options) => runCli(entry, op, args, options),
        })),
      };
    }
    const ticks = config.tools ? new Set(config.tools) : null;
    if (config.kind === 'dsh') {
      const tools = await dshTools(entry);
      const names = operationNames(id, tools.map((tool) => tool.name));
      return {
        ops: tools.map((tool, i) => ({
          name: `${PREFIX}${id}_${names[i]}`, label: tool.name, ticked: ticks ? ticks.has(tool.name) : tool.readOnly, readOnly: tool.readOnly,
          inputSchema: tool.inputSchema ?? { type: 'object', additionalProperties: true },
          description: brief(TEXT.op.named(entry.name, tool.description || TEXT.op.dsh(config.server, tool.name)), 300),
          run: async (args) => {
            if (!dsh?.call) return failure(TEXT.msg.noDsh);
            try {
              const reply = await dsh.call(tool.full, args ?? {});
              return material(entry, `${PREFIX}${id}_${names[i]}`, { text: typeof reply === 'string' ? reply : JSON.stringify(reply) });
            } catch (error) {
              return failure(brief(error?.message ?? error, 300));
            }
          },
        })),
      };
    }
    const offered = await listing(entry);
    return offered.tools ? { ops: mcpOperations(entry, offered.tools) } : { ops: [], error: offered.error };
  }

  function mcpOperations(entry, tools) {
    const ticks = entry.config.tools ? new Set(entry.config.tools) : null;
    const names = operationNames(entry.id, tools.map((tool) => tool.name));
    return tools.map((tool, i) => ({
      name: `${PREFIX}${entry.id}_${names[i]}`, label: tool.name, ticked: ticks ? ticks.has(tool.name) : tool.readOnly, readOnly: tool.readOnly,
      inputSchema: tool.inputSchema, description: brief(TEXT.op.named(entry.name, tool.description || tool.title || tool.name), 300),
      run: (args, options) => runMcp(entry, { name: names[i], tool: tool.name }, args, options),
    }));
  }

  const toolOf = ({ name, description, inputSchema, readOnly }) => ({ name, description, inputSchema, readOnly });

  // --- what the owner and the model are shown of a connector

  function describeConfig(config) {
    if (config.kind === 'dsh') return { transport: 'dsh', server: config.server };
    if (config.kind === 'cli') return { transport: 'process', command: config.command, envNames: Object.keys(config.env ?? {}) };
    if (config.transport === 'http') return { transport: 'http', url: redactUrl(config.url, scrubber.remember), headerNames: Object.keys(config.headers ?? {}) };
    return { transport: 'stdio', command: config.command, args: redactArgs(config.args ?? [], scrubber.remember), envNames: Object.keys(config.env ?? {}), ...(config.cwd ? { cwd: config.cwd } : {}) };
  }

  async function viewOf(entry) {
    const { config } = entry;
    const view = {
      id: entry.id, name: entry.name, kind: config.kind, enabled: entry.enabled, source: entry.source, since: entry.since, description: entry.description,
      allow: [], operations: [], tools: config.tools ?? null, toolsKnown: config.kind !== 'mcp', lastTest: tests.get(entry.id) ?? null, launch: null, digest: '',
    };
    let live = null;
    if (config.from) {
      view.from = config.from;
      const found = agents.find(config.from);
      if (found.error) {
        view.error = found.error;
      } else {
        view.launch = describeSpec(found.spec, scrubber.remember);
        live = fingerprint(found.spec);
        if (found.spec.unsupported) view.error = TEXT.msg.sse;
        else if (config.launch && config.launch !== live) Object.assign(view, { needsReview: true, error: TEXT.msg.needsReview(entry.id) });
      }
    } else {
      view.launch = describeConfig(config);
    }
    view.transport = view.launch?.transport;
    if (config.kind === 'cli') {
      view.allow = cliOperations(config).map((op) => op.template);
      view.operations = (await operationsOf(entry)).ops;
    } else if (config.kind === 'dsh') {
      view.operations = (await operationsOf(entry)).ops;
    } else if (listings.get(entry.id)?.tools) {
      view.toolsKnown = true;
      view.operations = mcpOperations(entry, listings.get(entry.id).tools);
    } else if (listings.get(entry.id)?.error) {
      view.error ??= listings.get(entry.id).error;
    }
    view.operations = view.operations.map(({ name, label, description, readOnly, ticked }) => ({ name, label, description, readOnly, ticked }));
    view.digest = hash([entry.raw, entry.source, live]);
    return view;
  }

  async function viewById(id) {
    const { parsed } = load();
    const found = find(parsed, id);
    return found.entry ? viewOf(found.entry) : null;
  }

  // --- the groups

  // Every public method goes through here: nothing throws, and nothing leaves without passing the scrubber.
  const guard = (method, onFailure = (message) => failure(message)) => async (...args) => {
    let result;
    try {
      result = await method(...args);
    } catch (error) {
      const code = typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code) ? error.code : null;
      result = onFailure(error instanceof Failure ? error.message : code === 'ENOENT' ? TEXT.msg.noFolder : code ? TEXT.msg.fileError(code) : TEXT.msg.unexpected(brief(error?.message ?? error, 120)));
    }
    return scrubber.deep(result);
  };

  const forget = (id) => {
    dropSession(id);
    listings.delete(id);
    inflight.delete(id);
    tests.delete(id);
  };

  async function list() {
    const { parsed } = load();
    const connectors = [];
    for (const entry of parsed.entries) connectors.push(await viewOf(entry));
    return success({ connectors, diagnostics: parsed.diagnostics });
  }

  // --- finding candidates (writes nothing)

  async function discover(input) {
    const query = typeof input?.query === 'string' ? input.query.trim() : '';
    const needle = query.toLowerCase();
    const { parsed } = load();
    const taken = new Set(parsed.ids);
    const idFor = (name) => {
      const base = slug(name);
      if (!base) return null;
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 24 - String(n).length - 1)}-${n}`;
      taken.add(id);
      return id;
    };
    const refOf = (from) => canon({ agent: from.agent, name: from.name, scope: from.agent === 'claude' ? from.scope ?? 'user' : null, project: from.project ?? null });
    const candidates = [];
    if (query) {
      for (const found of await findCommands(query, { env, run, cwd: folder })) {
        const have = parsed.entries.find((entry) => entry.config.kind === 'cli' && entry.config.command === found.name);
        candidates.push({ source: 'path', kind: 'cli', id: have?.id ?? idFor(found.name), name: found.name, command: found.name, path: found.path, version: found.version, registered: Boolean(have) });
      }
    }
    if (dsh?.tools) {
      let servers = new Map();
      try {
        servers = groupDshTools(await dsh.tools());
      } catch { /* DSH could not list its tools: the other sources still answer */ }
      for (const [server, tools] of servers) {
        if (needle && !server.toLowerCase().includes(needle)) continue;
        const have = parsed.entries.find((entry) => entry.config.kind === 'dsh' && entry.config.server === server);
        candidates.push({ source: 'dsh', kind: 'dsh', id: have?.id ?? idFor(server), name: server, server, tools: tools.map((tool) => ({ name: tool.name, readOnly: tool.readOnly })), registered: Boolean(have) });
      }
    }
    const configured = agents.all();
    for (const server of configured.servers) {
      if (needle && !server.name.toLowerCase().includes(needle)) continue;
      const have = parsed.entries.find((entry) => entry.config.from && refOf(entry.config.from) === refOf(server.from));
      const base = { source: server.from.agent, kind: 'mcp', id: have?.id ?? idFor(server.name), name: server.name, from: server.from, registered: Boolean(have) };
      if (server.error) {
        candidates.push({ ...base, supported: false, problem: server.error });
        continue;
      }
      candidates.push({ ...base, transport: server.spec.transport, supported: !server.spec.unsupported, launch: describeSpec(server.spec, scrubber.remember) });
    }
    const shown = candidates.slice(0, 100);
    return success({
      candidates: shown, diagnostics: configured.diagnostics, message: shown.length ? TEXT.msg.discovered(shown.length) : TEXT.msg.nothingFound,
      next: shown.length ? TEXT.hint.register : TEXT.hint.discover,
    });
  }

  // --- changes by dudu: add, change, remove (always off, only its own, each with a review line and an undo)

  function remember(item) {
    const token = `undo_${randomBytes(9).toString('base64url')}`;
    journal.set(token, item);
    while (journal.size > 100) journal.delete(journal.keys().next().value);
    return token;
  }

  const whatIs = (config) => {
    if (config.kind === 'cli') return TEXT.review.cli(config.command, config.allow.length);
    if (config.kind === 'dsh') return TEXT.review.dsh(config.server);
    if (config.from) return TEXT.review.mcpFrom(agents.names[config.from.agent], config.from.name);
    return config.transport === 'http' ? TEXT.review.mcpHttp(redactUrl(config.url)) : TEXT.review.mcpStdio(config.command);
  };

  function check(input, { update = false } = {}) {
    if (!plain(input)) return { problems: [TEXT.config.input] };
    const problems = [];
    const allowed = update ? [...CONFIG_KEYS, 'name', 'description'] : NEW_KEYS;
    for (const key of Object.keys(input)) {
      if (OWNER_ONLY.includes(key)) problems.push(TEXT.config.ownerOnly(key));
      else if (!allowed.includes(key)) problems.push(TEXT.config.unknownKey(key));
    }
    return { problems };
  }

  async function register(input) {
    const { problems } = check(input);
    if (problems.length) return clarify(TEXT.msg.problems(problems));
    const id = input.id !== undefined ? input.id : slug(input.name ?? input.command ?? input.server ?? input.from?.name);
    if (typeof id !== 'string' || !ID.test(id)) return clarify(input.id === undefined ? TEXT.config.needId : TEXT.config.id);
    const name = oneLine(input.name ?? id, { max: 100, label: 'name', markdown: true });
    const description = input.description === undefined || input.description === '' ? { text: '' } : oneLine(input.description, { max: 300, label: 'description', markdown: true });
    const rest = { ...input };
    for (const key of ['id', 'name', 'description']) delete rest[key];
    const checked = normalizeConfig(rest, { strict: true });
    const issues = [name.problem, description.problem, ...(checked.problems ?? [])].filter(Boolean);
    if (issues.length) return clarify(TEXT.msg.problems(issues));
    const { config } = checked;
    if (config.from) {
      const found = agents.find(config.from);
      if (found.error) return clarify(found.error, TEXT.hint.discover);
      if (found.spec.unsupported) return clarify(TEXT.msg.sse, TEXT.hint.discover);
    }
    if (config.kind === 'dsh' && !(await dshTools({ config })).length) return clarify(dsh?.tools ? TEXT.msg.noDshServer(config.server) : TEXT.msg.noDsh, TEXT.hint.discover);
    const entry = { id, name: name.text, enabled: false, source: 'dudu', since: today(), description: description.text, config };
    const done = modify((parsed) => {
      if (parsed.ids.has(id)) return { result: clarify(TEXT.msg.exists(id)) };
      if (parsed.entries.length >= MAX_CONNECTORS) return { result: clarify(TEXT.msg.tooMany) };
      if (parsed.unclosed.length) return { result: failure(TEXT.msg.unclosedFence(parsed.unclosed[0])) };
      const text = appendSection(parsed, renderEntry(entry));
      const reparsed = parseRegistry(text);
      const added = reparsed.entries.find((candidate) => candidate.id === id);
      if (!added) return { result: clarify(TEXT.msg.problems([TEXT.config.name])) };
      return { text, result: { added: digestOf(sectionOf(reparsed, added)) } };
    });
    if (done.outcome) return done;
    return success({
      message: TEXT.msg.added(id), connector: await viewById(id), review: TEXT.review.added(entry.name, id, whatIs(config)),
      undo: remember({ id, before: null, after: done.added }),
    });
  }

  async function update(rawId, patch) {
    const id = String(rawId ?? '');
    if (!plain(patch)) return clarify(TEXT.config.input);
    const { problems } = check(patch, { update: true });
    if (problems.length) return clarify(TEXT.msg.problems(problems));
    const touched = Object.keys(patch);
    if (!touched.length) return noOp(TEXT.msg.notNeeded);
    const done = modify((parsed) => {
      const found = find(parsed, id);
      if (found.failure) return { result: found.failure };
      const { entry } = found;
      if (entry.source !== 'dudu') return { result: failure(TEXT.msg.notDudu(id)) };
      const changesConfig = touched.some((key) => CONFIG_KEYS.includes(key));
      if (changesConfig && entry.enabled) return { result: failure(TEXT.msg.isOn(id), TEXT.hint.owner) };
      const edits = {};
      if (changesConfig) {
        // The owner's fields (the ticked tools, the approved launch) are not dudu's to touch: they are set aside while the
        // rest is checked as dudu's own, and put back after.
        const { tools, launch, ...own } = entry.raw;
        const merged = { ...own };
        for (const key of touched.filter((k) => CONFIG_KEYS.includes(k))) {
          if (patch[key] === null) delete merged[key];
          else merged[key] = patch[key];
        }
        const checked = normalizeConfig(merged, { strict: true });
        if (checked.problems) return { result: clarify(TEXT.msg.problems(checked.problems)) };
        edits.config = { ...checked.config, ...(tools ? { tools } : {}), ...(launch && checked.config.from && JSON.stringify(checked.config.from) === JSON.stringify(entry.config.from) ? { launch } : {}) };
      }
      if (touched.includes('name')) {
        const name = oneLine(patch.name, { max: 100, label: 'name', markdown: true });
        if (name.problem) return { result: clarify(name.problem) };
        edits.name = name.text;
      }
      if (touched.includes('description')) {
        const description = patch.description === null || patch.description === '' ? { text: '' } : oneLine(patch.description, { max: 300, label: 'description', markdown: true });
        if (description.problem) return { result: clarify(description.problem) };
        edits.description = description.text;
      }
      const current = { config: entry.config, name: entry.name, description: entry.description };
      for (const key of Object.keys(edits)) if (canon(edits[key]) === canon(current[key])) delete edits[key];
      if (!Object.keys(edits).length) return { result: noOp(TEXT.msg.notNeeded) };
      const text = editEntry(parsed, entry, edits);
      const reparsed = parseRegistry(text);
      const next = reparsed.entries.find((candidate) => candidate.id === id);
      if (!next) return { result: clarify(TEXT.msg.problems([TEXT.config.name])) };
      return { text, result: { name: edits.name ?? entry.name, fields: Object.keys(patch), before: sectionOf(parsed, entry), after: digestOf(sectionOf(reparsed, next)) } };
    });
    if (done.outcome) return done;
    return success({
      message: TEXT.msg.updated(id), connector: await viewById(id), review: TEXT.review.updated(done.name, id, TEXT.review.fields(done.fields)),
      undo: remember({ id, before: done.before, after: done.after }),
    });
  }

  function removeById(id, { owner }) {
    return modify((parsed) => {
      const found = find(parsed, id);
      if (found.failure) return { result: found.failure };
      const { entry } = found;
      if (!owner && entry.source !== 'dudu') return { result: failure(TEXT.msg.notDudu(id)) };
      if (!owner && entry.enabled) return { result: failure(TEXT.msg.isOn(id), TEXT.hint.owner) };
      if (parsed.unclosed.length) return { result: failure(TEXT.msg.unclosedFence(parsed.unclosed[0])) };
      return { text: removeEntry(parsed, entry), result: { name: entry.name, before: sectionOf(parsed, entry), source: entry.source } };
    });
  }

  async function remove(rawId, who) {
    const id = String(rawId ?? '');
    const done = removeById(id, who);
    if (done.outcome) return done;
    forget(id);
    return success({ message: TEXT.msg.removed(id), review: TEXT.review.removed(done.name, id), undo: remember({ id, before: done.before, after: null }) });
  }

  // Puts a section back as it was, but off: an undo never turns a connector on.
  const asOff = (section, eol) => section.split(eol).map((line) => (/^\s*<!--.*\bid\s*:/i.test(line) ? setMeta(line, 'enabled', 'false') : line));

  async function undo(token) {
    const item = typeof token === 'string' ? journal.get(token) : undefined;
    if (!item) return failure(TEXT.msg.noUndo);
    const done = modify((parsed) => {
      const entry = parsed.entries.find((candidate) => candidate.id === item.id);
      if (item.after !== null) {
        if (!entry || digestOf(sectionOf(parsed, entry)) !== item.after) return { result: clarify(TEXT.msg.undoChanged(item.id)) };
        if (item.before === null && parsed.unclosed.length) return { result: failure(TEXT.msg.unclosedFence(parsed.unclosed[0])) };
        return { text: item.before === null ? removeEntry(parsed, entry) : replaceSection(parsed, entry, asOff(item.before, parsed.eol).join(parsed.eol)), result: { undone: true } };
      }
      if (parsed.ids.has(item.id)) return { result: clarify(TEXT.msg.undoBack(item.id)) };
      if (parsed.unclosed.length) return { result: failure(TEXT.msg.unclosedFence(parsed.unclosed[0])) };
      const lines = asOff(item.before, parsed.eol);
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
      return { text: appendSection(parsed, lines), result: { undone: true } };
    });
    if (!done.undone) return done;
    journal.delete(token);
    forget(item.id);
    return success({ message: TEXT.msg.undone(item.id), connector: await viewById(item.id) });
  }

  // --- changes by the owner: on, off, which tools

  async function enable(rawId, options) {
    const id = String(rawId ?? '');
    const done = modify((parsed) => {
      const found = find(parsed, id);
      if (found.failure) return { result: found.failure };
      const { entry } = found;
      let launch = entry.raw.launch;
      if (entry.config.from) {
        const original = agents.find(entry.config.from);
        if (original.error) return { result: failure(original.error) };
        if (original.spec.unsupported) return { result: failure(TEXT.msg.sse) };
        // What the owner has just looked at is what will be started: the fingerprint of the original is pinned now.
        if (options?.digest && options.digest !== hash([entry.raw, entry.source, fingerprint(original.spec)])) return { result: clarify(TEXT.msg.changedSince(id)) };
        launch = fingerprint(original.spec);
      } else if (options?.digest && options.digest !== hash([entry.raw, entry.source, null])) {
        return { result: clarify(TEXT.msg.changedSince(id)) };
      }
      const repin = entry.config.from && entry.raw.launch !== launch;
      if (entry.enabled && !repin) return { result: noOp(TEXT.msg.alreadyOn(id)) };
      return { text: editEntry(parsed, entry, { meta: { enabled: 'true' }, ...(repin ? { config: { ...entry.raw, launch } } : {}) }), result: { on: true } };
    });
    if (!done.on) return done;
    listings.delete(id);
    return success({ message: TEXT.msg.on(id), connector: await viewById(id) });
  }

  async function disable(rawId) {
    const id = String(rawId ?? '');
    const done = modify((parsed) => {
      const found = find(parsed, id);
      if (found.failure) return { result: found.failure };
      if (!found.entry.enabled) return { result: noOp(TEXT.msg.alreadyOff(id)) };
      return { text: editEntry(parsed, found.entry, { meta: { enabled: 'false' } }), result: { off: true } };
    });
    if (!done.off) return done;
    forget(id);
    return success({ message: TEXT.msg.off(id), connector: await viewById(id) });
  }

  // Chooses the tools of an MCP server or the DSH tools of a server that 嘟嘟 may use; null goes back to the default
  // (the ones marked read-only). The command of a command connector has no tools to choose: its operations are its allow list.
  async function tick(rawId, tools) {
    const id = String(rawId ?? '');
    const ok = tools === null || (Array.isArray(tools) && tools.length <= 200 && tools.every((tool) => typeof tool === 'string' && tool && tool.length <= 200));
    if (!ok) return clarify(TEXT.msg.badTicks);
    const done = modify((parsed) => {
      const found = find(parsed, id);
      if (found.failure) return { result: found.failure };
      const { entry } = found;
      if (entry.config.kind === 'cli') return { result: clarify(TEXT.msg.noTicks('command')) };
      const { tools: _, ...rest } = entry.raw;
      const config = tools === null ? rest : { ...rest, tools: [...new Set(tools)] };
      return { text: editEntry(parsed, entry, { config }), result: { ticked: tools === null ? null : new Set(tools).size } };
    });
    if (done.outcome) return done;
    return success({ message: done.ticked === null ? TEXT.msg.tickedDefault(id) : TEXT.msg.ticked(id, done.ticked), connector: await viewById(id) });
  }

  // --- trying a connector once, read-only

  async function test(rawId, { asOwner }) {
    const id = String(rawId ?? '');
    const { parsed } = load();
    const found = find(parsed, id);
    if (found.failure) return found.failure;
    const { entry } = found;
    const at = now();
    const record = (ok, message) => tests.set(id, { at, ok, message: scrubber.scrub(message) }).get(id);
    let result;
    if (!entry.enabled && !asOwner) {
      // Off means nothing is started: only what can be checked without starting it.
      const checks = await staticChecks(entry);
      result = { outcome: 'no_op', ok: checks.ok, live: false, message: `${TEXT.msg.testStatic} ${checks.message}`.trim() };
    } else if (entry.config.kind === 'dsh') {
      const tools = await dshTools(entry);
      result = { outcome: tools.length ? 'success' : 'error', ok: tools.length > 0, live: true, message: tools.length ? TEXT.msg.testDsh(tools.length) : TEXT.msg.noConnector(entry.config.server) };
    } else if (entry.config.kind === 'cli') {
      const { ops } = await operationsOf(entry);
      const probe = ops.find((op) => op.readOnly && !Object.keys(op.inputSchema.properties).length);
      if (!probe) {
        const program = which(entry.config.command, baseEnv(env));
        result = program ? { outcome: 'success', ok: true, live: true, message: TEXT.msg.testNoRead } : { outcome: 'error', ok: false, live: true, message: TEXT.msg.notFound(entry.config.command) };
      } else {
        const ran = await probe.run({});
        result = ran.outcome === 'success' ? { outcome: 'success', ok: true, live: true, message: TEXT.msg.testRan(probe.label, ran.chars) } : { outcome: 'error', ok: false, live: true, message: ran.message };
      }
    } else {
      const offered = await listing(entry, { force: true });
      if (!offered.tools) result = { outcome: 'error', ok: false, live: true, message: offered.error };
      else result = { outcome: 'success', ok: true, live: true, message: TEXT.msg.testListed(offered.tools.length) };
    }
    result.at = at;
    result.lastTest = record(result.ok, result.message);
    result.connector = await viewById(id);
    return result;
  }

  async function staticChecks(entry) {
    const { config } = entry;
    if (config.kind === 'dsh') {
      const count = (await dshTools(entry)).length;
      return { ok: count > 0, message: count ? TEXT.msg.testDsh(count) : TEXT.msg.noConnector(config.server) };
    }
    if (config.kind === 'mcp' && config.transport === 'http') return { ok: true, message: '' };
    let command = config.command;
    if (config.from) {
      const original = agents.find(config.from);
      if (original.error) return { ok: false, message: original.error };
      if (original.spec.transport !== 'stdio') return { ok: true, message: '' };
      command = original.spec.command;
    }
    const program = which(command, baseEnv(env));
    return program ? { ok: true, message: TEXT.msg.testFound(program) } : { ok: false, message: TEXT.msg.notFound(command) };
  }

  // --- using an operation

  async function operationFor(name, { owner = false } = {}) {
    if (typeof name !== 'string' || !name.startsWith(PREFIX)) return { failure: failure(TEXT.msg.unknownOperation(String(name).slice(0, 80)), TEXT.hint.list) };
    const end = name.indexOf('_', PREFIX.length);
    const id = end < 0 ? '' : name.slice(PREFIX.length, end);
    const { parsed } = load();
    const entry = parsed.entries.find((candidate) => candidate.id === id);
    if (!entry) return { failure: failure(TEXT.msg.unknownOperation(name.slice(0, 80)), TEXT.hint.list) };
    if (!entry.enabled && !owner) return { failure: failure(TEXT.msg.isOff(id), TEXT.hint.owner) };
    const { ops, error } = await operationsOf(entry);
    const op = ops.find((candidate) => candidate.name === name && (owner || candidate.ticked));
    if (!op) return { failure: failure(error ?? TEXT.msg.unknownOperation(name.slice(0, 80)), TEXT.hint.list) };
    return { entry, op };
  }

  async function use(name, args, { owner = false, readOnly = false, signal } = {}) {
    const found = await operationFor(name, { owner });
    if (found.failure) return found.failure;
    const { entry, op } = found;
    if (readOnly && entry.config.kind === 'dsh') return failure(TEXT.msg.notReadable('DSH'));
    if (readOnly && !op.readOnly) return failure(TEXT.msg.notRead(name));
    return op.run(args, { signal });
  }

  async function collect({ onlyRead = false } = {}) {
    const { parsed } = load();
    const out = [];
    for (const entry of parsed.entries) {
      if (!entry.enabled || (onlyRead && entry.config.kind === 'dsh')) continue;
      const { ops } = await operationsOf(entry);
      for (const op of ops) if (op.ticked && (!onlyRead || op.readOnly)) out.push(toolOf(op));
    }
    return out;
  }

  async function close() {
    closed = true;
    await Promise.all([...sessions.keys()].map((id) => dropSession(id)));
  }

  const [listing_, discovering, guarded] = [guard(list), guard(discover), guard(undo)];
  return {
    dudu: {
      list: listing_, discover: discovering, register: guard(register), update: guard(update), remove: guard((id) => remove(id, { owner: false })),
      test: guard((id) => test(id, { asOwner: false })), tools: guard(() => collect(), () => []), call: guard((name, args, options) => use(name, args, { signal: options?.signal })), undo: guarded,
    },
    owner: {
      list: listing_, discover: discovering, enable: guard(enable), disable: guard(disable), tick: guard(tick), remove: guard((id) => remove(id, { owner: true })),
      test: guard((id) => test(id, { asOwner: true })), call: guard((name, args, options) => use(name, args, { owner: true, signal: options?.signal })), undo: guarded,
    },
    read: guard((name, args, options) => use(name, args, { readOnly: true, signal: options?.signal })),
    readTools: guard(() => collect({ onlyRead: true }), () => []),
    close,
  };
}
