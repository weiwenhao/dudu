// What the plugin shell (client.js) gets from the built interface: its stylesheet and the page for the 嘟嘟 panel.
import { useState } from 'react';
import { ToastProvider } from './components/toast.jsx';
import { Scope } from './lib/scope.jsx';
import { IssueDetail } from './issues/IssueDetail.jsx';
import { IssuesWidget } from './issues/IssuesWidget.jsx';

// Replaced by scripts/build-client.mjs with the compiled, `.dudu`-scoped Tailwind output.
export const css = __DUDU_CSS__;

/**
 * The 嘟嘟 panel: the Issues widget, which for now fills the page, and one issue's page in its place when a row is opened.
 * `request` is the shell's POST helper; `logo` is the 嘟嘟 mark the shell already carries; `actions.openSession(issue)` opens an
 * issue's session in DSH (the shell knows how).
 */
export function Page({ request, logo, actions = {} }) {
  const [route, setRoute] = useState({ name: 'issues' });
  const openIssue = (id, ids = route.ids ?? []) => setRoute({ name: 'issue', id, ids });
  return (
    <Scope>
      <ToastProvider>
        {route.name === 'issue' ? (
          <IssueDetail request={request} id={route.id} ids={route.ids} logo={logo} onBack={() => setRoute({ name: 'issues' })} onOpen={openIssue} openSession={actions.openSession} />
        ) : (
          <div className="flex h-full min-h-0 flex-col p-6">
            <IssuesWidget request={request} onOpen={openIssue} />
          </div>
        )}
      </ToastProvider>
    </Scope>
  );
}
