import { useCallback, useEffect, useRef, useState } from 'react';
import { untilStarted } from '../lib/startup-grace.js';

/**
 * One call on opening or `reload()`; `update()` keeps a confirmed write in the local value without another read. A page can open while the plugin is still starting (a Desktop update reloads it under an open window,
 * and the routes come up phase by phase: this one of the General page 5 s after the others): a first read that has never worked keeps its loading state and asks again for a while (lib/startup-grace.js) before the
 * failure and its Retry are shown (owner, 2026-11-20: 「这一页没能加载」 in the middle of the General page right after the update). Retry and later reads ask once.
 */
export function useLoaded(request, action, body = {}) {
  const key = JSON.stringify([action, body]);
  const [state, setState] = useState({ key, status: 'loading', value: null });
  const [round, setRound] = useState(0);
  const worked = useRef(null); // the key of the last read that gave a value
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const read = () => request(action, body).then((value) => {
      if (['error', 'needs_clarification'].includes(value.outcome)) throw new Error(value.message);
      return value;
    });
    (round === 0 && worked.current !== key ? untilStarted(read, { signal: controller.signal }) : read()).then((value) => {
      worked.current = key;
      if (alive) setState({ key, status: 'ready', value });
    }).catch(() => { if (alive) setState((previous) => ({ key, status: previous.key === key && previous.value ? 'ready' : 'error', value: previous.key === key ? previous.value : null })); });
    return () => { alive = false; controller.abort(); };
  }, [key, round, request]); // eslint-disable-line react-hooks/exhaustive-deps -- `body` is represented by `key`
  const reload = useCallback(() => setRound((n) => n + 1), []);
  const update = useCallback((change) => setState((previous) => previous.value ? { ...previous, value: change(previous.value) } : previous), []);
  return { ...(state.key === key ? state : { status: 'loading', value: null }), reload, update };
}
