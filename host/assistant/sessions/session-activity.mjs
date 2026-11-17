import { mapLimit, withAbort } from '../../providers/async.mjs';
import { activityRevision, EMPTY_ATTENTION, sessionStateForActivity } from './session-state.mjs';
import { validReadPosition } from './read-receipts.mjs';

const LIST_WAIT_MS = 1_500; // how long a request waits for DSH's list of all sessions
const LIST_RETRY_MS = 30_000; // after a list failed, none is started for this long

/** Shared session status and exact read boundaries. Lifecycle and workflow remain their own facts. */
export function createSessionActivity({ receipts, projected, readProjection, listProjections, snapshotOf, nativeSnapshotOf, liveOf, diagnostics }) {
  const cache = new Map();
  const flights = new Map();
  const stop = new AbortController();
  let listing;
  let listFailedAt = -Infinity;
  let hydration = Promise.resolve();
  const attempted = new Map();
  const sourceStamp = (id) => {
    const source = nativeSnapshotOf(`dsh:${id}`);
    // Completion need not add another assistant message. Also invalidate when foreground work ends.
    return `${source?.incomingAt ?? 0}:${source?.foregroundActive === true}:${source?.foregroundActive ? 0 : source?.lastActivityAt ?? 0}`;
  };
  const observe = (id, attention, stamp = sourceStamp(id), exact = true) => {
    const previous = cache.get(id);
    const revision = activityRevision(attention);
    if (!stop.signal.aborted && attention && revision >= activityRevision(previous?.attention)
      && (exact || !previous?.exact || revision > activityRevision(previous.attention))) {
      cache.set(id, { attention, stamp, exact });
    }
  };
  const attentionOf = (id) => {
    const live = projected(id);
    const saved = cache.get(id)?.attention;
    return (live && activityRevision(live) >= activityRevision(saved) ? live : saved) ?? EMPTY_ATTENTION;
  };
  const exactAttentionOf = (id, required = true) => {
    const live = projected(id);
    const saved = cache.get(id);
    const exact = saved?.exact && saved.stamp === sourceStamp(id) ? saved.attention : null;
    const latest = live && activityRevision(live) >= activityRevision(exact) ? live : exact;
    if (!latest && required) throw new Error('An exact session read boundary is unavailable');
    return latest;
  };
  const warm = (ids) => mapLimit([...new Set(ids)], 6, async (id) => {
    if (stop.signal.aborted) return;
    const saved = cache.get(id);
    const stamp = sourceStamp(id);
    if (projected(id) || saved?.exact && saved.stamp === stamp) return;
    if (flights.has(id)) return flights.get(id);
    const began = Date.now();
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(15_000)]);
    const flight = withAbort(Promise.resolve().then(() => readProjection(id, signal)), signal).then((attention) => {
      // A source change during this read must still invalidate it on the next refresh.
      if (!stop.signal.aborted) observe(id, attention, stamp);
    }).catch((error) => {
      if (!stop.signal.aborted) diagnostics?.record({ event: 'session.activity.read', provider: 'dsh', id, outcome: 'failure', elapsedMs: Date.now() - began, error });
      throw error;
    }).finally(() => { if (flights.get(id) === flight) flights.delete(id); });
    flights.set(id, flight);
    return flight;
  });
  async function refresh(ids) {
    if (stop.signal.aborted) return;
    const cold = [...new Set(ids)].filter((id) => !projected(id));
    if (!cold.length) return;
    // DSH's list of every session is as slow as DSH is busy (12 to 26 seconds were measured, on 2026-11-17), and the phone's lists and
    // the desktop's wait here before they answer. A list that failed is not asked for again for a while, and a request waits for it
    // only a moment: what is known answers, and what the list brings is taken in when it comes.
    if (!listing && Date.now() - listFailedAt < LIST_RETRY_MS) return;
    if (!listing) {
      const began = Date.now();
      const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(12_000)]);
      listing = withAbort(Promise.resolve().then(() => listProjections(signal)), signal)
        .then((rows) => new Map(rows.map((row) => [row.sessionId ?? row.id, row.projections?.values?.duduSessionActivity])))
        .catch((error) => {
          listFailedAt = Date.now();
          if (!stop.signal.aborted) diagnostics?.record({ event: 'session.activity.list', provider: 'dsh', id: 'list', outcome: 'failure', elapsedMs: Date.now() - began, error });
          throw error;
        }).finally(() => { listing = undefined; });
    }
    const taken = listing.then((rows) => {
      if (stop.signal.aborted) return;
      for (const id of cold) {
        // DSH validates persisted hints against the session lifecycle. A hint is for display only:
        // it must never certify the exact boundary used by acknowledge/markUnread/rebind.
        observe(id, rows.get(id), undefined, false);
        if (projected(id) || cache.has(id) || attempted.get(id) === sourceStamp(id)) continue;
        attempted.set(id, sourceStamp(id));
        // Only requested, genuinely uncached sessions need a first fold. One cold log at a time,
        // off the list's response path; an unreadable session cannot blank every other row.
        hydration = hydration.then(() => {
          if (!stop.signal.aborted && !projected(id) && !cache.has(id)) return warm([id]);
        }).catch(() => {}); // warm records failures; do not retry the unchanged source on every poll.
      }
    }).catch(() => {}); // the failure is recorded above
    let timer;
    try { await Promise.race([taken, new Promise((done) => { timer = setTimeout(done, LIST_WAIT_MS); timer.unref?.(); })]); }
    finally { clearTimeout(timer); }
  }
  const statusOf = (key) => {
    const snapshot = snapshotOf(key);
    const native = nativeSnapshotOf(key);
    const incomingAt = native?.incomingAt;
    if (!key?.startsWith('dsh:')) {
      // Once imported, both identities name the same journal and share its exact read coordinates.
      if (native?.dshSessionId) return statusOf(`dsh:${native.dshSessionId}`);
      const unread = Number.isFinite(incomingAt) && incomingAt > 0 && incomingAt > (receipts.get(key)?.seq ?? -1);
      return { ...snapshot, sessionState: sessionStateForActivity({
        running: snapshot?.foregroundActive === true, pendingInteraction: snapshot?.state === 'waiting_owner',
      }, { sessionState: unread ? 'unread' : 'idle' }) };
    }
    const id = key.slice(4);
    const attention = attentionOf(id);
    const live = liveOf(id);
    // Assignment has already reconciled pushed DSH boundaries with native evidence by freshness.
    // Reading the raw native cache again would let an older running scan override a newer completion.
    const running = live?.status === 'running' || (snapshot?.provider !== 'dsh' && snapshot?.foregroundActive === true)
      || (!live && snapshot?.provider === 'dsh' && snapshot.state === 'running');
    const sessionState = sessionStateForActivity({
      running,
      pendingInteraction: live?.status === 'waiting' || snapshot?.state === 'waiting_owner',
    }, { state: 'idle', sessionState: receipts.unread(key, attention) ? 'unread' : 'idle' });
    return { ...snapshot, sessionState, attention, unread: receipts.unread(key, attention) };
  };
  return {
    observe, attentionOf, warm, refresh, statusOf,
    async markUnread(id) {
      if (typeof id !== 'string' || !id || id.length > 512) throw new TypeError('Invalid session');
      await warm([id]);
      if (stop.signal.aborted) throw new Error('Session activity is closed');
      receipts.markUnread(`dsh:${id}`, { seq: exactAttentionOf(id).seq });
    },
    async acknowledge(id, position) {
      if (typeof id !== 'string' || !id || id.length > 512 || !validReadPosition(position)) throw new TypeError('Invalid read position');
      await warm([id]);
      if (stop.signal.aborted) throw new Error('Session activity is closed');
      const latest = exactAttentionOf(id);
      // Visible partial content remains readable after a stop, without treating control events as content.
      if (position.seq > Math.max(latest.seq, latest.readableSeq ?? -1)) throw new TypeError('Read position is ahead of the conversation');
      receipts.acknowledge(`dsh:${id}`, position);
      return { sessionState: statusOf(`dsh:${id}`).sessionState };
    },
    async rebind(previousId, nextId) {
      await warm([previousId, nextId]);
      const previous = exactAttentionOf(previousId, false);
      const next = exactAttentionOf(nextId, false);
      // A replacement has different journal coordinates. Transfer only an already-read identical last answer.
      if (previous?.kind === 'message' && next?.kind === 'message' && previous.digest === next.digest
        && next.at <= previous.at && !receipts.unread(`dsh:${previousId}`, previous)) {
        receipts.acknowledge(`dsh:${nextId}`, { seq: next.seq });
      }
    },
    async close() {
      stop.abort();
      await Promise.allSettled([...flights.values(), listing, hydration]);
      cache.clear();
      attempted.clear();
    },
  };
}
