import { useCallback, useEffect, useRef, useState } from 'react';
import { receiveStatuses } from './workflow.js';

export const PAGE_SIZE = 50;
const MAX_LIMIT = 200;
const POLL_MS = 5000;

const empty = (key) => ({ key, status: 'loading', items: [], groups: null, total: 0, counts: null, cursor: null, error: null });

// A group of the store's answer as the page keeps it: its rows and the cursor of its next page, or its sub-groups.
const node = (group) => ({
  key: group.key, label: group.label, count: group.count, cursor: group.nextCursor ?? null,
  ...(group.groups ? { groups: group.groups.map(node) } : { items: group.items ?? [] }),
});

const leaves = (groups) => groups.flatMap((group) => (group.groups ? leaves(group.groups) : [group]));
const loaded = (state) => (state.groups ? Math.max(0, ...leaves(state.groups).map((group) => group.items.length)) : state.items.length);
const mapLeaves = (groups, change) => groups.map((group) => (group.groups ? { ...group, groups: mapLeaves(group.groups, change) } : change(group)));

/**
 * The issues of one view, fetched a page at a time (the store filters, orders, groups and counts; the browser only holds what
 * was asked for) and refreshed in place every few seconds while the page is visible. `request(action, body)` is the plugin's
 * POST helper. A flat view keeps one list and one cursor; a grouped view keeps a tree whose leaves each have their own rows
 * and cursor. A response that arrives after a newer request was sent is dropped.
 */
