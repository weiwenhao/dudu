import { useEffect, useRef, useState } from 'react';
import { ArrowDownFromLine, ArrowUpToLine, LoaderCircle } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/context-menu.jsx';
import { Button } from '../components/button.jsx';
import { useToast } from '../components/toast.jsx';
import { useServices } from '../services.jsx';
import { ConversationAvatar } from './ConversationAvatar.jsx';
import { ConversationSplit } from './ConversationSplit.jsx';
import { AgentAvatar, ProgressRing } from './icons.jsx';
import { AgentLogo } from './AgentLogo.jsx';
import { IssueMenu } from './IssueMenu.jsx';
import { IssueConversation } from './IssueConversation.jsx';
import { SubIssueChipMenu } from './SubIssueMenu.jsx';
import { T } from '../strings.js';
import { conversationTime } from './conversation-time.js';
import { pickConversation, rememberConversation, rememberedConversation } from './selection.js';

const issueOf = entry => entry.issue ? {
  ...entry.issue, pinned: entry.pinned, sessionState: entry.sessionState, receivedAt: entry.receivedAt,
} : { id: 'assistant', title: T.brand, agent: 'dudu', session: 'assistant', pinned: entry.pinned };

function ConversationTitle({ issue }) {
  return <span className="dudu-conversation-row-title-text">
    {issue.parent && <><span className="max-w-32 min-w-0 shrink truncate text-[#96989d]">{issue.parent.title}</span><span className="shrink-0 text-[#96989d]">#</span></>}
    <span className="min-w-0 truncate">{issue.title}</span>
  </span>;
}

function ConversationSidebar({ request, entries, pins, home, selected, scope, open, openChild, menu, badge, header }) {
  const scroller = useRef(null);
  const shelf = useRef(null);
  const [shelfHeight, setShelfHeight] = useState(0);
  useEffect(() => {
    // Observe the real shelf: pin rows change when the divider moves, and the
    // shelf disappears in the compact rail. Neither changes the host session.
    const element = shelf.current;
    const observer = new ResizeObserver(() => setShelfHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { scroller.current.scrollTop = 0; }, [scope]);
  const virtual = useVirtualizer({
    count: entries.length, getScrollElement: () => scroller.current, estimateSize: () => 64, overscan: 8,
    scrollMargin: 8 + shelfHeight, getItemKey: index => entries[index].id,
  });
  return <div className="dudu-conversation-sidebar">
    {header}
    <div ref={scroller} className="dudu-conversation-scroll">
    <div ref={shelf} className="dudu-conversation-pins">
      {pins.map(entry => menu(entry, <button type="button" className="dudu-conversation-pin focus-visible:ring-[3px] focus-visible:ring-ring/50" title={entry.issue ? entry.title : T.brand}
        onClick={event => { if (event.currentTarget.contains(event.target)) open(entry); }}>
        {badge(entry, 32)}<span className="dudu-conversation-pin-label">{entry.issue ? entry.title : T.brand}</span>
      </button>))}
    </div>
    {home.status === 'error' && !home.value ? <div role="alert" className="flex flex-col items-center gap-3 p-5 text-muted-foreground">
      <span>{T.loadFailed}</span><Button variant="outline" size="sm" onClick={() => home.refresh()}>{T.retry}</Button>
    </div> : !home.value ? <div role="status" className="flex items-center justify-center gap-2 p-5 text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />{T.shell.loading}
    </div> : !entries.length ? <div className="p-5 text-center text-muted-foreground">{T.empty}</div> : <div role="list" className="relative" style={{ height: virtual.getTotalSize() }}>
      {virtual.getVirtualItems().map(row => {
        const entry = entries[row.index], issue = issueOf(entry), progress = issue.subIssues;
        const title = issue.parent ? `${issue.parent.title}#${issue.title}` : issue.title;
        return <div key={entry.id} role="listitem" className="absolute top-0 left-0 w-full" style={{ height: row.size, transform: `translateY(${row.start - (8 + shelfHeight)}px)` }}>
          {menu(entry, <div tabIndex={0} className="dudu-conversation-row" aria-label={title} aria-current={selected === entry.id ? 'true' : undefined} title={title}
            onClick={event => { if (event.currentTarget.contains(event.target) && !event.target.closest('button')) open(entry); }}
            onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); open(entry); } }}>
            {badge(entry, 40)}
            <div className="dudu-conversation-row-copy">
              <div className="dudu-conversation-row-title"><ConversationTitle issue={issue} />
                {entry.receivedAt > 0 && <time className="dudu-conversation-row-time" dateTime={new Date(entry.receivedAt).toISOString()}>{conversationTime(entry.receivedAt)}</time>}
              </div>
              <div className="dudu-conversation-row-preview">
                <span className="dudu-conversation-summary" title={entry.preview}>{entry.preview}</span>
                {progress?.total > 0 && <span className="invisible inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums" aria-hidden="true"><ProgressRing done={progress.done} total={progress.total} />{T.subIssues.progress(progress.done, progress.total)}</span>}
                {entry.issue && (issue.agent ? <AgentLogo agent={issue.agent} className="size-3" /> : <AgentAvatar compact className="!size-3" />)}
              </div>
            </div>
            {progress?.total > 0 && <SubIssueChipMenu progress={progress} issueId={issue.id} request={request} onOpen={openChild} plain />}
          </div>)}
        </div>;
      })}
    </div>}
    </div>
  </div>;
}

