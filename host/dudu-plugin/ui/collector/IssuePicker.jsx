import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { StatusIcon } from '../issues/icons.jsx';
import { T } from '../strings.js';

/** The reference an issue is called by: its project's (DUD-12), else its number. */
export const issueRef = (issue) => issue.ref ?? `#${issue.id}`;

/** An issue a record can be shared into the session of: it has an agent and a session. */
export const hasSession = (issue) => Boolean(issue.agent && issue.session);

/**
 * The open issues, the one touched last first, for "Share to issue" and "Share to session": a box that finds one by its number or its words. They
 * are read when the list opens (a submenu or a popover mounts it then): the Active and Backlog tabs of Issues, 50 of each. `eligible` keeps only
 * the issues that fit what is being done (sharing to a session needs an issue that has one).
 */
export function IssuePicker({ request, onSelect, eligible = () => true }) {
  const [issues, setIssues] = useState([]);
  const [status, setStatus] = useState('loading');
  const [refWidth, setRefWidth] = useState(0);
  const probe = useRef(null);
  useEffect(() => {
    let live = true;
    Promise.all(['active', 'backlog'].map((tab) => request('issues/list', { tab, order: 'updated', limit: 50 }))).then((results) => {
      if (!live) return;
      if (results.some((result) => result?.outcome !== 'success')) { setStatus('error'); return; }
      setIssues(results.flatMap((result) => result.items ?? []).sort((a, b) => b.updatedAt - a.updatedAt));
      setStatus('ready');
    }).catch(() => { if (live) setStatus('error'); });
    return () => { live = false; };
  }, [request]);
  const shown = useMemo(() => issues.filter(eligible), [issues, eligible]);
  // The reference column is as wide as the widest reference (the Issues list's rule, not a fixed width): the titles line up and a reference never
  // wraps. Digits are the same width (tabular), so one sample for each kind of reference (a key and its number of digits) is enough to measure.
  const kinds = useMemo(() => [...new Set(shown.map((issue) => issueRef(issue).replace(/\d/g, '0')))].slice(0, 40), [shown]);
  const kindKey = kinds.join('|');
  useLayoutEffect(() => {
    const samples = probe.current;
    if (!samples) return undefined;
    const measure = () => setRefWidth(Math.ceil(Math.max(0, ...[...samples.children].map((sample) => sample.getBoundingClientRect().width))));
    measure();
    let stale = false;
    document.fonts?.ready.then(() => { if (!stale) measure(); });
    return () => { stale = true; };
  }, [kindKey]);
  return <Command style={{ '--issue-ref-w': `${refWidth}px` }}>
    <div ref={probe} aria-hidden="true" className="invisible absolute h-0 overflow-hidden text-sm whitespace-nowrap">
      {kinds.map((kind) => <span key={kind} className="inline-block tabular-nums">{kind}</span>)}
    </div>
    <CommandInput placeholder={T.search.placeholder} aria-label={T.search.label} />
    <CommandSeparator />
    <CommandList>
      <CommandEmpty>{status === 'error' ? T.loadFailed : status === 'loading' ? '' : T.empty}</CommandEmpty>
      {shown.map((issue) => <CommandItem key={issue.id} value={`${issueRef(issue)} ${issue.title}`} onSelect={() => onSelect(issue)}>
        <StatusIcon status={issue.status} />
        <span data-issue-ref="" className="min-w-(--issue-ref-w) shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{issueRef(issue)}</span>
        <span className="truncate">{issue.title}</span>
      </CommandItem>)}
    </CommandList>
  </Command>;
}
