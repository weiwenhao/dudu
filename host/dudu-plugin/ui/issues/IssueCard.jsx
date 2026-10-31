import { CalendarDays } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { dueInfo, DUE_TONE } from './due.js';
import { AgentAvatar, PriorityIcon, ProjectChip, StatusIcon } from './icons.jsx';
import { StatusMenu } from './StatusMenu.jsx';

/** A card of the Board, as in Linear: id and agent, then status icon and title, then a row of small pills. */
export function IssueCard({ issue, now, show, menuOpen, onMenuOpenChange, onStatus, onOpen }) {
  const priority = T.priority[issue.priority] ?? T.priority.none;
  const due = show.dueDate ? dueInfo(issue.dueAt, now) : null;
  const status = T.status[issue.status];
  const pills = show.priority || (show.project && issue.project?.name) || due;
  return (
    <article className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm shadow-xs">
      {(show.id || show.agent) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {show.id && <span className="tracking-[-0.02em]">DUDU-{issue.id}</span>}
          <span className="flex-1" />
          {show.agent && <AgentAvatar agent={issue.agent} state={issue.agentState} />}
        </div>
      )}
      <div className="flex gap-2">
        {show.status && (
          <StatusMenu status={issue.status} open={menuOpen} onOpenChange={onMenuOpenChange} onSelect={(next) => onStatus(issue, next)}>
            <button
              type="button" aria-label={T.changeStatusOf(status, issue.title)} title={status}
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <StatusIcon status={issue.status} />
            </button>
          </StatusMenu>
        )}
        <h3 className="line-clamp-2 leading-5 font-medium">
          <button type="button" onClick={() => onOpen(issue)} className="cursor-pointer rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{issue.title}</button>
        </h3>
      </div>
      {pills && (
        <div className="flex flex-wrap items-center gap-1.5">
          {show.priority && (
            <span className="flex size-6 items-center justify-center rounded-full border" role="img" aria-label={T.priorityOf(priority)} title={T.priorityOf(priority)}>
              <PriorityIcon priority={issue.priority} />
            </span>
          )}
          {show.project && issue.project?.name && <ProjectChip name={issue.project.name} />}
          {due && (
            <span className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs', DUE_TONE[due.kind])} title={due.hint}>
              <CalendarDays className="size-3" aria-hidden="true" />{due.text}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
