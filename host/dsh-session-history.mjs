import { withAbort } from './providers/async.mjs';

export function canReadSessionHistory({ query, controller } = {}) {
  return typeof query?.readSession === 'function' || typeof controller?.inspect === 'function';
}

/** Cold, live-preferred history reads moved out of sessionController in DSH 0.2.2. */
export async function readSessionHistory({ query, controller }, sessionId, signal) {
  signal?.throwIfAborted();
  let pending;
  if (typeof query?.readSession === 'function') pending = query.readSession(sessionId);
  else if (typeof controller?.inspect === 'function') pending = controller.inspect(sessionId, signal);
  else throw Object.assign(new Error('UNSUPPORTED'), { code: 'UNSUPPORTED' });
  const result = await (signal ? withAbort(pending, signal) : pending);
  // Older consumers name the same immutable session header meta or header.
  const header = result.header ?? result.meta ?? result.session;
  return { ...result, meta: header, header };
}
