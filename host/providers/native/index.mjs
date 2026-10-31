import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { listClaudeSessions } from './claude-store.mjs';
import { readClaudeHistory } from './claude-history.mjs';
import { listCodexThreads, readCodexThread, readCodexThreads } from './codex-store.mjs';
import { codexHistory } from './codex-history.mjs';
import { createContentIndex, textOf } from './content-index.mjs';
import { buildSessionEvents } from './session-events.mjs';

// The sessions the harnesses on this computer already have, to browse, search and load into DSH. A loaded session is a
// DSH session whose log holds the conversation and whose assistant messages name the harness's own session, so
// the next message resumes that session and a terminal's `claude --resume` or `codex resume` still finds it.

const LIST_TTL = 15_000;
const MAX_LIMIT = 500;

/** Which DSH session each native session was loaded into (or was started from), kept across restarts. */
export async function createLinkStore(folder) {
  const file = join(folder, 'links.json');
  let links = {};
  try { links = JSON.parse(await readFile(file, 'utf8')); } catch { /* none yet, or unreadable: start again */ }
  if (!links || typeof links !== 'object' || Array.isArray(links)) links = {};
  let writing = Promise.resolve();
  const save = () => {
    writing = writing.then(async () => {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(links, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, file);
    }).catch(() => {});
    return writing;
  };
  return {
    get: (provider, id) => links[`${provider}:${id}`]?.sessionId,
    record({ route, nativeSessionId, sessionId }) {
      if (!route || !nativeSessionId || !sessionId) return;
      const key = `${route}:${nativeSessionId}`;
      if (links[key]?.sessionId === sessionId) return;
      links[key] = { sessionId, at: Date.now() };
      void save();
    },
    forget(provider, id) { delete links[`${provider}:${id}`]; void save(); },
    flush: () => writing,
  };
}

const lower = (value) => String(value ?? '').toLowerCase();
const keyOf = (session) => `${session.provider}:${session.id}`;
// A session changed when its file did; Codex does not say how big a thread is, so its update time stands in.
const stampOf = (session) => `${session.size ?? ''}:${session.updatedAt}`;

/** How much one search term says about a session's own details: the title counts most. 0 when it is not in them. */
export function metadataWeight(session, term) {
  const fields = [[session.title, 8], [session.preview, 4], [session.cwd, 3], [session.branch, 2], [session.id, 3]];
  return Math.max(0, ...fields.map(([value, weight]) => (lower(value).includes(term) ? weight : 0)));
}

/** The words of a query, lower case. */
export const termsOf = (query) => lower(query).split(/\s+/).filter(Boolean);

