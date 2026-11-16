export { sessionStateForActivity as sidebarSessionState } from '../../../assistant/sessions/session-state.mjs';

/** One bounded read for the mounted sidebar rows, shared across their subscriptions. */
export function createSidebarActivity(request) {
  const entries = new Map();
  let timer;
  let queued = false;
  let reading = false;
  let closed = false;
  const refresh = async () => {
    queued = true;
    if (closed || reading || document.visibilityState === 'hidden') return;
    reading = true;
    try {
      while (queued && !closed) {
        queued = false;
        const roster = [...entries];
        for (let offset = 0; offset < roster.length && !closed; offset += 200) {
          const batch = roster.slice(offset, offset + 200);
          try {
            const result = await request('sessions/activity', { sessionIds: batch.map(([id]) => id) });
            if (closed) return;
            for (const [id, entry] of batch) {
              if (entries.get(id) !== entry) continue;
              const next = result.states?.[id] ?? null;
              if (JSON.stringify(next) === JSON.stringify(entry.snapshot)) continue;
              entry.snapshot = next;
              for (const listener of entry.listeners) listener();
            }
          } catch { /* Keep the last observation until the connection recovers. */ }
        }
      }
    } finally { reading = false; }
  };
  const schedule = () => {
    if (queued || closed) return;
    queued = true;
    queueMicrotask(() => { void refresh(); });
  };
  const focus = () => { void refresh(); };
  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
    window.removeEventListener('focus', focus);
    window.removeEventListener('dudu:session-read', focus);
    document.removeEventListener('visibilitychange', focus);
  };
  return {
    refresh,
    forSession(id) {
      return {
        getSnapshot: () => entries.get(id)?.snapshot ?? null,
        subscribe(listener) {
          let entry = entries.get(id);
          if (!entry) { entry = { listeners: new Set(), snapshot: null }; entries.set(id, entry); }
          entry.listeners.add(listener);
          if (!timer) {
            timer = setInterval(() => { void refresh(); }, 5000);
            window.addEventListener('focus', focus);
            window.addEventListener('dudu:session-read', focus);
            document.addEventListener('visibilitychange', focus);
          }
          schedule();
          return () => {
            entry.listeners.delete(listener);
            if (entry.listeners.size) return;
            entries.delete(id);
            if (!entries.size) stop();
          };
        },
      };
    },
    dispose() {
      closed = true;
      stop();
      entries.clear();
    },
  };
}
