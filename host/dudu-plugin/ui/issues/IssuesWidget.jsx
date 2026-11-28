import { receiveStatuses, statusLabel, statusType } from './workflow.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, ListFilter, Plus, Search } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Button } from '../components/button.jsx';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../components/context-menu.jsx';
import { useToast } from '../components/toast.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { Board } from './Board.jsx';
import { BulkBar } from './BulkBar.jsx';
import { DisplayMenu } from './DisplayMenu.jsx';
import { FILTER_KEYS } from './filters.jsx';
import { appliedFilters, removeFilter, toggleFilter } from './filter-state.js';
import { FilterBar } from './FilterBar.jsx';
import { FilterMenu } from './FilterMenu.jsx';
import { IssueList } from './IssueList.jsx';
import { Conversations } from './Conversations.jsx';
import { IssueScopeMenu } from './IssueScopeMenu.jsx';
import { ScopeTabs } from './ScopeTabs.jsx';
import { AGENT_NAMES, leafIds, presetOf } from './model.js';
import { NewIssueDialog } from './NewIssueDialog.jsx';
import { keepVisible, selectRow } from './selection.js';
import { labelStore } from './labels.js';
import { useFacets } from './use-facets.js';
import { useIssueList } from './use-issue-list.js';
import { DEFAULT_VIEW, listRequest, useLayout, useViews } from './view.js';
import { isTyping } from '../lib/typing.js';
import { DeleteConfirm, DeleteIssuesDialog } from './DeleteIssuesDialog.jsx';
import { CHAT_TABS, CLASSIC_TABS, useSavedViews, viewKey } from './saved-views.js';
import { ViewNameDialog } from './ViewDialogs.jsx';
import { usePolled } from '../widgets/use-polled.js';
import { useSessionReturnState } from '../lib/session-return.jsx';

const SEARCH_DELAY_MS = 250;
const allItems = (groups) => groups.flatMap((group) => group.groups ? allItems(group.groups) : group.items ?? []);
// The key of a tab's view: the conversation layout keeps its filters and display options apart from the list's and the board's.
const scopeOf = (chat, tab) => (chat ? `chat:${tab}` : tab);
const NO_VIEWS = [];

