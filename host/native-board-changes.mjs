// Tells the phones that what the board shows has changed, at the moment it changes (owner, 2026-11-22: a red dot should come as fast as WeChat's, and a phone that asks every
// few seconds is neither fast nor cheap: "轮询只能作为保底").
//
// It sends nothing itself: `send(revision)` puts one small event on the phones' held connections (native-server.mjs, `broadcast`), and a phone that gets it reads the board again.
// A burst of changes is one event: the first change starts a short wait, everything that happens inside it is the same event, and two events are never closer than `minGapMs`.

import { activityRevision } from './assistant/sessions/session-state.mjs';

export function createBoardChanges({ send, delayMs = 120, minGapMs = 400, now = Date.now }) {
  let timer;
  let lastSentAt = -Infinity;
  let revision = 0;
  let closed = false;
  const seen = new Map();

  function changed() {
    if (closed || timer) return;
    const wait = Math.max(delayMs, lastSentAt + minGapMs - now());
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;
      lastSentAt = now();
      revision += 1;
      try { send(revision); } catch { /* A phone that cannot be told reads the board again on its own. */ }
    }, wait);
    timer.unref?.();
  }

  return {
    changed,
    /**
     * A session's published state moved: a turn began or ended, a question or an answer was recorded. `attention` is what the session's activity projection says now; it is
     * compared with what it said the last time, so that the many events of a running turn that change nothing a phone shows are not told.
     */
    sessionChanged(id, attention) {
      const mark = `${activityRevision(attention)}:${attention?.pending?.seq ?? -1}`;
      if (seen.get(id) === mark) return;
      seen.set(id, mark);
      changed();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      timer = undefined;
      seen.clear();
    },
  };
}
