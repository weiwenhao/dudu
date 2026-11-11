import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createCompletions } from './completion.js';

/**
 * Fill in context (completion.js) for the Collector widget: `start(record)` asks for it, `follow(id)` waits for one that is running already, `running` holds the ids of the records being
 * waited on and `ended.get(id)` counts how many completions of a record have ended (an open record is read again then). `onFailed()` says that it did not work.
 */
export function useCompletion(request, onFailed) {
  const completions = useMemo(() => createCompletions({ request }), [request]);
  useEffect(() => { completions.whenFailed(onFailed); }, [completions, onFailed]);
  useEffect(() => () => completions.stop(), [completions]);
  const { running, ended } = useSyncExternalStore(completions.subscribe, completions.getSnapshot);
  return { running, ended, start: completions.start, follow: completions.follow };
}