export function IssuesWidget({ request, onOpen, onOpenSession, onPreviewSession }) {
  // The layout is the page's, and no tab or saved view changes it (owner, 2026-11-25: 「点击也不能切换模式」). The conversation layout has the three tabs it is fixed to (进行中, 未读, 全部;
  // no saved views: 「那会话模式就不需要这个东西了」) and its own filters; the list and the board share the set they always had (进行中, 待规划, 全部, with saved views), and a filter set in one set is not in the other.
  const [layout, changeLayout] = useLayout();
  const chat = layout === 'chat';
  const TABS = chat ? CHAT_TABS : CLASSIC_TABS;
  const [classicTab, setClassicTab] = useSessionReturnState('issues.tab', 'active');
  const [chatTab, setChatTab] = useSessionReturnState('issues.chat.tab', 'active');
  const setTab = chat ? setChatTab : setClassicTab;
  // The search page takes the conversation list's column (search/SearchPage.jsx) while it is open; it is the conversation layout's, so it closes when the page leaves that layout.
  const [searching, setSearching] = useState(false);
  const searchButton = useRef(null);
  const closeSearch = useCallback(() => {
    setSearching(false);
    requestAnimationFrame(() => searchButton.current?.focus({ preventScroll: true })); // the list is shown again by then: the focus goes back to the button that opened the page
  }, []);
  if (!chat && searching) setSearching(false);
  const [creating, setCreating] = useState(null); // null, or { preset, parent?, initial? } while the New issue window is open
  const [dialogKey, setDialogKey] = useState(0); // a window that opens anew starts from its own preset and text
  const startCreating = useCallback((next) => { setDialogKey((key) => key + 1); setCreating(next); }, []);
  const [search, setSearch] = useSessionReturnState('issues.search', '');
  const [searched, setSearched] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearched(search), SEARCH_DELAY_MS); return () => clearTimeout(timer); }, [search]);
  const { viewOf, update } = useViews();
  const { saved: savedViews, add: addView, rename: renameView, remove: removeView } = useSavedViews();
  const saved = chat ? NO_VIEWS : savedViews;
  const [naming, setNaming] = useState(null); // null, 'new', or the saved view being renamed
  const [removingView, setRemovingView] = useState(null);
  const toast = useToast();
  const wanted = chat ? chatTab : classicTab;
  const tab = TABS.includes(wanted) || saved.some((entry) => viewKey(entry.id) === wanted) ? wanted : 'active';
  // A saved view draws from one of the tabs (its base) and keeps its own filter and display options under its own key.
  const savedView = saved.find((entry) => viewKey(entry.id) === tab);
  const base = savedView ? savedView.base : TABS.includes(tab) ? tab : 'active';
  const scope = scopeOf(chat, tab);
  const view = useMemo(() => ({ ...viewOf(scope), layout }), [viewOf, scope, layout]);
  const query = useMemo(() => listRequest(base, view, Date.now(), view.layout !== 'chat' && base === 'all' ? searched : ''), [base, view, searched]);
  const list = useIssueList(request, query, !chat);
  const homeQuery = useMemo(() => ({ tab: query.tab, ...(query.filter ? { filter: query.filter } : {}) }), [query]);
  const home = usePolled(request, 'home/list', homeQuery, { every: 5000, enabled: chat });
  const invalidateHome = home.invalidate;
  useEffect(() => { if (chat && home.value?.statuses) receiveStatuses(home.value.statuses); }, [chat, home.value]);
  const { patch, move } = list;
  const refresh = useCallback(() => window.dispatchEvent(new Event('dudu:home-changed')), []);
  useEffect(() => {
    if (!chat) return undefined;
    const changed = () => { void invalidateHome(); };
    window.addEventListener('dudu:home-changed', changed);
    window.addEventListener('dudu:session-read', changed);
    return () => {
      window.removeEventListener('dudu:home-changed', changed);
      window.removeEventListener('dudu:session-read', changed);
    };
  }, [chat, invalidateHome]);
  const pinRequests = useRef(new Set());
  const [pinning, setPinning] = useState(() => new Set());
  // 重启会话: the agent's process of the conversation is closed; the next message starts a new one that resumes it (host: sessions/restart).
  const restart = useCallback(async (issue) => {
    try {
      const result = await request('sessions/restart', { session: issue.session });
      if (!['success', 'no_op'].includes(result?.outcome)) throw new Error();
    } catch { toast({ message: T.toast.failed }); }
  }, [request, toast]);
  const pin = useCallback(async (issue) => {
    const target = issue.id === 'assistant' ? 'assistant' : `issue:${issue.id}`;
    if (pinRequests.current.has(target)) return;
    pinRequests.current.add(target);
    setPinning(new Set(pinRequests.current));
    try {
      const result = await request('home/pin', { target, pinned: !issue.pinned });
      if (result.outcome !== 'success') throw new Error();
      if (issue.id !== 'assistant') patch(issue.id, { pinned: !issue.pinned });
    } catch { toast({ message: T.toast.failed }); }
    finally {
      refresh();
      pinRequests.current.delete(target);
      setPinning(new Set(pinRequests.current));
    }
  }, [request, patch, refresh, toast]);

  // Every change says so at the bottom.
  const changeStatus = useCallback(async (issue, status) => {
    if (status === issue.status) return;
    patch(issue.id, { status });
    try {
      const result = await request('issues/update', { id: issue.id, patch: { status } });
      if (result?.outcome === 'success') toast({ message: statusType(status) === 'done' ? T.toast.markedDone : T.toast.status(statusLabel(status)) });
    } catch { toast({ message: T.toast.failed }); } finally { refresh(); }
  }, [request, patch, refresh, toast]);
  const changeProperty = useCallback(async (issue, changes) => {
    if (changes.status) return changeStatus(issue, changes.status);
    patch(issue.id, changes.labels ? { ...changes, labels: labelStore.resolve(changes.labels) } : changes); // the labels the page shows are not the ids it sends
    try {
      const result = await request('issues/update', { id: issue.id, patch: changes });
      if (result.outcome === 'success') {
        const message = changes.priority ? T.toast.priority(T.priority[changes.priority])
          : Object.hasOwn(changes, 'dueAt') ? changes.dueAt == null ? T.toast.dueRemoved : T.toast.dueSet : T.toast.updated(1);
        toast({ message });
      } else if (result.outcome !== 'no_op') toast({ message: T.toast.failed });
      return result; // The title editor closes only after the store accepts the change.
    } catch { toast({ message: T.toast.failed }); } finally { refresh(); }
  }, [request, patch, refresh, toast, changeStatus]);
  // A card dropped on a lane: it is in the lane at once, and the lane's value is its (the status, the priority, the agent state).
  const moveCard = useCallback((issue, field, key) => {
    if (issue[field] === key) return undefined;
    move(issue.id, key, { [field]: key });
    return field === 'status' ? changeStatus(issue, key) : changeProperty(issue, { [field]: key });
  }, [move, changeStatus, changeProperty]);
  // "Add sub-issue" opens the New issue window with the issue as its parent and, the project of it.
  const addSub = useCallback((issue) => startCreating({ preset: { parent: issue.id, ...(issue.project ? { project: issue.project } : {}) }, parent: { id: issue.id, ref: issue.ref, title: issue.title, status: issue.status } }), [startCreating]);
  // "Make a copy…" opens the New issue window with the issue's title, description and values (not its agent or session), and its parent.
  const duplicate = useCallback((issue) => startCreating({
    preset: {
      status: issue.status, ...(issue.priority && issue.priority !== 'none' ? { priority: issue.priority } : {}), ...(issue.project ? { project: issue.project } : {}),
      ...(issue.labels?.length ? { labels: issue.labels.map((label) => label.id) } : {}), ...(issue.dueAt != null ? { dueAt: issue.dueAt } : {}), ...(issue.parent ? { parent: issue.parent.id } : {}),
    },
    ...(issue.parent ? { parent: { id: issue.parent.id, ref: issue.parent.ref, title: issue.parent.title, status: issue.parent.status } } : {}),
    initial: { title: issue.title, brief: issue.brief ?? '' },
  }), [startCreating]);
  const assignCard = useCallback(async (issue, agent, project) => {
    try {
      const result = await request('issues/assign', { id: issue.id, agent, project });
      if (result.outcome === 'success') toast({ message: T.toast.assigned(AGENT_NAMES[agent]) });
      else if (result.outcome !== 'no_op') toast({ message: T.toast.failed });
    } catch { toast({ message: T.toast.failed }); } finally { refresh(); }
  }, [request, refresh, toast]);

  // Ticked rows: what they are, and what a bulk change does to them all, in one group (the store logs them together).
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(null);
  const [deletedIssue, setDeletedIssue] = useState(null);
  const selectedIssues = (list.groups ? allItems(list.groups) : list.items).filter((issue) => selected.has(issue.id));
  const assignmentLocked = selectedIssues.length !== selected.size || selectedIssues.some((issue) => issue.agent);
  const sharedProject = selectedIssues[0]?.project;
  const assignmentProject = sharedProject?.path && selectedIssues.every((issue) => issue.project?.path === sharedProject.path) ? sharedProject : undefined;
  const anchor = useRef(null);
  const select = useCallback((id, shift, ids) => { setSelected((current) => selectRow(current, id, { shift, anchor: anchor.current, ids })); anchor.current = id; }, []);
  const visibleIds = useMemo(() => (list.groups ? leafIds(list.groups) : list.items.map((issue) => issue.id)), [list.items, list.groups]);
  useEffect(() => { setSelected((current) => keepVisible(current, visibleIds)); }, [visibleIds]);
  useEffect(() => { setSelected(new Set()); anchor.current = null; }, [scope, layout]);
  const bulk = useCallback(async (change, call) => {
    const ids = [...selected];
    const groupId = `bulk-${Date.now()}`;
    setSelected(new Set());
    for (const id of ids) patch(id, change);
    try {
      await Promise.all(ids.map((id) => call(id, groupId)));
      toast({ message: T.toast.updated(ids.length) });
    } catch { toast({ message: T.toast.failed }); } finally { refresh(); }
  }, [selected, patch, refresh, toast]);

  // What a row shows: the person's Display properties, minus what the grouping already says (a Project group needs no
  // Project chip on its rows; a Status group still keeps the status icon).
  const grouped = [view.group, view.subGroup];
  const show = useMemo(() => ({
    ...view.properties,
    updated: view.layout === 'list' ? view.listUpdated !== false : view.properties.updated,
    project: view.properties.project && !grouped.includes('project'),
    agent: view.properties.agent && !grouped.includes('agent'),
  }), [view.properties, view.layout, view.listUpdated, view.group, view.subGroup]); // eslint-disable-line react-hooks/exhaustive-deps -- `grouped` is those two

  // Folded groups and columns are remembered per tab while the page is open.
  const [folded, setFolded] = useState({});
  const collapsed = useMemo(() => new Set(folded[scope] ?? []), [folded, scope]);
  const toggleGroup = useCallback((id) => setFolded((previous) => {
    const set = new Set(previous[scope] ?? []);
    if (set.has(id)) set.delete(id); else set.add(id);
    return { ...previous, [scope]: [...set] };
  }), [scope]);

  // The filter menu opens from the icon beside the tabs, from "+ Filter" in the chip row, or with F.
  const root = useRef(null);
  const filterButton = useRef(null);
  const scopeButton = useRef(null);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [menu, setMenu] = useState({ open: false, anchor: null });
  const openFilter = useCallback((element, align) => {
    // Compact controls live in the scope popover; anchor their filters to the
    // persistent scope button before closing it, including the F shortcut.
    const compact = element?.closest('[data-conversation-compact-tools]');
    if (compact) setScopeMenuOpen(false);
    setMenu({ open: true, anchor: { element: compact ? scopeButton.current : element, align } });
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || searching) return; // the search page has the column: F has no filter button to open
      if (!root.current?.getClientRects().length || root.current.closest('[inert]')) return;
      if (event.key === 'Escape' && !event.defaultPrevented) { setSelected((current) => (current.size ? new Set() : current)); return; }
      const button = filterButton.current ?? scopeButton.current;
      if (event.key.toLowerCase() !== 'f' || !button) return;
      event.preventDefault();
      setScopeMenuOpen(false);
      if (chat) button.closest('[data-conversation-list-controls]')?.scrollIntoView({ block: 'nearest' });
      openFilter(button, chat ? 'start' : 'end');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chat, openFilter, searching]);
  const filtered = appliedFilters(view.filter, FILTER_KEYS).length > 0;
  const facets = useFacets(request, menu.open, query.tab === 'unread' ? 'all' : query.tab, query.filter);
  const addTo = useCallback((entry) => startCreating({ preset: presetOf(entry.field, entry.groupKey) }), [startCreating]);
  // 列表, 看板 and 会话 are the page's choice; the other display options are the tab's.
  const changeDisplay = ({ layout: next, ...rest }) => {
    if (next) changeLayout(next);
    if (Object.keys(rest).length) update(scope, rest);
  };
  const addViewButton = <Button variant="ghost" size="icon-sm" className="size-7 rounded-full text-muted-foreground"
    aria-label={T.views.add} title={T.views.add} onClick={() => setNaming('new')}><Layers /></Button>;
  const filterTrigger = <Button ref={filterButton} variant={chat ? 'ghost' : 'outline'} size="icon-sm"
    className={cn('size-7 rounded-full', chat && 'bg-[var(--dudu-scope-track)] text-muted-foreground', menu.open && 'bg-accent',
      chat && filtered && 'bg-[var(--dudu-soft)] text-[var(--dudu-strong)] hover:bg-[var(--dudu-soft)] hover:text-[var(--dudu-strong)] dark:hover:bg-[var(--dudu-soft)]')}
    aria-label={T.filterButton} title={T.filterButton} aria-haspopup="dialog" aria-expanded={menu.open}
    onClick={(event) => openFilter(event.currentTarget, chat ? 'start' : 'end')}>
    <ListFilter />
  </Button>;
  const actions = <>
    <DisplayMenu
      tab={base} view={view} onChange={changeDisplay}
      onReset={() => update(scope, (current) => ({ ...DEFAULT_VIEW, filter: current.filter }))}
      variant={chat ? 'ghost' : 'outline'} className={chat ? 'rounded-md text-muted-foreground' : undefined}
    />
    <Button variant={chat ? 'ghost' : 'outline'} size="icon-sm"
      className={cn('size-7', chat ? 'rounded-md text-muted-foreground' : 'rounded-full')}
      aria-label={T.newIssue.title} title={T.newIssue.title} onClick={() => { setScopeMenuOpen(false); startCreating({ preset: {} }); }}><Plus /></Button>
  </>;
  // The magnifier before Display options and the plus (owner, 2026-11-27: the desktop has room for it, so it is not folded into a ⋯); the narrow rail has no room for the page, so it has no button.
  const searchTrigger = <Button ref={searchButton} variant="ghost" size="icon-sm" className="size-7 rounded-md text-muted-foreground"
    aria-label={T.searchPage.open} title={T.searchPage.open} onClick={() => setSearching(true)}><Search /></Button>;
  const searchControl = base === 'all' && <div className="relative">
    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <input
      type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={T.search.placeholder} aria-label={T.search.label}
      className="h-7 w-[150px] rounded-full border bg-background pr-3 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 @[560px]:w-[220px]"
    />
  </div>;
  const clearFilters = () => update(scope, { filter: {} });
  const filterBar = !chat && filtered && <FilterBar
    filter={view.filter} onAdd={(element) => openFilter(element, 'start')}
    onRemove={(field) => update(scope, (current) => ({ filter: removeFilter(current.filter, field) }))}
    onClear={clearFilters}
  />;
  const filterMenu = <FilterMenu
    open={menu.open} anchor={menu.anchor} filter={view.filter} counts={chat ? home.value?.counts : list.counts} facets={facets}
    onOpenChange={(open) => setMenu((current) => ({ ...current, open }))}
    onToggle={(field, value) => update(scope, (current) => ({ filter: toggleFilter(current.filter, field, value) }))}
    canReset={filtered} onReset={() => {
      clearFilters();
      if (chat) return;
      // Clearing removes the chip bar and its "+ Filter" anchor.
      setMenu({ open: false, anchor: { element: filterButton.current, align: 'end' } });
    }}
  />;
  const conversationHeader = (compact) => <header className="dudu-conversation-toolbar">
    {compact ? (
      <IssueScopeMenu value={tab} onChange={setTab} open={scopeMenuOpen} onOpenChange={setScopeMenuOpen} triggerRef={scopeButton} highlighted={filtered}>
        <div data-conversation-compact-tools>
          <div className="flex items-center justify-end gap-1.5 px-1.5 pt-1.5 pb-2">{filterTrigger}{actions}</div>
        </div>
      </IssueScopeMenu>
    ) : <div className="ml-auto flex shrink-0 items-center gap-1.5">{searchTrigger}{actions}</div>}
  </header>;
  const conversationControls = <>
    <div className="flex min-w-0 items-center gap-1.5 px-4 py-1" data-conversation-list-controls>
      {filterTrigger}
      <ScopeTabs tabs={TABS} value={tab} label={T.widgets.titles.issues} />
    </div>
  </>;

  return (
    <section ref={root} aria-label={T.widgets.titles.issues} className="@container relative flex h-full min-h-0 flex-col">
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        {!chat && <div className="flex h-11 shrink-0 items-center gap-1.5 px-3">
          {/* The tabs give way to what is beside them (saved views can be many, and the smallest widget is narrow): they scroll sideways in their own row, with no bar. */}
          <Tabs.List className="-mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" aria-label={T.widgets.titles.issues}>
            {TABS.map((id) => (
              <Tabs.Trigger key={id} value={id} asChild>
                <Button variant={tab === id ? 'secondary' : 'outline'} size="sm" className={cn('h-7 rounded-full px-3 text-xs', tab === id && 'font-medium')}>{T.tabs[id]}</Button>
              </Tabs.Trigger>
            ))}
            {saved.map((entry) => (
              <ContextMenu key={entry.id}>
                <ContextMenuTrigger asChild>
                  <Tabs.Trigger value={viewKey(entry.id)} asChild>
                    <Button variant={tab === viewKey(entry.id) ? 'secondary' : 'outline'} size="sm" data-saved-view={entry.id} title={entry.name}
                      className={cn('h-7 max-w-[180px] rounded-full px-3 text-xs', tab === viewKey(entry.id) && 'font-medium')}><span className="truncate">{entry.name}</span></Button>
                  </Tabs.Trigger>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => setNaming(entry)}>{T.views.rename}</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => setRemovingView(entry)}>{T.views.delete}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </Tabs.List>
          {addViewButton}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {searchControl}
            {filterTrigger}
            {actions}
          </div>
        </div>}
        {filterBar}
        {chat ? <Conversations
          request={request} home={home} scope={savedView ? tab : JSON.stringify({ tab: base })} listKey={JSON.stringify(homeQuery)}
          header={conversationHeader} controls={conversationControls} deletedIssue={deletedIssue} onOpen={onOpen}
          onChange={changeProperty} onAssign={assignCard} onDelete={(issue) => setDeleting([issue.id])}
          onAddSub={addSub} onDuplicate={duplicate} onRestart={restart} onPin={pin} pinning={pinning} search={{ open: searching, onClose: closeSearch }}
        /> : list.status === 'error' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <span>{T.loadFailed}</span>
            <Button variant="outline" size="sm" onClick={list.retry}>{T.retry}</Button>
          </div>
        ) : list.status === 'ready' && list.items.length === 0 && !list.groups?.length ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">{T.empty}</div>
        ) : (
          view.layout === 'board'
            ? <Board list={list} view={view} tab={base} show={show} collapsed={collapsed} onToggleLane={toggleGroup} onAddToLane={addTo} onStatus={changeStatus} onMove={moveCard} onOpen={onOpen}
                request={request} onChange={changeProperty} onAssign={assignCard} onDelete={(issue) => setDeleting([issue.id])} onOpenSession={onOpenSession} onAddSub={addSub} onDuplicate={duplicate} onPreviewSession={onPreviewSession} />
            : (
              <IssueList
                list={list} view={view} tab={base} show={show} collapsed={collapsed} onToggleGroup={toggleGroup} onAddToGroup={addTo}
                selected={selected} onSelect={select} onStatus={changeStatus} onMove={moveCard} onOpen={onOpen}
                request={request} onChange={changeProperty} onAssign={assignCard} onDelete={(issue) => setDeleting([issue.id])} onOpenSession={onOpenSession} onAddSub={addSub} onDuplicate={duplicate} onPreviewSession={onPreviewSession}
                onPin={pin} pinning={pinning}
              />
            )
        )}
        {!chat && base === 'all' && list.status === 'ready' && (
          <footer className="flex h-9 shrink-0 items-center border-t px-4 text-xs text-muted-foreground">{T.total(list.total)}</footer>
        )}
      </Tabs.Root>
      {selected.size > 0 && view.layout === 'list' && (
        <BulkBar
          request={request}
          project={assignmentProject} assignmentLocked={assignmentLocked}
          count={selected.size} onClear={() => setSelected(new Set())}
          onStatus={(status) => bulk({ status }, (id, groupId) => request('issues/update', { id, patch: { status }, groupId }))}
          onPriority={(priority) => bulk({ priority }, (id, groupId) => request('issues/update', { id, patch: { priority }, groupId }))}
          onAgent={(agent, project) => bulk({ agent, ...(project ? { project } : {}) }, (id, groupId) => request('issues/assign', { id, agent, ...(project ? { project } : {}), groupId }))}
          onDelete={() => setDeleting([...selected])}
        />
      )}
      {naming && <ViewNameDialog key={naming === 'new' ? 'new' : naming.id} open title={naming === 'new' ? T.views.newTitle : T.views.renameTitle} initial={naming === 'new' ? '' : naming.name}
        confirm={naming === 'new' ? T.views.create : T.views.save} onClose={() => setNaming(null)}
        onSubmit={(name) => {
          if (naming === 'new') {
            // the new view starts as the tab it was made from looks now: the same filter and display options
            const id = addView(name, base);
            update(viewKey(id), viewOf(scope));
            setTab(viewKey(id));
          } else renameView(naming.id, name);
          setNaming(null);
        }} />}
      <DeleteConfirm open={Boolean(removingView)} onClose={() => setRemovingView(null)} title={T.views.deleteTitle(removingView?.name ?? '')} description={T.views.deleteScope}
        onDelete={() => { if (tab === viewKey(removingView.id)) setTab(TABS.includes(removingView.base) ? removingView.base : 'active'); removeView(removingView.id); setRemovingView(null); }} />
      <DeleteIssuesDialog request={request} ids={deleting} onClose={() => setDeleting(null)} onDeleted={() => {
        if (chat) setDeletedIssue(deleting?.[0]);
        setSelected(new Set());
        refresh();
      }} />
      <NewIssueDialog
        request={request}
        key={dialogKey} open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }} preset={creating?.preset} parent={creating?.parent} initial={creating?.initial}
        onCreate={async (fields) => { const result = await request('issues/add', { fields }); if (result?.outcome === 'success') refresh(); return result; }}
      />
      {filterMenu}
    </section>
  );
}
