// A read source shared by widgets asking the same question. No polling remains when its last subscriber leaves.
import { abortable } from '../lib/abortable.js';

export function createReadStore(request, action, body, {
  every = 10_000, timeoutMs = 15_000, visibility = globalThis.document,
  initialRetries = 0, retryMs = 1000, keepValueOnError = false, trackRefresh = false,
} = {}) {
  let snapshot = { status: 'loading', value: null, ...(trackRefresh ? { refreshing: false, updatedAt: null } : {}) };
  let pending = null;
  let invalidation = null;
  let timer = null;
  let controller = null;
  let failures = 0;
  const listeners = new Set();
  const cadences = new Map();
  const visible = () => !visibility || visibility.visibilityState === 'visible';
  const schedule = () => {
    clearTimeout(timer);
    const delay = failures > 0 && failures <= initialRetries ? retryMs : Math.min(...cadences.values());
    if (listeners.size) timer = setTimeout(() => { if (visible()) void load(); else schedule(); }, delay);
  };
  function load(override, manual = false) {
    if (pending) return pending;
    controller = new AbortController();
    const current = controller;
    const signal = AbortSignal.any([current.signal, AbortSignal.timeout(timeoutMs)]);
    if (manual) failures = 0;
    if (manual || trackRefresh) snapshot = { ...snapshot, ...(manual ? { status: 'loading' } : {}), ...(trackRefresh ? { refreshing: true } : {}) };
    pending = Promise.resolve().then(() => abortable(request(action, override ? { ...body, ...override } : body, { signal }), signal)).then((value) => {
      if (current.signal.aborted) return;
      if (['error', 'needs_clarification'].includes(value.outcome)) throw new Error(value.message);
      failures = 0;
      snapshot = { status: 'ready', value, ...(trackRefresh ? { refreshing: false, updatedAt: Date.now() } : {}) };
    }).catch(() => {
      if (current.signal.aborted) return;
      failures++;
      if (snapshot.value !== null && keepValueOnError) snapshot = { ...snapshot, status: 'ready' };
      else if (snapshot.value === null || manual) snapshot = { ...snapshot, status: failures <= initialRetries ? 'loading' : 'error' };
    }).finally(() => {
      if (controller === current) controller = null;
      pending = null;
      if (trackRefresh) snapshot = { ...snapshot, refreshing: false };
      for (const listener of listeners) listener();
      if (current.signal.aborted && listeners.size && visible()) void load();
      else schedule();
    });
    // Notify after retaining the in-flight request so a subscriber cannot accidentally start a duplicate read.
    if (manual || trackRefresh) for (const listener of listeners) listener();
    return pending;
  }
  const changed = () => { if (visible()) void load(); };
  return {
    getSnapshot: () => snapshot,
    refresh: (override) => load(override, true),
    invalidate() {
      if (!pending) return load();
      // A pushed completion may arrive while an older response is in flight. Read again after it,
      // instead of treating that older response as the answer to the new event.
      return invalidation ??= pending.then(() => {
        invalidation = null;
        if (listeners.size && visible()) return load();
      });
    },
    subscribe(listener, cadence = every) {
      listeners.add(listener);
      cadences.set(listener, cadence);
      if (listeners.size === 1) {
        if (initialRetries && snapshot.status === 'error' && snapshot.value === null) {
          failures = 0;
          snapshot = { ...snapshot, status: 'loading' };
          listener();
        }
        visibility?.addEventListener('visibilitychange', changed);
        if (visible()) void load(); else schedule();
      } else schedule();
      return () => {
        listeners.delete(listener);
        cadences.delete(listener);
        if (!listeners.size) {
          clearTimeout(timer);
          controller?.abort();
          visibility?.removeEventListener('visibilitychange', changed);
        } else schedule();
      };
    },
    get active() { return listeners.size > 0; },
  };
}

const sources = new WeakMap();
export function widgetReadStore(request, action, body, every) {
  let cache = sources.get(request);
  if (!cache) { cache = new Map(); sources.set(request, cache); }
  const key = JSON.stringify([action, body]);
  if (!cache.has(key)) {
    if (cache.size >= 128) for (const [id, store] of cache) {
      if (!store.active) { cache.delete(id); if (cache.size < 128) break; }
    }
    cache.set(key, createReadStore(request, action, body, {
      every, ...(action === 'sessions/list' ? { initialRetries: 2, keepValueOnError: true, trackRefresh: true } : {}),
    }));
  }
  return cache.get(key);
}
