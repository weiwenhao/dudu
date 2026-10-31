// What the plugin shell (client.js) gets from the built interface: its stylesheet and the page for the 嘟嘟 panel.
import { useCallback, useMemo, useState } from 'react';
import { ToastProvider } from './components/toast.jsx';
import { Dashboard } from './dashboard/Dashboard.jsx';
import { IssueDetail } from './issues/IssueDetail.jsx';
import { Scope } from './lib/scope.jsx';
import { ServicesProvider } from './services.jsx';
import { REGISTRY } from './widgets/index.js';

// Replaced by scripts/build-client.mjs with the compiled, `.dudu`-scoped Tailwind output.
export const css = __DUDU_CSS__;

/**
 * The 嘟嘟 panel: the dashboard (widgets on a grid; Issues fills it until it is pulled smaller), and one issue's page in its place
 * when an issue is opened. `request` is the shell's POST helper; `logo` is the 嘟嘟 mark the shell already carries;
 * `actions.openSession({ sessionId, workspaceId })` opens a session in DSH (the shell knows how).
 */
export function Page({ request, logo, actions = {} }) {
  const [route, setRoute] = useState({ name: 'dashboard' });
  // `ids` is the list the person came from; stepping to the next issue passes none and keeps the one already held.
  const openIssue = useCallback((id, ids) => setRoute((current) => ({ name: 'issue', id, ids: ids ?? current.ids ?? [] })), []);
  // A session the harness has on this computer is loaded into DSH first (unless it already lives there), then opened.
  const openNativeSession = useCallback(async (session) => {
    const target = session.dshSessionId ? { sessionId: session.dshSessionId } : await request('sessions/load', { provider: session.provider, id: session.id });
    await actions.openSession?.(target);
  }, [request, actions]);
  // An issue names its session as `claude:<id>`, `codex:<id>` or `dsh:<id>`.
  const openIssueSession = useCallback(async (issue) => {
    const [provider, ...rest] = String(issue.session ?? '').split(':');
    const id = rest.join(':');
    if (!id) return;
    if (provider === 'dsh') await actions.openSession?.({ sessionId: id });
    else await openNativeSession({ provider, id });
  }, [actions, openNativeSession]);
  const services = useMemo(() => ({ request, openIssue, openNativeSession, openIssueSession }), [request, openIssue, openNativeSession, openIssueSession]);
  return (
    <Scope>
      <ToastProvider>
        <ServicesProvider value={services}>
          {route.name === 'issue' ? (
            <IssueDetail request={request} id={route.id} ids={route.ids} logo={logo} onBack={() => setRoute({ name: 'dashboard' })} onOpen={openIssue} openSession={openIssueSession} />
          ) : (
            <Dashboard request={request} registry={REGISTRY} />
          )}
        </ServicesProvider>
      </ToastProvider>
    </Scope>
  );
}
