// Deep sleep releases a stopped session's retained resources. Read state never stops live work or a dialog.
// `state` is the execution lifecycle; `agentMark` is the automatic session status (idle/processing/unread).
export const DEEP_SLEEP_MS = 30 * 60_000; // an idle agent's wait

/**
 * Keep the previous waits: thirty minutes for idle and an hour for unread (owner, 2026-11-15).
 */
export const WAIT_FACTOR = Object.freeze({ idle: 1, unread: 2 });
export const waitFor = (agentMark, afterMs = DEEP_SLEEP_MS) => afterMs * (WAIT_FACTOR[agentMark] ?? 1);

// A historical question also reads `waiting_owner` after its process has gone. Only an explicit live observation that its turn is
// inactive allows that state to sleep; a real question/approval, background work and unknown liveness keep it awake.
export const ENDED_STATES = Object.freeze(['finished', 'idle', 'error', 'stopped']);
const ENDED = new Set(ENDED_STATES);
export const hasEndedTurn = (state, turnActive) => turnActive !== true && (ENDED.has(state) || (state === 'waiting_owner' && turnActive === false));

// Both idle and unread may sleep. Actual foreground work, dialogs and background jobs remain protected separately.
export const SLEEPING_MARKS = Object.freeze(['idle', 'unread']);

/** The latest of the session's state transition, its last activity, and the owner's last start or message. */
export function handledAtOf(snapshot) {
  const times = [snapshot?.stateSince, snapshot?.lastActivityAt, snapshot?.touchedAt].filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/**
 * A DSH session may sleep when its turn has ended and its status's wait has passed since last handled.
 * Native terminal processes are not owned here; an unknown handled time never guesses sleep.
 * `turnActive` distinguishes a historical question from an actual waiting turn; true protects work in every state, and unknown never permits a waiting turn
 * to sleep. `afterMs` is idle's wait; unread's is twice that (`waitFor`).
 */
export function inDeepSleep({ key, state, agentMark, handledAt, turnActive = null, now = Date.now(), afterMs = DEEP_SLEEP_MS }) {
  if (!/^dsh:./s.test(String(key ?? ''))) return false;
  return SLEEPING_MARKS.includes(agentMark) && hasEndedTurn(state, turnActive) && Number.isFinite(handledAt) && now - handledAt >= waitFor(agentMark, afterMs);
}
