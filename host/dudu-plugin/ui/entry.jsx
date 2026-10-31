// What the plugin shell (client.js) gets from the built interface: its stylesheet and the page for the 嘟嘟 panel.
import { useState } from 'react';
import { Scope } from './lib/scope.jsx';
import { IssueDetail } from './issues/IssueDetail.jsx';
import { IssuesWidget } from './issues/IssuesWidget.jsx';

// Replaced by scripts/build-client.mjs with the compiled, `.dudu`-scoped Tailwind output.
export const css = __DUDU_CSS__;

/**
 * The 嘟嘟 panel: the Issues widget, which for now fills the page, and one issue's page in its place when a row is opened.
 * `request` is the shell's POST helper; `logo` is the 嘟嘟 mark the shell already carries.
 */
export function Page({ request, logo }) {
  const [route, setRoute] = useState({ name: 'issues' });
  const openIssue = (id, ids = route.ids ?? []) => setRoute({ name: 'issue', id, ids });
  return (
    <Scope>
      {route.name === 'issue' ? (
        <IssueDetail request={request} id={route.id} ids={route.ids} logo={logo} onBack={() => setRoute({ name: 'issues' })} onOpen={openIssue} />
      ) : (
        <div className="flex h-full min-h-0 flex-col p-6">
          <IssuesWidget request={request} onOpen={openIssue} />
        </div>
      )}
    </Scope>
  );
}
