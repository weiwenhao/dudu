// The sessions 嘟嘟 starts for issues: DSH sessions that are given a folder, an access mode and a first message, and are
// followed until they ask, end or fail. docs/assistant.md 3.3 and 3.4. It never imports DSH: `dsh` is the adapter of
// ./dsh-sessions.mjs (or a stand-in in tests), a set of plain functions.
//
//   const sessions = createAgentSessions({ dsh, now = Date.now, log = console });
//
//   start({ issue?, agent, firstMessage, cwd, access = 'read-only', model?, title? })
//        -> { outcome: 'success', key: 'dsh:<id>', sessionId, agent, provider, model, access, cwd }
//   send(key, text, { steer? })      the owner's words to the session: the answer to the question it waits on, else a message that
//                                    starts its next turn (the session is put back first if it was folded away: `resumed: true`).
//                                    -> { outcome, kind: 'answer' | 'message' }
//   stop(key)                        ends the turn that runs; the session stays
//   close(key, { stop? }) / resume(key)   fold the session away in DSH's sidebar and put it back (resume says where it lives: `workspaceId`);
//                                    closing one that runs needs stop: true
//   stateOf(key)   -> 'running' | 'waiting_owner' | 'finished' | 'idle' | 'error' | 'stopped' | null    synchronous: createIssues' `lifecycleState`
//   snapshotOf(key) -> { key, id, agent, cwd, closed, state, stateSince, lastActivityAt, touchedAt, pending, error, ending, excerpt } | null
//                                    (touchedAt: when the owner last started, spoke to or opened the session, ms, or null: it is what keeps an agent awake, deep-sleep.mjs)
//   onChange(cb)   -> unsubscribe; cb({ key, from, to, snapshot }) for every change of a session's state ({ from: null } the first time)
//   adopt(key, { agent?, cwd? })     follow a session that existed before this process (DSH was restarted): its state is read from what
//                                    DSH stored of it, and nothing is announced
//   has(key), keys()
//   runner, reader                   the same sessions in the shapes host/assistant/sessions/ takes: runners.dsh = { start({ cwd, firstMessage,
//                                    access, agent? }) -> { key }, resume(key), send(key, text), close(key) } and readers.dsh = { list(), stateOf(id) }
//   dispose()
//
// Results of operations are { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', message?, next? }: wrong input and a DSH that
// refuses never throw. A session's state follows from what DSH says, and from nothing else:
//
//   waiting_owner  a question of the agent, or its request for a wider mode, is unanswered (and nobody answered it in DSH's own window)
//   running        DSH's loop works on a turn
//   error          the last turn ended in a failure
//   finished       the last turn ended with an answer
//   idle           anything else: nothing ran yet, or the turn was stopped
//
// The adapter's functions (all async unless noted; a rejection is DSH's refusal and carries its message):
//   models() -> { default: { provider, model }, groups: [{ id, models: [{ id }] }] }      what DSH can run
//   createSession({ cwd, title, workspaceTitle? }) -> { sessionId }                        a session in a workspace of that folder (named so, when it is new)
//   selectModel(sessionId, { provider, model }), setAccess(sessionId, mode), prompt(sessionId, text, { steer }), cancel(sessionId)
//   archive(sessionId, { stop }) -> whether it was open (a stand-in that says nothing is read as yes); rejects with `code: 'ACTIVE'` when the
//   session runs and stop is not set; unarchive(sessionId) -> whether it had been folded away; workspaceOf(sessionId) -> its workspace id | null
//   lastTurn(sessionId) -> { last: 'answer' | 'error' | 'aborted' | null, at, error?, ending? } | null     what a session that is not live ended with
//   watch(handlers) -> unwatch (sync). The handlers are told only of the sessions `handlers.owns(sessionId)` says are followed:
//     status(sessionId, running), turnEnd(sessionId, { kind, error? }), assistant(sessionId, text),
//     question(sessionId, { text, kind, signal }) -> { answer: Promise<string>, close() } | null: a question of the agent (kind 'question') or its
//     request for a wider mode (kind 'approval'); the adapter waits for `answer` (the owner's words) and calls close() once it is settled by
//     anyone, in DSH's own window as well

