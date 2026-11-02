// The issues and the sessions they are given to (docs/assistant.md 3.2 "状态跟着会话走", 3.3 "分配之后", 3.4): an issue that is given an
// agent gets a session in its project folder, with the task title and description as its first message; from then on the issue follows
// the session, and what the owner answers on the issue's page reaches the session. It never imports DSH: the sessions are
// ./agent-sessions.mjs's, the issues are host/assistant/issues/'s.
//
//   const assignment = createAssignment({ issues, agentSessions, read?, llm?, accessOf?, waitMs = 8000, log });
//
//   accessOf(issue)   -> { access?, model?, problem? }   what ASSIGN.md says; with nothing said the session is read-only (3.3)
//   read(key), llm(messages) -> recent conversation evidence and dudu's progress decision after the worker stops
//
//   sessionState(key)        for createIssues({ sessionState })
//   onAssign(issue)          for createIssuesApi({ onAssign }): starts the session of an issue that was just given an agent
//   onReply(issue, text)     for createIssuesApi({ onReply }): hands the owner's answer to the issue's session
//   onResume(issue)          for createIssuesApi({ onResume }): puts a closed session back in DSH's sidebar
//   start(issue, { access?, model? })   the same as onAssign; requires the issue's project path
//   closeFor(issue)          closes the session of an issue that is Done or Canceled (once it does not work any more)
//   restore()                after a restart: follows the sessions of the issues that are open (their state is read from DSH); -> how many
//   dispose()
//
// What the session does to the issue, as the session's state changes (the issue's `ask` is the card the page shows, and its agent state
// is derived from it and from the session's state by the store):
//
//   running        In Progress; the question that was open is gone
//   waiting_owner  In Review; the question of the agent is the issue's ask
//   finished/idle  In Review; dudu reads the last messages after a debounce to summarize progress and any next question
//   error          In Review; records the failure, then asks dudu to review the conversation
//
// A Done or Canceled issue is left as it is, and its session is closed once it has stopped. Everything done here is written as 嘟嘟,
// so that Undo and the log say who did it.
import { setTimeout as sleep } from 'node:timers/promises';
import { AGENTS } from './agent-sessions.mjs';
import { firstMessage } from './first-message.mjs';
import { createProgressReview } from './progress.mjs';
import { issueStatusForSession } from './issue-state.mjs';

// NEW wording. `ask` is shown on the issue's page as a card to answer ("确认完成吗？" is the doc's own, 3.2); the sentences of the session
// log are shown in Activity after "嘟嘟", in English like the rest of the Activity's words.
export const WORDS = Object.freeze({
  confirm: '确认完成吗？',
  failed: (reason) => `出错了：${reason || '没有说明原因'}。怎么办？`,
  notStarted: (reason) => `没能开始：${reason}。要换个智能体，还是稍后再试？`,
  notDelivered: (reason) => `回复没能发给会话：${reason}`,
  started: (agent) => `started a session with ${agent}`,
  closed: 'closed the session',
  resumed: 'resumed the session',
});

const EARLY_KEPT = 100;
const finished = (issue) => issue.status === 'done' || issue.status === 'canceled';

