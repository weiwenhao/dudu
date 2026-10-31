// DSH's side of agent-sessions.mjs: the sessions of issues as DSH's own services know them. With host/dudu-plugin/index.mjs, which
// hands it `ctx`, this is where those services are touched. What each call is, and what was tried, is in docs/dsh-session-control.md.
//
//   const dsh = createDshSessions(ctx);       // the adapter createAgentSessions takes
//
// Every service is looked up when it is used: a DSH that lacks one still runs the plugin, and the call that needs it says so. Both
// runtimes have all of them (the npm `dsh web` 0.2.0-rc.2 and the Desktop's bundled CLI 0.2.1-rc.3); neither needs `connection.createPeer`.
import { randomUUID } from 'node:crypto';

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

export function createDshSessions(ctx) {
  const service = (name) => {
    let found;
    try { found = ctx[name]; } catch { found = undefined; } // reading a service the plugin did not ask for throws
    if (!found) throw new Error(`This DSH has no ${name} service.`);
    return found;
  };
  const optional = (name) => { try { return ctx[name]; } catch { return undefined; } };

  return {
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
    async selectModel(sessionId, { provider, model }) {
      const options = optional('agents')?.get(sessionId)?.options;
      if (options?.provider === provider && options?.model === model) return;
      const defaults = optional('agentDefaultModel');
      const previous = defaults?.currentSelection?.();
      try {
        await service('sessionController').selectModel({ sessionId, provider, model });
      } finally {
        if (previous) await defaults.saveSelection(previous).catch(() => {});
      }
    },

    /** The access mode is one of DSH's permission presets (`read-only`, `workspace-write`, `danger-full-access`); the harness routes read it from there. */
    async setAccess(sessionId, mode) {
      const agent = service('agents').get(sessionId);
      if (!agent) throw new Error('The session is not running in this DSH.');
      service('permissionPresets').set(agent.session, mode); // throws for a preset this DSH does not have: the session then does not start
    },

    async prompt(sessionId, text, { steer = false } = {}) {
      await service('sessionController').prompt({ requestId: `dudu-${randomUUID()}`, sessionId, mode: steer ? 'steer' : 'queue', content: [{ type: 'text', text }] }, new AbortController().signal);
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
      try { ({ events } = await service('sessionController').inspect(sessionId)); } catch { return null; } // not a session DSH knows
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
          if (!id || (event?.type !== 'turn/end' && event?.type !== 'assistant/message') || !handlers.owns(id)) return;
          safe(() => {
            if (event.type === 'assistant/message') handlers.assistant(id, textOf(event.data?.message?.content));
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
