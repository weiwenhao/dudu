import { useCallback, useEffect, useState } from 'react';

const TIMEOUT_MS = 10_000;
// DSH's content index may still be building: the answer says so (`sessions.indexing`) and is asked for again until it is built, as the phone's search does.
const INDEXING_RETRY_MS = 2000;
const INDEXING_RETRIES = 30;

/** `value` once it has stood still for `ms`: the words typed are asked for when the typing pauses. While `hold` is on (an input method is still composing) it waits. */
export function useSettled(value, ms, hold = false) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (hold) return undefined;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms, hold]);
  return settled;
}

const NOTHING = { value: null, answered: null, failed: null };

/**
 * The answer of `search/query` (the plugin's one request for the three places: assistant/home/search.mjs) to `body`; null asks nothing. The newest question wins: an older one that is still
 * on its way is cancelled, and until the answer to the newest comes the last answer stays in `value` (`status` is 'loading'), so that the list does not blink while words are typed.
 * `status` is 'idle' | 'loading' | 'ready' | 'error'; `retry()` asks again. Which question an answer or a failure belongs to is kept with it (`answered`, `failed`), and the status is read from that.
 */
export function useSearchAnswer(request, body) {
  const key = body ? JSON.stringify(body) : null;
  const [revision, setRevision] = useState(0);
  const question = key === null ? null : `${revision}:${key}`; // the same words asked for again are another question
  const [state, setState] = useState(NOTHING);
  if (question === null && state.value !== null) setState(NOTHING); // nothing to ask: what was answered before is forgotten, so that it does not show for the next question
  useEffect(() => {
    if (key === null) return undefined;
    const controller = new AbortController();
    let timer = null;
    let tries = 0;
    const ask = async () => {
      try {
        const answer = await request('search/query', JSON.parse(key), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
        if (controller.signal.aborted) return;
        if (answer?.outcome !== 'success') throw new Error('unavailable');
        setState({ value: answer, answered: question, failed: null });
        if (answer.sessions?.indexing === true && tries++ < INDEXING_RETRIES) timer = setTimeout(ask, INDEXING_RETRY_MS);
      } catch {
        if (!controller.signal.aborted) setState((current) => ({ ...current, failed: question }));
      }
    };
    void ask();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [request, key, question]);
  const retry = useCallback(() => setRevision((count) => count + 1), []);
  const status = question === null ? 'idle' : state.answered === question ? 'ready' : state.failed === question ? 'error' : 'loading';
  return { status, value: question === null ? null : state.value, retry };
}
