/**
 * DSH 0.2.2's sidebar commands require the native main Session surface.
 * Embedded conversation.content alone has no sidebar surface. Route a command
 * through the owning Session and wait for its native header's committed mount.
 */
export function installEmbeddedSessionSurface({ sidebar, openSession, isVisible = () => true, onError = console.error }) {
  const surfaces = new Map();
  const originals = new Map();
  let selected;
  let pending;
  let closed = false;
  const mounted = () => sidebar.mounted.getSnapshot();
  const abort = () => {
    if (!pending) return;
    const waiting = pending;
    pending = undefined;
    waiting.reject(new DOMException('Aborted', 'AbortError'));
  };
  const off = sidebar.mounted.subscribe(() => {
    const id = mounted();
    if (pending && id !== undefined && id !== pending.id) abort();
  });
  const route = async (method, args, id) => {
    abort();
    const ready = Promise.withResolvers();
    void ready.promise.catch(() => {});
    const waiting = { id, ...ready };
    pending = waiting;
    // Install the waiter before navigation: openSession may synchronously commit.
    const timeout = setTimeout(() => { if (pending === waiting) abort(); }, 10_000);
    try {
      await openSession(id, { returnToDudu: true });
      await ready.promise;
      if (!closed && mounted() === id) return method.apply(sidebar, args);
    } finally {
      clearTimeout(timeout);
      if (pending === waiting) pending = undefined;
    }
  };
  for (const name of ['openResource', 'openTab']) {
    const method = sidebar[name];
    if (typeof method !== 'function') continue;
    const own = Object.hasOwn(sidebar, name);
    const wrapped = function (...args) {
      const id = surfaces.get(selected) ?? [...surfaces.values()].at(-1);
      if (mounted() !== undefined || !id || !isVisible()) return method.apply(this, args);
      // Host event handlers call these void commands without awaiting a promise.
      void route(method, args, id).catch(error => { if (error?.name !== 'AbortError') onError(error); });
    };
    originals.set(name, { method, wrapped, own });
    sidebar[name] = wrapped;
  }
  return {
    mount(id) {
      const key = Symbol(id);
      surfaces.set(key, id);
      selected = key;
      return {
        activate() { if (surfaces.has(key)) selected = key; },
        release() { surfaces.delete(key); if (selected === key) selected = undefined; },
      };
    },
    committed(id) { if (pending?.id === id && mounted() === id) pending.resolve(); },
    dispose() {
      closed = true;
      abort();
      off();
      surfaces.clear();
      for (const [name, { method, wrapped, own }] of originals) {
        if (sidebar[name] !== wrapped) continue;
        if (own) sidebar[name] = method;
        else delete sidebar[name];
      }
    },
  };
}
