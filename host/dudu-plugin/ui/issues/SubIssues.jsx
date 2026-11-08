import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Command, CommandInput, CommandItem, CommandList } from '../components/command.jsx';
import { Dialog, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';
import { StatusIcon } from './icons.jsx';

/** Chooses the parent of an issue: the latest issues while the box is empty, a search once it has words. `except` is the issue itself. */
export function ParentChoices({ request, except, onSelect }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const words = /[\p{L}\p{N}]/u.test(query);
        const result = await request(words ? 'issues/search' : 'issues/list', words ? { q: query.trim(), limit: 20 } : { tab: 'all', limit: 20, order: 'updated' });
        if (active) { setItems(result?.outcome === 'success' ? (result.items ?? []) : []); setReady(true); }
      } catch { if (active) { setItems([]); setReady(true); } }
    }, query ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [request, query]);
  const shown = items.filter((issue) => issue.id !== except);
  return <Command shouldFilter={false}>
    <CommandInput value={query} onValueChange={setQuery} placeholder={T.subIssues.searchParent} aria-label={T.subIssues.searchParent} />
    <CommandList>
      {ready && !shown.length && <p className="py-6 text-center text-sm text-muted-foreground">{T.subIssues.noMatch}</p>}
      {shown.map((issue) => <CommandItem key={issue.id} value={String(issue.id)} onSelect={() => onSelect(issue)} data-parent-option={issue.id}>
        <StatusIcon status={issue.status} />
        {issue.ref && <span className="shrink-0 text-muted-foreground tabular-nums">{issue.ref}</span>}
        <span className="truncate">{issue.title}</span>
      </CommandItem>)}
    </CommandList>
  </Command>;
}

/** "Set parent issue…" in a window of its own. */
export function ParentDialog({ request, open, onOpenChange, except, onSelect }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="gap-0 overflow-hidden p-0 sm:max-w-md">
      <DialogTitle className="sr-only">{T.subIssues.setParent}</DialogTitle>
      {open && <ParentChoices request={request} except={except} onSelect={(issue) => { onOpenChange(false); onSelect(issue); }} />}
    </DialogContent>
  </Dialog>;
}

/** The sub-issues of an issue, with how many are done, and a line to add more (each Enter makes one, the issue's project is theirs too). */
export function SubIssues({ request, issue, onOpen, reload }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const children = issue.children ?? [];
  const add = async () => {
    const text = title.trim();
    if (!text || busy) return;
    setBusy(true);
    setProblem(false);
    try {
      const result = await request('issues/add', { fields: { title: text, parent: issue.id, ...(issue.project ? { project: issue.project } : {}) } });
      if (result?.outcome !== 'success') throw new Error();
      setTitle('');
      reload();
    } catch { setProblem(true); } finally { setBusy(false); }
  };
  return <section className="mt-6" data-issue-subissues-section="" aria-label={T.subIssues.title}>
    {children.length > 0 && <div className="mb-1 flex items-center gap-2 text-sm">
      <h2 className="font-medium">{T.subIssues.title}</h2>
      <span className="text-muted-foreground tabular-nums">{T.subIssues.progress(issue.subIssues?.done ?? 0, children.length)}</span>
    </div>}
    <ul className="flex flex-col">
      {children.map((child) => <li key={child.id}>
        <button type="button" data-sub-issue={child.id} onClick={() => onOpen(child.id)}
          className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <StatusIcon status={child.status} />
          {child.ref && <span className="shrink-0 text-muted-foreground tabular-nums">{child.ref}</span>}
          <span className="min-w-0 flex-1 truncate">{child.title}</span>
        </button>
      </li>)}
    </ul>
    {adding
      ? <div className="mt-1 flex flex-col gap-1">
        <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={T.subIssues.placeholder} aria-label={T.subIssues.placeholder}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void add(); }
            if (event.key === 'Escape') { event.stopPropagation(); setAdding(false); setTitle(''); }
          }}
          className="h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground" />
        {problem && <p role="alert" className="text-xs text-danger-foreground">{T.subIssues.createFailed}</p>}
      </div>
      : <button type="button" onClick={() => setAdding(true)} className="mt-1 flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <Plus className="size-4" aria-hidden="true" />{T.subIssues.addMore}
      </button>}
  </section>;
}
