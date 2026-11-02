// A read source shared by widgets asking the same question. No polling remains when its last subscriber leaves.
export function createReadStore(request, action, body, { every = 10_000, visibility = globalThis.document } = {}) {
  let snapshot = { status: 'loading', value: null };
  let pending = null;
  let timer = null;
  const listeners = new Set();
  const visible = () => !visibility || visibility.visibilityState === 'visible';
  const schedule = () => {
    clearTimeout(timer);
    if (listeners.size) timer = setTimeout(() => { if (visible()) void load(); else schedule(); }, every);
  };
  function load() {
    if (pending) return pending;
    pending = Promise.resolve().then(() => request(action, body)).then((value) => {
      if (['error', 'needs_clarification'].includes(value.outcome)) throw new Error(value.message);
      snapshot = { status: 'ready', value };
    }).catch(() => {
      if (snapshot.value === null) snapshot = { status: 'error', value: null };
    }).finally(() => {
      pending = null;
      for (const listener of listeners) listener();
      schedule();
    });
    return pending;
  }
  const changed = () => { if (visible()) void load(); };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        visibility?.addEventListener('visibilitychange', changed);
        if (visible()) void load(); else schedule();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(timer);
          visibility?.removeEventListener('visibilitychange', changed);
        }
      };
    },
    get active() { return listeners.size > 0; },
  };
}

const sources = new WeakMap();
export function widgetReadStore(request, action, body, every) {
  let cache = sources.get(request);
  if (!cache) { cache = new Map(); sources.set(request, cache); }
  const key = JSON.stringify([action, body, every]);
  if (!cache.has(key)) {
    if (cache.size >= 128) for (const [id, store] of cache) {
      if (!store.active) { cache.delete(id); if (cache.size < 128) break; }
    }
    cache.set(key, createReadStore(request, action, body, { every }));
  }
  return cache.get(key);
}
