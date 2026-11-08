import { PriorityIcon, StatusIcon } from './icons.jsx';

/**
 * A row as it is held up while it is dragged, as Linear draws it: a small card with what names the issue (priority, ID, status, title)
 * that follows the pointer; the row itself stays where it was, dimmed.
 */
export function DragChip({ issue, show }) {
  return (
    <div data-issue-lifted className="flex h-10 w-fit max-w-[520px] items-center gap-2.5 rounded-xl border bg-card px-3 shadow-lg">
      {show.priority && <PriorityIcon priority={issue.priority} className="size-4 shrink-0" />}
      {show.id && issue.ref && <span className="shrink-0 tracking-[-0.02em] whitespace-nowrap text-muted-foreground tabular-nums">{issue.ref}</span>}
      {show.status && <StatusIcon status={issue.status} />}
      <span className="min-w-0 truncate font-medium">{issue.title}</span>
    </div>
  );
}
