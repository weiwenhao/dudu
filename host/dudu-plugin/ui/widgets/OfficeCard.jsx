import { OfficeWidget } from './office/OfficeWidget.jsx';
import { useServices } from '../services.jsx';
import { usePolled } from './use-polled.js';

/** Assigned Active issues occupy desks; board totals also include unassigned work. */
export function OfficeCard({ size, editing, openIssue }) {
  const { request, previewIssueSession } = useServices();
  const { value } = usePolled(request, 'issues/office', {});
  const issues = value?.items ?? [];
  // As on the board and in the list: a click on a person (or a name tag) opens the conversation of the issue, when it has one, else its page.
  const open = (id) => {
    const issue = issues.find((entry) => entry.id === id);
    if (issue?.session && previewIssueSession) previewIssueSession(issue);
    else openIssue(id, issues.map((entry) => entry.id));
  };
  return <OfficeWidget size={size} issues={issues} totals={value} editing={editing} openIssue={open} />;
}
