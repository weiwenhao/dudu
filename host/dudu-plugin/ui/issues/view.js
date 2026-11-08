import { useCallback, useState } from 'react';
import { storeFilter } from './dates.js';

const DAY = 86400000;
const HOUR = 3600000;

export const PROPERTY_ORDER = ['id', 'status', 'agent', 'priority', 'project', 'labels', 'dueDate', 'source', 'created', 'updated'];

// What one tab shows besides its rows. Agent state is the default grouping; each tab remembers the owner's choices.
export const DEFAULT_VIEW = {
  filter: {},
  layout: 'list', // 'list' | 'board'
  group: 'agentState', // list: Grouping; board: Columns (null reads as Agent state)
  subGroup: null, // list: Sub-grouping; board: Rows
  reverseGroups: false,
  order: 'priority',
  reverse: false,
  recency: null, // Order completed by recency: null follows the tab (on for All issues), true/false is the person's choice
  completed: 'all', // Completed issues: 'all' | 'day' | 'week' | 'month' | 'none'
  showEmpty: false,
  properties: { id: true, status: true, agent: true, priority: true, project: true, labels: true, dueDate: true, source: false, created: false, updated: false },
};

const COMPLETED_DAYS = { day: 1, week: 7, month: 30 };

/**
 * The body of `issues/list` for a tab and its view, leaving out what is the default. "Completed issues" becomes a time the
 * store compares with when issues were finished; it is rounded to the hour so the request, and with it the list, does not
 * change on every render.
 */
export function listRequest(tab, view, now = Date.now(), search = '') {
  const request = { tab };
  const filter = storeFilter(view.filter, now);
  if (/[\p{L}\p{N}]/u.test(search)) filter.q = search.trim(); // a search with no word in it would only be refused
  if (view.completed === 'none') filter.completedFrom = Number.MAX_SAFE_INTEGER;
  else if (COMPLETED_DAYS[view.completed]) filter.completedFrom = Math.floor(now / HOUR) * HOUR - COMPLETED_DAYS[view.completed] * DAY;
  if (Object.keys(filter).length) request.filter = filter;
  const group = view.layout === 'board' ? (view.group ?? 'agentState') : view.group;
  if (group) request.group = group;
  if (view.subGroup && view.subGroup !== group) request.subGroup = view.subGroup;
  if (view.order !== DEFAULT_VIEW.order) request.order = view.order;
  if (view.reverse) request.reverse = true;
  // The store's own default is on for All issues and off elsewhere; only a different choice is sent.
  const recency = view.recency ?? tab === 'all';
  if (recency !== (tab === 'all')) request.completedLast = recency;
  return request;
}

/** Whether the display options (not the filter) differ from the defaults: the blue dot on the Display options button. */
export function displayChanged(view) {
  return ['layout', 'group', 'subGroup', 'reverseGroups', 'order', 'reverse', 'recency', 'completed', 'showEmpty'].some((key) => view[key] !== DEFAULT_VIEW[key])
    || PROPERTY_ORDER.some((key) => view.properties[key] !== DEFAULT_VIEW.properties[key]);
}

const STORAGE_KEY = 'dudu.issues.views.v1';

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const migrated = migrateViews(stored);
    if (JSON.stringify(migrated) !== JSON.stringify(stored)) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* storage may be read-only */ }
    }
    return migrated;
  } catch { return {}; }
}

export function migrateViews(stored) {
  return Object.fromEntries(Object.entries(stored).filter(([, view]) => view && typeof view === 'object' && !Array.isArray(view)).map(([tab, view]) => {
    if (view.agentGroupingVersion) return [tab, view];
    const group = view.group == null || view.group === 'status' ? 'agentState' : view.group;
    return [tab, { ...view, group, ...(view.subGroup === group ? { subGroup: null } : {}), agentGroupingVersion: 1 }];
  }));
}

const complete = (view) => ({
  ...DEFAULT_VIEW, ...view,
  agentGroupingVersion: 1,
  filter: {
    ...view?.filter,
    ...(Array.isArray(view?.filter?.agentState) ? {
      agentState: [...new Set(view.filter.agentState.map((state) => ['needs_you', 'stuck', 'done'].includes(state) ? 'blocked' : state))],
    } : {}),
  },
  properties: { ...DEFAULT_VIEW.properties, ...view?.properties },
});

/** The view of every tab, remembered in this browser (the doc keeps it in the server's settings.json; that comes with them). */
export function useViews() {
  const [views, setViews] = useState(load);
  const update = useCallback((tab, change) => setViews((previous) => {
    const current = complete(previous[tab]);
    const next = { ...previous, [tab]: complete({ ...current, ...(typeof change === 'function' ? change(current) : change) }) };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private window or blocked storage: it just is not remembered */ }
    return next;
  }), []);
  const viewOf = useCallback((tab) => complete(views[tab]), [views]);
  return { viewOf, update };
}
