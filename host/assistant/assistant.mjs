// 嘟嘟's own state, opened together (docs/assistant.md 2, 3.5, 3.6, 5): the project folder, the settings, the memory, the connectors
// and the collectors, and the calls the settings page makes on them. Nothing here imports DSH; the plugin passes in what it must (the
// folders, a model function, how to open a file).
//
//   const assistant = openAssistant({ dshHome, stateFolder, env, llm?, openPath?, credentials?, createOAuth?, onCollectorRemoved? });
//   assistant.handle('connectors/list', request)      one POST of the page, answered with JSON
//   assistant.memory, assistant.connectors, assistant.connections, assistant.collectors     null when the project folder could not be opened (see `problems`)
//   credentials                                       DSH's credential store ({ readRecord, modifyRecord, deleteRecord }): where tokens, keys and the values of environment variables are kept
//   createOAuth({ store, openUrl })                   the browser sign-in of hosted MCP servers (connectors/oauth); without it a server that needs one cannot be connected
//   connectionDeps                                    what connectors/connections.mjs takes besides these (open, probe, run, which, here): for tests
//   assistant.setLlm(fn)                              the model function of the memory (once the plugin has one)
//   assistant.close()
//
// The page is the owner. Every answer is { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', ... }.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { createCollectors } from './collectors/index.mjs';
import { splitLegacySources } from './collectors/migrate.mjs';
import { createConnections } from './connectors/connections.mjs';
import { createConnectors } from './connectors/index.mjs';
import { createState } from './connectors/state.mjs';
import { createMemory } from './memory/index.mjs';
import { checkFolder, defaultFolder, ensureFolder, migrate } from './project.mjs';
import { RULE_FILES, updateOwnerRule } from './rules.mjs';
import { createSettings } from './settings.mjs';

const NO_STORE = { 'cache-control': 'no-store' };

/** Opens a file or a folder with what the system uses for it (execFile with an argument list: no shell). */
export function openWithSystem(path, { platform = process.platform, run = execFile } = {}) {
  const [command, args] = platform === 'darwin' ? ['open', [path]] : platform === 'win32' ? ['explorer', [path]] : ['xdg-open', [path]];
  return new Promise((resolve) => { run(command, args, (error) => resolve(error ? { ok: false, message: error.message } : { ok: true })); });
}

/**
 * The credential store as one record per name, as connectors/connections.mjs and the sign-in want it: `prefix` keeps the two apart (the connection's own secrets,
 * the sign-in's tokens). DSH keeps a record under `<owner>/<id>`; the owner is this plugin. Without a store (an older DSH) what is kept lasts until the plugin stops.
 */
function recordStore(credentials, prefix, scope = 'dudu') {
  if (!credentials?.readRecord || !credentials?.modifyRecord) {
    const memory = new Map();
    return {
      read: async (id) => memory.get(id),
      modify: async (id, fn) => { const next = await fn(memory.get(id)); if (next !== undefined) memory.set(id, next); },
      remove: async (id) => { memory.delete(id); },
    };
  }
  const key = (id) => `${scope}/${prefix}${id}`;
  return {
    read: async (id) => { const record = await credentials.readRecord(key(id)); return record?.kind === 'grant' ? record.payload : undefined; },
    modify: async (id, fn) => { await credentials.modifyRecord(key(id), async (current) => { const next = await fn(current?.kind === 'grant' ? current.payload : undefined); return next === undefined ? undefined : { kind: 'grant', payload: next }; }); },
    remove: async (id) => { await credentials.deleteRecord(key(id)); },
  };
}

