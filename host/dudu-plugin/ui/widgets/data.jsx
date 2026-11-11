import { useEffect, useMemo, useState } from 'react';
import { IssuesWidget } from '../issues/IssuesWidget.jsx';
import { useServices } from '../services.jsx';
import { usePolled } from './use-polled.js';
import { widgetReadStore } from './data-store.mjs';
import { sessionReader } from '../sessions/session-reader.js';

/**
 * Reads the sessions list once in the background, so that the session window opens with it instead of an empty "loading": the read is kept by the same source the window
 * uses (the window then only brings it up to date, quietly). One read; nothing is polled afterwards. `body` is the window's own question. Returns what stops it.
 */
export function warmSessions(request, body = { query: '', limit: 500 }) {
  const source = widgetReadStore(request, 'sessions/list', body, 15_000);
  let stop = () => {};
  let done = false;
  stop = source.subscribe(() => {
    if (!done && source.getSnapshot().status !== 'loading') { done = true; queueMicrotask(() => stop()); }
  }, 600_000);
  return () => { done = true; stop(); };
}

/** One capability face for built-in widgets, third-party slots and standalone fixture rendering. */
export function useWidgetData() {
  const services = useServices();
  return useMemo(() => ({
    useIssues: function useIssues(view = {}) { return usePolled(services.request, 'issues/list', view); },
    // What the quota service has kept (the header icon's panel and the chat's card are what ask for a reading; a widget only looks, so it asks for nothing).
    useQuota: function useQuota() { return usePolled(services.request, 'quota/get', {}, { every: 60_000 }); },
    useInputs: function useInputs() { return usePolled(services.request, 'dispatch/state', {}, { every: 30_000 }); },
    useSessions: function useSessions(query = {}) {
      const [indexing, setIndexing] = useState(false);
      const result = usePolled(services.request, 'sessions/list', query, { every: indexing ? 2000 : 15_000 });
      // An unanswered request is not evidence that indexing stopped; cadence changes keep the same answer source.
      useEffect(() => { if (result.status === 'ready') setIndexing(Boolean(result.value?.indexing?.running)); }, [result.status, result.value]);
      return result;
    },
    openIssue: services.openIssue, openSession: services.openNativeSession, addSession: services.addSession,
    readSession: sessionReader(services.request),
    takeOverSession: ({ provider, id }) => services.request('sessions/takeover', { provider, id }),
    renderIssues: () => <IssuesWidget request={services.request} onOpen={services.openIssue} onOpenSession={services.openIssueSession} onPreviewSession={services.previewIssueSession} />,
  }), [services]);
}

export function WidgetData({ Component, ...props }) {
  const data = useWidgetData();
  return <Component {...props} {...data} />;
}
