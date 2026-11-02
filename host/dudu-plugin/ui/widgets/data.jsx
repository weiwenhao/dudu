import { useEffect, useMemo, useState } from 'react';
import { IssuesWidget } from '../issues/IssuesWidget.jsx';
import { useServices } from '../services.jsx';
import { usePolled } from './use-polled.js';

/** One capability face for built-in widgets, third-party slots and standalone fixture rendering. */
export function useWidgetData() {
  const services = useServices();
  return useMemo(() => ({
    useIssues: function useIssues(view = {}) { return usePolled(services.request, 'issues/list', view); },
    useQuota: function useQuota() { return usePolled(services.request, 'overview/usage', {}, { every: 120_000 }); },
    useInputs: function useInputs() { return usePolled(services.request, 'dispatch/state', {}, { every: 30_000 }); },
    useSessions: function useSessions(query = {}) {
      const [indexing, setIndexing] = useState(false);
      const result = usePolled(services.request, 'sessions/list', query, { every: indexing ? 2000 : 15_000 });
      useEffect(() => { setIndexing(Boolean(result.value?.indexing?.running)); }, [result.value]);
      return result;
    },
    openIssue: services.openIssue, openSession: services.openNativeSession, addSession: services.addSession,
    readSession: ({ provider, id, before }) => services.request('sessions/read', { provider, id, ...(before ? { before } : {}) }),
    takeOverSession: ({ provider, id }) => services.request('sessions/takeover', { provider, id }),
    renderIssues: () => <IssuesWidget request={services.request} onOpen={services.openIssue} onOpenSession={services.openIssueSession} onPreviewSession={services.previewIssueSession} />,
  }), [services]);
}

export function WidgetData({ Component, ...props }) {
  const data = useWidgetData();
  return <Component {...props} {...data} />;
}
