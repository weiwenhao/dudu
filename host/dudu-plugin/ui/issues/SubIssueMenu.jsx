import { useCallback, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Command, CommandGroup, CommandItem, CommandList } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { PriorityIcon, ProgressRing, StatusIcon, SUB_ISSUE_CHIP } from './icons.jsx';

/**
 * The count of sub-issues on a card or a row (a ring and "done/total"), as Linear's: it is a button, and it opens a small list of the sub-issues, one line each with its
 * status, id, title and priority; Enter or a click on one goes to that issue. The list is read when it opens (`issues/get` has the children), so the lists of issues stay light.
 */
export function SubIssueChipMenu({ progress, issueId, request, onOpen }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null); // null: being read
  const [failed, setFailed] = useState(false);
  // The list is there only once it has been read: the keyboard goes to it then, so that the arrows and Enter work.
  const focusList = useCallback((node) => { node?.focus({ preventScroll: true }); }, []);
  const load = async () => {
    setChildren(null);
    setFailed(false);
    try {
      const result = await request('issues/get', { id: issueId, logLimit: 1 });
      if (result?.outcome !== 'success') throw new Error();
      setChildren(result.issue.children ?? []);
    } catch { setFailed(true); setChildren([]); }
  };
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) void load(); }}>
    <PopoverTrigger asChild>
      <button type="button" data-issue-subissues="" aria-label={T.subIssues.title} title={T.subIssues.title}
        onClick={(event) => event.stopPropagation()}
        className={cn(SUB_ISSUE_CHIP, 'cursor-pointer outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent')}>
        <ProgressRing done={progress.done} total={progress.total} />
        {T.subIssues.progress(progress.done, progress.total)}
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[280px] p-0" aria-label={T.subIssues.title}
      onClick={(event) => event.stopPropagation()}>
      {children === null ? <p role="status" className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{T.shell.loading}</p>
        : failed ? <p role="alert" className="px-3 py-3 text-sm text-danger-foreground">{T.toast.failed}</p>
        : <Command ref={focusList} tabIndex={-1} loop className="outline-none">
          <CommandList className="max-h-[300px] p-1 outline-none">
            <CommandGroup heading={T.subIssues.title}>
              {children.map((child) => <CommandItem key={child.id} value={`${child.ref ?? ''} ${child.title} ${child.id}`} data-sub-issue-item={child.id}
                onSelect={() => { setOpen(false); onOpen(child.id); }}>
                <StatusIcon status={child.status} />
                {child.ref && <span className="shrink-0 text-muted-foreground tabular-nums">{child.ref}</span>}
                <span className="min-w-0 flex-1 truncate">{child.title}</span>
                <PriorityIcon priority={child.priority} />
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>}
    </PopoverContent>
  </Popover>;
}
