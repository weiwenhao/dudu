// An issue given to an agent gets a session in its project folder, with the task title and description as its first message.
// Session facts drive agent state and actual questions; the owner controls the issue's workflow status.
// What the owner answers on the issue's page reaches the session. It never imports DSH: the sessions are
// ./agent-sessions.mjs's, the issues are host/assistant/issues/'s.
//
//   const assignment = createAssignment({ issues, agentSessions, accessOf?, waitMs = 8000, log });
//
//   accessOf(issue)   -> { access?, model?, problem? }   what ASSIGN.md says; with nothing said the session is read-only (3.3)
//
//   sessionState(key)        for createIssues({ sessionState }); sessionSince(key) for its `sessionSince`, sessionBases(key) for its `sessionBases`, sessionHandledAt(key) for its `sessionHandledAt`
//   onAssign(issue)          for createIssuesApi({ onAssign }): starts the session of an issue that was just given an agent
//   onReply(issue, text)     for createIssuesApi({ onReply }): hands the owner's answer to the issue's session
//   onResume(issue)          for createIssuesApi({ onResume }): puts a closed session back in DSH's sidebar
//   start(issue, { access?, model? })   the same as onAssign; requires the issue's project path
//   closeFor(issue)          closes the session of an issue that is Done or Canceled (once it does not work any more)
//   restore()                after a restart: follows the sessions of the issues that are open (their state is read from DSH); -> how many
//   dispose()
//
// What the session does to the issue, as the session's state changes (agent state is derived from the session by the store):
//
//   running        the question that was open is gone
//   waiting_owner  the question of the agent is the issue's ask
//   finished/idle/error  no generated progress or questions
//
// A Done or Canceled issue is left as it is, and its session is closed once it has stopped. Everything done here is written as 嘟嘟,
// so that Undo and the log say who did it.
import { setTimeout as sleep } from 'node:timers/promises';
import { handledAtOf } from '../sessions/deep-sleep.mjs';
import { AGENTS } from './agent-sessions.mjs';
import { firstMessage } from './first-message.mjs';

// Fixed delivery errors and session activity wording.
export const WORDS = Object.freeze({
  notStarted: (reason) => `没能开始：${reason}。要换个智能体，还是稍后再试？`,
  notDelivered: (reason) => `回复没能发给会话：${reason}`,
  started: (agent) => `started a session with ${agent}`,
  closed: 'closed the session',
  resumed: 'resumed the session',
});

const EARLY_KEPT = 100;
const finished = (issue) => ['done', 'canceled'].includes(issue.statusType ?? issue.status);

