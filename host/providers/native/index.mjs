import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { listClaudeSessions, readClaudeSummary } from './claude-store.mjs';
import { readClaudeHistory } from './claude-history.mjs';
import { listCodexThreads, readCodexThread, readCodexThreads } from './codex-store.mjs';
import { codexHistory } from './codex-history.mjs';
import { readCodexMetrics } from './codex-metrics.mjs';
import { codexSearchText } from './content-index.mjs';
import { createCachedContentIndex } from './cached-content-index.mjs';
import { indexClaudeConversations } from './search-worker.mjs';
import { keepImages } from './images.mjs';
import { buildSessionEvents } from './session-events.mjs';
import { busy, createNativeSync } from './sync.mjs';
import { createImportRepair } from './repair.mjs';
import { nativeIdentity } from './session-info.mjs';
import { canReadSessionHistory, readSessionHistory } from '../../dsh-session-history.mjs';
import { withAbort } from '../async.mjs';

// The sessions the harnesses on this computer already have, to browse, search and load into DSH. A loaded session is a
// DSH session whose log holds the conversation and whose assistant messages name the harness's own session, so
// the next message resumes that session and a terminal's `claude --resume` or `codex resume` still finds it.

const LIST_TTL = 15_000;
const HISTORY_TTL = 2 * 60_000;
const HISTORY_KEPT = 4;
// A synchronization that was put off is not tried again for the same transcript before this long: a minute when it is for the moment (the agent was working, a
// write was in the way), ten when this DSH cannot be synchronized into at all (sync.mjs says `unsupported`): every try reads the transcript and the whole DSH session.
const PUT_OFF_FOR = { busy: 60_000, unsupported: 10 * 60_000 };
const MAX_LIMIT = 500;

/** Which DSH session each native session was loaded into (or was started from), kept across restarts. */
export async function createLinkStore(folder) {
  const file = join(folder, 'links.json');
  let links = {};
  try { links = JSON.parse(await readFile(file, 'utf8')); } catch { /* none yet, or unreadable: start again */ }
  if (!links || typeof links !== 'object' || Array.isArray(links)) links = {};
  let writing = Promise.resolve();
  const save = () => {
    const pending = writing.then(async () => {
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(links, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, file);
    });
    writing = pending.catch(() => {});
    return pending;
  };
  return {
    get: (provider, id) => links[`${provider}:${id}`]?.removed ? undefined : links[`${provider}:${id}`]?.sessionId,
    nativeKey: (sessionId) => Object.entries(links).find(([key, link]) => !key.startsWith('dsh:') && !link.removed && link.sessionId === sessionId)?.[0] ?? null,
    // Suppress automatic inbox adoption; the original conversation stays available for manual import.
    hidden: (provider, id) => links[`${provider}:${id}`]?.removed === true || links[`${provider}:${id}`]?.dismissed === true,
    removed: (sessionId) => Object.values(links).some((link) => link.sessionId === sessionId && link.removed),
    async retire({ sessionId, provider, id }) {
      for (const [key, link] of Object.entries(links)) if (sessionId && link.sessionId === sessionId) links[key] = { ...link, removed: true };
      if (provider && id) links[`${provider}:${id}`] = { ...links[`${provider}:${id}`], ...(sessionId ? { sessionId } : {}), removed: true, at: Date.now() };
      if (sessionId) links[`dsh:${sessionId}`] = { sessionId, removed: true, at: Date.now() };
      await save();
    },
    async replace({ route, nativeSessionId, previousId, sessionId }) {
      const native = `${route}:${nativeSessionId}`;
      if (links[native]?.sessionId !== previousId || links[native]?.removed) throw new Error('The native session link changed during repair.');
      const before = new Map(Object.entries(links).filter(([key, link]) => key === native || link.sessionId === previousId || key === `dsh:${previousId}`));
      for (const [key, link] of before) if (key !== native) links[key] = { ...link, removed: true };
      links[native] = { sessionId, at: Date.now(), ...(before.get(native)?.dismissed ? { dismissed: true } : {}) };
      links[`dsh:${previousId}`] = { sessionId: previousId, removed: true, at: Date.now() };
      try { await save(); }
      catch (error) {
        delete links[`dsh:${previousId}`];
        for (const [key, link] of before) links[key] = link;
        throw error;
      }
    },
    record({ route, nativeSessionId, sessionId }) {
      if (!route || !nativeSessionId || !sessionId) return;
      // A late event from an archived copy must not replace a later explicit import.
      if (Object.values(links).some((link) => link.sessionId === sessionId && link.removed)) return;
      const key = `${route}:${nativeSessionId}`;
      if (links[key]?.sessionId === sessionId) return;
      const dismissed = links[key]?.removed || links[key]?.dismissed;
      links[key] = { sessionId, at: Date.now(), ...(dismissed ? { dismissed: true } : {}) };
      void save().catch(() => {});
    },
    forget(provider, id) { delete links[`${provider}:${id}`]; void save().catch(() => {}); },
    flush: () => writing,
  };
}