export function openAssistant({ dshHome, stateFolder, env = process.env, llm = null, now = Date.now, openPath = openWithSystem, state = () => ({}), beforeFolderChange = () => null, credentials = null, mountMcp = null, createOAuth = null, connectionDeps = {}, onCollectorRemoved = null }) {
  const settings = createSettings({ file: join(stateFolder, 'settings.json'), now });
  const problems = [];
  let model = llm;
  let folder = null;
  let memory = null;
  let connectors = null;
  let connections = null;
  let collectors = null;

  const standard = defaultFolder(dshHome, { env });

  /** The two registries of the folder in use. A connector is kept while a collector reads through it. */
  function openRegistries() {
    connectors = createConnectors({
      file: join(folder, 'CONNECTORS.md'),
      inUse: (id) => (collectors?.owner.list().collectors ?? []).filter((collector) => collector.connector === id).map((collector) => collector.name),
    });
    collectors = createCollectors({ file: join(folder, 'COLLECTORS.md'), connectors: () => connectors, onRemoved: onCollectorRemoved });
    const oauthStore = recordStore(credentials, 'oauth-');
    const openBrowser = (url) => openPath(url).then((opened) => { if (!opened?.ok) throw new Error(opened?.message ?? 'The browser could not be opened.'); });
    connections = createConnections({
      connectors, state: createState({ file: join(stateFolder, 'connectors-state.json'), now }), secrets: recordStore(credentials, 'connector-'), env, now,
      oauth: createOAuth ? createOAuth({ store: oauthStore, openUrl: openBrowser }) : null,
      openUrl: openBrowser, // a sign-in by device code sends the browser to the service's page for it
      mount: mountMcp, // what is connected is given to DSH's sessions too (connectors/publish.mjs)
      ...connectionDeps,
    });
    connections.publishAll().catch((error) => console.warn(`[dudu] The connectors could not be given to DSH: ${error?.message ?? error}`));
  }

  /** Opens the project folder at `path`: creates it with its template files when it is new, then the memory, connectors and collectors in it. */
  function start(path) {
    const ensured = ensureFolder(path, { env });
    if (!ensured.ok) return ensured;
    memory?.close();
    memory = null;
    connectors = null;
    connections = null;
    collectors = null;
    folder = ensured.path;
    // A registry written when a connector and a collector were one thing is split once (it stays readable if that fails; the next start tries again).
    try { splitLegacySources({ folder }); } catch (error) { console.warn(`[dudu] The connectors could not be split from the collectors: ${error?.message ?? error}`); }
    memory = createMemory({ dir: folder, indexDir: join(stateFolder, 'index'), llm: (messages, options) => {
      if (!model) return Promise.reject(new Error('There is no model yet.'));
      return model(messages, options);
    }, now });
    openRegistries();
    return ensured;
  }

  const wanted = settings.get().settings.projectFolder ?? standard;
  const first = start(wanted);
  if (!first.ok) problems.push(first.reason);

  const unavailable = () => ({
    outcome: 'error', message: `The project folder could not be opened${problems.length ? `: ${problems[0]}` : '.'}`,
    next: 'Choose a project folder in the settings.',
  });
  const need = (part) => (part ? null : unavailable());

  async function changeFolder({ path, move = false }) {
    const check = checkFolder(path, { env });
    if (!check.ok) return { outcome: 'needs_clarification', message: check.reason, code: check.code, next: 'Choose another folder.' };
    if (folder && check.path === folder) return { outcome: 'no_op', message: 'This is already the folder in use.' };
    const held = await beforeFolderChange();
    if (held) return held;
    await connections?.close();
    await connectors?.close();
    await collectors?.close();
    if (move && folder) {
      const moved = migrate(folder, path, { env });
      if (!moved.ok) {
        openRegistries();
        return { outcome: 'needs_clarification', message: moved.reason, code: moved.code, next: 'Choose another folder.' };
      }
    }
    const started = start(path);
    if (!started.ok) {
      if (folder) openRegistries();
      return { outcome: 'needs_clarification', message: started.reason, code: started.code, next: 'Choose another folder.' };
    }
    problems.length = 0;
    const saved = settings.set({ projectFolder: path === standard ? null : path });
    return saved.outcome === 'success' ? { outcome: 'success', projectFolder: folder, isDefault: path === standard } : saved;
  }

  async function open({ name }) {
    if (name === 'folder') return folder ? { outcome: 'success', ...(await openPath(folder)) } : unavailable();
    if (!RULE_FILES.includes(name)) return { outcome: 'needs_clarification', message: `Only ${RULE_FILES.join(' and ')} or the folder can be opened.` };
    const missing = need(folder);
    if (missing) return missing;
    const opened = await openPath(join(folder, name));
    return opened.ok ? { outcome: 'success' } : { outcome: 'error', message: `The file could not be opened: ${opened.message}` };
  }

  // The owner-facing calls, by the path the page posts to. Each takes the parsed body.
  const CALLS = {
    'assistant/state': async () => ({ outcome: 'success', projectFolder: folder, isDefault: folder === standard, defaultFolder: standard, stateFolder, problems: [...problems], ...await state() }),
    'assistant/settings': ({ patch } = {}) => (patch === undefined ? settings.get() : settings.set(patch)),
    'assistant/folder': changeFolder,
    'assistant/open': open,
    'rules/get': () => need(memory) ?? { ...memory.rules(), projectFolder: folder },
    'rules/update': (body) => need(memory) ?? updateOwnerRule(folder, body),
    'memory/records': (body) => need(memory) ?? memory.records(body),
    'memory/update': ({ id, ...patch }) => need(memory) ?? memory.update(id, patch),
    'memory/forget': (body) => need(memory) ?? memory.forget(body),
    'memory/reviews': (body) => need(memory) ?? memory.reviews(body),
    'memory/undo': ({ id }) => need(memory) ?? memory.undoReview(id),
    'skills/list': () => need(memory) ?? memory.skills.list(),
    'skills/read': ({ name }) => need(memory) ?? memory.skills.read(name),
    'skills/remove': ({ name }) => need(memory) ?? memory.skills.remove(name),
    // A connector is a service 嘟嘟 can use (docs/assistant.md 3.1): connected from the catalog or from what is on this computer, or made by hand. The page also
    // shows which collectors read through each.
    'connectors/catalog': () => need(connections) ?? connections.catalogView(),
    'connectors/list': () => {
      const listed = need(connections) ?? connections.list();
      if (listed.outcome !== 'success') return listed;
      const reading = collectors?.owner.list().collectors ?? [];
      return { ...listed, connectors: listed.connectors.map((entry) => ({ ...entry, usedBy: reading.filter((collector) => collector.connector === entry.id).map(({ id, name }) => ({ id, name })) })) };
    },
    'connectors/connect': ({ id }) => need(connections) ?? connections.connect(id),
    'connectors/authorize': ({ id }) => need(connections) ?? connections.authorize(id),
    'connectors/retry': ({ id }) => need(connections) ?? connections.retry(id),
    'connectors/cancel': ({ id }) => need(connections) ?? connections.cancel(id),
    'connectors/recognize': ({ text }) => need(connections) ?? connections.recognize(text),
    'connectors/add': ({ text, name, token, env: values }) => need(connections) ?? connections.add({ text, name, token, env: values }),
    'connectors/update': ({ id, name, text, token }) => need(connections) ?? connections.update({ id, name, text, token }),
    'connectors/remove': ({ id }) => need(connections) ?? connections.remove(id),
    'connectors/undo': ({ token }) => need(connectors) ?? connectors.owner.undo(token),
    // A collector reads through one connector: what to collect, and how often.
    'collectors/list': () => {
      const listed = need(collectors) ?? collectors.owner.list();
      if (listed.outcome !== 'success') return listed;
      const known = new Map((connectors?.owner.list().connectors ?? []).map((entry) => [entry.id, entry]));
      return { ...listed, collectors: listed.collectors.map((entry) => ({ ...entry, connectorName: known.get(entry.connector)?.name ?? '', connectorKind: known.get(entry.connector)?.kind ?? '' })) };
    },
    'collectors/add': ({ name, connector, prompt, frequency }) => need(collectors) ?? collectors.owner.add({ name, connector, prompt, ...(frequency ? { frequency } : {}) }),
    'collectors/update': ({ id, name, connector, prompt, frequency }) => need(collectors) ?? collectors.owner.update(id, { name, connector, prompt, ...(frequency !== undefined ? { frequency } : {}) }),
    'collectors/remove': ({ id }) => need(collectors) ?? collectors.owner.remove(id),
    'collectors/undo': ({ token }) => need(collectors) ?? collectors.owner.undo(token),
  };

  return {
    paths: Object.keys(CALLS),
    get memory() { return memory; },
    get connectors() { return connectors; },
    get connections() { return connections; },
    get collectors() { return collectors; },
    get folder() { return folder; },
    settings,
    problems,
    setLlm(fn) { model = fn; },
    /** One POST of the page: `path` is one of `paths`; the body is a JSON object. */
    async handle(path, request) {
      const call = Object.hasOwn(CALLS, path) ? CALLS[path] : null;
      if (!call) return new Response('Not found', { status: 404 });
      try {
        const body = await request.json().catch(() => { throw new SyntaxError('The request body is not JSON.'); });
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
        return Response.json(await call(body), { headers: NO_STORE });
      } catch (error) {
        const bad = error instanceof SyntaxError;
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: bad ? 400 : 500, headers: NO_STORE });
      }
    },
    async close() {
      memory?.close();
      await connections?.close();
      await connectors?.close();
      await collectors?.close();
      memory = null;
      connections = null;
      connectors = null;
      collectors = null;
    },
  };
}
