import { T } from '../strings.js';
import { useServices } from '../services.jsx';
import { Empty, Frame } from './Frame.jsx';
import { IssueLines } from './IssueLines.jsx';
import { usePolled } from './use-polled.js';

/** Issues that have a due date, soonest first (overdue ones lead). */
export function Upcoming() {
  const { request } = useServices();
  const { status, value } = usePolled(request, 'issues/list', { tab: 'active', filter: { dueFrom: 1 }, order: 'due', limit: 50 });
  const issues = value?.items ?? [];
  return (
    <Frame title={T.widgets.titles.upcoming}>
      {status === 'ready' && issues.length === 0 ? <Empty>{T.widgets.upcoming.empty}</Empty> : <IssueLines issues={issues} />}
    </Frame>
  );
}
