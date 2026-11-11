// A receipt can open the manager while the dashboard panel is unmounted.
let pending = null;
const listeners = new Set();
export function requestTask(id) { pending = id; for (const listener of listeners) listener(); }
export function takeTaskRequest() { const id = pending; pending = null; return id; }
export function subscribeTaskRequest(listener) { listeners.add(listener); return () => listeners.delete(listener); }
