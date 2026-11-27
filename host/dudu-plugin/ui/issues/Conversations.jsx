import { useEffect, useRef, useState } from 'react';
import { ArrowDownFromLine, ArrowUpToLine, LoaderCircle } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/context-menu.jsx';
import { Button } from '../components/button.jsx';
import { useToast } from '../components/toast.jsx';
import { useServices } from '../services.jsx';
import { ConversationAvatar } from './ConversationAvatar.jsx';
import { ConversationSplit } from './ConversationSplit.jsx';
import { ConversationTitle, issueOf } from './conversation-row.jsx';
import { AgentAvatar, ProgressRing } from './icons.jsx';
import { AgentLogo } from './AgentLogo.jsx';
import { IssueMenu } from './IssueMenu.jsx';
import { IssueConversation } from './IssueConversation.jsx';
import { SubIssueChipMenu } from './SubIssueMenu.jsx';
import { T } from '../strings.js';
import { conversationTime } from './conversation-time.js';
import { pickConversation, rememberConversation, rememberedConversation } from './selection.js';
import { useSessionReturnState } from '../lib/session-return.jsx';
import { SearchPage } from '../search/SearchPage.jsx';
import { noteOpened } from '../search/search-model.js';

function ConversationSidebar({ request, entries, pins, home, selected, listKey, open, openChild, menu, badge, header, controls, hidden }) {
  const scroller = useRef(null);
  const aboveRows = useRef(null);
  const [aboveRowsHeight, setAboveRowsHeight] = useState(0);
  useEffect(() => {
    // Pins may wrap and the number of filter controls can change.
    const element = aboveRows.current;
    const observer = new ResizeObserver(() => setAboveRowsHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { scroller.current.scrollTop = 0; }, [listKey]);
  const scrollMargin = 8 + aboveRowsHeight; // includes the scroller's top padding
  const virtual = useVirtualizer({
    count: entries.length, getScrollElement: () => scroller.current, estimateSize: () => 64, overscan: 8,
    scrollMargin, getItemKey: index => entries[index].id,
  });
  return <div className="dudu-conversation-sidebar" style={hidden ? { display: 'none' } : undefined}>
    {header}
    <div ref={scroller} className="dudu-conversation-scroll">
    <div ref={aboveRows}>
      <div className="dudu-conversation-pins">
        {pins.map(entry => menu(entry, <button type="button" className="dudu-conversation-pin focus-visible:ring-[3px] focus-visible:ring-ring/50" title={entry.issue ? entry.title : T.brand}
          onClick={event => { if (event.currentTarget.contains(event.target)) open(entry); }}>
          {badge(entry, 32)}<span className="dudu-conversation-pin-label">{entry.issue ? entry.title : T.brand}</span>
        </button>))}
      </div>
      {controls}
    </div>
    {home.status === 'error' && !home.value ? <div role="alert" className="flex flex-col items-center gap-3 p-5 text-muted-foreground">
      <span>{T.loadFailed}</span><Button variant="outline" size="sm" onClick={() => home.refresh()}>{T.retry}</Button>
    </div> : !home.value ? <div role="status" className="flex items-center justify-center gap-2 p-5 text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />{T.shell.loading}
    </div> : !entries.length ? <div className="p-5 text-center text-muted-foreground">{T.empty}</div> : <div role="list" className="relative" style={{ height: virtual.getTotalSize() }}>
      {virtual.getVirtualItems().map(row => {
        const entry = entries[row.index], issue = issueOf(entry), progress = issue.subIssues;
        const title = issue.parent ? `${issue.parent.title}#${issue.title}` : issue.title;
        return <div key={entry.id} role="listitem" className="absolute top-0 left-0 w-full" style={{ height: row.size, transform: `translateY(${row.start - scrollMargin}px)` }}>
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

/** Mounted while the panel is too narrow for the search page (the list column is a rail): it closes the search, so that it does not come back by itself when the panel is wide again. */
function CloseSearch({ onClose }) {
  useEffect(() => { onClose(); }, [onClose]);
  return null;
}

export function Conversations({ request, home, scope, listKey, header, controls, deletedIssue, onOpen, onChange, onAssign, onDelete, onAddSub, onDuplicate, onRestart, onPin, pinning, search }) {
  const { conversation: services } = useServices();
  const toast = useToast();
  const [selection, setSelection] = useSessionReturnState('conversation.selection', () => ({ scope, id: null, entry: null, outsideIssue: null }));
  const childRequest = useRef(0);
  const deleted = deletedIssue == null ? null : `issue:${deletedIssue}`;
  const loadedPins = home.value?.pinnedConversations;
  const [shelf, setShelf] = useState(() => ({ listKey, response: loadedPins, pins: loadedPins }));
  if (shelf.listKey !== listKey) {
    // A cached response for the new query can be older than the pins already on screen.
    setShelf({ ...shelf, listKey, response: loadedPins });
  } else if (loadedPins && loadedPins !== shelf.response) {
    setShelf({ listKey, response: loadedPins, pins: loadedPins });
  }
  const entries = (home.value?.conversations ?? []).filter(entry => entry.id !== deleted);
  const pins = (shelf.pins ?? []).filter(entry => entry.id !== deleted);
  const pinnedIds = new Set(pins.map(entry => entry.id));
  const byId = new Map([...pins, ...entries].map(entry => [entry.id, entry]));
  const resetSelection = selection.scope !== scope || (deleted !== null && selection.id === deleted);
  let selected = resetSelection ? null : selection.id;
  if (selected === null) {
    const remembered = byId.get(rememberedConversation(scope));
    selected = (remembered ? pickConversation([remembered], remembered.id) : null) ?? pickConversation(entries);
  }
  const previousSelection = !resetSelection && selection.id === selected ? selection : null;
  const selectedEntry = byId.get(selected) ?? previousSelection?.entry ?? null;
  const outsideIssue = selectedEntry ? null : previousSelection?.outsideIssue ?? null;
  // Filtering changes the list query, but the right pane still owns the same conversation.
  if (resetSelection || selected !== selection.id || selectedEntry !== selection.entry) {
    setSelection({ scope, id: selected, entry: selectedEntry, outsideIssue });
  }
  const listed = selected != null && byId.has(selected);
  useEffect(() => { if (listed) rememberConversation(scope, selected); }, [scope, selected, listed]);
  useEffect(() => () => { childRequest.current++; }, [scope]);
  const open = (entry) => {
    childRequest.current++;
    if (entry.issue && !entry.issue.session) {
      // An issue nobody was given has no conversation to show; say so in the toast every other result uses, as the phones do (owner, 2026-11-22). One that has an agent but no session yet keeps its quiet return.
      if (!entry.issue.agent) toast({ message: T.toast.assignAgent });
      return;
    }
    noteOpened(entry.id); // 常用 of the search page: the conversation opened last first
    setSelection({ scope, id: entry.id, entry, outsideIssue: null });
  };
  const selectedIssue = selectedEntry ? issueOf(selectedEntry) : outsideIssue;
  const openChild = async (id) => {
    const local = byId.get(`issue:${id}`);
    if (local) { open(local); return; }
    const token = ++childRequest.current;
    try {
      const answer = await request('issues/get', { id, logLimit: 1 });
      if (token !== childRequest.current) return;
      if (answer.outcome !== 'success') throw new Error();
      if (answer.issue?.session) {
        noteOpened(`issue:${id}`);
        setSelection(current => current.scope === scope ? { scope, id: `issue:${id}`, entry: null, outsideIssue: answer.issue } : current);
      }
    } catch { if (token === childRequest.current) toast({ message: T.toast.failed }); }
  };
  const menu = (entry, child) => {
    const pinned = pinnedIds.has(entry.id);
    const issue = { ...issueOf(entry), pinned };
    if (!entry.issue) return <ContextMenu key={entry.id}><ContextMenuTrigger asChild>{child}</ContextMenuTrigger>
      <ContextMenuContent><ContextMenuItem disabled={pinning.has(entry.id)} onSelect={() => onPin(issue)}>
        {pinned ? <ArrowDownFromLine strokeWidth={1.8} /> : <ArrowUpToLine strokeWidth={1.8} />}{pinned ? T.issuePin.off : T.issuePin.on}
      </ContextMenuItem></ContextMenuContent>
    </ContextMenu>;
    return <IssueMenu key={entry.id} issue={issue} request={request} onChange={onChange} onAssign={onAssign} onDelete={onDelete}
      onOpenIssue={() => onOpen(issue.id)} onAddSub={onAddSub} onDuplicate={onDuplicate} onRestart={onRestart} onPin={onPin} pinning={pinning.has(entry.id)}>
      {() => child}
    </IssueMenu>;
  };
  const badge = (entry, size) => <ConversationAvatar title={entry.title} assistant={!entry.issue}
    state={entry.sessionState} size={size} busy={pinning.has(entry.id)} />;
  // The search page takes the list column's place (the rail of a narrow panel has no room for it: it is closed then) and the list stays under it, mounted, so that it comes back where it was.
  return <ConversationSplit sidebar={compact => <>
    <ConversationSidebar request={request} entries={entries} pins={pins} home={home} selected={selected} listKey={listKey}
      open={open} openChild={openChild} menu={menu} badge={badge} header={header(compact)} controls={!compact && controls} hidden={search?.open && !compact} />
    {search?.open && !compact && <SearchPage request={request} selected={selected} onOpen={open} badge={badge} onOpenIssue={onOpen} onClose={search.onClose} />}
    {search?.open && compact && <CloseSearch onClose={search.onClose} />}
  </>}>
    {selectedIssue && services && <IssueConversation key={selectedIssue.id} issue={selectedIssue} request={request} services={services} />}
  </ConversationSplit>;
}
