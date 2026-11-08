import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the page waits before it reads the connectors again while one of them waits for the browser or is being checked. */
export const POLL_MS = 1500;

const failed = (answer) => !answer || ['error', 'needs_clarification'].includes(answer.outcome);

/**
 * What the connectors page shows, read together: what Dudu offers that is not connected yet (`connectors/catalog`) and what is connected
 * (`connectors/list`). While any connector waits for the browser or is being checked they are read again every 1.5 s, and when none does that stops.
 * Returns `{ status, value: { groups, connectors } | null, reload }`; `reload()` reads them now and gives back what it read (null if it could not).
 */
export function useConnectors(request) {
  const [state, setState] = useState({ status: 'loading', value: null });
  const alive = useRef(true);
  const started = useRef(0); // the number of the latest read that was started
  const shown = useRef(0); // the number of the latest read that was shown: a slow, older read never replaces a newer one
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** The two answers, or null when either could not be had. */
  const read = useCallback(async () => {
    try {
      const [catalog, list] = await Promise.all([request('connectors/catalog', {}), request('connectors/list', {})]);
      if (failed(catalog) || failed(list)) return null;
      return { groups: catalog.groups ?? [], connectors: list.connectors ?? [] };
    } catch { return null; }
  }, [request]);
  const show = useCallback((number, value) => {
    if (!alive.current) return;
    // a page that was read once keeps what it showed; only a page that never was read says so
    if (value === null) setState((previous) => (previous.value ? previous : { status: 'error', value: null }));
    else if (number > shown.current) { shown.current = number; setState({ status: 'ready', value }); }
  }, []);
  const reload = useCallback(async () => {
    const number = ++started.current;
    const value = await read();
    show(number, value);
    return value;
  }, [read, show]);

  useEffect(() => {
    let current = true;
    const number = ++started.current;
    read().then((value) => { if (current) show(number, value); });
    return () => { current = false; };
  }, [read, show]);

  // Read again while a connector waits for the browser, and while the host is still checking one (a command-line tool, a server that needs no sign-in): its state is not there yet.
  const waiting = state.value?.connectors.some((connector) => connector.state?.status === 'waiting' || connector.busy === true) ?? false;
  useEffect(() => {
    if (!waiting) return undefined;
    let stopped = false;
    let timer;
    const tick = async () => {
      await reload();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [waiting, reload]);

  return { ...state, reload };
}
