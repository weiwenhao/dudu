import { useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip.jsx';
import { T } from '../strings.js';
import { dueInfo, shortDate } from './due.js';
import { IssueDueDate } from './DueMenu.jsx';
import { AgentAvatar, PriorityIcon, ProjectChip, StatusIcon } from './icons.jsx';
import { SubIssueChipMenu } from './SubIssueMenu.jsx';
import { LabelChip } from './LabelMenu.jsx';
import { PriorityMenu } from './PriorityMenu.jsx';
import { StatusMenu } from './StatusMenu.jsx';
import { IssueMenu } from './IssueMenu.jsx';
import { formatDateTime } from '../lib/locale.mjs';
import { statusLabel } from './workflow.js';

/**
 * The saved progress sentence: three lines of the card, no more and (see the slot in the card) no less, so that every card is as high as
 * the next. What does not fit is cut with an ellipsis, and shown whole in a tooltip while the pointer is on it.
 */
function Summary({ text, lines = 3 }) {
  const node = useRef(null);
  const [open, setOpen] = useState(false);
  const clipped = () => node.current !== null && node.current.scrollHeight > node.current.clientHeight;
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && clipped())}>
      <TooltipTrigger asChild>
        <p ref={node} data-issue-summary className={cn(lines === 3 ? 'line-clamp-3' : 'line-clamp-2', 'text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]')}>{text}</p>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-h-60 overflow-y-auto text-left leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Approved card A: status, ID and title (one line); saved progress (a slot of three lines); agent, priority, due date and project (one
 * line); optional timestamps. The way to the issue's page is the right-click menu's "Open issue". Every part has a height of its own, so all cards of a board are the same height.
 */
export function IssueCard({ issue, now, show, menuOpen, onMenuOpenChange, onStatus, onOpen, onNavigate, onHover, request, onChange, onAssign, onDelete, onOpenSession, onAddSub, onDuplicate, onPreviewSession, overlay = false }) {
  const priority = T.priority[issue.priority] ?? T.priority.none;
  const due = show.dueDate ? dueInfo(issue.dueAt, now) : null;
  const status = statusLabel(issue.status);
  const openCard = () => (issue.session ? onPreviewSession(issue) : onOpen(issue));
  const card = (action) => <article tabIndex={overlay ? -1 : 0} aria-label={issue.title} data-issue-card={overlay ? undefined : issue.id} data-issue-lifted={overlay ? '' : undefined}
      className={cn('flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm shadow-xs outline-none hover:border-ring/30 has-[[data-issue-title]:focus-visible]:border-ring/30 focus-visible:border-ring/30',
        overlay && 'cursor-grabbing shadow-lg ring-1 ring-ring/20')}
      onMouseEnter={() => onHover?.(action)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(action)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover?.(null); }}
      onClick={(event) => {
        if (event.currentTarget.contains(event.target) && !event.target.closest('button, input, [role=combobox]')) openCard();
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); openCard(); }
      }}>
      {/* A sub-issue says whose it is, as Linear does: its id, a chevron and the title of its parent, on a line of its own; the line is taken from the saved progress below it, so the card is as high as any other. */}
      <div className="flex flex-col">
      {issue.parent && <div data-issue-parent={issue.parent.id} className="flex h-5 min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {show.id && issue.ref && <span className="shrink-0 tracking-[-0.02em] tabular-nums">{issue.ref}</span>}
        <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate" title={issue.parent.title}>{issue.parent.title}</span>
      </div>}
      <div className="flex items-start gap-2">
        {show.status && (
          <StatusMenu status={issue.status} open={menuOpen} onOpenChange={onMenuOpenChange} onSelect={(next) => onStatus(issue, next)}>
            <button
              type="button" aria-label={T.changeStatusOf(status, issue.title)} title={status}
              className="flex h-5 w-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <StatusIcon status={issue.status} className="size-3.5" />
            </button>
          </StatusMenu>
        )}
        {show.id && issue.ref && !issue.parent && <span className="shrink-0 text-xs leading-5 tracking-[-0.02em] text-muted-foreground tabular-nums">{issue.ref}</span>}
        <h3 className="min-w-0 flex-1 text-[14px] leading-5 font-medium">
          <button type="button" onClick={openCard} data-issue-title="" className="block w-full cursor-pointer truncate rounded text-left outline-none">{issue.title}</button>
        </h3>
      </div>
      </div>
      <div className={issue.parent ? 'h-10' : 'h-[60px]'}>{issue.progressSummary && <Summary text={issue.progressSummary} lines={issue.parent ? 2 : 3} />}</div>
      <footer className="flex h-6 items-center gap-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {show.agent && <AgentAvatar agent={issue.agent} state={issue.agentState} finished={issue.agentFinished} asleep={issue.deepSleep} compact showTitle={false} />}
          {show.priority && (
            // As in Linear: a round chip, the same height and border as the due date and the project beside it, the icon at its full 16px; a click opens the priority menu.
            <PriorityMenu priority={issue.priority} onSelect={(next) => onChange(issue, { priority: next })}>
              <button type="button" data-issue-priority={issue.id} aria-label={T.priorityOf(priority)} title={T.priorityOf(priority)}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <PriorityIcon priority={issue.priority} />
              </button>
            </PriorityMenu>
          )}
          {/* As in Linear (owner, 2026-11-08, with Linear's card): the sub-issue chip is the first after the priority, before the due date, the project and the labels. */}
          {issue.subIssues && <SubIssueChipMenu progress={issue.subIssues} issueId={issue.id} request={request} onOpen={onNavigate} />}
          {due && <IssueDueDate issue={issue} info={due} onChange={onChange} pill />}
          {show.project && issue.project?.name && <ProjectChip name={issue.project.name} shrink />}
          {show.labels && issue.labels?.map((label) => <LabelChip key={label.id} label={label} shrink />)}
        </div>
      </footer>
      {(show.source || show.created || show.updated) && <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {show.source && <span>{T.source[issue.source] ?? issue.source}</span>}
        {show.created && <span title={formatDateTime(issue.createdAt)}>{T.display.property.created} {shortDate(issue.createdAt, now)}</span>}
        {show.updated && <span title={formatDateTime(issue.updatedAt)}>{T.display.property.updated} {shortDate(issue.updatedAt, now)}</span>}
      </div>}
    </article>;
  // The card as it is lifted while it is dragged is only a picture of it: no menu, no shortcuts.
  if (overlay) return card(null);
  return (
    <IssueMenu issue={issue} request={request} onChange={onChange} onAssign={onAssign} onDelete={onDelete} onOpenSession={onOpenSession} onAddSub={onAddSub} onDuplicate={onDuplicate} onOpenIssue={onOpen}>
      {card}
    </IssueMenu>
  );
}
