import { useEffect, useState } from 'react';

/**
 * One call to the plugin, repeated while the page is visible: `{ status: 'loading' | 'ready' | 'error', value }`. A failed repeat keeps
 * the value that is there; only a call that never worked reports the error.
 */
export function usePolled(request, action, body, { every = 10_000 } = {}) {
  const key = JSON.stringify([action, body]);
  const [state, setState] = useState({ key, status: 'loading', value: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await request(action, body);
        if (alive) setState({ key, status: 'ready', value });
      } catch { if (alive) setState((previous) => (previous.key === key && previous.value ? previous : { key, status: 'error', value: null })); }
    };
    load();
    const again = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(again, every);
    document.addEventListener('visibilitychange', again);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', again); };
  }, [key, request, every]); // eslint-disable-line react-hooks/exhaustive-deps -- `body` is represented by `key`
  return state.key === key ? state : { key, status: 'loading', value: null };
}
