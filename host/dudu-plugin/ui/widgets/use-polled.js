import { useMemo, useSyncExternalStore } from 'react';
import { widgetReadStore } from './data-store.mjs';

/**
 * One call to the plugin, repeated while the page is visible: `{ status: 'loading' | 'ready' | 'error', value }`. A failed repeat keeps
 * the value that is there; only a call that never worked reports the error.
 */
export function usePolled(request, action, body, { every = 10_000 } = {}) {
  const key = JSON.stringify([action, body]);
  const source = useMemo(() => widgetReadStore(request, action, body, every), [key, request, every]); // eslint-disable-line react-hooks/exhaustive-deps -- the query is represented by `key`
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}
