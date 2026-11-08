// Labels (owner, 2026-11-05, after Linear): the page keeps the list of labels once, so that every chip, picker and filter reads the same names and colours,
// and refreshes it whenever a picker opens (an agent may have made a label meanwhile).
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** Linear's nine label colours, sampled from its colour menu; the store keeps the name of the colour. */
export const LABEL_COLORS = { grey: '#bec2c8', darkGrey: '#95a2b3', purple: '#5e6ad2', teal: '#26b5ce', green: '#4cb782', yellow: '#f2c94c', orange: '#f2994a', pink: '#f7c8c1', red: '#eb5757' };
export const colorOf = (name) => LABEL_COLORS[name] ?? LABEL_COLORS.darkGrey;

let labels = [];
let loaded = false;
let loading = null;
const listeners = new Set();
const emit = () => { for (const listener of listeners) listener(); };

export const labelStore = {
  list: () => labels,
  get: (id) => labels.find((label) => label.id === id) ?? null,
  /** The labels of an issue's ids, for a change shown before the store has answered. */
  resolve: (ids) => (ids ?? []).map((id) => labelStore.get(id)).filter(Boolean),
  set(next) { labels = next; loaded = true; emit(); },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};

export function loadLabels(request, force = false) {
  if (loading && !force) return loading;
  loading = request('issues/labels').then((result) => { if (result?.outcome === 'success') labelStore.set(result.labels); return result; }).finally(() => { loading = null; });
  return loading;
}

export function useLabels(request) {
  const list = useSyncExternalStore(labelStore.subscribe, labelStore.list);
  useEffect(() => { if (!loaded && request) loadLabels(request).catch(() => {}); }, [request]);
  const create = useCallback(async (name, color) => {
    const result = await request('issues/label-add', { fields: { name, color } });
    if (result?.outcome === 'success') labelStore.set(result.labels);
    return result;
  }, [request]);
  return { labels: list, create };
}
