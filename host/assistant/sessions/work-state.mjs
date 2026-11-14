// Worker lifecycle is independent of issue workflow, review questions and reminder snoozes.
// "blocked" is the boss's turn: the agent stopped because it asked, failed or finished. (A finished run used to be a state of its own, "done";
// the boss decided on 2026-11-03 that it is the same thing: the work waits for them, so grouping, filters and counts have three states.)
// But the corner of an avatar still tells a finished run (a green check) from a question or a failure (red), which the boss asked to keep on
// 2026-11-04: that is the mark, one of four, and "done" is a mark of the state "blocked", never a state of its own.
export const AGENT_STATES = Object.freeze(['idle', 'working', 'blocked']);
export const AGENT_MARKS = Object.freeze(['idle', 'working', 'blocked', 'done']);

/** The state a mark belongs to: a finished run is "blocked" too. */
export const stateOfMark = (mark) => (mark === 'done' ? 'blocked' : mark);

/** Every state an issue shows: the agent's, or "unassigned" while it has no agent (owner, 2026-11-05). */
export const ISSUE_AGENT_STATES = Object.freeze([...AGENT_STATES, 'unassigned']);

/**
 * The mark of a session's state. A stopped or interrupted turn needs the owner like a question or a failure does (owner, 2026-11-05): idle is what they will not
 * handle soon. A finished run waited for ever for its look: the owner took the 12 hours away on 2026-11-07 ("去掉自动进入空闲的机制吧，只有我手动放到空闲区域") and, the
 * same afternoon, put a day back ("超过 24 小时没有处理的会话也自动进入到空闲中", `agedMark` below); on 2026-11-14 he made it 72 hours ("改成 72 小时吧").
 * Idle is a session that really is idle, the owner's own word, or 72 hours nobody has handled it.
 */
export function agentMarkForSession(state) {
  if (state === 'running') return 'working';
  if (state === 'finished') return 'done';
  if (state === 'waiting_owner' || state === 'error' || state === 'stopped') return 'blocked';
  return 'idle';
}

export const agentStateForSession = (state) => stateOfMark(agentMarkForSession(state));

/** How long nobody handles a session that waits for the owner before it reads Idle by itself (owner, 2026-11-07: 24 hours; 2026-11-14: 72 hours). */
export const UNHANDLED_IDLE_MS = 72 * 60 * 60_000;

/**
 * The mark with that rule applied: the marks that wait for the owner (a finished run, a question, a failure, a stop) read Idle once nobody has handled the session
 * for 72 hours. Work that runs, and Idle itself, are left as they are; a time that is not known is never aged (it is not guessed). `handledAt` is when anybody last did anything
 * with the session, in ms (the latest of its state's beginning, its last activity and the owner's last word to it or opening of it).
 */
export function agedMark(mark, handledAt, now = Date.now()) {
  if (mark !== 'blocked' && mark !== 'done') return mark;
  return Number.isFinite(handledAt) && now - handledAt >= UNHANDLED_IDLE_MS ? 'idle' : mark;
}

/** Shared by desktop and native sidebars; live work wins over persisted observations. A saved "done" (see activity-projection.mjs) is a finished run. */
export function agentMarkForActivity(live, saved, indexed, { now = Date.now() } = {}) {
  if (live?.pendingInteraction) return 'blocked';
  if (live?.running) return 'working';
  const handledAt = Math.max(...[saved?.at, indexed?.lastActivityAt, indexed?.stateSince].filter(Number.isFinite), -Infinity);
  const mark = (() => {
    if (indexed && (!saved || indexed.lastActivityAt > saved.at)) return agentMarkForSession(indexed.state);
    if (saved) return AGENT_MARKS.includes(saved.state) ? saved.state : 'idle';
    if (indexed) return agentMarkForSession(indexed.state);
    return live?.completionUnread ? 'done' : 'idle';
  })();
  return agedMark(mark, Number.isFinite(handledAt) ? handledAt : null, now);
}

export const agentStateForActivity = (live, saved, indexed, options) => stateOfMark(agentMarkForActivity(live, saved, indexed, options));
