import { statusLabel } from './workflow.js';
import { ArrowUpToLine } from 'lucide-react';
import { Checkbox } from '../components/checkbox.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { formatDateTime } from '../lib/locale.mjs';
import { dueInfo, shortDate } from './due.js';
import { PriorityIcon, ProjectChip, StatusIcon } from './icons.jsx';
import { SubIssueChipMenu } from './SubIssueMenu.jsx';
import { IssueDueDate } from './DueMenu.jsx';
import { PriorityMenu } from './PriorityMenu.jsx';
import { StatusMenu } from './StatusMenu.jsx';
import { IssueMenu } from './IssueMenu.jsx';
import { IssueAgent } from './IssueAgent.jsx';
import { LabelChip } from './LabelMenu.jsx';
import { ConversationAvatar } from './ConversationAvatar.jsx';
import { conversationTime } from './conversation-time.js';

const Muted = ({ children, title }) => <span className="w-[72px] shrink-0 truncate text-right text-xs text-muted-foreground @max-[560px]:hidden" title={title}>{children}</span>;

/**
 * One row, 44px, as in Linear: [select box] generated avatar, priority, id, status, title … labels, project, due date, agent, then the dates (Created, Updated). The id column is as wide as the widest id of the list
 * (`--issue-id-w`, measured by IssueList), so the titles line up and the gap after an id stays small. `show` says which of those
 * the person has switched on in Display properties (and which the grouping already says). There is no box, and no place for it, until a row is chosen with Select in its right-click menu
 * (owner, 2026-11-16, as in the Collector); then every row shows its box and a click on a row ticks it (Shift ticks a run) instead of opening it. When the keyboard is on the row or on its title (or comes back to it when a
 * conversation window closes) the row looks as it does under the mouse, instead of a blue frame round the row or round the words of the title (owner, 2026-11-05/06: "这个奇怪的蓝框是什么").
 */
export function IssueRow({ issue, now, show, selected, selecting, onSelect, menuOpen, onMenuOpenChange, onStatus, onHover, onOpen, onNavigate,
  request, onChange, onAssign, onDelete, onOpenSession, onAddSub, onDuplicate, onPreviewSession, onPin, pinning }) {
  const priority = T.priority[issue.priority] ?? T.priority.none;
  const due = dueInfo(issue.dueAt, now);
  const status = statusLabel(issue.status);
  // As on the board: the conversation, when the issue has one, else its page; the right-click menu's "Open issue" is the way to the page.
  const openRow = (event) => {
    if (selecting) onSelect(issue.id, Boolean(event?.shiftKey));
    else if (issue.session) onPreviewSession(issue);
    else onOpen(issue);
  };
  return (
    <IssueMenu issue={issue} request={request} onChange={onChange} onAssign={onAssign} onDelete={onDelete} onOpenSession={onOpenSession} onAddSub={onAddSub} onDuplicate={onDuplicate} onOpenIssue={onOpen}
      selected={selected} onSelectIssue={() => onSelect(issue.id, false)} onPin={onPin} pinning={pinning}>
    {(action) => <div tabIndex={0} data-issue-row={issue.id}
      className={cn('group flex h-11 cursor-pointer items-center gap-2 rounded-lg px-3 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 has-[[data-state=open]]:bg-accent has-[[data-issue-title]:focus-visible]:bg-accent/60', selected && 'bg-accent/60')}
      onMouseEnter={() => onHover(action)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(action)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onHover(null); }}
      // Portaled menus still bubble through this React row; only its own DOM content opens the issue.
      onClick={(event) => { if (event.currentTarget.contains(event.target) && !event.target.closest('button, input, [role=combobox]')) openRow(event); }}
      onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); openRow(event); } }}
    >
      {selecting && (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Checkbox
            checked={selected} aria-label={T.bulk.select(issue.ref || issue.title)}
            onClick={(event) => { event.stopPropagation(); onSelect(issue.id, event.shiftKey); }}
          />
        </span>
      )}
      <ConversationAvatar reference={issue.ref ?? ''} state={issue.sessionState} size={32} busy={pinning} />
      {show.priority && (
        // Like the status beside it: the icon is the button, and a click opens the priority menu.
        <PriorityMenu priority={issue.priority} onSelect={(next) => onChange(issue, { priority: next })}>
          <button
            type="button" data-issue-priority={issue.id} aria-label={T.priorityOf(priority)} title={T.priorityOf(priority)}
            className="flex size-4 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <PriorityIcon priority={issue.priority} />
          </button>
        </PriorityMenu>
      )}
      {show.id && issue.ref && <span data-issue-id="" className="min-w-(--issue-id-w) shrink-0 tracking-[-0.02em] whitespace-nowrap text-muted-foreground tabular-nums">{issue.ref}</span>}
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
      {/* The sub-issue chip follows the words of the title, as in Linear (owner, 2026-11-08, with Linear's row): the title takes only the room it needs, this box takes the rest. */}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button" onClick={openRow} aria-label={issue.title} data-issue-title=""
          title={issue.parent ? `${issue.parent.title}#${issue.title}` : issue.title}
          className="flex min-w-0 cursor-pointer items-center rounded text-left font-medium outline-none"
        >
          {/* A sub-issue reads "parent#sub-issue" (the owner's choice, 2026-11-05: @ first, then #): the parent's title in grey, then the title of the sub-issue. */}
          {issue.parent && <span data-issue-parent={issue.parent.id} aria-hidden="true" className="flex min-w-0 max-w-[280px] items-center font-normal text-muted-foreground"><span className="truncate">{issue.parent.title}</span><span className="shrink-0">#</span></span>}
          <span className="min-w-0 truncate">{issue.title}</span>
        </button>
        {issue.pinned && <ArrowUpToLine className="size-3.5 shrink-0 text-[#727b89] dark:text-muted-foreground" strokeWidth={1.8} aria-label={T.issuePin.on} />}
        {issue.subIssues && <span className="shrink-0 @max-[560px]:hidden"><SubIssueChipMenu progress={issue.subIssues} issueId={issue.id} request={request} onOpen={onNavigate} /></span>}
      </span>
      {show.labels && issue.labels?.length > 0 && <span className="flex shrink-0 items-center gap-1 @max-[720px]:hidden">{issue.labels.map((label) => <LabelChip key={label.id} label={label} />)}</span>}
      {show.project && issue.project?.name && <span className="@max-[720px]:hidden"><ProjectChip name={issue.project.name} /></span>}
      {/* As in Linear (owner, 2026-11-05): the due date is a round chip among the others, right before the agent, so it ends where the agent begins; the dates of the issue (Created, Updated) are
          the last, right-aligned columns of the row. */}
      {show.dueDate && due && <span className="shrink-0 text-xs @max-[560px]:hidden"><IssueDueDate issue={issue} info={due} onChange={onChange} pill /></span>}
      {show.agent && <IssueAgent issue={issue} onPreview={onPreviewSession} showActivity={false} />}
      {show.source && <Muted>{T.source[issue.source] ?? issue.source}</Muted>}
      {show.created && <Muted title={formatDateTime(issue.createdAt)}>{shortDate(issue.createdAt, now)}</Muted>}
      {show.updated && issue.receivedAt > 0 && <time dateTime={new Date(issue.receivedAt).toISOString()} title={formatDateTime(issue.receivedAt)}
        className="shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground">{conversationTime(issue.receivedAt, now)}</time>}
    </div>}
    </IssueMenu>
  );
}
