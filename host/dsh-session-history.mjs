import { withAbort } from './providers/async.mjs';

export function canReadSessionHistory({ query, controller } = {}) {
  return typeof query?.observeSession === 'function' || typeof query?.readSession === 'function' || typeof controller?.inspect === 'function';
}

/** Share DSH's immutable event cut; release the preparation lease even on cancellation or a failed read. */
async function observeHistory(query, sessionId, signal) {
  const pending = Promise.resolve(query.observeSession(sessionId, { projectionMode: 'none', ...(signal ? { signal } : {}) }));
  let taken = false;
  try {
    const observation = await (signal ? withAbort(pending, signal) : pending);
    taken = true;
    try {
      signal?.throwIfAborted();
      const header = observation.header;
      return { session: header, meta: header, header, inheritedEventCount: observation.inheritedEventCount, events: observation.events,
        source: observation.source, revision: observation.revision, cursor: observation.cursor };
    } finally { observation[Symbol.dispose](); }
  } finally {
    // A host can finish after its caller stops waiting. That late lease must not pin the prepared history.
    if (!taken) void pending.then((observation) => { observation[Symbol.dispose](); }, () => {});
  }
}

/** Read-only, live-preferred history. Detached readSession snapshots clone/replay the whole log twice per mirror step. */
export async function readSessionHistory({ query, controller }, sessionId, signal) {
  signal?.throwIfAborted();
  if (typeof query?.observeSession === 'function') return observeHistory(query, sessionId, signal);
  let pending;
  if (typeof query?.readSession === 'function') pending = query.readSession(sessionId);
  else if (typeof controller?.inspect === 'function') pending = controller.inspect(sessionId, signal);
  else throw Object.assign(new Error('UNSUPPORTED'), { code: 'UNSUPPORTED' });
  const result = await (signal ? withAbort(pending, signal) : pending);
  // Older consumers name the same immutable session header meta or header.
  const header = result.header ?? result.meta ?? result.session;
  return { ...result, meta: header, header };
}
