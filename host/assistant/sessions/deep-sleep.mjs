// Deep sleep (docs/assistant.md 3.4): an agent whose turn has ended, that nobody has handled for half an hour (an hour for a finished run that waits for a look)
// and that is not asking for anything has nothing running and is told to let go of what 嘟嘟 holds for it; the next turn starts it again (a harness is started
// afresh for every turn and resumes its own session). Pure: no clock of its own and no I/O. A state is the session's (`running`, `waiting_owner`, `finished`,
// `idle`, `error`, see states.mjs); `agentMark` is the agent's as the issue shows it (`idle`, `working`, `blocked`, `done`: the session's, or the owner's word
// over it, see work-state.mjs).
export const DEEP_SLEEP_MS = 30 * 60_000; // an idle agent's wait

/**
 * How long a mark is left alone before it sleeps, as a multiple of the idle agent's wait (owner, 2026-11-07: "in the Needs-you stage, deep sleep only after an hour
 * with nothing new; in the idle area keep thirty minutes"): a finished run that waits for a look (the green check) waits twice as long.
 */
export const WAIT_FACTOR = Object.freeze({ idle: 1, done: 2 });
export const waitFor = (agentMark, afterMs = DEEP_SLEEP_MS) => afterMs * (WAIT_FACTOR[agentMark] ?? 1);

// A turn that ended has nothing running. `waiting_owner` is not one of them: it is a turn that is alive and waits for its answer.
export const ENDED_STATES = Object.freeze(['finished', 'idle', 'error', 'stopped']);
const ENDED = new Set(ENDED_STATES);

// The marks that may sleep: an idle agent, and a run that finished and waits for a look (the green check; owner, 2026-11-07: "在需要我的阶段，只要不是红点，都可以进入
// 深度睡眠"). A red dot (a question, an approval, a failure, a stop) is the owner's to answer: it never sleeps, however long.
export const SLEEPING_MARKS = Object.freeze(['idle', 'done']);

/** When a session was last handled: the latest of when its state began, when it last did anything, and when the owner last spoke to it or opened it. */
export function handledAtOf(snapshot) {
  const times = [snapshot?.stateSince, snapshot?.lastActivityAt, snapshot?.touchedAt].filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/**
 * Whether the agent of a session is in deep sleep: its mark may sleep (idle, or a finished run: an agent that asks, fails or was stopped is not, nor is one
 * that works), its session is a DSH one (the kind 嘟嘟 started or took over: a conversation in somebody's terminal is not 嘟嘟's to put to sleep or to start
 * again), its turn has ended, and the wait of its mark has passed since it was handled (`handledAt`, ms; unknown is not asleep: it is never guessed). `afterMs`
 * is an idle agent's wait; a finished run's is twice that (`waitFor`).
 */
export function inDeepSleep({ key, state, agentMark, handledAt, now = Date.now(), afterMs = DEEP_SLEEP_MS }) {
  if (!/^dsh:./s.test(String(key ?? ''))) return false;
  return SLEEPING_MARKS.includes(agentMark) && ENDED.has(state) && Number.isFinite(handledAt) && now - handledAt >= waitFor(agentMark, afterMs);
}
