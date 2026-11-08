// DSH's side of agent-sessions.mjs: the sessions of issues as DSH's own services know them. With host/dudu-plugin/index.mjs, which
// hands it `ctx`, this is where those services are touched. What each call is, and what was tried, is in docs/dsh-session-control.md.
//
//   const dsh = createDshSessions(ctx);       // the adapter createAgentSessions takes
//
// Every service is looked up when it is used: a DSH that lacks one still runs the plugin, and the call that needs it says so. Both
// runtimes have all of them (the npm `dsh web` 0.2.0-rc.2 and the Desktop's bundled CLI 0.2.1-rc.3); neither needs `connection.createPeer`.
import { randomUUID } from 'node:crypto';
import { createDshContentSearch } from './session-search.mjs';
import { withAbort } from '../../providers/async.mjs';
import { readSessionHistory } from '../../dsh-session-history.mjs';

const textOf = (content) => (typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n'));

/** The first of the promises to be kept; rejected only when every one of them is not. */
function firstKept(...promises) {
  return new Promise((resolve, reject) => {
    let left = promises.length;
    for (const promise of promises) promise.then(resolve, (error) => { if (--left === 0) reject(error); });
  });
}

/** What the agent asks, as the one text the issue's `ask` carries: the questions, each with the choices it offers. */
export function questionText(questions) {
  return questions.map((item, index) => {
    const choices = item.options?.length ? ` (${item.options.map((option) => option.label).join(' / ')})` : '';
    return `${questions.length > 1 ? `${index + 1}. ` : ''}${item.question}${choices}`;
  }).join('\n');
}

/**
 * The owner's words as the answer DSH's question tool takes. They answer the first question: the label of one of its choices picks that
 * choice, anything else is the "other" answer. The questions after the first are left unanswered, as DSH's own window allows.
 */
export function answerOf(questions, text) {
  const [first, ...rest] = questions;
  const wanted = String(text).trim().toLowerCase();
  const chosen = first.options?.find((option) => option.label.trim().toLowerCase() === wanted);
  return { answers: [chosen ? { id: first.id, selected: [chosen.label] } : { id: first.id, selected: [], custom: String(text).trim() }, ...rest.map((item) => ({ id: item.id, selected: [] }))] };
}

// What the owner may say to let an agent have a wider mode for one operation. Anything else is a no: an approval is never guessed from a
// reply that was meant as something else.
const ALLOW = new Set(['允许', '同意', '可以', '好', '好的', '是', '是的', '放开', 'yes', 'y', 'ok', 'okay', 'approve', 'allow']);

/** The owner's words as DSH's outcome for an approval: a plain yes allows the one operation asked about, everything else refuses it. */
export function outcomeOf(text) {
  const words = String(text).trim().toLowerCase().replace(/[\s。.!！,，]+$/u, '');
  return ALLOW.has(words) ? 'allowed-once' : 'rejected';
}

/** What an agent asks permission for, as the issue's ask: DSH's own sentence for it, and how to answer. */
export function approvalText(request) {
  const said = request.displayReason?.zh ?? request.displayReason?.en ?? request.reason ?? `使用 ${request.toolName}`;
  return `${said}\n回复“允许”放开这一次，其他回复都不放开。`;
}

export function createDshSessions(ctx, { hidden = () => false, nativeDefaults, cacheFile, diagnostics } = {}) {
  const service = (name) => {
    let found;
    try { found = ctx[name]; } catch { found = undefined; } // reading a service the plugin did not ask for throws
    if (!found) throw new Error(`This DSH has no ${name} service.`);
    return found;
  };
  const optional = (name) => { try { return ctx[name]; } catch { return undefined; } };
  const inspectSession = (id, signal) => readSessionHistory({
    controller: optional('sessionController'), query: optional('sessionQuery'),
  }, id, signal);
  let fallbackSearch = false;
  let catalogDirty = false;
  const contentSearch = createDshContentSearch({
    file: cacheFile,
    diagnostics,
    controller: () => service('sessionController'),
    query: () => optional('sessionQuery'),
    watch: (receive) => ctx.on?.('session/event', (session, event) => {
      if (!session?.id) return;
      if (['user/message', 'assistant/message', 'session/title'].includes(event.type)) catalogDirty = true;
      if (['user/message', 'assistant/message'].includes(event.type)) receive(session.id);
    }, { global: true }),
  });
  let cachedCatalog;
  let restoredCatalog = false;
  let readingCatalog;
  const catalogLifetime = new AbortController();
  async function catalogItems(refresh, signal) {
    await contentSearch.ready;
    if (!restoredCatalog) {
      cachedCatalog = await contentSearch.snapshot();
      if (!Array.isArray(cachedCatalog?.items)) cachedCatalog = null;
      else cachedCatalog.at = 0; // show it immediately and check for changes in the background
      restoredCatalog = true;
    }
    const scan = () => (readingCatalog ??= (async () => {
      catalogDirty = false;
      const readSignal = AbortSignal.any([catalogLifetime.signal, AbortSignal.timeout(12_000)]);
      const result = await withAbort(service('sessionController').list({}, readSignal), readSignal);
      cachedCatalog = { at: Date.now(), items: result.items ?? result };
      await contentSearch.saveSnapshot(cachedCatalog);
      return cachedCatalog;
    })().finally(() => { readingCatalog = undefined; }));
    if (cachedCatalog && !refresh) {
      if (catalogDirty || Date.now() - cachedCatalog.at >= 15_000) void scan().catch(() => {});
      return cachedCatalog.items;
    }
    return (await withAbort(scan(), signal)).items;
  }

  return {
    defaults: nativeDefaults,
    searchState: contentSearch.state,
    async close() {
      catalogLifetime.abort();
      await readingCatalog?.catch(() => {});
      await contentSearch.close();
    },
    /** Repair only defaults Dudu originally wrote, before any user input or later owner selection. */
    async repairDefaults(sessionId, initial, { access = false, model = false } = {}) {
      if (!nativeDefaults || initial?.provider !== 'claude' || optional('agents')?.get(sessionId)?.status === 'running') return;
      const inspect = () => inspectSession(sessionId);
      const eligible = ({ events }) => {
        const firstInput = events.find((event) => event.type === 'user/message' && (event.data?.message?.source ?? event.data?.source)?.kind === 'user');
        if (!firstInput) return null;
        const permission = events.findLast((event) => event.type === 'permission/preset');
        const selection = events.findLast((event) => event.type === 'model/selection');
        return {
          permission, selection,
          access: access && initial.access === 'read-only' && permission?.seq < firstInput.seq && permission.data.preset === 'read-only',
          model: model && initial.model === 'default' && selection?.seq < firstInput.seq && selection.data.provider === 'claude' && selection.data.model === 'default',
        };
      };
      const before = eligible(await inspect());
      if (!before?.access && !before?.model) return;
      const agent = optional('agents')?.get(sessionId);
      const defaults = await nativeDefaults('claude', { cwd: initial.cwd ?? agent?.session?.header?.cwd });
      if (!defaults || optional('agents')?.get(sessionId)?.status === 'running') return;
      const current = eligible(await inspect());
      if (before.access && current?.access && current.permission.seq === before.permission.seq && defaults.access) await this.setAccess(sessionId, defaults.access);
      if (before.model && current?.model && current.selection.seq === before.selection.seq && defaults.model) await this.selectModel(sessionId, {
        provider: 'claude', model: defaults.model, ...(defaults.effort ? { reasoningEffort: defaults.effort } : {}),
      });
    },
    isRunning: (sessionId) => optional('agents')?.get(sessionId)?.status === 'running',
    projects: () => (optional('workspaceRegistry')?.list() ?? []).map((item) => ({ name: item.title, path: item.path, id: item.id })),
    async list() {
      const result = await service('sessionController').list();
      return result.items ?? result;
    },
    async title(sessionId) {
      const { events } = await inspectSession(sessionId);
      const event = events.findLast((item) => item.type === 'session/title');
      return event ? { title: event.data.title, seq: event.seq, at: event.time } : null;
    },
    renameTitle: (sessionId, title) => service('sessionController').rename({ sessionId, title }),
    watchTitles: (receive) => ctx.on('session/event', (session, event) => {
      if (session?.id && event?.type === 'session/title') receive(session.id, { title: event.data.title, seq: event.seq, at: event.time });
    }),

    async catalog({ query = '', refresh = false, contentIndexOnly = false, signal = AbortSignal.timeout(12_000) } = {}) {
      const controller = service('sessionController');
      await contentSearch.ready;
      const items = await catalogItems(refresh, signal);
      const registry = optional('workspaceRegistry');
      const workspaces = registry?.list() ?? [];
      const archived = new Set(registry?.archivedSessionIds ?? []);
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let hits = new Map();
      if (terms.length && !contentIndexOnly && !contentSearch.state().searchable && !fallbackSearch && typeof controller.search === 'function') {
        try {
          const found = await controller.search({ query: query.trim() }, signal);
          hits = new Map((found.items ?? found).map((item) => [item.sessionId, item.snippet]));
          if (found.hasMore) fallbackSearch = true;
        } catch (error) {
          signal.throwIfAborted();
          // Desktop's web profile can explicitly disable the query index. Its durable sessions are still cold-readable.
          if (/session search is disabled|session search is unavailable/i.test(error.message)) fallbackSearch = true;
          else throw error;
        }
      }
      const rows = items.filter((item) => {
        const id = item.sessionId ?? item.id;
        return id && !hidden(id) && !id.startsWith('dudu-assistant-') && !item.blank && !item.parentSessionId && item.origin !== 'subagent' && !archived.has(id);
      }).map((item) => {
        const id = item.sessionId ?? item.id;
        const values = item.projections?.values ?? {};
        const title = typeof values.title === 'string' ? values.title : values.title?.title ?? item.title ?? '';
        const workspace = workspaces.find((candidate) => candidate.sessionIds.includes(id) || candidate.path === item.cwd);
        const selection = values.modelSelection?.next ?? values.modelSelection?.lastUsed ?? optional('agents')?.get(id)?.options;
        return {
          key: `dsh:${id}`, id, provider: 'dsh', dshSessionId: id, workspaceId: workspace?.id,
          agent: ['claude', 'codex'].includes(selection?.provider) ? selection.provider : 'deepseek',
          project: workspace ? { name: workspace.title, path: workspace.path } : null,
          title, cwd: item.cwd, updatedAt: item.updatedAt ?? 0,
          seq: item.seq,
          previewVersion: contentSearch.messageStamp(id) ?? null,
          ...(hits.has(id) ? { evidence: { text: hits.get(id) } } : {}),
        };
      });
      // Prepare every conversation on the first list open, before the owner searches. Later opens reuse durable text and only read changed logs.
      contentSearch.update(rows, { refresh });
      if (terms.length) hits = new Map([...hits, ...await contentSearch.find(terms)]);
      return rows.map((item) => hits.has(item.id) ? { ...item, evidence: typeof hits.get(item.id) === 'string' ? { text: hits.get(item.id) } : hits.get(item.id) } : item)
        .filter((item) => !terms.length || hits.has(item.id) || terms.every((term) => `${item.title} ${item.cwd} ${item.id}`.toLowerCase().includes(term)));
    },

    async read(key, { before, query, fresh = false, signal = AbortSignal.timeout(10_000) } = {}) {
      const id = String(key).replace(/^dsh:/, '');
      if (!id || hidden(id) || id.startsWith('dudu-assistant-')) return { outcome: 'needs_clarification', message: 'Name an agent session.' };
      const began = Date.now();
      let source = 'sqlite';
      try {
        signal.throwIfAborted();
        let result = !fresh && await withAbort(Promise.resolve(contentSearch.page(id, { before, query })), signal);
        if (!result) {
          source = 'source';
          // Old search-only caches are filled once. Later previews and pagination read SQLite, not DSH's entire event log.
          const item = cachedCatalog?.items.find((item) => (item.sessionId ?? item.id) === id);
          await withAbort(contentSearch.load(id, item ? `${item.updatedAt}:${item.seq ?? ''}` : undefined), signal);
          result = await withAbort(Promise.resolve(contentSearch.page(id, { before, query })), signal);
        }
        diagnostics?.record({ event: 'session.preview.read', provider: 'dsh', id, source, outcome: 'success', elapsedMs: Date.now() - began, count: result?.messages?.length });
        return result;
      } catch (error) {
        diagnostics?.record({ event: 'session.preview.read', provider: 'dsh', id, source, outcome: 'failure', elapsedMs: Date.now() - began, error });
        throw error;
      }
    },

    async models() {
      const catalog = await service('sessionController').modelCatalog();
      return { default: catalog.default, groups: catalog.groups.map((group) => ({ id: group.id, models: group.models.map((model) => ({ id: model.id })) })) };
    },

    /** A session in the workspace of `cwd` (the workspace is made when there is none), named `title` in the sidebar. */
    async createSession({ cwd, title, workspaceTitle }) {
      const workspace = await service('workspaceRegistry').create(cwd, workspaceTitle);
      const { sessionId } = await service('sessionController').create({ workspaceId: workspace.id });
      // The first message would name the session after its first words; the issue's id and title are what the owner looks for.
      if (title) await service('sessionController').rename({ sessionId, title }).catch(() => {});
      return { sessionId };
    },

    /**
     * DSH saves a selected model as the default of every new session, which would make the owner's next session and 嘟嘟's own run on
     * Claude; so the default is put back. A session that is on the model already is left alone.
     */
    async selectModel(sessionId, { provider, model, reasoningEffort }) {
      const options = optional('agents')?.get(sessionId)?.options;
      if (options?.provider === provider && options?.model === model && (reasoningEffort === undefined || options.reasoningEffort === reasoningEffort)) return;
      const defaults = optional('agentDefaultModel');
      const previous = defaults?.currentSelection?.();
      try {
        await service('sessionController').selectModel({ sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) });
      } finally {
        if (previous) await defaults.saveSelection(previous).catch(() => {});
      }
    },

    /** The access mode is one of DSH's permission presets (`read-only`, `workspace-write`, `danger-full-access`); the harness routes read it from there. */
    async setAccess(sessionId, mode) {
      let agent = service('agents').get(sessionId);
      if (!agent && service('sessionController').resolveAgent) {
        const found = await service('sessionController').resolveAgent(sessionId);
        if (found?.error) throw found.error;
        agent = found?.agent ?? found;
      }
      if (!agent) throw new Error('The session is not running in this DSH.');
      if (agent.status === 'running') throw new Error('Wait until the current turn stops before changing its access.');
      service('permissionPresets').set(agent.session, mode); // throws for a preset this DSH does not have: the session then does not start
    },

    async prompt(sessionId, text, { steer = false, attachments = [] } = {}) {
      await service('sessionController').prompt({ requestId: `dudu-${randomUUID()}`, sessionId, mode: steer ? 'steer' : 'queue',
        content: [...attachments, ...(text ? [{ type: 'text', text }] : [])] }, new AbortController().signal);
    },

    async cancel(sessionId) { await service('sessionController').cancel({ sessionId }); },

    /** Fold the session away in the sidebar; true when it was open. DSH refuses while a turn runs, unless it is told to stop it. */
    async archive(sessionId, { stop = false } = {}) {
      const registry = service('workspaceRegistry');
      const open = !registry.archivedSessionIds.includes(sessionId);
      try {
        await registry.archiveSession(sessionId, stop ? { stopActivity: true } : undefined);
      } catch (error) {
        throw error?.name === 'WorkspaceActiveSessionError' ? Object.assign(error, { code: 'ACTIVE' }) : error;
      }
      return open;
    },

    /** The workspace a session belongs to, which DSH needs to be told when a window adopts it (a session is tied to its folder). */
    async workspaceOf(sessionId) {
      const workspace = service('workspaceRegistry').list().find((candidate) => candidate.sessionIds.includes(sessionId));
      return workspace?.id ?? null;
    },

    /** Put the session back in the sidebar; true when it had been folded away. */
    async unarchive(sessionId) {
      const registry = service('workspaceRegistry');
      const folded = registry.archivedSessionIds.includes(sessionId);
      if (folded) await registry.unarchiveSession(sessionId);
      return folded;
    },

    /** How the last turn of a session that is not live ended, from what DSH stored: its log is read without waking the session. */
    async lastTurn(sessionId) {
      let events;
      try { ({ events } = await inspectSession(sessionId)); } catch { return null; } // not a session DSH knows
      let start = -1;
      let end = -1;
      events.forEach((event, index) => { if (event.type === 'turn/start') start = index; else if (event.type === 'turn/end') end = index; });
      if (end < 0 && start < 0) return { last: null, at: null };
      const ended = end > start ? events[end] : null; // a turn that never ended was cut off: DSH reads it as interrupted
      const kind = ended?.data?.reason?.kind;
      const last = !ended ? 'aborted' : kind === 'completed' || kind === 'max-tokens' ? 'answer' : kind === 'error' ? 'error' : 'aborted';
      const said = events.slice(Math.max(start, 0)).filter((event) => event.type === 'assistant/message').map((event) => textOf(event.data?.message?.content)).filter((text) => text.trim()).at(-1);
      return { last, at: (ended ?? events[start]).time ?? null, ...(kind === 'error' ? { error: ended.data.reason.error?.message } : {}), ...(said ? { ending: said } : {}) };
    },

    /** Listens to DSH for the sessions `handlers.owns` names (see agent-sessions.mjs). Returns the way to stop. */
    watch(handlers) {
      const safe = (work) => { try { work(); } catch (error) { console.warn(`[dudu] A session event was not handled: ${error.message}`); } };
      async function relay(request, next, { text, kind, answer }) {
        const sessionId = request?.agent?.session?.id;
        if (typeof sessionId !== 'string' || !handlers.owns(sessionId)) return next();
        const original = request.signal;
        const waiter = handlers.question(sessionId, { text, kind, signal: original });
        if (!waiter) return next();
        // When the answer comes from the page, the card in DSH's own window must go: its wait ends with the request.
        const lifetime = new AbortController();
        request.signal = original ? AbortSignal.any([original, lifetime.signal]) : lifetime.signal;
        try {
          return await firstKept(Promise.resolve().then(next), waiter.answer.then(answer));
        } finally {
          waiter.close();
          lifetime.abort();
          request.signal = original;
        }
      }
      const stops = [
        ctx.on('api-session/status', (sessionId, running) => { if (handlers.owns(sessionId)) safe(() => handlers.status(sessionId, running)); }),
        ctx.on('session/event', (session, event) => {
          const id = session?.id;
          if (!id || !['turn/start', 'turn/end', 'assistant/message'].includes(event?.type) || !handlers.owns(id)) return;
          safe(() => {
            if (event.type === 'turn/start') {
              // Queued turns share one running loop, so there may be no second status true after the previous turn ended.
              // Imported native boundaries are history: only an actually running DSH Agent starts work.
              if (optional('agents')?.get(id)?.status === 'running') handlers.status(id, true);
            } else if (event.type === 'assistant/message') handlers.assistant(id, textOf(event.data?.message?.content));
            else handlers.turnEnd(id, { kind: event.data?.reason?.kind, error: event.data?.reason?.error?.message });
          });
        }),
        // A question of the agent, and its request for a wider mode, are answerers on DSH's waterfalls: each asks the owner on the issue's page,
        // and DSH's own window, when the session is open there, may answer it as well; the first answer wins. A listener of a waterfall must
        // pass on what it does not own.
        ctx.on('user-questions/request', (request, next) => {
          const questions = request?.questions;
          if (!Array.isArray(questions) || !questions.length) return next();
          return relay(request, next, { text: questionText(questions), kind: 'question', answer: (words) => answerOf(questions, words) });
        }, { global: true, prepend: true }),
        // Without this a read-only agent that asks to write waits for ever: DSH's window is the only place the request is shown.
        ctx.on('approval/request', (request, next) => relay(request, next, { text: approvalText(request), kind: 'approval', answer: outcomeOf }), { global: true, prepend: true }),
      ];
      return () => { for (const stop of stops) { try { stop?.(); } catch { /* already gone */ } } };
    },
  };
}
