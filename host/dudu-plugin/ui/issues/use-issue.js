import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 5000;

/**
 * One issue with its log (newest first, a page at a time), refreshed in place while the page is visible. Changes go through
 * `change(patch)` and `addNote(text)`; both answer when the store has taken them and then reload.
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
      setState((previous) => ({
        id, status: 'ready', issue: page.issue,
        log: cursor && previous.id === id ? [...previous.log, ...page.log] : page.log,
        nextLogCursor: page.nextLogCursor ?? null,
      }));
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

  const change = useCallback(async (patch) => {
    setState((previous) => (previous.issue ? { ...previous, issue: { ...previous.issue, ...patch } } : previous)); // at once; the reload corrects it
    try { await request('issues/update', { id, patch }); } finally { load(); }
  }, [id, load, request]);
  const addNote = useCallback(async (text) => {
    try { await request('issues/log', { id, kind: 'note', text }); } finally { load(); }
  }, [id, load, request]);
  const loadEarlier = useCallback(() => { if (state.nextLogCursor) load(state.nextLogCursor); }, [load, state.nextLogCursor]);
  return { ...state, change, addNote, loadEarlier, reload: load };
}
