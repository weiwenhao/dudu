import { withAbort } from './providers/async.mjs';

/**
 * DSH caches completed cold preparations, but does not share an in-progress one.
 * Its native conversation and our readers can therefore decompress/restore the same
 * large journal concurrently. Warm that preparation once through the public query
 * API, keeping its lease pinned until every waiting reader has acquired its own cut.
 * Every caller still invokes the original API with its own projection mode and signal;
 * neither stale snapshots nor another caller's "none" projections escape to the UI.
 */
export function installSessionHistoryCoalescing(query, sessions) {
  if (typeof query?.observeSession !== 'function') return () => {};
  const own = Object.getOwnPropertyDescriptor(query, 'observeSession');
  let owner = query;
  let descriptor = own;
  while (!descriptor && (owner = Object.getPrototypeOf(owner))) descriptor = Object.getOwnPropertyDescriptor(owner, 'observeSession');
  // Cordis returns a new context-tracing proxy on each method read. Save the
  // descriptor's method so restoration does not install one caller's proxy.
  const original = descriptor?.value ?? query.observeSession;
  const flights = new Map();
  let closed = false;
  const dispose = (flight) => {
    if (flight.users) return;
    if (flights.get(flight.id) === flight) flights.delete(flight.id);
    flight.controller.abort();
    flight.lease?.[Symbol.dispose]();
    flight.lease = undefined;
  };
  async function observeSession(id, options = {}) {
    const signal = options.signal;
    signal?.throwIfAborted();
    if (closed || sessions?.get(id)) return original.call(this, id, options);
    let flight = flights.get(id);
    if (!flight) {
      flight = { id, controller: new AbortController(), users: 0, lease: undefined };
      flights.set(id, flight);
      const current = flight;
      current.ready = Promise.resolve().then(() => original.call(this, id, {
        projectionMode: 'none', signal: current.controller.signal,
      })).then((lease) => {
        current.lease = lease;
        if (closed || !current.users) dispose(current);
      });
    }
    flight.users++;
    const waiting = signal ? AbortSignal.any([signal, flight.controller.signal]) : flight.controller.signal;
    try {
      await withAbort(flight.ready, waiting);
      waiting.throwIfAborted();
      // A live attach or a new durable revision during preparation must win. The
      // original reader rechecks it; the pinned preparation is only a fast path.
      const pending = Promise.resolve().then(() => original.call(this, id, options));
      let taken = false;
      try {
        const lease = await withAbort(pending, waiting);
        taken = true;
        return lease;
      } finally {
        if (!taken) void pending.then((lease) => lease[Symbol.dispose](), () => {});
      }
    } finally {
      flight.users--;
      dispose(flight);
    }
  }
  query.observeSession = observeSession;
  return () => {
    closed = true;
    if (Object.getOwnPropertyDescriptor(query, 'observeSession')?.value === observeSession) {
      if (own) Object.defineProperty(query, 'observeSession', own);
      else delete query.observeSession;
    }
    for (const flight of flights.values()) flight.controller.abort();
  };
}
