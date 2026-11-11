// The connections of the connectors page (docs/assistant.md 3.1, "连接器怎么做"): what can be connected (the catalog and what is on this computer), what is connected and
// in what state, and what a click does: connect, sign in, check, cancel, retry, disconnect, and add one by hand. The entries themselves are CONNECTORS.md (index.mjs), the
// state of each connection is state.mjs, the tokens, keys and values of environment variables are in the credential store (`secrets`), the sign-in is oauth/, and an MCP
// server is opened by mcp.mjs; all of them come in as options, so that each can be replaced in a test.
//
//   const connections = createConnections({ connectors, catalog, state, secrets, oauth, open, probe, run, which, here, now })
//   connections.catalogView()          -> { outcome, groups: [{ id: 'here' | group, items: [{ id, name, line, icon, how }] }] }   what is left to connect
//   connections.list()                 -> { outcome, connectors: [{ id, name, icon, kind, custom, about, line?, address?, text?, tools?, state, legacy, busy }], diagnostics }
//                                      `line` is the catalog's one line (of a connector made from it), `text` what a custom connector is as its page's box holds it,
//                                      `busy` that a connection is being made now (a check that has no state to show yet)
//   connections.connect(id)            a catalog id, or an id of `catalogView`, or (as retry) a connector that exists          -> { outcome, connector? }, at once
//   connections.retry(id) / authorize(id) / cancel(id) / remove(id) / update({ id, name?, text?, token? }) / recognize(text) / add({ text, name?, token?, env? })
//   connections.session(id)            a live connection for one collection: { tools: [{ name, description, inputSchema, annotations }], call(name, args), close() }
//   connections.publishAll()           gives every connected MCP connector to DSH (at the start; see publish.mjs): `list` says which are there as `inSessions`
//   connections.idle()                 resolves when no connection is being made (for tests and for closing)
//
// Connecting does not wait for the owner: it answers at once, and the state of the connection (waiting for the browser, connected, an error and what to do) is what `list`
// shows while the work goes on; the page reads the list again while a connector waits. `secrets` is { read(id), modify(id, fn), remove(id) } over one record per connector
// ({ token?, env?: { NAME: value }, url? }): nothing of it is ever returned by a call here. What is connected is also given to DSH (`mount` mounts DSH's MCP client for one server),
// so that its tools are in the owner's sessions too: when a connection works (publish.mjs, which a test replaces with `publisher`).
import { basename } from 'node:path';
import { brandOf } from './brands.mjs';
import { loadCatalog } from './catalog.mjs';
import { which as findOnPath, runProcess } from './cli.mjs';
import { createAgentConfigs, fingerprint } from './discover.mjs';
import { requestCode, waitForToken } from './device.mjs';
import { isUnauthorized, openMcp, probeServer } from './mcp.mjs';
import { createPublisher } from './publish.mjs';
import { recognize as recognizeText, slug } from './recognize.mjs';

const wrong = (message) => ({ outcome: 'needs_clarification', message });
const CONNECT_MS = { remote: 20_000, local: 60_000 }; // a command that is fetched the first time (npx) takes a while
const LEGACY = 'This connector points to an MCP server of DSH, which is no longer supported. Add it again.';

/** A failure as one short line; a timeout is said as the word the page knows. */
function messageOf(error) {
  const text = String(error?.message ?? error ?? '');
  if (/time(d)? ?out|ETIMEDOUT|-32001/i.test(text)) return 'timeout';
  if (error?.code === 'ENOENT') return `Command not found: ${error?.path ?? ''}`.trim();
  const tail = String(error?.stderr ?? '').trim().split('\n').filter(Boolean).at(-1);
  return (tail ? `${text.split('\n')[0]}: ${tail}` : text.split('\n')[0]).slice(0, 200);
}

const pick = (value, path) => path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), value);

