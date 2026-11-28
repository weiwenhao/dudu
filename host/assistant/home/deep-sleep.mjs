// Deep sleep releases stopped issue sessions once, after thirty minutes idle or an hour unread.
// Actual work, live questions/approvals and background jobs remain protected by lifecycle checks.
// Starting or speaking to the session resets its sleep timer. Opening it preserves the timer.
// Deep sleep releases retained memory while preserving the issue's status and the agent's state.
// It calls no model and writes nothing to the log.
//
// A conversation that is no issue's keeps its harness process between turns as well (130 to 400 MB each, until DSH exited: owner, 2026-11-27: 「做吧」), so it is let go of after the same
// waits, counted from the end of its turn. Nothing about it is shown differently (no crescent, no state): only the process and what the run kept of the turn go.
//
//   const sleep = createDeepSleep({ sessions, asleep, release, held, markOf, enabled, afterMs, intervalMs = 60 s, log });
//
//   sessions    the sessions of the issues (agent-sessions.mjs): `keys()`
//   asleep      (key) -> whether the agent of that session is in deep sleep now (the `deepSleep` of its issue)
//   release     async (key) -> whether something was let go of (the harness runs of that DSH session, host/providers)
//   held        () -> [{ key, endedAt }]: the sessions that keep a run whose turn has ended (host/providers `heldRuns`); the issues' are left to `asleep`
//   markOf      (key) -> the session's status mark (idle, unread, processing): only idle and unread may sleep, and unread waits twice as long
//   enabled     () -> whether deep sleep is on (the owner's switch); off, nothing is let go of
//   afterMs     an idle session's wait (the unread one's is twice that)
//   tick()      looks at every session now (a timer does it every `intervalMs`); -> the keys that fell asleep in this look
//   isAsleep(key)  whether the session was found asleep in the last look and has not woken since
//   close()
//
//   withDeepSleep(snapshot, key, asleep)  what the DSH sidebar and the phone are told of a session: its snapshot, plus `deepSleep: true` when `asleep(key)` says its crescent is to be drawn
//                (both clients retain unread's red dot and show the crescent for idle only).
import { DEEP_SLEEP_MS, SLEEPING_MARKS, hasEndedTurn, waitFor } from '../sessions/deep-sleep.mjs';

/**
 * What the DSH sidebar and the phone are told of a session: its snapshot, and `deepSleep: true` when `asleep(key)` says so (it is the crescent of an agent in deep sleep).
 * Only a session whose turn has ended can sleep, so only those are looked up: most of the sessions in a list are not an issue's, and cost nothing.
 */
export function withDeepSleep(snapshot, key, asleep) {
  if (!snapshot || !hasEndedTurn(snapshot.state, snapshot.turnActive)) return snapshot;
  return asleep(key) ? { ...snapshot, deepSleep: true } : snapshot;
}

export function createDeepSleep({ sessions, asleep, release, held = () => [], markOf = () => 'idle', enabled = () => true, afterMs = DEEP_SLEEP_MS, now = Date.now, intervalMs = 60_000, log = console } = {}) {
  const sleeping = new Set();
  const waiting = new Map(); // key of a session that is no issue's -> { mark, endedAt, since, failed }: what it was when last looked at, and since when it has been left alone
  let running = null;
  let closed = false;

  /**
   * The conversations that are no issue's but keep a run whose turn has ended. The wait counts from the end of the turn; a change of the session's mark is the owner handling it
   * (reading the answer makes unread idle), and the wait begins again then. A release that is refused (it still works, or owns background work) is asked again at the next look; one that
   * fails is not asked again for the same turn.
   */
  async function lookAtOthers(issueKeys) {
    if (!enabled()) { waiting.clear(); return; }
    const ended = new Map();
    for (const { key, endedAt } of held() ?? []) {
      if (typeof key !== 'string' || issueKeys.has(key)) continue;
      ended.set(key, Math.max(Number.isFinite(endedAt) ? endedAt : -Infinity, ended.get(key) ?? -Infinity));
    }
    for (const key of [...waiting.keys()]) if (!ended.has(key)) waiting.delete(key);
    for (const [key, endedAt] of ended) {
      if (closed) return;
      const mark = markOf(key);
      let entry = waiting.get(key);
      if (!entry || entry.endedAt !== endedAt) entry = { mark, endedAt, since: Number.isFinite(endedAt) ? endedAt : now(), failed: false };
      else if (entry.mark !== mark) entry = { mark, endedAt, since: now(), failed: false };
      waiting.set(key, entry);
      if (entry.failed || !SLEEPING_MARKS.includes(mark) || now() - entry.since < waitFor(mark, afterMs)) continue;
      try { await release?.(key); } catch (error) {
        entry.failed = true;
        log.warn?.(`[dudu] The process of a conversation could not be let go of: ${error.message}`);
      }
    }
  }

  async function look() {
    const fell = [];
    const issueKeys = new Set(sessions.keys());
    for (const key of issueKeys) {
      if (closed) break;
      if (!asleep(key)) { sleeping.delete(key); continue; }
      if (sleeping.has(key)) continue;
      sleeping.add(key);
      fell.push(key);
      try { await release?.(key); } catch (error) { log.warn?.(`[dudu] An agent in deep sleep could not be let go of: ${error.message}`); }
    }
    await lookAtOthers(issueKeys);
    return fell;
  }
  const tick = () => (running ??= look().finally(() => { running = null; }));
  const timer = intervalMs > 0 ? setInterval(() => { void tick().catch(() => {}); }, intervalMs) : null;
  timer?.unref?.();

  return {
    tick,
    isAsleep: (key) => sleeping.has(key),
    async close() { closed = true; clearInterval(timer); waiting.clear(); await running?.catch(() => {}); },
  };
}
