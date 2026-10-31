import { cn } from '../lib/cn.js';
import { dueInfo } from '../issues/due.js';
import { AgentAvatar, DueDate } from '../issues/icons.jsx';
import { useServices } from '../services.jsx';

/** A list of issues as one line each (date or note, title, who is on it); a click opens the issue. */
export function IssueLines({ issues, note }) {
  const { openIssue } = useServices();
  const ids = issues.map((issue) => issue.id);
  const now = Date.now();
  return (
    <ul>
      {issues.map((issue) => {
        const info = dueInfo(issue.dueAt, now);
        const extra = note?.(issue);
        return (
          <li key={issue.id}>
            <button
              type="button" onClick={() => openIssue(issue.id, ids)}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {info && <span className="w-[56px] shrink-0 text-xs whitespace-nowrap"><DueDate info={info} /></span>}
              <span className={cn('min-w-0 flex-1 truncate', extra && 'flex items-baseline gap-2')}>
                <span className="truncate font-medium">{issue.title}</span>
                {extra && <span className="truncate text-xs text-muted-foreground @max-[320px]:hidden">{extra}</span>}
              </span>
              <AgentAvatar agent={issue.agent} state={issue.agentState} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
