// What the conversations' headers read (`SessionTasks.jsx`): one reading of the task list shared by every header that is on screen, started with the first one and stopped with the last (nothing is read while no
// header is mounted or while the page is hidden). `forSession(id)` is an external store of that conversation's tasks by status (`session-tasks.js`) whose snapshot stays the same object while nothing in it changed.
import { sessionTasks } from './session-tasks.js';

const EMPTY = Object.freeze({ active: [], paused: [], ended: [] });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TIMEOUT = 15_000;

export function createSessionTasks(request, { period = 5000 } = {}) {
  const listeners = new Set();
  const cache = new Map(); // conversation id -> the snapshot made at `version`
  let all = [];
  let version = 0;
  let reading = null;
  let timer = null;
  let abort = null;

  const emit = () => { for (const listener of [...listeners]) listener(); };
  const awake = () => document.visibilityState !== 'hidden';

  function refresh() {
    if (reading) return reading;
    abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(TIMEOUT)]);
    reading = (async () => {
      try {
        const result = await request('tasks/list', {}, { signal });
        if (result.outcome !== 'success' || !Array.isArray(result.tasks) || same(result.tasks, all)) return;
        all = result.tasks;
        version++;
        emit();
      } catch { /* the next reading tries again */ } finally { reading = null; }
    })();
    return reading;
  }
  /** After a change of ours: the reading that was on its way may predate it, so wait for it and read again. */
  async function reread() {
    if (reading) await reading;
    await refresh();
  }
  const wake = () => { if (awake()) void refresh(); };

  function subscribe(listener) {
    listeners.add(listener);
    if (listeners.size === 1) {
      void refresh();
      timer = setInterval(wake, period);
      document.addEventListener('visibilitychange', wake);
      window.addEventListener('focus', wake);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size) return;
      clearInterval(timer); timer = null;
      abort?.abort();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }

  function snapshot(sessionId) {
    const cached = cache.get(sessionId);
    if (cached?.version === version) return cached.value;
    const next = sessionId ? sessionTasks(all, sessionId) : EMPTY;
    const value = cached && same(cached.value, next) ? cached.value : next;
    if (cache.size > 64) cache.clear();
    cache.set(sessionId, { version, value });
    return value;
  }

  return {
    forSession: (sessionId) => ({ subscribe, getSnapshot: () => snapshot(sessionId) }),
    /** `pause`, `resume`, `run` or `delete` of a task as it was read (its revision): true when the plugin did it. */
    async act(action, task) {
      try {
        const result = await request(`tasks/${action}`, { id: task.id, revision: task.revision }, { signal: AbortSignal.timeout(TIMEOUT) });
        await reread();
        return result.outcome === 'success';
      } catch { return false; }
    },
    /** The runs of a task, the latest first (the tasks window's 任务运行记录). */
    async history(id, signal) {
      const result = await request('tasks/history', { id }, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT) });
      if (result.outcome !== 'success' || !Array.isArray(result.runs)) throw new Error(result.code ?? 'unavailable');
      return result.runs;
    },
    refresh,
    dispose() { listeners.clear(); clearInterval(timer); timer = null; abort?.abort(); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); },
  };
}
