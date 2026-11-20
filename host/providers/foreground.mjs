import { LONG_POLL_MS } from '../long-poll.mjs';
import { abortReason } from './async.mjs';

/** Transient, session-scoped observation. Waiting for native work is not another model turn or a durable status. */
export function createForegroundWatch(read) {
  const waiting = new Map();
  let closed = false;
  const snapshot = (id) => ({ backgroundOnly: !closed && read(id) === true });
  return {
    changed(id) {
      for (const settle of [...waiting.get(id) ?? []]) settle();
    },
    wait(id, { after, signal } = {}) {
      signal?.throwIfAborted();
      const value = snapshot(id);
      if (closed || after !== value.backgroundOnly) return Promise.resolve(value);
      return new Promise((resolve, reject) => {
        const listeners = waiting.get(id) ?? new Set();
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          listeners.delete(settle);
          if (!listeners.size) waiting.delete(id);
        };
        const settle = () => { cleanup(); resolve(snapshot(id)); };
        const abort = () => { cleanup(); reject(abortReason(signal)); };
        const timer = setTimeout(settle, LONG_POLL_MS);
        listeners.add(settle);
        waiting.set(id, listeners);
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
    close() {
      closed = true;
      for (const listeners of [...waiting.values()]) for (const settle of [...listeners]) settle();
    },
  };
}