export function createNativeSessions({ sources, persistence, workspaces, links, claude = {}, now = Date.now }) {
  const claudeCache = new Map();
  const content = createContentIndex();
  let listed;                // { at, sessions, providers }
  let indexing;              // the running indexing pass
  let progress = { running: false, done: 0, total: 0 };
  const loading = new Map(); // key -> promise, so a double click loads once

  const sourceOf = (provider) => sources().find((source) => source.id === provider);

  /** Read the conversations that are new or changed, in the background: a search looks inside them once they are in. */
  function startIndexing(snapshot) {
    if (indexing) return;
    const wanted = new Map(snapshot.sessions.map((session) => [keyOf(session), session]));
    for (const key of content.keys()) if (!wanted.has(key)) content.delete(key);
    const todo = [...wanted.values()].filter((session) => content.stamp(keyOf(session)) !== stampOf(session));
    if (!todo.length) return;
    progress = { running: true, done: 0, total: todo.length };
    indexing = (async () => {
      for (const session of todo.filter((item) => item.provider === 'claude')) {
        let text = { user: '', assistant: '' };
        try { text = textOf(await readClaudeHistory({ file: session.file, id: session.id, results: false })); } catch { /* indexed as empty until it changes */ }
        content.set(keyOf(session), stampOf(session), text);
        progress.done++;
      }
      const codex = todo.filter((item) => item.provider === 'codex');
      const source = sourceOf('codex');
      if (codex.length && source) {
        const byId = new Map(codex.map((session) => [session.id, session]));
        await readCodexThreads({ command: source.command, env: source.environment?.() }, [...byId.keys()], (id, thread) => {
          content.set(`codex:${id}`, stampOf(byId.get(id)), textOf(codexHistory(thread)));
          byId.delete(id);
          progress.done++;
        });
        for (const session of byId.values()) { content.set(keyOf(session), stampOf(session), { user: '', assistant: '' }); progress.done++; }
      }
    })().catch(() => {}).finally(() => { progress.running = false; indexing = undefined; });
  }

  async function scan({ refresh }) {
    if (!refresh && listed && now() - listed.at < LIST_TTL) return listed;
    const providers = [];
    const sessions = [];
    for (const source of sources()) {
      try {
        const found = source.id === 'claude'
          ? await listClaudeSessions({ cache: claudeCache, ...claude })
          : await listCodexThreads({ command: source.command, env: source.environment?.() });
        sessions.push(...found);
        providers.push({ id: source.id, name: source.name, count: found.length });
      } catch (error) {
        providers.push({ id: source.id, name: source.name, count: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
    listed = { at: now(), sessions, providers };
    startIndexing(listed);
    return listed;
  }

  /** The DSH session a native session already lives in, when that session still exists. */
  async function linkedSession(session) {
    const sessionId = links.get(session.provider, session.id);
    if (!sessionId) return undefined;
    try {
      if (await persistence()?.stat(sessionId)) return sessionId;
    } catch { /* the store cannot say: show it as not loaded */ }
    links.forget(session.provider, session.id);
    return undefined;
  }

  async function list({ query = '', provider, refresh = false, limit = 200 } = {}) {
    const snapshot = await scan({ refresh });
    const terms = termsOf(query);
    const inside = new Map(terms.map((term) => [term, content.find(term)]));
    const matches = [];
    for (const session of snapshot.sessions) {
      if (provider && session.provider !== provider) continue;
      const key = keyOf(session);
      let score = terms.length ? 0 : 1;
      let evidence;
      for (const term of terms) {
        const weight = metadataWeight(session, term);
        const hit = inside.get(term).get(key);
        if (!weight && !hit) { score = 0; break; }
        score += weight || 1;
        // What the session says about a word its details do not hold: a few words around it.
        if (!weight && hit && !evidence) evidence = { role: hit.role, text: content.snippet(key, hit, term.length) };
      }
      if (score > 0) matches.push({ session, score, evidence });
    }
    matches.sort((a, b) => (b.score - a.score) || (b.session.updatedAt - a.session.updatedAt));
    const shown = matches.slice(0, Math.min(Math.max(1, limit), MAX_LIMIT));
    const sessions = await Promise.all(shown.map(async ({ session, evidence }) => {
      const { file, size, ...view } = session;
      const dshSessionId = await linkedSession(session);
      return { key: keyOf(session), ...view, ...(evidence ? { evidence } : {}), ...(dshSessionId ? { dshSessionId } : {}) };
    }));
    return { sessions, total: matches.length, providers: snapshot.providers, home: homedir(), indexing: { ...progress } };
  }

  async function summaryOf(provider, id) {
    let found = (await scan({ refresh: false })).sessions.find((session) => session.provider === provider && session.id === id);
    if (!found) found = (await scan({ refresh: true })).sessions.find((session) => session.provider === provider && session.id === id);
    if (!found) throw new Error('That session is no longer on this computer.');
    return found;
  }

  async function readHistory(source, summary) {
    if (source.id === 'claude') return readClaudeHistory({ file: summary.file, id: summary.id });
    const thread = await readCodexThread({ command: source.command, env: source.environment?.() }, summary.id);
    return codexHistory(thread);
  }

  /** The model a loaded session starts on: the one the conversation used when the harness offers it, else its default. */
  async function modelFor(source, history) {
    const models = await source.driver.listModels();
    const used = typeof history.model === 'string' ? history.model : '';
    const model = models.find((candidate) => candidate.id === used || (used && candidate.id.endsWith(`/${used}`))) ?? models[0];
    const modelId = model?.id ?? 'default';
    let effort;
    try { effort = (await source.driver.resolveModel(modelId)).reasoning?.defaultEffort; } catch { /* no effort levels */ }
    return { model: modelId, effort };
  }

  async function loadOnce({ provider, id }) {
    const source = sourceOf(provider);
    if (!source) throw new Error('That harness is not available. Check Settings > 供应商.');
    const store = persistence();
    const registry = workspaces();
    if (!store || !registry) throw new Error('This DSH cannot store a loaded session.');
    const summary = await summaryOf(provider, id);
    const existing = await linkedSession(summary);
    if (existing) return { sessionId: existing, reused: true, title: summary.title };
    const history = await readHistory(source, summary);
    if (!history.cwd) throw new Error('The session does not say which folder it ran in.');
    if (!history.turns.length) throw new Error('The session has no conversation to load.');
    const workspace = await registry.create(history.cwd).catch((error) => {
      throw new Error(`The session's folder is not available: ${history.cwd} (${error.message})`);
    });
    const sessionId = `session-${randomUUID()}`;
    const { model, effort } = await modelFor(source, history);
    const { header, events } = buildSessionEvents({ history, route: source.route, model, effort, sessionId, title: summary.title });
    const handle = await store.create(header);
    try {
      await handle.append(events);
      await handle.flush();
    } finally {
      await handle.close();
    }
    try { await workspace.attachSession(sessionId); } catch (error) { console.warn(`[dudu] Could not attach the loaded session to its workspace: ${error.message}`); }
    links.record({ route: source.route, nativeSessionId: summary.id, sessionId });
    return { sessionId, workspaceId: workspace.id, reused: false, title: summary.title };
  }

  function load(request) {
    const key = `${request.provider}:${request.id}`;
    if (!loading.has(key)) loading.set(key, loadOnce(request).finally(() => loading.delete(key)));
    return loading.get(key);
  }

  return {
    list, load,
    /** The title of a session as the list knows it, or undefined. */
    titleOf: (provider, id) => listed?.sessions.find((session) => session.provider === provider && session.id === id)?.title,
    /** Resolves once the pass that is reading conversations has finished (for tests and for callers that must search at once). */
    settled: async () => { while (indexing) await indexing; },
    async handle(action, request) {
      try {
        const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
        if (action === 'list') return Response.json(await list(body), { headers: { 'cache-control': 'no-store' } });
        if (action === 'load') return Response.json(await load(body), { headers: { 'cache-control': 'no-store' } });
        return new Response('Not found', { status: 404 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    },
  };
}
