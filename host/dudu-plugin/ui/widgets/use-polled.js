import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { widgetReadStore } from './data-store.mjs';

/**
 * One call to the plugin, repeated while the page is visible: `{ status: 'loading' | 'ready' | 'error', value }`. A failed repeat keeps
 * the value that is there; only a call that never worked reports the error. Session lists also expose `refreshing` and their last successful `updatedAt`.
 */
export function usePolled(request, action, body, { every = 10_000 } = {}) {
  const key = JSON.stringify([action, body]);
  const source = useMemo(() => widgetReadStore(request, action, body, every), [key, request]); // eslint-disable-line react-hooks/exhaustive-deps -- cadence changes keep the same query and snapshot
  const subscribe = useCallback((listener) => source.subscribe(listener, every), [source, every]);
  const snapshot = useSyncExternalStore(subscribe, source.getSnapshot, source.getSnapshot);
  return { ...snapshot, refresh: source.refresh };
}
