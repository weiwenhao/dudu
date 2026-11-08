import { useEffect, useState } from 'react';
import { abortable } from '../lib/abortable.js';

/** The Properties row and the conversation header use the same persisted native continuation identity. */
export function useIssueSession(request, issue) {
  const id = issue?.id;
  const key = issue?.session;
  const agent = issue?.agent;
  const [session, setSession] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    setSession(null);
    const read = async () => {
      let result;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      try {
        result = await abortable(request('issues/session', { id }, { signal }), signal);
        if (!controller.signal.aborted && result.outcome === 'success') setSession({ id, key, value: result });
      } catch { /* Retry a failed read while this issue stays open. */ }
      // Harness identity may arrive after DSH has already created its session.
      if (!controller.signal.aborted && (result?.outcome !== 'success' || (['claude', 'codex'].includes(agent) && !result.command))) {
        timer = setTimeout(read, 5000);
      }
    };
    if (key) void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, key, agent, request]);
  return session && session.id === id && session.key === key ? session.value : null;
}
