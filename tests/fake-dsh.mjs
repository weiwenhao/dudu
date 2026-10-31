// DSH as the sessions of issues see it (host/assistant/home/agent-sessions.mjs): every call is noted, the events are told by the test.
// What DSH itself does is tried in a real DSH by tests/e2e/agent-sessions.e2e.test.ts.
export const CATALOG = {
  default: { provider: 'deepseek-official', model: 'deepseek-flash' },
  groups: [
    { id: 'claude', models: [{ id: 'opus' }, { id: 'default' }, { id: 'haiku' }] },
    { id: 'codex', models: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-5.5' }] },
    { id: 'deepseek-official', models: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] },
  ],
};

export function fakeDsh({ catalog = CATALOG, turns = new Map() } = {}) {
  const calls = [];
  const running = new Set();
  const archived = new Set();
  const failures = new Map();
  let handlers = null;
  let next = 0;
  const note = (...call) => { calls.push(call); const failure = failures.get(String(call[0])); if (failure) throw failure; };
  const dsh = {
    async models() { note('models'); return catalog; },
    async createSession(options) { note('createSession', options); return { sessionId: `s${++next}` }; },
    async selectModel(id, selection) { note('selectModel', id, selection); },
    async setAccess(id, mode) { note('setAccess', id, mode); },
    async prompt(id, text, options) { note('prompt', id, text, options); },
    async cancel(id) { note('cancel', id); },
    async archive(id, options = {}) {
      note('archive', id, options);
      if (running.has(id) && !options.stop) throw Object.assign(new Error('the session is active (turn)'), { code: 'ACTIVE' });
      const open = !archived.has(id);
      archived.add(id);
      return open;
    },
    async unarchive(id) { note('unarchive', id); return archived.delete(id); },
    async workspaceOf(id) { return `ws-of-${id}`; },
    async lastTurn(id) { return turns.get(id) ?? null; },
    watch(given) { handlers = given; calls.push(['watch']); return () => { handlers = null; calls.push(['unwatch']); }; },
  };
  const say = {
    status(id, value) { if (value) running.add(id); else running.delete(id); handlers?.status(id, value); },
    turnEnd(id, end) { handlers?.turnEnd(id, end); },
    assistant(id, text) { handlers?.assistant(id, text); },
    /** A question of the agent, the way the adapter relays it: held until it is answered, then closed. */
    ask(id, text, signal, kind) {
      const waiter = handlers?.question(id, { text, kind, signal });
      if (!waiter) return waiter;
      const answer = waiter.answer.then((words) => { waiter.close(); return words; });
      answer.catch(() => {}); // a question that is given up is not an unhandled rejection
      return { answer, close: waiter.close };
    },
    /** A whole turn that ends well, as DSH tells it: the words, the end of the turn, then the loop idle. */
    answer(id, text) { this.status(id, true); this.assistant(id, text); this.turnEnd(id, { kind: 'completed' }); this.status(id, false); },
    owns: (id) => handlers?.owns(id),
  };
  return { dsh, calls, say, failures, running, archived, ofKind: (kind) => calls.filter(([name]) => name === kind) };
}
