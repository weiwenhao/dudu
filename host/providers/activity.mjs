import { randomUUID } from 'node:crypto';
import { abortReason } from './async.mjs';

/** Report native compaction through DSH's existing compact command row, without rewriting its message surface. */
export function createHarnessActivity({ session, route, nativeSessionId, signal }) {
  let compact;
  let finished = false;
  const start = () => {
    if (compact || !session?.append) return;
    compact = randomUUID();
    session.append('command/run', {
      commandId: compact, name: 'compact',
      source: { kind: 'dudu-harness', provider: route, nativeSessionId },
    });
  };
  const settle = (ok, text = '') => {
    if (!compact) return;
    const commandId = compact;
    compact = undefined;
    session.append('command/done', { commandId, kind: ok ? 'success' : 'error', ...(text ? { text } : {}) });
  };
  const end = ({ ok = false, error } = {}) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener('abort', onAbort);
    settle(ok, error?.message);
  };
  function onAbort() { end({ error: abortReason(signal) }); }
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    update(event) {
      if (finished) return;
      if (event.type === 'compaction-start') start();
      else if (event.type === 'compaction-end') {
        // Claude reports only the boundary after compaction; it still gets a completed row, without an invented duration.
        start();
        settle(event.outcome === 'completed', event.reason);
      }
    },
    end,
  };
}
