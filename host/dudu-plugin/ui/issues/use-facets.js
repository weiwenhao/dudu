import { useEffect, useState } from 'react';

/**
 * The options of the filter menu that the list does not count (agent, agent state, project, source), asked of the store while the
 * menu is open and again when the tab or the filter changes under it, so the counts show what ticking an option would give.
 */
export function useFacets(request, active, tab, filter) {
  const [facets, setFacets] = useState(null);
  const key = JSON.stringify({ tab, filter });
  useEffect(() => {
    if (!active) return undefined;
    let current = true;
    request('issues/facets', { tab, ...(filter ? { filter } : {}) })
      .then((page) => { if (current && page.outcome === 'success') setFacets(page.facets); })
      .catch(() => {}); // the menu still works with the counts it has
    return () => { current = false; };
  }, [active, key, request]); // eslint-disable-line react-hooks/exhaustive-deps -- `tab` and `filter` are in `key`
  return facets;
}