const lower = (value) => String(value ?? '').toLowerCase();
const keyOf = (session) => `${session.provider}:${session.id}`;
// A session changed when its file did; Codex does not say how big a thread is, so its update time stands in.
// A conversation that changed is read again for the search, but not more than once in a while: a session somebody is working in changes every few seconds, and reading
// a transcript of hundreds of megabytes each time would keep the computer busy for nothing. (This was lost in the move to the disk index; the test of it said so.)
const REINDEX_MS = 5 * 60_000;
const stampOf = (session) => `${session.size ?? ''}:${session.mtimeMs ?? session.updatedAt}`;

/** How much one search term says about a session's own details: the title counts most. 0 when it is not in them. */
export function metadataWeight(session, term) {
  const fields = [[session.title, 8], [session.preview, 4], [session.cwd, 3], [session.branch, 2], [session.id, 3]];
  return Math.max(0, ...fields.map(([value, weight]) => (lower(value).includes(term) ? weight : 0)));
}

/** The words of a query, lower case. */
export const termsOf = (query) => lower(query).split(/\s+/).filter(Boolean);

// `attachments()` is DSH's attachment store (it may be absent): the pictures a person pasted into a session are kept there when it is loaded.
export function createNativeSessions({ sources, persistence, workspaces, attachments = () => undefined, controller = () => undefined, query = () => undefined, agents = () => undefined, rebind, links, claude = {}, cacheFile, diagnostics, now = Date.now }) {
  const claudeCache = new Map();
  const content = createCachedContentIndex({ file: cacheFile });
  let listed;                // { at, sessions, providers }
  let restored = false;
  let scanning;
  let closed = false;
  let indexing;              // the running indexing pass
  let progress = { running: false, done: 0, total: 0, unsearchable: 0, failed: false };
  // A failed conversation is not read again by list polling. Only an explicit refresh clears its failure.
  const unreadable = new Map(); // key -> { stamp, reason }
  const indexedAt = new Map(); // key -> when its conversation was last read for the search
  const sentence = (error) => { const text = error instanceof Error ? error.message : String(error); return /[.!?]$/.test(text) ? text : `${text}.`; };
  function cannotRead(session, reason) {
    const key = keyOf(session);
    unreadable.set(key, { stamp: stampOf(session), reason });
    diagnostics?.record({ event: 'session.index.failure', provider: session.provider, id: session.id, error: reason });
    console.warn(`[dudu] Conversation search cannot read ${key}: ${reason} Automatic retry is disabled.`);
  }
  async function checkTranscript(session) {
    if (!session.file) return;
    // Codex keeps the .jsonl path in thread/list after compressing the rollout to .jsonl.zst.
    // Its app-server reads that compressed sibling itself; do not reject a valid thread before asking it.
    for (const file of [session.file, ...(session.file.endsWith('.zst') ? [] : [session.file + '.zst'])]) {
      try { if ((await stat(file)).isFile()) return; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    throw Object.assign(new Error('Missing transcript file.'), { code: 'ENOENT' });
  }
  const loading = new Map(); // key -> promise, so a double click loads once
  const readingMessages = new Map();
  const previewPriorities = new Map();
  const previewWorkers = new Set();
  const checked = new Map();
  const putOff = new Map(); // DSH session id -> { stamp, until }: the transcript as it was when its synchronization was put off, and when it may be tried again
  const unlinked = new Map();
  const synchronize = createNativeSync({
    persistence, controller, query, agents,
    refresh: ({ history, route }) => load({ provider: history.provider ?? route, id: history.id, syncOnly: true, fresh: false }),
  });
  const repair = createImportRepair({ persistence, controller, query, agents, workspaces, links, rebind });

  const sourceOf = (provider) => sources().find((source) => source.id === provider);

  /** Read the conversations that are new or changed, in the background: a search looks inside them once they are in. */
  function startIndexing(snapshot, { refresh = false } = {}) {
    if (indexing || closed) return;
    const wanted = new Map(snapshot.sessions.map((session) => [keyOf(session), session]));
    for (const key of content.keys()) if (!wanted.has(key)) content.delete(key);
    for (const key of unreadable.keys()) if (!wanted.has(key)) unreadable.delete(key);
    if (refresh) { unreadable.clear(); indexedAt.clear(); } // asked for by the person: read everything that changed, and try what could not be read again
    const current = (session) => content.stamp(keyOf(session)) === stampOf(session) && content.messageStamp(keyOf(session)) === stampOf(session);
    // A failed ordered-preview backfill must not make an existing searchable document count as unreadable.
    const unsearchable = () => [...wanted.values()].filter((session) => unreadable.has(keyOf(session)) && !content.has(keyOf(session))).length;
    const settle = () => { const missing = unsearchable(); progress = { running: false, done: wanted.size - missing, total: wanted.size, unsearchable: missing, failed: missing > 0 }; };
    const todo = [...wanted.values()].filter((session) => !current(session) && !unreadable.has(keyOf(session))
      && (content.stamp(keyOf(session)) === undefined || now() - (indexedAt.get(keyOf(session)) ?? 0) >= REINDEX_MS));
    if (!todo.length) { settle(); return; }
    progress = { running: true, done: wanted.size - todo.length - unsearchable(), total: wanted.size, unsearchable: unsearchable(), failed: unsearchable() > 0 };
    indexing = (async () => {
      const claude = todo.filter((item) => item.provider === 'claude');
      const shared = claude.map((session) => readingMessages.get(keyOf(session))).filter(Boolean);
      const queued = claude.filter((session) => !current(session) && !readingMessages.has(keyOf(session)));
      if (queued.length) {
        const waiting = new Map(queued.map((session) => [session.id, Promise.withResolvers()]));
        const remaining = new Set(waiting.keys());
        const writes = [];
        for (const session of queued) {
          const task = waiting.get(session.id);
          void task.promise.catch(() => {});
          readingMessages.set(keyOf(session), task.promise);
        }
        const worker = indexClaudeConversations(queued, ({ session, text }) => {
          const task = waiting.get(session.id);
          const writing = (async () => {
            try {
              if (!text) throw new Error('Its transcript could not be read.');
              await content.set(keyOf(session), stampOf(session), text);
              indexedAt.set(keyOf(session), now());
              unreadable.delete(keyOf(session));
              progress.done++;
              task.resolve();
            } catch (error) {
              if (!closed) cannotRead(session, sentence(error));
              task.reject(error);
            } finally { remaining.delete(session.id); }
          })();
          writes.push(writing);
        });
        previewWorkers.add(worker);
        for (const session of queued) previewPriorities.set(keyOf(session), () => worker.prioritize(session.id));
        try { await worker.done; } finally {
          await Promise.all(writes);
          for (const id of remaining) waiting.get(id).reject(new Error('Conversation indexing stopped.'));
          for (const session of queued) {
            if (readingMessages.get(keyOf(session)) === waiting.get(session.id).promise) readingMessages.delete(keyOf(session));
            previewPriorities.delete(keyOf(session));
          }
          previewWorkers.delete(worker);
        }
      }
      await Promise.allSettled(shared);
      if (closed) return;
      const codex = [];
      for (const session of todo.filter((item) => item.provider === 'codex' && !current(item))) {
        try { await checkTranscript(session); codex.push(session); }
        catch (error) { if (!closed) cannotRead(session, sentence(error)); }
      }
      const source = sourceOf('codex');
      if (codex.length && source) {
        await Promise.allSettled(codex.map((session) => readingMessages.get(keyOf(session))));
        const byId = new Map(codex.filter((session) => !current(session)).map((session) => [session.id, session]));
        const waiting = new Map();
        for (const session of byId.values()) {
          const task = Promise.withResolvers();
          void task.promise.catch(() => {});
          waiting.set(session.id, task);
          readingMessages.set(keyOf(session), task.promise);
        }
        await readCodexThreads({ command: source.command, env: source.environment?.(), spawnProcess: source.spawnProcess }, [...byId.keys()], async (id, thread) => {
          const session = byId.get(id);
          await content.set(`codex:${id}`, stampOf(session), codexSearchText(thread, { includeMessages: true }));
          indexedAt.set(keyOf(session), now());
          unreadable.delete(keyOf(session));
          byId.delete(id);
          progress.done++;
          waiting.get(id).resolve();
        }, {
          onFailure: (id, error) => {
            const session = byId.get(id);
            if (!session) return;
            byId.delete(id);
            cannotRead(session, sentence(error));
            waiting.get(id).reject(error);
          },
        });
        for (const session of byId.values()) {
          cannotRead(session, 'The Codex app-server did not return it.');
          waiting.get(session.id).reject(new Error('The Codex app-server did not return it.'));
        }
        for (const [id, task] of waiting) if (readingMessages.get(`codex:${id}`) === task.promise) readingMessages.delete(`codex:${id}`);
      }
      await content.flush();
    })().catch((error) => {
      if (closed) return;
      for (const session of todo) if (!current(session) && !unreadable.has(keyOf(session))) cannotRead(session, sentence(error));
    }).finally(() => { if (closed) progress = { ...progress, running: false }; else settle(); indexing = undefined; });
  }

  async function rescan({ refresh }) {
    if (!refresh && listed && now() - listed.at < LIST_TTL) return listed;
    const providers = [];
    const sessions = [];
    // Only Claude and Codex keep sessions that the plugin reads itself (OAR cannot list a harness's sessions, so these two have readers here).
    for (const source of sources().filter((candidate) => ['claude', 'codex'].includes(candidate.id))) {
      try {
        const found = source.id === 'claude'
          ? await listClaudeSessions({ cache: claudeCache, ...claude })
          : await listCodexThreads({ command: source.command, env: source.environment?.(), spawnProcess: source.spawnProcess });
        sessions.push(...found);
        providers.push({ id: source.id, name: source.name, count: found.length });
      } catch (error) {
        sessions.push(...(listed?.sessions ?? []).filter((session) => session.provider === source.id));
        providers.push({ id: source.id, name: source.name, count: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
    listed = { at: now(), sessions, providers };
    await content.saveSnapshot(listed);
    startIndexing(listed, { refresh });
    return listed;
  }

  async function scan({ refresh }) {
    await content.ready;
    if (!restored) {
      const cached = await content.snapshot();
      if (cached && Array.isArray(cached.sessions) && Array.isArray(cached.providers)) listed = { ...cached, at: 0 };
      restored = true;
    }
    const run = () => (scanning ??= rescan({ refresh }).finally(() => { scanning = undefined; }));
    if (listed && !refresh) {
      if (now() - listed.at >= LIST_TTL) void run().catch(() => {});
      return listed;
    }
    return run();
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
    const inside = new Map(await Promise.all(terms.map(async (term) => [term, await content.find(term)])));
    const matches = [];
    for (const session of snapshot.sessions) {
      if (provider && session.provider !== provider) continue;
      const key = keyOf(session);
      let score = terms.length ? 0 : 1;
      let needsEvidence = false;
      for (const term of terms) {
        const weight = metadataWeight(session, term);
        const hit = inside.get(term).get(key);
        if (!weight && !hit) { score = 0; break; }
        score += weight || 1;
        // What the session says about a word its details do not hold: a few words around it.
        if (!weight && hit) needsEvidence = true;
      }
      if (score > 0) matches.push({ session, score, needsEvidence });
    }
    matches.sort((a, b) => (b.score - a.score) || (b.session.updatedAt - a.session.updatedAt));
    const shown = matches.slice(0, Math.min(Math.max(1, limit), MAX_LIMIT));
    const excerpts = terms.length ? await content.evidence(shown.filter((item) => item.needsEvidence).map(({ session }) => keyOf(session)), query) : new Map();
    const sessions = await Promise.all(shown.map(async ({ session }) => {
      const { file, size, mtimeMs, ...view } = session;
      const evidence = excerpts.get(keyOf(session));
      const dshSessionId = await linkedSession(session);
      return { key: keyOf(session), ...view, previewVersion: content.messageStamp(keyOf(session)) ?? null, ...(evidence ? { evidence } : {}), ...(dshSessionId ? { dshSessionId } : {}) };
    }));
    return { sessions, total: matches.length, providers: snapshot.providers, home: homedir(), indexing: { ...progress } };
  }

  async function summaryOf(provider, id) {
    let found = (await scan({ refresh: false })).sessions.find((session) => session.provider === provider && session.id === id);
    if (!found) found = (await scan({ refresh: true })).sessions.find((session) => session.provider === provider && session.id === id);
    if (!found) throw new Error('That session is no longer on this computer.');
    // A list can stay cached while a TUI writes more. The transcript's own stamp is authoritative for synchronization.
    if (found.file) {
      if (provider === 'claude') return await readClaudeSummary({ file: found.file, cache: claudeCache }) ?? found;
      try { const info = await stat(found.file); return { ...found, size: info.size, mtimeMs: info.mtimeMs }; } catch { /* the harness may still read it */ }
    }
    return found;
  }

  /** Search and preview share ordered text; a cold click reuses a scan already reading the same conversation. */
  function cacheConversation(summary) {
    const key = keyOf(summary);
    if (content.messageStamp(key) === stampOf(summary)) return Promise.resolve();
    if (readingMessages.has(key)) {
      previewPriorities.get(key)?.();
      return readingMessages.get(key);
    }
    const pending = (async () => {
      let text;
      if (summary.provider === 'claude') {
        const worker = indexClaudeConversations([summary], (result) => { text = result.text; });
        previewWorkers.add(worker);
        try { await worker.done; } finally { previewWorkers.delete(worker); }
        if (!text) throw new Error('Its transcript could not be read.');
      } else {
        const source = sourceOf(summary.provider);
        if (!source) throw new Error('That harness is unavailable.');
        await checkTranscript(summary);
        const thread = await readCodexThread({
          command: source.command, env: source.environment?.(), spawnProcess: source.spawnProcess, timeoutMs: 25_000,
        }, summary.id);
        text = codexSearchText(thread, { includeMessages: true });
      }
      if (closed) throw new Error('Conversation indexing stopped.');
      await content.set(key, stampOf(summary), text);
    })().finally(() => { if (readingMessages.get(key) === pending) readingMessages.delete(key); });
    readingMessages.set(key, pending);
    return pending;
  }

  // A whole conversation is read from a transcript that can be hundreds of megabytes, or from a Codex app-server that can take minutes:
  // one that was read for a session as it was stays for a while, so choosing a session again, or loading what was just previewed,
  // does not read it again. Reads that overlap share one.
  const histories = new Map(); // `${provider}:${id}` -> { stamp, promise, at }
  function readHistory(source, summary, fresh = false) {
    const key = `${summary.provider}:${summary.id}`;
    const stamp = stampOf(summary);
    const cached = histories.get(key);
    if (!fresh && cached && cached.stamp === stamp && now() - cached.at < HISTORY_TTL) return cached.promise;
    const promise = (async () => {
      if (source.id === 'claude') return readClaudeHistory({ file: summary.file, id: summary.id });
      const thread = await readCodexThread({ command: source.command, env: source.environment?.() }, summary.id);
      return codexHistory(thread, { metrics: await readCodexMetrics(thread.path ?? summary.file) });
    })();
    histories.delete(key);
    histories.set(key, { stamp, promise, at: now() });
    while (histories.size > HISTORY_KEPT) histories.delete(histories.keys().next().value);
    promise.catch(() => { if (histories.get(key)?.promise === promise) histories.delete(key); });
    return promise;
  }

  // The pictures of a conversation are read from the transcript once more (withPictures), and that read was not kept: a pass of the synchronization read the whole
  // transcript for them every time it ran, whether or not anything had changed. One read is kept, as the history is, for as long as the transcript is as it was.
  const withImagesCache = new Map(); // `${provider}:${id}` -> { stamp, promise, at }
  function picturedHistory(source, summary, history, fresh = false) {
    const key = `${summary.provider}:${summary.id}`;
    const stamp = stampOf(summary);
    const cached = withImagesCache.get(key);
    if (!fresh && cached && cached.stamp === stamp && now() - cached.at < HISTORY_TTL) return cached.promise;
    const promise = withPictures(source, summary, history);
    withImagesCache.delete(key);
    withImagesCache.set(key, { stamp, promise, at: now() });
    while (withImagesCache.size > HISTORY_KEPT) withImagesCache.delete(withImagesCache.keys().next().value);
    promise.catch(() => { if (withImagesCache.get(key)?.promise === promise) withImagesCache.delete(key); });
    return promise;
  }

  /** The model a loaded session starts on: the one the conversation used when the harness offers it, else its default. */
  async function modelFor(source, history) {
    const models = await source.driver.listModels();
    const used = typeof history.model === 'string' ? history.model : '';
    // The model the conversation ran on: by its own name, or by the alias that means it today (a non-default one first: `sonnet` is a
    // choice, `default` only happens to be the same model), so that the loaded session shows what it really used.
    const model = models.find((candidate) => candidate.id === used)
      ?? (used ? models.find((candidate) => candidate.id !== 'default' && candidate.resolvedId === used) : undefined)
      ?? (used ? models.find((candidate) => candidate.id.endsWith(`/${used}`) || candidate.resolvedId === used) : undefined)
      ?? models[0];
    const modelId = model?.id ?? 'default';
    let effort;
    try { effort = (await source.driver.resolveModel(modelId)).reasoning?.defaultEffort; } catch { /* no effort levels */ }
    return { model: modelId, effort };
  }

  /**
   * The conversation to load, with the pictures the person pasted stored in DSH (they show as pictures in its chat). A Claude
   * transcript is read once more for them, only when it holds some: their bytes are not kept with the conversation that is reused.
   * A picture that cannot be had or stored stays a marker; this never fails a load.
   */
  async function withPictures(source, summary, history) {
    try {
      let read = history;
      if (source.id === 'claude' && history.turns.some((turn) => turn.pictures)) {
        try { read = await readClaudeHistory({ file: summary.file, id: summary.id, images: true }); } catch { /* the words load without them */ }
      }
      return await keepImages(read, { attachments: attachments() });
    } catch { return history; }
  }

  async function loadOnce({ provider, id, syncOnly = false, fresh = true }) {
    const source = sourceOf(provider);
    if (!source) throw new Error('That harness is not available. Check Settings > 供应商.');
    const store = persistence();
    const registry = workspaces();
    if (!store || !registry) throw new Error('This DSH cannot store a loaded session.');
    const summary = await summaryOf(provider, id);
    const existing = await linkedSession(summary);
    if (syncOnly && !existing) return { updated: false };
    const stamp = stampOf(summary);
    if (existing && !fresh && checked.get(existing) === stamp) return { sessionId: existing, reused: true, updated: false, title: summary.title };
    // Reading a transcript is the expensive part (a conversation of 659 MB takes five seconds of DSH's main thread, and a second read for its pictures), and it is
    // pointless when the synchronization will be put off anyway. It is put off while the session's agent works in DSH (sync.mjs), and the transcript of a turn that
    // runs grows all the time, so that it was read again every five seconds the panel asked, for the whole turn (2026-11-07: a phone's message waited 3.9 seconds
    // for DSH). So: a working agent is not asked at all, and a transcript that was put off is not read again for a minute, unless it grew or somebody asks (`fresh`).
    if (syncOnly && existing) {
      if (busy(agents()?.get(existing))) return { sessionId: existing, reused: true, updated: false, deferred: true, title: summary.title };
      const wait = putOff.get(existing);
      if (!fresh && wait && wait.stamp === stamp && now() < wait.until) return { sessionId: existing, reused: true, updated: false, deferred: true, title: summary.title };
    }
    const history = await readHistory(source, summary, fresh);
    if (existing) {
      const withImages = await picturedHistory(source, summary, history, fresh);
      const repaired = await repair({ sessionId: existing, history: withImages, route: source.route });
      if (repaired) {
        await synchronize({ sessionId: repaired.sessionId, history: withImages, route: source.route });
        checked.delete(existing);
        checked.set(repaired.sessionId, stamp);
        return { ...repaired, reused: false };
      }
      const result = await synchronize({ sessionId: existing, history: withImages, route: source.route });
      if (!result.deferred) { checked.set(existing, stamp); putOff.delete(existing); } else putOff.set(existing, { stamp, until: now() + (PUT_OFF_FOR[result.reason] ?? PUT_OFF_FOR.busy) });
      return { sessionId: existing, reused: true, title: summary.title, ...result };
    }
    if (!history.cwd) throw new Error('The session does not say which folder it ran in.');
    if (!history.turns.length) throw new Error('The session has no conversation to load.');
    const workspace = await registry.create(history.cwd).catch((error) => {
      throw new Error(`The session's folder is not available: ${history.cwd} (${error.message})`);
    });
    const sessionId = `session-${randomUUID()}`;
    const { model, effort } = await modelFor(source, history);
    const pictured = await withPictures(source, summary, history);
    // Store the settled prefix, activate it, then observe the native turn through the live publication path.
    const { header, events } = buildSessionEvents({
      history: { ...pictured, turns: pictured.turns.filter((turn) => turn.complete !== false) },
      route: source.route, model, effort, sessionId, title: summary.title,
    });
    const handle = await store.create(header);
    try {
      await handle.append(events);
      await handle.flush();
    } finally {
      await handle.close();
    }
    try { await workspace.attachSession(sessionId); } catch (error) { console.warn(`[dudu] Could not attach the loaded session to its workspace: ${error.message}`); }
    links.record({ route: source.route, nativeSessionId: summary.id, sessionId });
    if (pictured.turns.some((turn) => turn.complete === false)) await synchronize({ sessionId, history: pictured, route: source.route });
    checked.set(sessionId, stamp);
    return { sessionId, workspaceId: workspace.id, reused: false, title: summary.title };
  }

  function load(request) {
    const key = `${request.provider}:${request.id}`;
    if (!loading.has(key)) loading.set(key, loadOnce(request).finally(() => loading.delete(key)));
    return loading.get(key);
  }

  async function nativeKey(sessionId, recover) {
    const known = links.nativeKey(sessionId);
    if (known || !recover || links.removed(sessionId)) return known;
    if (now() - (unlinked.get(sessionId) ?? -Infinity) < HISTORY_TTL) return null;
    const services = { controller: controller(), query: query() };
    if (!canReadSessionHistory(services)) return null;
    const inspected = await readSessionHistory(services, sessionId);
    const current = links.nativeKey(sessionId);
    if (current) return current;
    const identity = nativeIdentity(inspected?.events);
    if (!identity) {
      unlinked.delete(sessionId);
      unlinked.set(sessionId, now());
      if (unlinked.size > MAX_LIMIT) unlinked.delete(unlinked.keys().next().value);
      return null;
    }
    // Explicit deletions and newer imports win over a historical copy of the same native conversation.
    const linked = links.get(identity.provider, identity.id);
    if (links.removed(sessionId) || links.hidden(identity.provider, identity.id) || (linked && linked !== sessionId)) return null;
    links.record({ route: identity.provider, nativeSessionId: identity.id, sessionId });
    await links.flush();
    return links.nativeKey(sessionId);
  }

  return {
    list, load,
    close: async () => {
      closed = true;
      await scanning;
      await Promise.allSettled([...previewWorkers].map((worker) => worker.stop()));
      await indexing;
      await Promise.allSettled([...readingMessages.values()]);
      await content.close();
    },
    async sync({ sessionIds = [], fresh = false, recover = false } = {}) {
      const updated = [];
      const replacements = [];
      for (const sessionId of [...new Set(sessionIds)].slice(0, MAX_LIMIT)) {
        try {
          const native = await nativeKey(sessionId, recover);
          if (!native) continue;
          const [provider, ...parts] = native.split(':');
          const result = await load({ provider, id: parts.join(':'), syncOnly: true, fresh });
          if (result.updated) updated.push(result.sessionId ?? sessionId);
          if (result.repaired) replacements.push({ previousId: result.previousId, sessionId: result.sessionId, workspaceId: result.workspaceId });
        } catch (error) { console.warn(`[dudu] Could not synchronize a native session: ${error.message}`); }
      }
      return { updated, ...(replacements.length ? { replacements } : {}) };
    },
    async describe({ provider, id }) {
      const { file: _file, size: _size, mtimeMs: _mtime, ...session } = await summaryOf(provider, id);
      const dshSessionId = await linkedSession(session);
      return { ...session, key: keyOf(session), ...(dshSessionId ? { dshSessionId } : {}) };
    },
    async read({ provider, id, before, query }, { signal } = {}) {
      const began = now();
      let source = 'sqlite';
      try {
        signal?.throwIfAborted();
        const key = `${provider}:${id}`;
        const page = content.page(key, { before, query });
        let result = await (signal ? withAbort(Promise.resolve(page), signal) : page);
        if (!result) {
          source = 'source';
          const summary = await summaryOf(provider, id);
          const pending = cacheConversation(summary);
          await (signal ? withAbort(pending, signal) : pending);
          const stored = content.page(key, { before, query });
          result = await (signal ? withAbort(Promise.resolve(stored), signal) : stored);
        }
        diagnostics?.record({ event: 'session.preview.read', provider, id, source, outcome: 'success', elapsedMs: now() - began, count: result?.messages?.length });
        return result;
      } catch (error) {
        diagnostics?.record({ event: 'session.preview.read', provider, id, source, outcome: 'failure', elapsedMs: now() - began, error });
        throw error;
      }
    },
    /** The title of a session as the list knows it, or undefined. */
    titleOf: (provider, id) => listed?.sessions.find((session) => session.provider === provider && session.id === id)?.title,
    /** Resolves once the pass that is reading conversations has finished (for tests and for callers that must search at once). */
    settled: async () => { await scanning; while (indexing) await indexing; await content.flush(); },
    async handle(action, request) {
      try {
        const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
        if (action === 'list') return Response.json(await list(body), { headers: { 'cache-control': 'no-store' } });
        if (action === 'load') return Response.json(await load(body), { headers: { 'cache-control': 'no-store' } });
        if (action === 'sync' && Array.isArray(body.sessionIds) && body.sessionIds.every((id) => typeof id === 'string')) return Response.json(await this.sync(body), { headers: { 'cache-control': 'no-store' } });
        return new Response('Not found', { status: 404 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    },
  };
}
