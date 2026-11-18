import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { ConversationAvatar } from '../issues/ConversationAvatar.jsx';
import { T } from '../strings.js';

/** The reference an issue is called by: its project's (DUD-12), else its number. */
export const issueRef = (issue) => issue.ref ?? `#${issue.id}`;

/** A conversation a record can be forwarded to: an issue that has an agent and a session. */
export const hasSession = (issue) => Boolean(issue.agent && issue.session);

/**
 * The list "转发" opens, in the right-click menu, the selection bar and the record's window: the conversations a record can go to, as the phone's forward page lists them
 * (owner, 2026-11-18, "转发显示头像之类的都接入"; design `.local/designs/desktop-inbox-forward-2026-11-18/`, option A: a pick forwards at once). Each row: the conversation's own avatar
 * (`ConversationAvatar`, the initials of its title on the tone its title picks, as the sidebar and the phone draw it), its number and title, and at the right the logo of the agent it
 * runs on; no status icon (a conversation has none in the sidebar either). Only an issue that has an agent and a session is listed, the one touched last first, found by its number or its
 * words in the box ("搜索会话", the 会话 window's own). They are read when the list opens (a submenu or a popover mounts it then): the Active and Backlog tabs of Issues, 50 of each.
 */
export function ConversationPicker({ request, onSelect }) {
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
  const shown = useMemo(() => issues.filter(hasSession), [issues]);
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
    <CommandInput placeholder={T.widgets.sessions.search} aria-label={T.widgets.sessions.search} />
    <CommandSeparator />
    <CommandList>
      <CommandEmpty>{status === 'error' ? T.loadFailed : status === 'loading' ? '' : T.empty}</CommandEmpty>
      {shown.map((issue) => <CommandItem key={issue.id} value={`${issueRef(issue)} ${issue.title}`} className="h-10 gap-2.5" onSelect={() => onSelect(issue)}>
        <ConversationAvatar title={issue.title} size={28} />
        <span data-issue-ref="" className="min-w-(--issue-ref-w) shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{issueRef(issue)}</span>
        <span className="min-w-0 flex-1 truncate">{issue.title}</span>
        <AgentLogo agent={issue.agent} className="size-3.5" />
      </CommandItem>)}
    </CommandList>
  </Command>;
}