import { HARNESS_IDS } from '../../providers/catalog.mjs';

export const ACCESS_MODES = Object.freeze(['read-only', 'workspace-write', 'danger-full-access']);
// The agents the issues name, and what each is to DSH: the harnesses are routes of their own, DeepSeek is DSH's own model.
export const AGENTS = Object.freeze({ claude: 'Claude', codex: 'ChatGPT', pi: 'Pi', deepseek: 'DeepSeek' });
const HARNESS_ROUTES = Object.fromEntries(HARNESS_IDS.map((id) => [id, id]));

const KEY = /^dsh:(.+)$/s;
const TEXT_MAX = 100_000;
const ENDING_KEPT = 6000;
const ENDING_CHARS = 1500;
const EXCERPT_CHARS = 300;
const PENDING_CHARS = 2000;

const oneLine = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const characters = [...flat];
  return characters.length <= max ? flat : `${characters.slice(0, max - 1).join('')}…`;
};
/** A failure as DSH words it for a provider that answered with a status and a body: "400: {"message":"…"}" is "400: …". */
export function tidyFailure(message) {
  const text = String(message ?? '').trim();
  const found = /^(\d{3}):\s*(\{[\s\S]*\})$/.exec(text);
  if (!found) return text;
  try {
    const body = JSON.parse(found[2]);
    const said = body?.message ?? body?.error?.message;
    return typeof said === 'string' && said ? `${found[1]}: ${said}` : text;
  } catch { return text; }
}
const clarify = (message, next = 'Correct the input and call again.') => ({ outcome: 'needs_clarification', message, next });
const failure = (error, next) => ({ outcome: 'error', message: error instanceof Error ? error.message : String(error), ...(next ? { next } : {}) });
const absolute = (path) => typeof path === 'string' && (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path));

/** The model an agent runs on: the harnesses have a route of their own; DeepSeek is whatever DSH's own default is. */
export function modelFor(agent, catalog, wanted) {
  const groups = catalog?.groups ?? [];
  const harnessRoutes = Object.values(HARNESS_ROUTES);
  const pick = (group, id) => (group?.models?.some((model) => model.id === id) ? { provider: group.id, model: id } : null);
  if (HARNESS_ROUTES[agent]) {
    const group = groups.find((candidate) => candidate.id === HARNESS_ROUTES[agent]);
    if (!group?.models?.length) return null;
    // The harness's own default comes first in its list; Claude also has a model that is simply called "default".
    if (wanted) return pick(group, wanted);
    return pick(group, group.models[0].id);
  }
  if (agent !== 'deepseek') return null;
  const own = groups.filter((group) => !harnessRoutes.includes(group.id) && group.models?.length);
  if (wanted) return own.map((group) => pick(group, wanted)).find(Boolean) ?? null;
  const usual = own.find((group) => group.id === catalog?.default?.provider);
  return (usual && pick(usual, catalog.default.model)) ?? (own[0] ? pick(own[0], own[0].models[0].id) : null);
}

/** The state of a session from what DSH says of it (the rules of host/assistant/sessions/states.mjs for a DSH session). */
export function stateFrom({ pending, running, last }) {
  if (pending) return 'waiting_owner';
  if (running) return 'running';
  if (last === 'error') return 'error';
  if (last === 'answer') return 'finished';
  if (last === 'aborted') return 'stopped'; // the owner stopped it, or it was interrupted: it needs them
  return 'idle';
}

