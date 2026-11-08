import { useCallback, useEffect, useState } from 'react';

export const PAGE = 50;
const EVERY = 20_000;

/**
 * The rows of one tab under one filter, read again every 20 seconds while the page is visible and after every `refresh()`. `pages` is how many
 * pages of 50 are wanted (the list is asked for the first 50 × pages each time, so a row that changed under the owner's eyes changes in place).
 * -> { status: 'loading' | 'ready' | 'error', value: { items, nextCursor, facets } | null, refresh }. A failed repeat keeps what is shown.
 */
export function useRecords(request, { tab, filter, pages }) {
  const key = JSON.stringify([tab, filter, pages]);
  const [state, setState] = useState({ key: null, status: 'loading', value: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    let timer;
    const read = async () => {
      if (document.visibilityState !== 'hidden') {
        try {
          const result = await request('inbox/list', { tab, ...(Object.keys(filter).length ? { filter } : {}), limit: PAGE * pages });
          if (!live) return;
          if (result?.outcome !== 'success') throw new Error(result?.message ?? 'unavailable');
          setState({ key, status: 'ready', value: result });
        } catch {
          if (live) setState((current) => (current.key === key && current.value ? current : { key, status: 'error', value: null }));
        }
      }
      if (live) timer = setTimeout(read, EVERY);
    };
    read();
    return () => { live = false; clearTimeout(timer); };
  }, [request, key, revision]); // eslint-disable-line react-hooks/exhaustive-deps -- the query is `key`
  const refresh = useCallback(() => setRevision((count) => count + 1), []);
  // What was read for another tab or filter is not shown for this one.
  const current = state.key === key ? state : { key, status: 'loading', value: null };
  return { status: current.status, value: current.value, refresh };
}