export function createAssignment({ issues, agentSessions, snapshotOf = () => null, repairDefaults, accessOf = () => ({}), waitMs = 8000, log = console } = {}) {
  if (!issues || !agentSessions) throw new TypeError('createAssignment needs the issues and the sessions.');
  const bySession = new Map();   // session key -> issue id
  const suspended = new Set();  // issue ids whose linked sessions are being removed
  const early = new Map();       // session key -> the last change heard before the issue knew the session (a turn that ended at once)
  const tails = new Map();       // issue id -> the work in line for it: one thing at a time per issue
  const observed = new Map();    // issue id -> last reflected session facts; observing unchanged work is not activity
  const sessionSnapshot = (key) => {
    const live = agentSessions.snapshotOf(key);
    const indexed = snapshotOf(key);
    if (!live) return indexed;
    if (!indexed || indexed.provider === 'dsh' || ['running', 'waiting_owner'].includes(live.state)) return live;
    // A loaded native conversation can continue in its TUI. Adoption is not activity;
    // only actual DSH events newer than the native evidence may override that evidence.
    if (Number.isFinite(indexed.lastActivityAt) && live.lastActivityAt > indexed.lastActivityAt) return live;
    return indexed;
  };
  const sessionState = (key) => sessionSnapshot(key)?.state ?? null;
  const sessionSince = (key) => sessionSnapshot(key)?.stateSince ?? null; // when that state began: a manual agent state holds until it changes
  // A session is read from two places (what DSH says of it, what its harness wrote) that agree on its state and not on since when it has lasted: by a few hundred milliseconds
  // (DSH's end of a turn against the last line of the transcript), or by hours. Which of them is the session's snapshot changes with whatever either one last did, and a manual
  // agent state and deep sleep must not change with it: the word holds on ANY of the two (`sessionBases`), and whoever handled the session last, in either place, handled it.
  const sources = (key) => [agentSessions.snapshotOf(key), snapshotOf(key)].filter(Boolean);
  const sessionBases = (key) => sources(key).map((snapshot) => `${snapshot.state ?? ''}@${snapshot.stateSince ?? ''}`);
  const sessionHandledAt = (key) => { // when anybody last did anything with it: deep sleep, and a day nobody has (Idle by itself)
    const times = sources(key).map(handledAtOf).filter(Number.isFinite);
    return times.length ? Math.max(...times) : null;
  };
  const serialized = (id, work) => {
    const run = (tails.get(id) ?? Promise.resolve()).then(work, work);
    const tail = run.catch(() => {});
    tails.set(id, tail);
    tail.then(() => { if (tails.get(id) === tail) tails.delete(id); });
    return run;
  };
  const note = (id, text, data) => issues.log(id, { kind: 'session', text, data, actor: 'dudu' });
  const guard = (what, work) => Promise.resolve().then(work).catch((error) => { log.warn?.(`[dudu] ${what}: ${error.message}`); });

  // --- observe session facts without moving the owner's workflow --------------------------------------------------------
  async function reflect(id, key, change) {
    if (suspended.has(id)) return;
    const got = issues.get(id, { logLimit: 1 });
    if (got.outcome !== 'success') return;
    const { issue } = got;
    if (issue.session !== key) return; // the issue has another session now
    const { to: state, snapshot } = change;
    const facts = JSON.stringify([key, state, snapshot.pending ?? null, snapshot.error ?? '']);
    if (observed.get(id) === facts) return;
    observed.set(id, facts);
    if (finished(issue)) {
      // Done is the owner's word: a session that still works is not interrupted, and is put away once it has stopped.
      if (state !== 'running' && state !== 'waiting_owner') await closeFor(issue);
      return;
    }
    if (!['running', 'waiting_owner', 'finished', 'idle', 'error', 'stopped'].includes(state)) return;
    const ask = state === 'waiting_owner' ? snapshot.pending?.text ?? '' : '';
    if (issue.ask !== ask) issues.update(id, { ask }, { actor: 'dudu' });
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
      ? issues.update(issue.id, { ask: WORDS.notStarted(message) }, { actor: 'dudu' }) : null;
    return { outcome: 'error', message, ...(extra?.next ? { next: extra.next } : {}), issue: changed?.issue ?? current ?? issue };
  };

  async function begin(id, options) {
    const got = issues.get(id, { logLimit: 1 });
    if (got.outcome !== 'success') return got;
    const { issue } = got;
    const agent = issue.agent;
    if (!AGENTS[agent]) return { outcome: 'no_op', message: 'The issue has no agent that works in sessions.', issue };
    if (finished(issue)) return { outcome: 'no_op', message: `A ${issue.status} issue does not start a session.`, issue };
    if (issue.session) {
      await adopt(issue, { reconcile: true });
      return { outcome: 'no_op', message: 'The issue has a session already.', issue: issues.get(id, { logLimit: 1 }).issue ?? issue };
    }

    const said = { ...accessOf(issue), ...options };
    if (said.problem) return refuse(issue, said.problem);
    const access = said.access;
    let cwd;
    try { cwd = issue.project?.path; } catch (error) { return refuse(issue, error.message); }
    if (!cwd) return refuse(issue, '这个 issue 没有项目目录');
    const text = firstMessage({ issue, issues });
    const started = await agentSessions.start({ issue, agent, firstMessage: text, cwd, access, model: said.model });
    if (started.outcome !== 'success') return refuse(issue, started.message, started);

    // Another agent, a session of its own or Done may have come while it started: then this one is not wanted.
    const again = issues.get(id, { logLimit: 1 });
    if (again.outcome !== 'success' || again.issue.agent !== agent || again.issue.project?.path !== cwd || again.issue.session || finished(again.issue)) {
      await agentSessions.close(started.key, { stop: true });
      return { outcome: 'no_op', message: 'The issue changed while its session started.', ...(again.issue ? { issue: again.issue } : {}) };
    }
    bySession.set(started.key, id);
    const bound = issues.update(id, { session: started.key, ask: '' }, { actor: 'dudu' });
    note(id, WORDS.started(AGENTS[agent]), { key: started.key, agent, provider: started.provider, model: started.model, access: started.access, cwd });
    closeOthers(id, started.key);
    const heard = early.get(started.key);
    if (heard) { early.delete(started.key); await reflect(id, started.key, heard); }
    return { outcome: 'success', key: started.key, issue: bound.issue ?? again.issue };
  }

  // The sessions an issue had before are put away: it has one session at a time (3.3).
  function closeOthers(id, keep) {
    for (const [key, owner] of [...bySession]) {
      if (owner !== id || key === keep) continue;
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
        ask: WORDS.notDelivered(sent.message),
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

  async function adopt(issue, { reconcile = false } = {}) {
    if (!/^(dsh|claude|codex):./.test(issue?.session ?? '')) return false;
    const known = bySession.get(issue.session) === issue.id;
    if (reconcile) await repairDefaults?.(issue);
    if (issue.session.startsWith('dsh:') && !agentSessions.has(issue.session)) {
      await agentSessions.adopt(issue.session, { agent: issue.agent, cwd: issue.project?.path ?? null });
    }
    const snapshot = sessionSnapshot(issue.session);
    if (!snapshot) return false;
    bySession.set(issue.session, issue.id);
    if (!known || reconcile) await reflect(issue.id, issue.session, { to: snapshot.state, snapshot });
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
          // The initial index poll can reveal newer facts after this issue was already adopted.
          if (await adopt(issue, { reconcile: true })) followed++;
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    return followed;
  }

  return {
    sessionState, sessionSince, sessionBases, sessionHandledAt, snapshotOf: sessionSnapshot,
    onAssign, onReply, onResume, start, setAccess, closeFor, restore, adopt,
    forward: (issue, text, attachments = []) => agentSessions.send(issue.session, text, { direct: true, attachments }),
    suspend(issue) {
      suspended.add(issue.id);
      return async () => {
        suspended.delete(issue.id);
        const snapshot = agentSessions.snapshotOf(issue.session);
        if (snapshot) await serialized(issue.id, () => reflect(issue.id, issue.session, { to: snapshot.state, snapshot }));
      };
    },
    forget(issue) {
      observed.delete(issue.id);
      suspended.delete(issue.id);
      for (const [key, owner] of bySession) if (owner === issue.id) {
        bySession.delete(key);
        agentSessions.forget(key);
      }
    },
    observe: (issue, snapshot) => serialized(issue.id, () => {
      const resolved = sessionSnapshot(issue.session) ?? snapshot;
      return reflect(issue.id, issue.session, { to: resolved.state, snapshot: resolved });
    }),
    async dispose() { unsubscribe(); bySession.clear(); early.clear(); observed.clear(); await Promise.allSettled([...tails.values()]); },
  };
}
