import { IssuesWidget } from '../issues/IssuesWidget.jsx';
import { useServices } from '../services.jsx';

/** The Issues widget as the dashboard places it: it reads the plugin through the page's services. */
export function IssuesCard() {
  const { request, openIssue } = useServices();
  return <IssuesWidget request={request} onOpen={openIssue} />;
}