export function createAgentSessions({ dsh, now = Date.now, log = console } = {}) {
  if (!dsh || typeof dsh.watch !== 'function') throw new TypeError('createAgentSessions needs the adapter of DSH.');
  const entries = new Map();       // DSH session id -> entry
  const listeners = new Set();
  const textListeners = new Set();
  let disposed = false;
  let questions = 0;

  const keyOf = (sessionId) => `dsh:${sessionId}`;
  const idOf = (key) => KEY.exec(String(key ?? ''))?.[1] ?? null;
  const entryOf = (key) => entries.get(idOf(key));

  const newEntry = (sessionId, extra = {}) => ({
    sessionId, key: keyOf(sessionId), agent: null, cwd: null, closed: false, announced: false, seen: 0,
    running: false, last: null, lastAt: null, error: '', ending: '', waiters: [], state: 'idle', since: now(), activityAt: now(), touchedAt: null,
    ...extra,
  });

  const snapshot = (entry) => ({
    key: entry.key, id: entry.sessionId, agent: entry.agent, cwd: entry.cwd, closed: entry.closed, state: entry.state, stateSince: entry.since,
    turnActive: Boolean(entry.running || entry.waiters.length),
    lastActivityAt: entry.activityAt, touchedAt: entry.touchedAt, pending: entry.waiters[0] ? { kind: entry.waiters[0].kind, text: entry.waiters[0].text } : null,
    error: entry.error, ending: entry.ending, excerpt: oneLine(entry.ending, EXCERPT_CHARS),
  });

  // Every fact that changes goes through here: the state follows from the facts, and a change of it is announced once.
  function settle(entry) {
    const state = stateFrom({ pending: entry.waiters[0], running: entry.running, last: entry.last });
    if (entry.announced && state === entry.state) return; // DSH said the same again (a status that did not change): that is not activity
    // Only a change of the state is the session doing something. It used to count every word DSH said of it: a session nobody had touched for days then looked as if it had just
    // been used (it was handled "now", so it woke from deep sleep, and what it said of itself outranked what its harness wrote).
    entry.activityAt = now();
    const from = entry.announced ? entry.state : null;
    entry.announced = true;
    entry.state = state;
    entry.since = now();
    const change = { key: entry.key, from, to: state, snapshot: snapshot(entry) };
    for (const listener of [...listeners]) {
      try { listener(change); } catch (error) { log.warn?.(`[dudu] A session listener failed: ${error.message}`); }
    }
  }

  // A turn begins: what the last one said is not this one's.
  const begins = (entry) => { entry.error = ''; entry.ending = ''; entry.last = null; };

  // --- what DSH says ----------------------------------------------------------------------------------------------------
  const unwatch = dsh.watch({
    owns: (sessionId) => entries.has(sessionId),
    status(sessionId, running) {
      const entry = entries.get(sessionId);
      if (!entry) return;
      entry.seen++;
      if (running && !entry.running) begins(entry);
      entry.running = Boolean(running);
      settle(entry);
    },
    turnEnd(sessionId, { kind, error } = {}) {
      const entry = entries.get(sessionId);
      if (!entry) return;
      entry.seen++;
      entry.running = false;
      entry.last = kind === 'completed' || kind === 'max-tokens' ? 'answer' : kind === 'error' ? 'error' : 'aborted';
      entry.lastAt = now();
      entry.error = kind === 'error' ? oneLine(tidyFailure(error ?? 'The turn failed.'), 600) : '';
      settle(entry);
    },
    assistant(sessionId, text, { streaming = false } = {}) {
      const entry = entries.get(sessionId);
      if (!entry || typeof text !== 'string') return;
      if (!streaming) {
        if (!text.trim()) return; // A tool-only message does not erase the text already shown.
        entry.ending = text.trim().slice(-ENDING_KEPT);
      }
      if (!entry.running) return;
      const change = { key: entry.key, text: text.trim().slice(0, ENDING_KEPT), at: now() };
      for (const listener of [...textListeners]) {
        try { listener(change); } catch (error) { log.warn?.(`[dudu] A session text listener failed: ${error.message}`); }
      }
    },
    question(sessionId, { text, kind, signal } = {}) {
      const entry = entries.get(sessionId);
      if (!entry || disposed) return null;
      let resolve;
      let reject;
      const answer = new Promise((done, fail) => { resolve = done; reject = fail; });
      answer.catch(() => {}); // a question that is closed before anyone answers is not an unhandled rejection
      // The lines of an approval stay lines: they are what the owner reads before saying yes.
      const waiter = { id: ++questions, kind: kind === 'approval' ? 'approval' : 'question', text: String(text ?? '').split('\n').map((line) => oneLine(line, PENDING_CHARS)).filter(Boolean).join('\n').slice(0, PENDING_CHARS), since: now(), resolve, reject };
      entry.waiters.push(waiter);
      settle(entry);
      const close = () => {
        const at = entry.waiters.indexOf(waiter);
        if (at < 0) return;
        entry.waiters.splice(at, 1);
        reject(new Error('The question is settled.'));
        settle(entry);
      };
      signal?.addEventListener('abort', close, { once: true });
      if (signal?.aborted) close();
      return { answer, close };
    },
  });

  // --- the operations ---------------------------------------------------------------------------------------------------
  async function start({ issue, agent, firstMessage, cwd, access, model, title } = {}) {
    if (!AGENTS[agent]) return clarify(`"${agent}" is not an agent. The agents are: ${Object.keys(AGENTS).join(', ')}.`);
    if (typeof firstMessage !== 'string' || !firstMessage.trim()) return clarify('firstMessage must not be empty.', 'Write what the agent is to do.');
    if (firstMessage.length > TEXT_MAX) return clarify(`firstMessage must be at most ${TEXT_MAX} characters.`);
    if (!absolute(cwd)) return clarify('cwd must be the full path of a folder.', 'Give the folder the session is to work in.');
    if (access != null && !ACCESS_MODES.includes(access)) return clarify(`"${access}" is not an access mode. The modes are: ${ACCESS_MODES.join(', ')}.`);

    let catalog;
    let defaults;
    try {
      catalog = await dsh.models();
      defaults = await dsh.defaults?.(agent, { cwd, model });
    } catch (error) { return failure(error, 'DSH could not read the agent configuration; try again.'); }
    access ??= defaults?.access ?? 'read-only';
    const chosen = modelFor(agent, catalog, model ?? defaults?.model);
    if (chosen && defaults?.effort) chosen.reasoningEffort = defaults.effort;
    if (!chosen) {
      return {
        outcome: 'error', message: `${AGENTS[agent]} is not available${model ? ` with the model "${model}"` : ''}.`,
        next: HARNESS_ROUTES[agent] ? 'Check that it is installed and enabled in Settings > 供应商, then assign it again.' : 'Add a model to DSH, then assign it again.',
      };
    }
    const label = title || (issue?.ref ? `${issue.ref} ${issue.title ?? ''}` : AGENTS[agent]);
    let sessionId;
    try {
      ({ sessionId } = await dsh.createSession({ cwd, title: label, ...(issue?.project?.name ? { workspaceTitle: issue.project.name } : {}) }));
    } catch (error) { return failure(error, 'Check that the folder exists.'); }

    // Followed from the moment it exists, so that no event of the first turn is missed.
    const entry = newEntry(sessionId, { agent, cwd, touchedAt: now() });
    entries.set(sessionId, entry);
    const seen = entry.seen;
    try {
      await dsh.selectModel(sessionId, chosen);
      await dsh.setAccess(sessionId, access); // before the first message: the harnesses read the mode when a turn starts
      await dsh.prompt(sessionId, firstMessage.trim());
    } catch (error) {
      entries.delete(sessionId);
      await Promise.resolve(dsh.archive(sessionId, { stop: true })).catch(() => {}); // a session that never took its first message is not left in the sidebar
      return failure(error);
    }
    // The prompt is accepted, so the turn is on its way and DSH announces it within moments; unless it has been heard of already.
    if (entry.seen === seen) { begins(entry); entry.running = true; }
    settle(entry);
    return { outcome: 'success', key: entry.key, sessionId, agent, provider: chosen.provider, model: chosen.model, access, cwd };
  }

  // Folded away or not is DSH's to say (the owner may have done it in the sidebar), so DSH is always asked.
  async function reopen(id) {
    const entry = entries.get(id) ?? null;
    const folded = await dsh.unarchive(id); // true when it had been folded away; a stand-in that says nothing is read as yes
    if (entry) entry.closed = false;
    return folded !== false;
  }

  async function resume(key) {
    const id = idOf(key);
    if (!id) return clarify(`"${key}" is not a DSH session key (dsh:<id>).`);
    let folded;
    try { folded = await reopen(id); } catch (error) { return failure(error); }
    // Completed issues are not followed during restore. Opening one must still record the touch that wakes it.
    if (!entries.has(id)) await adopt(key);
    const opened = entries.get(id);
    if (opened) opened.touchedAt = now(); // opening it is handling it: it is awake again
    // Where the session lives is what a window must be told to adopt it, so the answer always says.
    let where = {};
    try { const workspaceId = await dsh.workspaceOf?.(id); if (workspaceId) where = { workspaceId }; } catch { /* the window will say */ }
    return folded ? { outcome: 'success', key, sessionId: id, ...where } : { outcome: 'no_op', message: 'The session is open already.', key, sessionId: id, ...where };
  }

  async function send(key, text, { steer = false, direct = false, attachments = [] } = {}) {
    const id = idOf(key);
    if (!id) return clarify(`"${key}" is not a DSH session key (dsh:<id>).`);
    if (typeof text !== 'string' || !text.trim() && !attachments.length) return clarify('text must not be empty.', 'Write what to say to the session.');
    if (text.length > TEXT_MAX) return clarify(`text must be at most ${TEXT_MAX} characters.`);
    const entry = entries.get(id) ?? followed(id);
    entry.touchedAt = now();
    // The question the agent waits on is answered with these words; nothing else is sent.
    const waiter = entry.waiters[0];
    if (waiter && !direct && !attachments.length) {
      waiter.resolve(text.trim());
      return { outcome: 'success', kind: 'answer', key };
    }
    // A session folded away takes no turn (DSH refuses it): it is put back first.
    let resumed;
    try { resumed = await reopen(id); } catch (error) { return failure(error); }
    const seen = entry.seen;
    try { await dsh.prompt(id, text.trim(), { steer, ...(attachments.length ? { attachments } : {}) }); } catch (error) { return failure(error); }
    if (entry.seen === seen && !entry.running) { begins(entry); entry.running = true; }
    settle(entry);
    return { outcome: 'success', kind: 'message', key, ...(resumed ? { resumed: true } : {}) };
  }

  async function setAccess(key, access) {
    const id = idOf(key);
    const entry = entries.get(id);
    if (!entry) return clarify('Name a followed agent session.');
    if (!ACCESS_MODES.includes(access)) return clarify(`access must be one of: ${ACCESS_MODES.join(', ')}.`);
    if (dsh.isRunning?.(id) ?? entry.running) return clarify('Wait until the current turn stops before changing its access.');
    try { await dsh.setAccess(id, access); } catch (error) { return failure(error); }
    return { outcome: 'success', key, access };
  }

  async function stop(key) {
    const id = idOf(key);
    if (!id) return clarify(`"${key}" is not a DSH session key (dsh:<id>).`);
    const entry = entries.get(id);
    if (entry && !entry.running && !entry.waiters.length) return { outcome: 'no_op', message: 'The session does not run.', key };
    try { await dsh.cancel(id); } catch (error) { return failure(error); }
    return { outcome: 'success', key };
  }

  async function close(key, { stop: interrupt = false } = {}) {
    const id = idOf(key);
    if (!id) return clarify(`"${key}" is not a DSH session key (dsh:<id>).`);
    const entry = entries.get(id) ?? null;
    const busy = clarify('The session is working; closing it now would interrupt it.', 'Wait until it stops, or call again with stop: true.');
    if (entry && (entry.running || entry.waiters.length) && !interrupt) return busy;
    let folded;
    try { folded = await dsh.archive(id, { stop: interrupt }); }
    catch (error) { return error?.code === 'ACTIVE' ? busy : failure(error); }
    if (entry) entry.closed = true;
    return folded === false ? { outcome: 'no_op', message: 'The session is closed already.', key } : { outcome: 'success', key };
  }

  // A session that is followed without having been started here: its facts are what DSH tells from now on.
  function followed(sessionId, extra) {
    const entry = newEntry(sessionId, { activityAt: 0, ...extra });
    entries.set(sessionId, entry);
    return entry;
  }

  async function adopt(key, { agent = null, cwd = null } = {}) {
    const id = idOf(key);
    if (!id) return clarify(`"${key}" is not a DSH session key (dsh:<id>).`);
    const entry = entries.get(id) ?? followed(id, { agent, cwd });
    const running = dsh.isRunning?.(id);
    if (typeof running === 'boolean') entry.running = running;
    try {
      const turn = await dsh.lastTurn?.(id);
      if (turn && !entry.running && !entry.waiters.length) {
        entry.last = turn.last ?? null;
        entry.lastAt = turn.at ?? null;
        entry.activityAt = Math.max(entry.activityAt, turn.at ?? 0);
        entry.error = turn.last === 'error' ? oneLine(tidyFailure(turn.error ?? 'The turn failed.'), 600) : '';
        if (turn.ending && !entry.ending) entry.ending = String(turn.ending).slice(-ENDING_KEPT);
        entry.since = turn.at ?? entry.since;
      }
    } catch (error) {
      log.warn?.(`[dudu] Could not read the last turn of ${key}: ${error.message}`);
    }
    // The baseline: what the session is now is not news.
    entry.state = stateFrom({ pending: entry.waiters[0], running: entry.running, last: entry.last });
    entry.announced = true;
    return { outcome: 'success', key, state: entry.state };
  }

  const stateOf = (key) => entryOf(key)?.state ?? null;
  const snapshotOf = (key) => { const entry = entryOf(key); return entry ? snapshot(entry) : null; };

  // The shapes of host/assistant/sessions/: a runner that starts in a folder, and a reader of what DSH knows of each session.
  const must = (result) => { if (result.outcome === 'error' || result.outcome === 'needs_clarification') throw new Error(result.message); return result; };
  const runner = {
    async start({ cwd, firstMessage, access, agent = 'deepseek', title } = {}) { return { key: must(await start({ agent, cwd, firstMessage, access, title })).key }; },
    async resume(key) { must(await resume(key)); },
    async send(key, text) { must(await send(key, text)); },
    async close(key) { must(await close(key, { stop: true })); }, // the library has already decided that this one may be closed
  };
  const reader = {
    list: () => [...entries.values()].filter((entry) => !entry.closed).map((entry) => ({ id: entry.sessionId, title: entry.agent ? AGENTS[entry.agent] : undefined, cwd: entry.cwd ?? undefined, updatedAt: entry.activityAt })),
    stateOf(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      const pending = entry.waiters[0];
      return {
        running: entry.running, since: entry.since, pending: pending ? { kind: pending.kind, text: pending.text, since: pending.since } : null,
        last: entry.last, at: entry.lastAt ?? undefined, excerpt: oneLine(entry.ending, EXCERPT_CHARS), ending: entry.ending.slice(-ENDING_CHARS),
      };
    },
  };

  return {
    start, send, setAccess, stop, close, resume, adopt, stateOf, snapshotOf, runner, reader,
    forget(key) {
      const id = idOf(key);
      const entry = entries.get(id);
      entries.delete(id);
      for (const waiter of entry?.waiters.splice(0) ?? []) waiter.reject(new Error('The issue was deleted.'));
    },
    has: (key) => entries.has(idOf(key)),
    keys: () => [...entries.values()].map((entry) => entry.key),
    onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    /** Body-only text for a currently running turn; these deltas are not state or issue activity. */
    onText(callback) { textListeners.add(callback); return () => textListeners.delete(callback); },
    dispose() {
      if (disposed) return;
      disposed = true;
      unwatch?.();
      listeners.clear();
      textListeners.clear();
      // A question nobody will answer must not hold a turn for ever: the adapter gives it to DSH's own window, or ends it.
      for (const entry of entries.values()) for (const waiter of entry.waiters.splice(0)) waiter.reject(new Error('嘟嘟 stopped before the question was answered.'));
    },
  };
}