export function Conversations({ request, home, scope, header, onOpen, onChange, onAssign, onDelete, onAddSub, onDuplicate, onPin, pinning }) {
  const { conversation: services } = useServices();
  const toast = useToast();
  const [selection, setSelection] = useState(() => ({ scope, id: pickConversation(home.value?.conversations ?? [], rememberedConversation(scope)), outsideIssue: null }));
  const childRequest = useRef(0);
  const entries = home.value?.conversations ?? [];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const pins = (home.value?.pins ?? []).map(id => byId.get(id)).filter(Boolean);
  // Reset only the choice when scope changes. The split and its header stay
  // mounted, including the button anchoring an open filter menu.
  const initial = pickConversation(entries, selection.scope !== scope || selection.id === null ? rememberedConversation(scope) : null);
  if (selection.scope !== scope || (selection.id === null && initial !== null)) {
    setSelection({ scope, id: initial, outsideIssue: null });
  }
  const { id: selected, outsideIssue } = selection;
  // Expanding a conversation opens DSH's own page and closes this panel: coming back, the same conversation is open (owner, 2026-11-17: "我点了放大之后，我就回不到当前会话页面了").
  const listed = selected != null && byId.has(selected);
  useEffect(() => { if (listed) rememberConversation(scope, selected); }, [scope, selected, listed]);
  useEffect(() => () => { childRequest.current++; }, [scope]);
  const open = (entry) => {
    childRequest.current++;
    if (entry.issue && !entry.issue.session) return;
    setSelection({ scope, id: entry.id, outsideIssue: null });
  };
  const selectedEntry = byId.get(selected);
  const selectedIssue = selectedEntry ? issueOf(selectedEntry) : outsideIssue;
  const openChild = async (id) => {
    const local = entries.find(entry => entry.issue?.id === id);
    if (local) { open(local); return; }
    const token = ++childRequest.current;
    try {
      const answer = await request('issues/get', { id, logLimit: 1 });
      if (token !== childRequest.current) return;
      if (answer.outcome !== 'success') throw new Error();
      if (answer.issue?.session) setSelection(current => current.scope === scope ? { scope, id: `issue:${id}`, outsideIssue: answer.issue } : current);
    } catch { if (token === childRequest.current) toast({ message: T.toast.failed }); }
  };
  const menu = (entry, child) => {
    const issue = issueOf(entry);
    if (!entry.issue) return <ContextMenu key={entry.id}><ContextMenuTrigger asChild>{child}</ContextMenuTrigger>
      <ContextMenuContent><ContextMenuItem disabled={pinning.has(entry.id)} onSelect={() => onPin(issue)}>
        {entry.pinned ? <ArrowDownFromLine strokeWidth={1.8} /> : <ArrowUpToLine strokeWidth={1.8} />}{entry.pinned ? T.issuePin.off : T.issuePin.on}
      </ContextMenuItem></ContextMenuContent>
    </ContextMenu>;
    return <IssueMenu key={entry.id} issue={issue} request={request} onChange={onChange} onAssign={onAssign} onDelete={onDelete}
      onOpenIssue={() => onOpen(issue.id)} onAddSub={onAddSub} onDuplicate={onDuplicate} onPin={onPin} pinning={pinning.has(entry.id)}>
      {() => child}
    </IssueMenu>;
  };
  const badge = (entry, size) => <ConversationAvatar title={entry.title} assistant={!entry.issue}
    state={entry.sessionState} size={size} busy={pinning.has(entry.id)} />;
  return <ConversationSplit sidebar={compact => <ConversationSidebar request={request} entries={entries} pins={pins} home={home} selected={selected} scope={scope}
    open={open} openChild={openChild} menu={menu} badge={badge} header={header(compact)} />}>
    {selectedIssue && services && <IssueConversation key={selectedIssue.id} issue={selectedIssue} request={request} services={services} />}
  </ConversationSplit>;
}
