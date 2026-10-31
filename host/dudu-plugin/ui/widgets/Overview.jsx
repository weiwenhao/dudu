import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { useServices } from '../services.jsx';
import { Frame } from './Frame.jsx';
import { usePolled } from './use-polled.js';

const DAY = 86400000;
const startOfDay = () => { const date = new Date(); date.setHours(0, 0, 0, 0); return date.getTime(); };

function Stat({ value, label, tone, className }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5 px-2', className)}>
      <span className={cn('text-3xl/9 font-semibold tabular-nums', tone)}>{value ?? '—'}</span>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** Overdue, due this week, in progress (an agent working): three numbers; a small widget keeps only the first. */
export function Overview() {
  const { request } = useServices();
  const today = startOfDay();
  const ask = (filter) => ({ tab: 'active', filter, limit: 1 }); // only the total is wanted
  const overdue = usePolled(request, 'issues/list', ask({ dueTo: today - 1 })).value?.total;
  const soon = usePolled(request, 'issues/list', ask({ dueFrom: today, dueTo: today + 7 * DAY - 1 })).value?.total;
  const going = usePolled(request, 'issues/list', ask({ status: ['in_progress'], agentState: ['working'] })).value?.total;
  return (
    <Frame title={T.widgets.titles.overview} className="flex items-center pb-3">
      <div className="grid w-full grid-cols-3 @max-[300px]:grid-cols-1">
        <Stat value={overdue} label={T.widgets.overview.overdue} tone={overdue > 0 ? 'text-danger-foreground' : undefined} />
        <Stat value={soon} label={T.widgets.overview.thisWeek} className="@max-[300px]:hidden" />
        <Stat value={going} label={T.widgets.overview.inProgress} className="@max-[300px]:hidden" />
      </div>
    </Frame>
  );
}
