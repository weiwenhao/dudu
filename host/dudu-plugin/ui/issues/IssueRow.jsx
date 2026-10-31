import { Checkbox } from '../components/checkbox.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { dueInfo, shortDate } from './due.js';
import { AgentAvatar, DueDate, PriorityIcon, ProjectChip, StatusIcon } from './icons.jsx';
import { StatusMenu } from './StatusMenu.jsx';

const Muted = ({ children, title }) => <span className="w-[72px] shrink-0 truncate text-right text-xs text-muted-foreground @max-[560px]:hidden" title={title}>{children}</span>;

/**
 * One row, 44px, as in Linear: [select box] priority, id, status, title … project, agent, due date. `show` says which of those
 * the person has switched on in Display properties (and which the grouping already says). The box shows when the mouse is on the
 * row, and on every row once any is ticked; its place is always kept so the columns line up.
 */
export function IssueRow({ issue, now, show, selected, selecting, onSelect, menuOpen, onMenuOpenChange, onStatus, onHover, onOpen }) {
  const priority = T.priority[issue.priority] ?? T.priority.none;
  const due = dueInfo(issue.dueAt, now);
  const status = T.status[issue.status];
  return (
    <div
      className={cn('group flex h-11 cursor-pointer items-center gap-2 rounded-lg px-3 hover:bg-accent/60 has-[[data-state=open]]:bg-accent', selected && 'bg-accent/60')}
      onMouseEnter={() => onHover(issue.id)} onMouseLeave={() => onHover(null)}
      onClick={(event) => { if (!event.target.closest('button, input, [role=combobox]')) onOpen(issue); }}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Checkbox
          checked={selected} aria-label={T.bulk.select(issue.id)}
          className={cn(!selected && !selecting && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          onClick={(event) => { event.stopPropagation(); onSelect(issue.id, event.shiftKey); }}
        />
      </span>
      {show.priority && (
        <span className="flex size-4 shrink-0 items-center justify-center" role="img" aria-label={T.priorityOf(priority)} title={T.priorityOf(priority)}>
          <PriorityIcon priority={issue.priority} />
        </span>
      )}
      {show.id && <span className="w-[60px] shrink-0 tracking-[-0.02em] whitespace-nowrap text-muted-foreground">DUDU-{issue.id}</span>}
      {show.status && (
        <StatusMenu status={issue.status} open={menuOpen} onOpenChange={onMenuOpenChange} onSelect={(next) => onStatus(issue, next)}>
          <button
            type="button" aria-label={T.changeStatusOf(status, issue.title)} title={status}
            className="flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <StatusIcon status={issue.status} />
          </button>
        </StatusMenu>
      )}
      <button
        type="button" onClick={() => onOpen(issue)}
        className="min-w-0 flex-1 cursor-pointer truncate rounded text-left font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {issue.title}
      </button>
      {show.project && issue.project?.name && <span className="@max-[720px]:hidden"><ProjectChip name={issue.project.name} /></span>}
      {show.agent && <AgentAvatar agent={issue.agent} state={issue.agentState} />}
      {show.source && <Muted>{T.source[issue.source] ?? issue.source}</Muted>}
      {show.created && <Muted title={new Date(issue.createdAt).toLocaleString()}>{shortDate(issue.createdAt, now)}</Muted>}
      {show.updated && <Muted title={new Date(issue.updatedAt).toLocaleString()}>{shortDate(issue.updatedAt, now)}</Muted>}
      {show.dueDate && <span className="flex w-[72px] shrink-0 justify-end text-xs @max-[560px]:hidden">{due && <DueDate info={due} />}</span>}
    </div>
  );
}