export function createAssignment({ issues, agentSessions, read, llm, snapshotOf = () => null, reviewMs, accessOf = () => ({}), waitMs = 8000, log = console } = {}) {
  if (!issues || !agentSessions) throw new TypeError('createAssignment needs the issues and the sessions.');
  const bySession = new Map();   // session key -> issue id
  const suspended = new Set();  // issue ids whose linked sessions are being removed
  const early = new Map();       // session key -> the last change heard before the issue knew the session (a turn that ended at once)
  const tails = new Map();       // issue id -> the work in line for it: one thing at a time per issue
  const sessionState = (key) => agentSessions.stateOf(key) ?? snapshotOf(key)?.state ?? null;
  const review = read && llm ? createProgressReview({
    issues, read, llm, stateOf: sessionState, debounceMs: reviewMs, log,
  }) : null;

  const serialized = (id, work) => {
    const run = (tails.get(id) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => {});
    tails.set(id, tail);
    tail.then(() => { if (tails.get(id) === tail) tails.delete(id); });
    return run;
  };
  const note = (id, text, data) => issues.log(id, { kind: 'session', text, data, actor: 'dudu' });
  const guard = (what, work) => Promise.resolve().then(work).catch((error) => { log.warn?.(`[dudu] ${what}: ${error.message}`); });

  // --- the session changes, the issue follows ---------------------------------------------------------------------------
  async function reflect(id, key, change) {
    if (suspended.has(id)) return;
    const got = issues.get(id, { logLimit: 1 });
    if (got.outcome !== 'success') return;
    const { issue } = got;
    if (issue.session !== key) return; // the issue has another session now
    const { to: state, snapshot } = change;
    review?.cancel(id);
    if (finished(issue)) {
      // Done is the owner's word: a session that still works is not interrupted, and is put away once it has stopped.
      if (state !== 'running' && state !== 'waiting_owner') await closeFor(issue);
      return;
    }
    const status = issueStatusForSession(state);
    if (!status) return;
    const patch = { status };
    switch (state) {
      case 'running': patch.ask = ''; break;
      case 'waiting_owner': patch.ask = snapshot.pending?.text ?? ''; break;
      case 'error': patch.ask = WORDS.failed(snapshot.error); break;
    }
    const changed = Object.fromEntries(Object.entries(patch).filter(([field, value]) => issue[field] !== value));
    if (Object.keys(changed).length) issues.update(id, changed, { actor: 'dudu' });
    if (['finished', 'idle', 'error'].includes(state)) review?.schedule(issues.get(id, { logLimit: 1 }).issue ?? issue, snapshot);
  }

  const unsubscribe = agentSessions.onChange((change) => {
    const id = bySession.get(change.key);
    if (id === undefined) {
      // A session is announced from its own start, a moment before the issue is told which session it has.
      if (early.size >= EARLY_KEPT) early.delete(early.keys().next().value);
      early.set(change.key, change);
      return;
    }
    serialized(id, () => guard('An issue could not follow its session', () => reflect(id, change.key, change)));
  });

  // --- giving an issue to an agent ------------------------------------------------------------------------------------------
  const refuse = (issue, message, extra) => {
    const current = issues.get(issue.id, { logLimit: 1 }).issue;
    const changed = current && !finished(current)
      ? issues.update(issue.id, { status: 'in_review', ask: WORDS.notStarted(message) }, { actor: 'dudu' }) : null;
    return { outcome: 'error', message, ...(extra?.next ? { next: extra.next } : {}), issue: changed?.issue ?? current ?? issue };
  };

  async function begin(id, options) {
    const got = issues.get(id, { logLimit: 1 });
    if (got.outcome !== 'success') return got;
    const { issue } = got;
    const agent = issue.agent;
    if (!AGENTS[agent]) return { outcome: 'no_op', message: 'The issue has no agent that works in sessions.', issue };
    if (finished(issue)) return { outcome: 'no_op', message: `A ${issue.status} issue does not start a session.`, issue };
    if (issue.session) return { outcome: 'no_op', message: 'The issue has a session already.', issue };

    const said = { ...accessOf(issue), ...options };
    if (said.problem) return refuse(issue, said.problem);
    const access = said.access ?? 'read-only';
    let cwd;
    try { cwd = issue.project?.path; } catch (error) { return refuse(issue, error.message); }
    if (!cwd) return refuse(issue, '这个 issue 没有项目目录');
    const text = firstMessage({ issue });
    const started = await agentSessions.start({ issue, agent, firstMessage: text, cwd, access, model: said.model });
    if (started.outcome !== 'success') return refuse(issue, started.message, started);

    // Another agent, a session of its own or Done may have come while it started: then this one is not wanted.
    const again = issues.get(id, { logLimit: 1 });
    if (again.outcome !== 'success' || again.issue.agent !== agent || again.issue.project?.path !== cwd || again.issue.session || finished(again.issue)) {
      await agentSessions.close(started.key, { stop: true });
      return { outcome: 'no_op', message: 'The issue changed while its session started.', ...(again.issue ? { issue: again.issue } : {}) };
    }
    bySession.set(started.key, id);
    const bound = issues.update(id, { session: started.key, status: 'in_progress', ask: '' }, { actor: 'dudu' });
    note(id, WORDS.started(AGENTS[agent]), { key: started.key, agent, provider: started.provider, model: started.model, access, cwd });
    closeOthers(id, started.key);
    const heard = early.get(started.key);
    if (heard) { early.delete(started.key); await reflect(id, started.key, heard); }
    return { outcome: 'success', key: started.key, issue: bound.issue ?? again.issue };
  }

  // The sessions an issue had before are put away: it has one session at a time (3.3).
  function closeOthers(id, keep) {
    for (const [key, owner] of [...bySession]) {
      if (owner !== id || key === keep) continue;
      review?.cancel(id);
      bySession.delete(key);
      guard('A session could not be closed', async () => {
        const result = await agentSessions.close(key, { stop: true });
        if (result.outcome === 'success') note(id, WORDS.closed, { key });
      });
    }
  }

  const start = (issue, options = {}) => serialized(issue.id, () => begin(issue.id, options));

  const setAccess = (issue, access) => serialized(issue.id, async () => {
    const current = issues.get(issue.id, { logLimit: 1 }).issue;
    if (!current?.session || current.session !== issue.session || !current.project?.path || finished(current)) {
      return { outcome: 'needs_clarification', message: 'Choose an open issue with its assigned project and session.' };
    }
    await adopt(current);
    return agentSessions.setAccess(current.session, access);
  });

  async function onAssign(issue) {
    if (!issue) return;
    if (!AGENTS[issue.agent]) { closeOthers(issue.id, null); return; } // the agent was taken away: its session goes with it
    const work = guard('A session could not be started', () => start(issue));
    // The page waits for this answer; a DSH that is slow to start a session does not hold it for long, the start goes on.
    await Promise.race([work, sleep(waitMs, undefined, { ref: false })]);
  }

  async function onReply(issue, text) {
    const key = issue?.session;
    if (!key) return; // nothing to hand it to: it is in the log, which is what the owner asked for
    const sent = await agentSessions.send(key, text);
    if (sent.outcome !== 'success') {
      const current = issues.get(issue.id, { logLimit: 1 }).issue;
      if (current?.session === key && !finished(current)) issues.update(issue.id, {
        status: issueStatusForSession(sessionState(key)) ?? 'in_review', ask: WORDS.notDelivered(sent.message),
      }, { actor: 'dudu' });
      return sent;
    }
    const current = issues.get(issue.id, { logLimit: 1 }).issue;
    if (current?.session === key && current.ask === issue.ask && !finished(current)) issues.update(issue.id, { ask: '' }, { actor: 'dudu' });
    if (sent.resumed) note(issue.id, WORDS.resumed, { key }); // it had been folded away in the sidebar
    return sent;
  }

  async function onResume(issue) {
    if (!issue?.session) return { outcome: 'no_op', message: 'The issue has no session.', next: 'Give the issue an agent first.' };
    const result = await agentSessions.resume(issue.session);
    // The page may open a session without saying which issue holds it; the issue is the one that was given this session.
    const id = issue.id ?? bySession.get(issue.session);
    if (result.outcome === 'success' && id != null) note(id, WORDS.resumed, { key: issue.session });
    return result;
  }

  async function adopt(issue) {
    if (!/^(dsh|claude|codex):./.test(issue?.session ?? '')) return false;
    const known = bySession.get(issue.session) === issue.id;
    if (issue.session.startsWith('dsh:') && !agentSessions.has(issue.session)) {
      await agentSessions.adopt(issue.session, { agent: issue.agent, cwd: issue.project?.path ?? null });
    }
    const live = agentSessions.snapshotOf(issue.session);
    const snapshot = issue.source === 'session' && !['running', 'waiting_owner'].includes(live?.state)
      ? snapshotOf(issue.session) ?? live : live ?? snapshotOf(issue.session);
    if (!snapshot) return false;
    bySession.set(issue.session, issue.id);
    if (!known) await reflect(issue.id, issue.session, { to: snapshot.state, snapshot });
    return true;
  }

  async function closeFor(issue) {
    const key = issue?.session;
    if (!key || !agentSessions.has(key)) return { outcome: 'no_op', message: 'The issue has no session to close.' };
    const result = await agentSessions.close(key);
    if (result.outcome === 'success') note(issue.id, WORDS.closed, { key });
    return result;
  }

  // Reconcile open issues with DSH and indexed native session facts without sending work.
  async function restore() {
    let followed = 0;
    for (const tab of ['active', 'backlog']) {
      let cursor;
      do {
        const page = issues.list({ tab, limit: 200, ...(cursor ? { cursor } : {}) });
        if (page.outcome !== 'success') break;
        for (const issue of page.items) {
          if (!AGENTS[issue.agent]) continue;
          if (await adopt(issue)) followed++;
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    return followed;
  }

  return {
    sessionState, review,
    onAssign, onReply, onResume, start, setAccess, closeFor, restore, adopt,
    forward: (issue, text) => agentSessions.send(issue.session, text, { direct: true }),
    suspend(issue) {
      review?.cancel(issue.id);
      suspended.add(issue.id);
      return async () => {
        suspended.delete(issue.id);
        const snapshot = agentSessions.snapshotOf(issue.session);
        if (snapshot) await serialized(issue.id, () => reflect(issue.id, issue.session, { to: snapshot.state, snapshot }));
      };
    },
    forget(issue) {
      review?.cancel(issue.id);
      suspended.delete(issue.id);
      for (const [key, owner] of bySession) if (owner === issue.id) {
        bySession.delete(key);
        agentSessions.forget(key);
      }
    },
    observe: (issue, snapshot) => serialized(issue.id, () => reflect(issue.id, issue.session, { to: snapshot.state, snapshot })),
    async dispose() { unsubscribe(); bySession.clear(); early.clear(); await review?.close(); await Promise.allSettled([...tails.values()]); },
  };
}
