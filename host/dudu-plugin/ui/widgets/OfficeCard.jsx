import { OfficeWidget } from './office/OfficeWidget.jsx';
import { useServices } from '../services.jsx';
import { usePolled } from './use-polled.js';

/** Assigned Active issues occupy desks; board totals also include unassigned work. */
export function OfficeCard({ size, editing, openIssue }) {
  const { request } = useServices();
  const { value } = usePolled(request, 'issues/office', {});
  const issues = value?.items ?? [];
  return <OfficeWidget size={size} issues={issues} totals={value} editing={editing} openIssue={(id) => openIssue(id, issues.map((issue) => issue.id))} />;
}
