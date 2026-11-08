// Deep sleep of the agents the issues are given to (docs/assistant.md 3.4): once an agent is idle, or its run finished and waits for a look, and nobody has handled it for half
// an hour (sessions/deep-sleep.mjs, which the issues store applies: its issue says `deepSleep`; an agent that asks, fails or was stopped never sleeps), what 嘟嘟 holds for its session is let go of, once. The next turn
// starts the agent again by itself, and the owner speaking to the session or opening it makes it awake. It never changes an issue's status or the
// agent's state, calls no model and writes nothing to the log: the session is as it was, and only what is kept in memory for it is gone.
//
//   const sleep = createDeepSleep({ sessions, asleep, release, intervalMs = 60 s, log });
//
//   sessions    the sessions of the issues (agent-sessions.mjs): `keys()`
//   asleep      (key) -> whether the agent of that session is in deep sleep now (the `deepSleep` of its issue)
//   release     async (key) -> whether something was let go of (the harness runs of that DSH session, host/providers)
//   tick()      looks at every session now (a timer does it every `intervalMs`); -> the keys that fell asleep in this look
//   isAsleep(key)  whether the session was found asleep in the last look and has not woken since
//   close()
//
//   withDeepSleep(snapshot, key, asleep)  what the DSH sidebar and the phone are told of a session: its snapshot, plus `deepSleep: true` when `asleep(key)` says its crescent is to be drawn
//                (the caller says so for every agent in deep sleep, whatever its mark: the crescent is drawn over the corner and the mark itself is left as it is, so it shows again on waking)
import { ENDED_STATES } from '../sessions/deep-sleep.mjs';

/**
 * What the DSH sidebar and the phone are told of a session: its snapshot, and `deepSleep: true` when `asleep(key)` says so (it is the crescent of an agent in deep sleep).
 * Only a session whose turn has ended can sleep, so only those are looked up: most of the sessions in a list are not an issue's, and cost nothing.
 */
export function withDeepSleep(snapshot, key, asleep) {
  if (!snapshot || !ENDED_STATES.includes(snapshot.state)) return snapshot;
  return asleep(key) ? { ...snapshot, deepSleep: true } : snapshot;
}

export function createDeepSleep({ sessions, asleep, release, intervalMs = 60_000, log = console } = {}) {
  const sleeping = new Set();
  let running = null;
  let closed = false;

  async function look() {
    const fell = [];
    for (const key of sessions.keys()) {
      if (closed) break;
      if (!asleep(key)) { sleeping.delete(key); continue; }
      if (sleeping.has(key)) continue;
      sleeping.add(key);
      fell.push(key);
      try { await release?.(key); } catch (error) { log.warn?.(`[dudu] An agent in deep sleep could not be let go of: ${error.message}`); }
    }
    return fell;
  }
  const tick = () => (running ??= look().finally(() => { running = null; }));
  const timer = intervalMs > 0 ? setInterval(() => { void tick().catch(() => {}); }, intervalMs) : null;
  timer?.unref?.();

  return {
    tick,
    isAsleep: (key) => sleeping.has(key),
    async close() { closed = true; clearInterval(timer); await running?.catch(() => {}); },
  };
}
