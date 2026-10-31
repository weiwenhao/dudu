import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 5000;

/**
 * One issue with its log (newest first, a page at a time), refreshed in place while the page is visible. Changes go through
 * `change(patch)`, `assign(agent)`, `snooze(until)`, `addNote(text)`, `reply(text)` and `undo(target)`; each answers with the store's
 * result when it has taken the change, and then reloads.
 */
export function useIssue(request, id) {
  const [state, setState] = useState({ id, status: 'loading', issue: null, log: [], nextLogCursor: null });
  const sequence = useRef(0);

  const load = useCallback(async (cursor) => {
    const token = ++sequence.current;
    try {
      const page = await request('issues/get', cursor ? { id, logCursor: cursor } : { id });
      if (token !== sequence.current) return;
      if (page.outcome !== 'success') { setState({ id, status: 'missing', issue: null, log: [], nextLogCursor: null }); return; }
      setState((previous) => {
        const same = previous.id === id;
        if (cursor && same) return { id, status: 'ready', issue: page.issue, log: [...previous.log, ...page.log], nextLogCursor: page.nextLogCursor ?? null };
        // A refresh brings the newest entries; the older ones the person already asked for stay where they were.
        const oldest = page.log.at(-1)?.id ?? Infinity;
        const older = same ? previous.log.filter((entry) => entry.id < oldest) : [];
        return { id, status: 'ready', issue: page.issue, log: [...page.log, ...older], nextLogCursor: older.length ? previous.nextLogCursor : page.nextLogCursor ?? null };
      });
    } catch {
      if (token === sequence.current) setState((previous) => (previous.issue ? previous : { ...previous, id, status: 'error' }));
    }
  }, [id, request]);

  useEffect(() => {
    setState((previous) => (previous.id === id ? previous : { id, status: 'loading', issue: null, log: [], nextLogCursor: null }));
    load();
    const poll = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); sequence.current++; };
  }, [id, load]);

  // Every change answers with the store's result (its `eventId` is what Undo is given) and then reloads, so the page shows what the store has.
  const send = useCallback(async (action, body) => { try { return await request(action, { id, ...body }); } finally { load(); } }, [id, load, request]);
  const show = useCallback((changes) => setState((previous) => (previous.issue ? { ...previous, issue: { ...previous.issue, ...changes } } : previous)), []); // at once; the reload corrects it
  const change = useCallback((patch) => { show(patch); return send('issues/update', { patch }); }, [send, show]);
  const assign = useCallback((agent) => { show({ agent }); return send('issues/assign', { agent }); }, [send, show]);
  const snooze = useCallback((until) => send('issues/snooze', { until }), [send]);
  const addNote = useCallback((text) => send('issues/log', { kind: 'note', text }), [send]);
  const reply = useCallback((text) => send('issues/reply', { text }), [send]);
  const undo = useCallback((target) => send('issues/undo', { target }), [send]);
  const loadEarlier = useCallback(() => { if (state.nextLogCursor) load(state.nextLogCursor); }, [load, state.nextLogCursor]);
  return { ...state, change, assign, snooze, addNote, reply, undo, loadEarlier, reload: load };
}
