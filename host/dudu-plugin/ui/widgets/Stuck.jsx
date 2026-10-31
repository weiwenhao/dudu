import { T } from '../strings.js';
import { useServices } from '../services.jsx';
import { Empty, Frame } from './Frame.jsx';
import { IssueLines } from './IssueLines.jsx';
import { usePolled } from './use-polled.js';

/** Issues whose agent is stuck, each with what it said (its question, when there is one). */
export function Stuck() {
  const { request } = useServices();
  const { status, value } = usePolled(request, 'issues/list', { tab: 'active', filter: { agentState: ['stuck'] }, limit: 50 });
  const issues = value?.items ?? [];
  return (
    <Frame title="Stuck">
      {status === 'ready' && issues.length === 0 ? <Empty>{T.widgets.stuck.empty}</Empty> : <IssueLines issues={issues} note={(issue) => issue.ask} />}
    </Frame>
  );
}
