import { useCallback, useEffect, useState } from 'react';

/** One call to the plugin, made when the page opens and again whenever `reload()` is called: `{ status, value, reload }`. */
export function useLoaded(request, action, body = {}) {
  const key = JSON.stringify([action, body]);
  const [state, setState] = useState({ key, status: 'loading', value: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    request(action, body).then((value) => {
      if (['error', 'needs_clarification'].includes(value.outcome)) throw new Error(value.message);
      if (alive) setState({ key, status: 'ready', value });
    }).catch(() => { if (alive) setState((previous) => ({ key, status: previous.key === key && previous.value ? 'ready' : 'error', value: previous.key === key ? previous.value : null })); });
    return () => { alive = false; };
  }, [key, round, request]); // eslint-disable-line react-hooks/exhaustive-deps -- `body` is represented by `key`
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { ...(state.key === key ? state : { status: 'loading', value: null }), reload };
}
