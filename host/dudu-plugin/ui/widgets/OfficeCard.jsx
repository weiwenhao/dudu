import { useServices } from '../services.jsx';
import { OfficeWidget } from './office/OfficeWidget.jsx';
import { usePolled } from './use-polled.js';

/** The Office as the dashboard places it: the Active issues in the Issues default order, and a click on a person opens the issue. */
export function OfficeCard({ size, editing }) {
  const { request, openIssue } = useServices();
  const { value } = usePolled(request, 'issues/list', { tab: 'active', limit: 200 }, { every: 5_000 });
  const issues = value?.items ?? [];
  return <OfficeWidget size={size} issues={issues} editing={editing} openIssue={(id) => openIssue(id, issues.map((issue) => issue.id))} />;
}