export function createConnections({
  connectors, catalog = loadCatalog(), state, secrets, oauth = null, open = openMcp, probe = probeServer, run = runProcess, which = findOnPath,
  here = null, env = process.env, now = Date.now, mount = null, publisher: given = null, warn = console.warn,
  openUrl = null, device = { requestCode, waitForToken },
}) {
  const jobs = new Map(); // id -> { controller, done }
  const owner = () => connectors.owner;
  const entries = () => (owner().list().connectors ?? []);
  const entryOf = (id) => entries().find((entry) => entry.id === id);
  const taken = (id) => entries().some((entry) => entry.id === id);
  // What is connected is given to DSH: its tools are in every session then. A sign-in that cannot be renewed any more is a connector to sign in to again. A DSH that cannot
  // mount a server gets nothing given, and the connectors work for the collections all the same.
  const publisher = given ?? (mount ? createPublisher({ mount, oauth, warn, onLost: (id) => state.set(id, { status: 'needs-auth' }) }) : null);

  // The MCP servers found in the configuration of the owner's other tools (Claude Code, Claude Desktop, Codex), once and described: [{ id, name, spec, line }].
  const configs = here ? null : createAgentConfigs({ home: env.HOME ?? '', env, platform: process.platform });
  async function found() {
    if (here) return here();
    const { servers } = configs.all();
    const seen = new Set();
    const out = [];
    for (const server of servers) {
      const launch = server.spec;
      // What the other tool wrote: a command or an address that is not an older SSE one. Only where it goes and the names of what it needs are taken, never a value.
      if (!launch || launch.unsupported || (!launch.command && !launch.url)) continue;
      const key = fingerprint(launch);
      if (seen.has(key)) continue;
      seen.add(key);
      const spec = launch.command
        ? { command: launch.command, args: launch.args ?? [], env: Object.keys(launch.env ?? {}) }
        : { url: launch.url };
      out.push({ id: `here-${key}`, key, name: slug(server.name) || 'server', spec, line: launch.command ? basename(launch.command) : new URL(launch.url).host });
    }
    return out;
  }
  const same = (a, b) => JSON.stringify([a?.command ?? null, a?.args ?? [], a?.url ?? null]) === JSON.stringify([b?.command ?? null, b?.args ?? [], b?.url ?? null]);

  function unique(base) {
    const root = slug(base) || 'connector';
    let id = root;
    for (let n = 2; taken(id); n++) id = `${root}-${n}`.slice(0, 40);
    return id;
  }

  // ---------------------------------------------------------------- what can be connected and what is

  async function catalogView() {
    const connected = new Set(entries().flatMap((entry) => [entry.id, entry.via].filter(Boolean)));
    const view = (item) => ({ id: item.id, name: item.name, line: item.line, icon: item.icon, how: item.how });
    const onThisComputer = [
      ...catalog.here.filter((item) => !connected.has(item.id)).map(view),
      ...(await found().catch(() => [])).filter((server) => !entries().some((entry) => entry.spec && same(entry.spec, server.spec)))
        .map((server) => ({ id: server.id, name: server.name, line: server.line, icon: server.spec.url ? 'plug' : 'terminal', how: 'local' })),
    ];
    const groups = onThisComputer.length ? [{ id: 'here', items: onThisComputer }] : [];
    for (const id of catalog.groups) {
      const items = catalog.items.filter((item) => item.group === id && !connected.has(item.id)).map(view);
      if (items.length) groups.push({ id, items });
    }
    return { outcome: 'success', groups };
  }

  /** A command as one line that can be written back into the box: an argument with a space is in double quotes. */
  const commandLine = (spec) => (spec?.command ? [spec.command, ...(spec.args ?? [])].map((word) => (/[\s"']/.test(word) ? `"${word.replace(/(["\\])/g, '\\$1')}"` : word)).join(' ') : '');

  function about(entry, item) {
    if (entry.kind === 'mcp' && entry.spec) {
      const tools = state.get(entry.id)?.tools;
      return entry.spec.url
        ? { kind: 'remote', host: new URL(entry.spec.url).host, ...(tools !== undefined ? { tools } : {}) }
        : { kind: 'local', command: entry.spec.command, ...(tools !== undefined ? { tools } : {}) };
    }
    if (entry.kind === 'prompt' && item?.command) return { kind: 'cli', command: item.command };
    return { kind: 'sentence', text: entry.prompt };
  }

  function list() {
    const listed = owner().list();
    if (listed.outcome !== 'success') return listed;
    const all = state.all();
    return {
      ...listed,
      connectors: listed.connectors.map((entry) => {
        const item = catalog.byId(entry.via);
        const known = entry.legacy ? { status: 'error', message: LEGACY } : all[entry.id];
        const { status, tools: _tools, at: _at, ...hints } = known ?? {};
        return {
          id: entry.id, name: entry.name, icon: item?.icon ?? brandOf(entry.name, entry.id) ?? (entry.kind === 'mcp' ? (entry.spec?.url ? 'plug' : 'terminal') : 'terminal'),
          kind: entry.kind, custom: !item, about: about(entry, item), tools: all[entry.id]?.tools, ...(item ? { line: item.line } : {}),
          // What a custom connector is, as the box of its page holds it: the sentence, or the address (without what is secret in it) or the command.
          ...(!item ? { text: entry.kind === 'prompt' ? entry.prompt : entry.spec?.url ?? commandLine(entry.spec) } : {}),
          ...(entry.spec?.url ? { address: new URL(entry.spec.url).host } : {}),
          legacy: entry.legacy, source: entry.source, busy: jobs.has(entry.id), inSessions: publisher?.has(entry.id) ?? false,
          state: known && status !== 'connected' ? { status, ...hints } : null,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- opening a server

  /** What `open` needs for one connector: its spec as the opener has it, with what is secret taken from the store. */
  async function specFor(entry) {
    const secret = (await secrets.read(entry.id)) ?? {};
    if (entry.spec.command) return { transport: 'stdio', command: entry.spec.command, args: entry.spec.args ?? [], env: secret.env ?? {} };
    const url = entry.spec.secretUrl ? secret.url : entry.spec.url;
    if (!url) throw new Error('The address is no longer in the credential store. Add the connector again.');
    return { transport: 'http', url, headers: secret.token ? { Authorization: `Bearer ${secret.token}` } : {} };
  }

  /** Opens the server of an MCP connector: with the token it was given, else with the sign-in it holds (which never opens a browser by itself). */
  async function openEntry(entry, signal) {
    const spec = await specFor(entry);
    const authProvider = spec.transport === 'stdio' || spec.headers?.Authorization || !oauth ? undefined : oauth.providerFor(entry.id, spec.url);
    const handle = await open(spec, { authProvider, connectTimeoutMs: spec.transport === 'stdio' ? CONNECT_MS.local : CONNECT_MS.remote, signal });
    return { handle, spec };
  }

  /** Gives a connection that works to DSH (publish.mjs): its tools are in the owner's sessions. What cannot be given is said once in the log, and never fails the connection. */
  async function offer(entry) {
    if (!publisher) return;
    try {
      const result = await publisher.publish({ id: entry.id, name: entry.name, spec: entry.spec, secret: (await secrets.read(entry.id)) ?? {} });
      if (result.ok || result.reason === 'no-mount') return;
      if (result.reason === 'needs-auth') state.set(entry.id, { status: 'needs-auth' });
      else warn(`[dudu] The tools of ${entry.name} are not in DSH's sessions: ${result.reason}`);
    } catch (error) { warn(`[dudu] The tools of ${entry.name} are not in DSH's sessions: ${error?.message ?? error}`); }
  }

  /** MCP: open it, ask for its tools, close. Signs in once when only the owner can. */
  async function checkMcp(entry, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { handle } = await openEntry(entry, signal);
        try {
          const tools = await handle.tools();
          state.set(entry.id, { status: 'connected', tools: tools.length });
        } finally { await handle.close(); }
        await offer(entry);
        return;
      } catch (error) {
        if (signal?.aborted) return;
        if (!isUnauthorized(error)) throw error;
        const spec = await specFor(entry).catch(() => null);
        if (spec?.headers?.Authorization) { state.set(entry.id, { status: 'error', message: 'The server did not accept the token.' }); return; }
        if (!oauth || attempt === 1) { state.set(entry.id, { status: 'needs-auth' }); await publisher?.withdraw(entry.id); return; }
        state.set(entry.id, { status: 'waiting' });
        const result = await oauth.authorize(entry.id, spec.url, { signal, displayName: entry.name });
        if (!result.ok) {
          state.set(entry.id, result.reason === 'cancelled' ? { status: 'needs-auth' } : { status: 'error', message: result.reason === 'timeout' ? 'timeout' : result.message ?? 'The sign-in did not finish.' });
          return;
        }
      }
    }
  }

  /** At the start: what was connected is given to DSH again (DSH forgets a plugin's servers when it stops). A token that has gone bad shows when it is renewed. */
  async function publishAll() {
    if (!publisher) return;
    for (const entry of entries()) {
      if (entry.kind === 'mcp' && !entry.legacy && state.get(entry.id)?.status === 'connected') await offer(entry);
    }
  }


  /** A command-line connector: the command is there and, when the catalog says how, it is signed in. A sentence of the owner's own is not checked. */
  async function checkCli(entry) {
    const item = catalog.byId(entry.via);
    if (!item?.command) { state.set(entry.id, { status: 'connected' }); return; }
    const found = which(item.command, env);
    if (!found) { state.set(entry.id, { status: 'missing', command: item.command, install: item.install ?? '' }); return; }
    if (item.status) {
      const result = await run(found, item.status, { env, timeoutMs: 15_000 });
      let ready = result.code === 0 && !result.failed;
      if (ready && item.ready) {
        try { ready = pick(JSON.parse(result.stdout), item.ready.path) === item.ready.equals; } catch { ready = false; }
      }
      if (!ready) { state.set(entry.id, { status: 'needs-login', command: item.command, login: item.login ?? '' }); return; }
    }
    state.set(entry.id, { status: 'connected' });
  }

  /**
   * A server signed in to by a device code: what is kept is tried first; without a token, or when the server no longer takes it, the owner is given a code, it is shown on
   * the row ('waiting') and the browser is sent to the service's page for it, and the token that comes is kept in the credential store (never in a state or a list).
   */
  async function deviceFlow(entry, item, signal) {
    if ((await secrets.read(entry.id))?.token) {
      await checkMcp(entry, signal);
      if (signal?.aborted || state.get(entry.id)?.status === 'connected') return;
    }
    const asked = await device.requestCode({ clientId: item.clientId, scope: item.scope, deviceUrl: item.deviceUrl, signal });
    if (signal?.aborted) return;
    if (!asked.ok) { state.set(entry.id, { status: 'error', message: asked.message }); return; }
    state.set(entry.id, { status: 'waiting', code: asked.userCode });
    // If the browser cannot be opened the code is still on the row, and the owner knows the address.
    try { await openUrl?.(asked.verificationUri); } catch (error) { warn(`[dudu] The browser could not be opened for ${entry.name}: ${error?.message ?? error}`); }
    const got = await device.waitForToken({ clientId: item.clientId, tokenUrl: item.tokenUrl, deviceCode: asked.deviceCode, interval: asked.interval, expiresIn: asked.expiresIn, signal });
    if (signal?.aborted) return;
    if (!got.ok) {
      // Not approving, or letting the code run out, is a connector to sign in to again.
      state.set(entry.id, got.reason === 'denied' ? { status: 'needs-auth' } : got.reason === 'expired' ? { status: 'error', message: 'timeout' } : { status: 'error', message: got.message });
      return;
    }
    await secrets.modify(entry.id, (record) => ({ ...(record ?? {}), token: got.token }));
    state.set(entry.id, { status: 'waiting' });
    await checkMcp(entry, signal);
  }

  async function flow(entry, signal) {
    if (entry.legacy) { state.set(entry.id, { status: 'error', message: LEGACY }); return; }
    const item = catalog.byId(entry.via);
    if (item?.how === 'device' && entry.kind === 'mcp') return deviceFlow(entry, item, signal);
    if (entry.kind === 'prompt') return checkCli(entry);
    return checkMcp(entry, signal);
  }

  /** Starts the connection of one connector in the background; one at a time for one connector. */
  function start(entry) {
    if (jobs.has(entry.id)) return jobs.get(entry.id).done;
    const controller = new AbortController();
    const done = flow(entry, controller.signal)
      .catch((error) => { if (!controller.signal.aborted) state.set(entry.id, { status: 'error', message: messageOf(error) }); })
      .finally(() => { jobs.delete(entry.id); });
    jobs.set(entry.id, { controller, done });
    return done;
  }

  // ---------------------------------------------------------------- what a click does

  async function connect(id) {
    const existing = entryOf(id);
    if (existing) { start(existing); return { outcome: 'success', id: existing.id }; }
    const item = catalog.byId(id);
    let made;
    if (item?.how === 'oauth' || item?.how === 'open' || item?.how === 'device') made = owner().add({ id: item.id, name: item.name, kind: 'mcp', spec: { url: item.url }, via: item.id });
    else if (item) made = owner().add({ id: item.id, name: item.name, kind: 'prompt', prompt: item.prompt, via: item.id });
    else {
      const server = (await found().catch(() => [])).find((candidate) => candidate.id === id);
      if (!server) return wrong('There is nothing to connect with this id.');
      made = owner().add({ id: unique(server.name), name: server.name, kind: 'mcp', spec: server.spec });
    }
    if (made.outcome !== 'success') return made;
    if (item?.how === 'oauth' || item?.how === 'device') state.set(made.connector.id, { status: 'waiting' });
    start(made.connector);
    return { outcome: 'success', id: made.connector.id };
  }

  const retry = (id) => { const entry = entryOf(id); if (!entry) return wrong('This connector no longer exists.'); start(entry); return { outcome: 'success' }; };

  function cancel(id) {
    jobs.get(id)?.controller.abort();
    oauth?.cancel(id);
    if (state.get(id)?.status === 'waiting') state.set(id, { status: 'needs-auth' });
    return { outcome: 'success' };
  }

  async function remove(id) {
    const result = owner().remove(id);
    if (result.outcome === 'success') {
      jobs.get(id)?.controller.abort();
      await publisher?.withdraw(id);
      await secrets.remove(id).catch(() => {});
      await oauth?.forget(id);
      state.delete(id);
    }
    return result;
  }

  // ---------------------------------------------------------------- a connector made by hand

  async function recognize(text) {
    const answer = await recognizeText(text, { probe: (url) => probe(url) });
    return { outcome: 'success', kind: answer.kind, name: answer.name, ...(answer.auth ? { auth: answer.auth } : {}), count: answer.count, ...(answer.problem ? { message: answer.problem } : {}) };
  }

  /** The secrets a pasted server brings go to the store; what the file keeps is where it is and the names. */
  function parts(server, { token, env: given = {} }) {
    const spec = server.spec;
    if (spec.transport === 'stdio') {
      return { spec: { command: spec.command, args: spec.args, env: [...new Set([...Object.keys(spec.env ?? {}), ...Object.keys(given)])] }, secret: { env: { ...spec.env, ...given } } };
    }
    const secretUrl = /[?&](?:key|token|api[_-]?key|access[_-]?token|secret|auth)=/i.test(spec.url);
    const bearer = token || String(spec.headers?.Authorization ?? '').replace(/^Bearer\s+/i, '') || undefined;
    return { spec: { url: spec.url, ...(secretUrl ? { secretUrl: true } : {}) }, secret: { ...(bearer ? { token: bearer } : {}), ...(secretUrl ? { url: spec.url } : {}) } };
  }

  async function add({ text, name, token, env: given }) {
    const answer = await recognizeText(text, { probe: (url) => probe(url) });
    if (!answer.kind) return wrong('Write an address, a command or a sentence.');
    if (answer.kind === 'sentence') {
      if (!String(name ?? '').trim()) return wrong('Give the connector a name.');
      const made = owner().add({ id: unique(name), name: String(name).trim(), kind: 'prompt', prompt: String(text).trim() });
      if (made.outcome === 'success') state.set(made.connector.id, { status: 'connected' });
      return made.outcome === 'success' ? { outcome: 'success', id: made.connector.id, count: 1 } : made;
    }
    const made = [];
    for (const server of answer.entries) {
      const title = answer.count === 1 && String(name ?? '').trim() ? String(name).trim() : server.name;
      const { spec, secret } = parts(server, { token, env: given });
      const result = owner().add({ id: unique(title), name: title, kind: 'mcp', spec });
      if (result.outcome !== 'success') { for (const earlier of made) await remove(earlier.id); return result; }
      if (Object.keys(secret).length) await secrets.modify(result.connector.id, () => secret);
      made.push(result.connector);
    }
    // One address that signs in in the browser is saved first and signed in after (nothing can be tried before); the rest are tried now, and what does not work is not kept.
    if (made.length === 1 && answer.auth !== 'oauth') {
      const [entry] = made;
      const controller = new AbortController();
      jobs.set(entry.id, { controller, done: Promise.resolve() });
      try { await checkMcp(entry, controller.signal); } catch (error) { state.set(entry.id, { status: 'error', message: messageOf(error) }); } finally { jobs.delete(entry.id); }
      const result = state.get(entry.id);
      if (result?.status !== 'connected') {
        await remove(entry.id);
        return { outcome: 'error', message: result?.message ?? (result?.status === 'needs-auth' ? 'The server wants a sign-in or a token.' : 'The server could not be reached.') };
      }
      return { outcome: 'success', id: entry.id, count: 1 };
    }
    for (const entry of made) {
      if (answer.auth === 'oauth') state.set(entry.id, { status: 'waiting' });
      start(entry);
    }
    return { outcome: 'success', id: made[0].id, count: made.length };
  }

  async function update({ id, name, text, token }) {
    const entry = entryOf(id);
    if (!entry) return wrong('This connector no longer exists.');
    if (token !== undefined) await secrets.modify(id, (record) => ({ ...(record ?? {}), token: String(token) || undefined }));
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (text !== undefined) {
      if (entry.kind === 'prompt') patch.prompt = text;
      else {
        const answer = await recognizeText(text, {});
        if (!answer.entries?.length || answer.count !== 1) return wrong('Write one address or one command.');
        const { spec, secret } = parts(answer.entries[0], {});
        patch.spec = spec;
        if (Object.keys(secret).length) await secrets.modify(id, (record) => ({ ...(record ?? {}), ...secret }));
      }
    }
    const result = Object.keys(patch).length ? owner().update(id, patch) : { outcome: 'no_op' };
    // A new address, command or token is tried again.
    if (result.outcome !== 'needs_clarification' && result.outcome !== 'error' && (patch.spec || token !== undefined)) start(entryOf(id));
    return token !== undefined && result.outcome === 'no_op' ? { outcome: 'success' } : result;
  }

  // ---------------------------------------------------------------- for a collection

  async function session(id) {
    const entry = entryOf(id);
    if (!entry) throw new Error('This connector no longer exists.');
    if (entry.legacy) throw new Error(LEGACY);
    if (entry.kind !== 'mcp') throw new Error('Only an MCP connector has tools.');
    const { handle } = await openEntry(entry);
    try {
      const tools = await handle.tools();
      return { tools, call: handle.call, close: () => handle.close() };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  return {
    catalogView, list, connect, retry, authorize: retry, cancel, remove, recognize, add, update, session, publishAll,
    idle: async () => { await Promise.all([...jobs.values()].map((job) => job.done)); },
    async close() {
      for (const job of jobs.values()) job.controller.abort();
      await Promise.allSettled([...jobs.values()].map((job) => job.done));
      await publisher?.close();
    },
  };
}
