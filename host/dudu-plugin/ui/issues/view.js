import { useCallback, useState } from 'react';
import { storeFilter } from './dates.js';

const DAY = 86400000;
const HOUR = 3600000;

export const PROPERTY_ORDER = ['id', 'status', 'agent', 'priority', 'project', 'labels', 'dueDate', 'source', 'created', 'updated'];

// What one tab shows besides its rows. Issue workflow is the default grouping; each tab remembers the owner's choices.
export const DEFAULT_VIEW = {
  filter: {},
  layout: 'chat', // 'list' | 'board' | 'chat'
  group: 'status', // list: Grouping; board: Columns (null reads as issue workflow)
  subGroup: null, // list: Sub-grouping; board: Rows
  reverseGroups: false,
  order: 'updated',
  reverse: false,
  recency: null, // Order completed by recency: null follows the tab (on for All issues), true/false is the person's choice
  completed: 'all', // Completed issues: 'all' | 'day' | 'week' | 'month' | 'none'
  showEmpty: false,
  listUpdated: true, // The list always starts with the shared phone message time; board properties stay independent.
  properties: { id: true, status: true, agent: true, priority: true, project: true, labels: true, dueDate: true, source: false, created: false, updated: false },
};

const COMPLETED_DAYS = { day: 1, week: 7, month: 30 };

/**
 * The body of `issues/list` for a tab and its view, leaving out what is the default. "Completed issues" becomes a time the
 * store compares with when issues were finished; it is rounded to the hour so the request, and with it the list, does not
 * change on every render.
 */
export function listRequest(tab, view, now = Date.now(), search = '') {
  // 未读 is about reading, not workflow. The conversation list asks the home for it; the other layouts ask the issue store for the issues whose session is unread.
  const unreadScope = tab === 'unread' && view.layout !== 'chat';
  const request = { tab: unreadScope ? 'all' : tab };
  const filter = storeFilter(view.filter, now);
  if (unreadScope) filter.sessionState = ['unread'];
  // The desktop's Updated control follows the phone's completed-message clock.
  for (const edge of ['From', 'To']) {
    if (filter[`updated${edge}`] !== undefined) {
      filter[`received${edge}`] = filter[`updated${edge}`];
      delete filter[`updated${edge}`];
    }
  }
  if (/[\p{L}\p{N}]/u.test(search)) filter.q = search.trim(); // a search with no word in it would only be refused
  if (view.completed === 'none') filter.completedFrom = Number.MAX_SAFE_INTEGER;
  else if (COMPLETED_DAYS[view.completed]) filter.completedFrom = Math.floor(now / HOUR) * HOUR - COMPLETED_DAYS[view.completed] * DAY;
  if (Object.keys(filter).length) request.filter = filter;
  if (view.layout === 'chat') return { ...request, order: 'received', completedLast: false };
  const group = view.layout === 'board' ? (view.group ?? 'status') : view.group;
  if (group) request.group = group;
  if (view.subGroup && view.subGroup !== group) request.subGroup = view.subGroup;
  // Send the UI's choice explicitly: the issue API keeps its independent priority default.
  request.order = view.order === 'updated' ? 'received' : view.order;
  if (view.reverse) request.reverse = true;
  if (view.layout === 'list') request.pinnedFirst = true;
  // The store's own default is on for All issues and off elsewhere; only a different choice is sent.
  const recency = view.recency ?? (tab === 'all' && view.order !== 'updated');
  if (recency !== (request.tab === 'all')) request.completedLast = recency;
  return request;
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
    const { agentState, ...filter } = view.filter ?? {};
    if (Array.isArray(agentState)) filter.sessionState = [...new Set(agentState.map((state) => ({ working: 'processing', idle: 'idle', unassigned: 'unassigned' }[state] ?? 'unread')))];
    const field = (value) => value === 'agentState' ? 'sessionState' : value;
    const previousGroup = field(view.group);
    // Replace the former default once. Subsequent explicit session/no-grouping choices survive.
    const group = !view.workflowGroupingVersion && (previousGroup === undefined || previousGroup === 'sessionState')
      ? 'status' : previousGroup ?? ((view.sessionGroupingVersion || view.agentGroupingVersion || view.workflowGroupingVersion) ? null : 'status');
    const { agentGroupingVersion: _oldVersion, ...rest } = view;
    return [tab, { ...rest, group, subGroup: field(view.subGroup) === group ? null : field(view.subGroup), filter, sessionGroupingVersion: 1, workflowGroupingVersion: 1 }];
  }));
}

const complete = (view) => {
  const migrated = migrateViews({ current: view ?? {} }).current;
  return { ...DEFAULT_VIEW, ...migrated, properties: { ...DEFAULT_VIEW.properties, ...migrated.properties } };
};

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
