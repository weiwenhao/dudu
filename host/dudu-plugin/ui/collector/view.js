import { useCallback, useState } from 'react';

export const TABS = ['todo', 'done', 'ignored'];
const DATES = ['day', 'week', 'month'];
const STORAGE_KEY = 'dudu.collector.view.v1';
const EMPTY = () => ({ tab: 'todo', filters: { todo: {}, done: {}, ignored: {} } });

/** What a stored filter may hold: connector ids, and one date range. Anything else is left out. */
function clean(filter) {
  const out = {};
  if (Array.isArray(filter?.connector)) {
    const ids = [...new Set(filter.connector.filter((id) => typeof id === 'string' && id))];
    if (ids.length) out.connector = ids;
  }
  if (Array.isArray(filter?.date) && DATES.includes(filter.date[0])) out.date = [filter.date[0]];
  return out;
}

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { tab: TABS.includes(stored?.tab) ? stored.tab : 'todo', filters: Object.fromEntries(TABS.map((tab) => [tab, clean(stored?.filters?.[tab])])) };
  } catch { return EMPTY(); }
}

/**
 * The tab the widget is on and the filter of each tab, remembered in this browser like the Issues views are (the doc keeps those in the
 * server's settings.json; they move together).
 */
export function useCollectorView() {
  const [view, setView] = useState(load);
  const update = useCallback((change) => setView((previous) => {
    const next = change(previous);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private window or blocked storage: it just is not remembered */ }
    return next;
  }), []);
  const setTab = useCallback((tab) => update((previous) => (TABS.includes(tab) ? { ...previous, tab } : previous)), [update]);
  const setFilter = useCallback((tab, change) => update((previous) => {
    const filter = clean(typeof change === 'function' ? change(previous.filters[tab] ?? {}) : change);
    return { ...previous, filters: { ...previous.filters, [tab]: filter } };
  }), [update]);
  const filterOf = useCallback((tab) => view.filters[tab] ?? {}, [view]);
  return { tab: view.tab, filterOf, setTab, setFilter };
}