export function useIssueList(request, view, enabled = true) {
  const key = JSON.stringify(view);
  const [state, setState] = useState(() => empty(key));
  const latest = useRef(state);
  latest.current = state;
  const sequence = useRef(0);

  const fetchPage = useCallback(async (mode) => {
    const token = ++sequence.current;
    const current = latest.current.key === key ? latest.current : empty(key);
    // A refresh asks for everything already loaded in one go, so the list does not jump back to its first page.
    const limit = mode === 'refresh' ? Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, loaded(current))) : PAGE_SIZE;
    const body = mode === 'more' ? { ...view, limit, cursor: current.cursor } : { ...view, limit };
    try {
      const page = await request('issues/list', body);
      // The store answers a view it cannot read with an outcome and a message, not with an HTTP error.
      if (page.outcome !== 'success') throw new Error(page.message || 'The issues could not be listed.');
      if (token !== sequence.current) return;
      receiveStatuses(page.statuses);
      setState((previous) => ({
        key, status: 'ready', error: null,
        items: mode === 'more' && previous.key === key ? [...previous.items, ...page.items] : page.items,
        groups: page.groups ? page.groups.map(node) : null,
        total: page.total, counts: page.counts ?? null, cursor: page.nextCursor ?? null,
      }));
    } catch (error) {
      if (token !== sequence.current) return;
      // A failed refresh keeps what is on screen; only a view with nothing to show reports the failure.
      setState((previous) => (previous.key === key && (previous.items.length || previous.groups) ? previous : { ...previous, key, status: 'error', error }));
    }
  }, [key, request]); // eslint-disable-line react-hooks/exhaustive-deps -- `view` is represented by `key`

  useEffect(() => {
    if (!enabled) return undefined;
    // The rows of the view just left stay until the new ones arrive (no blank flash while a filter is ticked); their cursors do not.
    setState((previous) => (previous.key === key ? previous : {
      ...previous, key, status: previous.items.length || previous.groups ? 'ready' : 'loading', cursor: null, error: null,
      groups: previous.groups && mapLeaves(previous.groups, (leaf) => ({ ...leaf, cursor: null })),
    }));
    fetchPage('first');
    const poll = () => { if (document.visibilityState === 'visible') fetchPage('refresh'); };
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('dudu:session-read', poll);
    window.addEventListener('dudu:home-changed', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); window.removeEventListener('dudu:session-read', poll); window.removeEventListener('dudu:home-changed', poll); sequence.current++; };
  }, [fetchPage, key, enabled]);

  const loadingMore = useRef(new Set());
  const loadMore = useCallback(async () => {
    if (!latest.current.cursor || loadingMore.current.has('flat')) return;
    loadingMore.current.add('flat');
    try { await fetchPage('more'); } finally { loadingMore.current.delete('flat'); }
  }, [fetchPage]);

  // The next page of one leaf group: the store answers a flat page of just that group.
  const loadMoreIn = useCallback(async (path) => {
    const id = JSON.stringify(path);
    if (loadingMore.current.has(id)) return;
    const target = path.subKey === undefined ? latest.current.groups?.find((group) => group.key === path.key)
      : latest.current.groups?.find((group) => group.key === path.key)?.groups?.find((group) => group.key === path.subKey);
    if (!target?.cursor) return;
    loadingMore.current.add(id);
    const sent = sequence.current;
    try {
      const groupFilter = path.subKey === undefined ? { key: path.key } : { key: path.key, subKey: path.subKey };
      const page = await request('issues/list', { ...view, limit: PAGE_SIZE, groupFilter, cursor: target.cursor });
      // A refresh that landed meanwhile has already replaced this group's rows (and its cursor): this page no longer follows them.
      if (page.outcome !== 'success' || latest.current.key !== key || sequence.current !== sent) return;
      const append = (leaf) => {
        const have = new Set(leaf.items.map((issue) => issue.id));
        return { ...leaf, items: [...leaf.items, ...page.items.filter((issue) => !have.has(issue.id))], cursor: page.nextCursor ?? null };
      };
      setState((previous) => ({
        ...previous,
        groups: previous.groups.map((group) => {
          if (group.key !== path.key) return group;
          if (path.subKey === undefined) return append(group);
          return { ...group, groups: group.groups.map((sub) => (sub.key === path.subKey ? append(sub) : sub)) };
        }),
      }));
    } catch { /* the next scroll tries again */ } finally { loadingMore.current.delete(id); }
  }, [key, request, view]);

  const retry = useCallback(() => fetchPage('first'), [fetchPage]);
  const refresh = useCallback(() => fetchPage('refresh'), [fetchPage]);
  // Show a change at once; the refresh that follows the request puts the store's answer in its place.
  const patch = useCallback((id, changes) => setState((previous) => {
    const change = (item) => (item.id === id ? { ...item, ...changes } : item);
    return {
      ...previous, items: previous.items.map(change),
      groups: previous.groups && mapLeaves(previous.groups, (leaf) => ({ ...leaf, items: leaf.items.map(change) })),
    };
  }), []);
  // A card dropped on another lane is in it at once; the store's answer, a moment later, confirms that or puts the card back.
  const move = useCallback((id, toKey, changes) => setState((previous) => {
    const patched = (item) => (item.id === id ? { ...item, ...changes } : item);
    const lanes = previous.groups;
    const from = lanes?.find((lane) => lane.items?.some((item) => item.id === id));
    const to = lanes?.find((lane) => lane.key === toKey && lane.items);
    if (!from || !to || from === to) {
      return { ...previous, items: previous.items.map(patched), groups: lanes && mapLeaves(lanes, (leaf) => ({ ...leaf, items: leaf.items.map(patched) })) };
    }
    const card = patched(from.items.find((item) => item.id === id));
    return {
      ...previous, items: previous.items.map(patched),
      groups: lanes.map((lane) => {
        if (lane === from) return { ...lane, count: lane.count - 1, items: lane.items.filter((item) => item.id !== id) };
        return lane === to ? { ...lane, count: lane.count + 1, items: [card, ...lane.items] } : lane;
      }),
    };
  }), []);
  const stale = state.key !== key; // the one render between a view change and the effect above
  const hasRows = state.items.length > 0 || Boolean(state.groups?.length);
  return {
    status: stale && !hasRows ? 'loading' : state.status, items: state.items, groups: state.groups, total: state.total, counts: state.counts,
    hasMore: !stale && Boolean(state.cursor), error: state.error, loadMore, loadMoreIn, retry, refresh, patch, move,
  };
}
