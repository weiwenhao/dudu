import { randomUUID } from 'node:crypto';
import { ConversationError, validateAnswers } from './native-conversation.mjs';

export function createNativeQuestions({ events, attachWait }) {
  const watching = new Map();
  const pending = new Map();
  let disposed = false;
  const keyOf = (sessionId, callId) => JSON.stringify([sessionId, callId]);
  const isWatched = (sessionId) => (watching.get(sessionId)?.size ?? 0) > 0;
  const changed = (sessionId) => {
    for (const watcher of watching.get(sessionId) ?? []) {
      try { watcher.onChange?.(); } catch { /* a view cannot fail the owner's tool call */ }
    }
  };
  const unregister = events.on('user-questions/request', async (request, next) => {
    const sessionId = request?.agent?.session?.id;
    const callId = request?.wait === undefined ? randomUUID() : request.wait?.callId;
    if (disposed || typeof sessionId !== 'string' || typeof callId !== 'string'
      || !Array.isArray(request.questions) || pending.size >= 100) return next();
    const key = keyOf(sessionId, callId);
    if (pending.has(key)) return next();
    const lifetime = new AbortController();
    const originalSignal = request.signal;
    const signal = originalSignal ? AbortSignal.any([originalSignal, lifetime.signal]) : lifetime.signal;
    let resolve;
    let reject;
    let claim;
    let claimed;
    let upstreamError;
    let claimError;
    let answered = false;
    const mobile = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
    const onAbort = () => reject(signal.reason ?? new ConversationError('STALE_APPROVAL'));
    const row = {
      sessionId, callId, questions: request.questions,
      answer(answers) {
        if (signal.aborted) return false;
        if (claimError) throw new ConversationError('UPSTREAM_UNAVAILABLE');
        if (answered || !isWatched(sessionId)) throw new ConversationError('STALE_APPROVAL');
        const validated = validateAnswers({ callId, questions: request.questions }, answers);
        answered = true;
        resolve(validated);
        return true;
      },
      reconcile() {
        if (!isWatched(sessionId) || disposed) {
          claim?.abort();
          claim = undefined;
          claimed = undefined;
          if (upstreamError) reject(upstreamError);
        } else if (!claim && !claimError && request.wait?.timed === true && attachWait) {
          claim = new AbortController();
          const claimSignal = AbortSignal.any([claim.signal, signal]);
          try { claimed = attachWait(request, claimSignal); }
          catch (error) { row.failClaim(error); return; }
          if (!claimed || typeof claimed[Symbol.asyncIterator] !== 'function') {
            row.failClaim(new ConversationError('UNSUPPORTED'));
            return;
          }
          void (async () => {
            try { for await (const _frame of claimed) { if (claimSignal.aborted) break; } }
            catch (error) { if (!claimSignal.aborted) row.failClaim(error); }
          })();
        }
      },
      failClaim(error) {
        claimError = error;
        claim?.abort();
        claim = undefined;
        claimed = undefined;
        if (upstreamError) reject(error);
        for (const watcher of watching.get(sessionId) ?? []) watcher.onFailure?.(error);
      },
      close() {
        claim?.abort();
        lifetime.abort(new ConversationError('STALE_APPROVAL'));
      },
    };
    pending.set(key, row);
    changed(sessionId);
    signal.addEventListener('abort', onAbort, { once: true });
    request.signal = signal;
    try {
      row.reconcile();
      if (signal.aborted) onAbort();
      const desktop = Promise.resolve().then(next).catch((error) => {
        upstreamError = error;
        if (error?.code === 'NO_PROVIDER' && isWatched(sessionId) && !claimError) return mobile;
        throw error;
      });
      return await Promise.race([desktop, mobile]);
    } finally {
      pending.delete(key);
      signal.removeEventListener('abort', onAbort);
      row.close();
      request.signal = originalSignal;
      changed(sessionId);
    }
  }, { global: true, prepend: true });

  return Object.freeze({
    watch(sessionId, onFailure, onChange) {
      if (disposed) throw new ConversationError('UPSTREAM_UNAVAILABLE');
      const token = { onFailure, onChange };
      const watchers = watching.get(sessionId) ?? new Set();
      watchers.add(token);
      watching.set(sessionId, watchers);
      for (const row of pending.values()) if (row.sessionId === sessionId) row.reconcile();
      return () => {
        watchers.delete(token);
        if (!watchers.size && watching.get(sessionId) === watchers) watching.delete(sessionId);
        for (const row of pending.values()) if (row.sessionId === sessionId) row.reconcile();
      };
    },
    answer(sessionId, callId, answers) {
      const row = pending.get(keyOf(sessionId, callId));
      if (!row) return false;
      return row.answer(answers);
    },
    /** Blocking host tools have no timed-question projection. Merge their live
     * requests with the host's durable continued questions, once per call ID. */
    list(sessionId, active = []) {
      const calls = new Map(active.map((call) => [call.callId, call]));
      for (const row of pending.values()) {
        if (row.sessionId === sessionId) calls.set(row.callId, { callId: row.callId, questions: row.questions, state: 'open' });
      }
      return [...calls.values()];
    },
    close() {
      disposed = true;
      unregister();
      watching.clear();
      for (const row of pending.values()) row.reconcile();
      pending.clear();
    },
  });
}
