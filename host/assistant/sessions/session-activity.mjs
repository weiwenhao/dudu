import { mapLimit, withAbort } from '../../providers/async.mjs';
import { activityRevision, EMPTY_ATTENTION, sessionStateForActivity } from './session-state.mjs';
import { validReadPosition } from './read-receipts.mjs';

/** Shared session status and exact read boundaries. Lifecycle and workflow remain their own facts. */
export function createSessionActivity({ receipts, projected, readProjection, snapshotOf, nativeSnapshotOf, liveOf }) {
  const cache = new Map();
  const flights = new Map();
  const stop = new AbortController();
  const sourceStamp = (id) => {
    const source = nativeSnapshotOf(`dsh:${id}`);
    // Completion need not add another assistant message. Also invalidate when foreground work ends.
    return `${source?.incomingAt ?? 0}:${source?.foregroundActive === true}:${source?.foregroundActive ? 0 : source?.lastActivityAt ?? 0}`;
  };
  const observe = (id, attention, stamp = sourceStamp(id)) => {
    if (!stop.signal.aborted && attention && activityRevision(attention) >= activityRevision(cache.get(id)?.attention)) {
      cache.set(id, { attention, stamp });
    }
  };
  const attentionOf = (id) => {
    const live = projected(id);
    const saved = cache.get(id)?.attention;
    return (live && activityRevision(live) >= activityRevision(saved) ? live : saved) ?? EMPTY_ATTENTION;
  };
  const warm = (ids) => mapLimit([...new Set(ids)], 6, async (id) => {
    if (stop.signal.aborted) return;
    const saved = cache.get(id);
    const stamp = sourceStamp(id);
    if (projected(id) || saved?.stamp === stamp) return;
    if (flights.has(id)) return flights.get(id);
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(15_000)]);
    const flight = withAbort(Promise.resolve().then(() => readProjection(id, signal)), signal).then((attention) => {
      // A source change during this read must still invalidate it on the next refresh.
      if (!stop.signal.aborted) observe(id, attention, stamp);
    }).finally(() => { if (flights.get(id) === flight) flights.delete(id); });
    flights.set(id, flight);
    return flight;
  });
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
    const running = live?.status === 'running' || (native?.provider !== 'dsh' && native?.foregroundActive === true)
      || (!live && snapshot?.provider === 'dsh' && snapshot.state === 'running');
    const sessionState = sessionStateForActivity({
      running,
      pendingInteraction: live?.status === 'waiting' || snapshot?.state === 'waiting_owner',
    }, { state: 'idle', sessionState: receipts.unread(key, attention) ? 'unread' : 'idle' });
    return { ...snapshot, sessionState, attention, unread: receipts.unread(key, attention) };
  };
  return {
    observe, attentionOf, warm, statusOf,
    async markUnread(id) {
      if (typeof id !== 'string' || !id || id.length > 512) throw new TypeError('Invalid session');
      await warm([id]);
      if (stop.signal.aborted) throw new Error('Session activity is closed');
      receipts.markUnread(`dsh:${id}`, { seq: attentionOf(id).seq });
    },
    async acknowledge(id, position) {
      if (typeof id !== 'string' || !id || id.length > 512 || !validReadPosition(position)) throw new TypeError('Invalid read position');
      await warm([id]);
      if (stop.signal.aborted) throw new Error('Session activity is closed');
      const latest = attentionOf(id);
      // Visible partial content remains readable after a stop, without treating control events as content.
      if (position.seq > Math.max(latest.seq, latest.readableSeq ?? -1)) throw new TypeError('Read position is ahead of the conversation');
      receipts.acknowledge(`dsh:${id}`, position);
      return { sessionState: statusOf(`dsh:${id}`).sessionState };
    },
    async rebind(previousId, nextId) {
      await warm([previousId, nextId]);
      const previous = attentionOf(previousId);
      const next = attentionOf(nextId);
      // A replacement has different journal coordinates. Transfer only an already-read identical last answer.
      if (previous.kind === 'message' && next.kind === 'message' && previous.digest === next.digest
        && next.at <= previous.at && !receipts.unread(`dsh:${previousId}`, previous)) {
        receipts.acknowledge(`dsh:${nextId}`, { seq: next.seq });
      }
    },
    async close() {
      stop.abort();
      await Promise.allSettled([...flights.values()]);
      cache.clear();
    },
  };
}
