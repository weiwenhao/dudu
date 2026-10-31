import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListFilter, Plus, Search } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Button } from '../components/button.jsx';
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
import { leafIds, presetOf } from './model.js';
import { NewIssueDialog } from './NewIssueDialog.jsx';
import { keepVisible, selectRow } from './selection.js';
import { useFacets } from './use-facets.js';
import { useIssueList } from './use-issue-list.js';
import { DEFAULT_VIEW, listRequest, useViews } from './view.js';
import { isTyping } from '../lib/typing.js';

const TABS = ['active', 'backlog', 'all'];
const SEARCH_DELAY_MS = 250;

export function IssuesWidget({ request, onOpen }) {
  const [tab, setTab] = useState('active');
  const [creating, setCreating] = useState(null); // null, or { preset } while the New issue window is open
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState('');
  useEffect(() => { const timer = setTimeout(() => setSearched(search), SEARCH_DELAY_MS); return () => clearTimeout(timer); }, [search]);
  const { viewOf, update } = useViews();
  const toast = useToast();
  const view = viewOf(tab);
  const query = useMemo(() => listRequest(tab, view, Date.now(), tab === 'all' ? searched : ''), [tab, view, searched]);
  const list = useIssueList(request, query);
  const { patch, refresh } = list;

  // Every change says so at the bottom, with Undo; the store keeps what it needs to put it back (an event, or a group of them).
  const undoable = useCallback((target) => ({
    label: T.toast.undo,
    run: async () => { try { await request('issues/undo', { target }); } finally { refresh(); } },
  }), [request, refresh]);
  const changeStatus = useCallback(async (issue, status) => {
    if (status === issue.status) return;
    patch(issue.id, { status });
    try {
      const result = await request('issues/update', { id: issue.id, patch: { status } });
      if (result?.outcome === 'success') toast({ message: status === 'done' ? T.toast.markedDone : T.toast.status(T.status[status]), action: undoable({ eventId: result.eventId }) });
    } catch { toast({ message: T.toast.failed }); } finally { refresh(); }
  }, [request, patch, refresh, toast, undoable]);

  // Ticked rows: what they are, and what a bulk change does to them all in one group, so one Undo puts them all back.
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);
  const select = useCallback((id, shift, ids) => { setSelected((current) => selectRow(current, id, { shift, anchor: anchor.current, ids })); anchor.current = id; }, []);
  const visibleIds = useMemo(() => (list.groups ? leafIds(list.groups) : list.items.map((issue) => issue.id)), [list.items, list.groups]);
  useEffect(() => { setSelected((current) => keepVisible(current, visibleIds)); }, [visibleIds]);
  useEffect(() => { setSelected(new Set()); anchor.current = null; }, [tab]);
  const bulk = useCallback(async (change, call) => {
    const ids = [...selected];
    const groupId = `bulk-${Date.now()}`;
    setSelected(new Set());
    for (const id of ids) patch(id, change);
    try {
      await Promise.all(ids.map((id) => call(id, groupId)));
      toast({ message: T.toast.updated(ids.length), action: undoable({ groupId }) });
    } catch { toast({ message: T.toast.failed }); } finally { refresh(); }
  }, [selected, patch, refresh, toast, undoable]);

  // What a row shows: the person's Display properties, minus what the grouping already says (a Project group needs no
  // Project chip on its rows; a Status group still keeps the status icon).
  const grouped = [view.group, view.subGroup];
  const show = useMemo(() => ({
    ...view.properties,
    project: view.properties.project && !grouped.includes('project'),
    agent: view.properties.agent && !grouped.includes('agent'),
  }), [view.properties, view.group, view.subGroup]); // eslint-disable-line react-hooks/exhaustive-deps -- `grouped` is those two

  // Folded groups and columns are remembered per tab while the page is open.
  const [folded, setFolded] = useState({});
  const collapsed = useMemo(() => new Set(folded[tab] ?? []), [folded, tab]);
  const toggleGroup = useCallback((id) => setFolded((previous) => {
    const set = new Set(previous[tab] ?? []);
    if (set.has(id)) set.delete(id); else set.add(id);
    return { ...previous, [tab]: [...set] };
  }), [tab]);

  // The filter menu opens from the icon beside the tabs, from "+ Filter" in the chip row, or with F.
  const root = useRef(null);
  const filterButton = useRef(null);
  const [menu, setMenu] = useState({ open: false, anchor: null });
  const openFilter = useCallback((element, align) => setMenu({ open: true, anchor: { element, align } }), []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (!root.current?.getClientRects().length) return; // a hidden page does not take keys
      if (event.key === 'Escape' && !event.defaultPrevented) { setSelected((current) => (current.size ? new Set() : current)); return; }
      if (event.key.toLowerCase() !== 'f' || !filterButton.current) return;
      event.preventDefault();
      openFilter(filterButton.current, 'end');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFilter]);
  const filtered = appliedFilters(view.filter, FILTER_KEYS).length > 0;
  const facets = useFacets(request, menu.open, query.tab, query.filter);
  const addTo = useCallback((entry) => setCreating({ preset: presetOf(entry.field, entry.groupKey) }), []);

  return (
    <section ref={root} aria-label={T.issues} className="@container relative flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <h2 className="font-semibold">{T.issues}</h2>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setCreating({ preset: {} })}><Plus />{T.newIssue.title}</Button>
      </header>
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1.5 px-3">
          <Tabs.List className="flex items-center gap-1.5" aria-label={T.issues}>
            {TABS.map((id) => (
              <Tabs.Trigger key={id} value={id} asChild>
                <Button variant={tab === id ? 'secondary' : 'outline'} size="sm" className={cn('h-7 rounded-full px-3 text-xs', tab === id && 'font-medium')}>{T.tabs[id]}</Button>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="ml-auto flex items-center gap-1.5">
            {tab === 'all' && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={T.search.placeholder} aria-label={T.search.label}
                  className="h-7 w-[150px] rounded-full border bg-background pr-3 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 @[560px]:w-[220px]"
                />
              </div>
            )}
            <Button
              ref={filterButton} variant="outline" size="icon-sm" className={cn('size-7 rounded-full', menu.open && 'bg-accent')}
              aria-label={T.filterButton} aria-haspopup="dialog" aria-expanded={menu.open} onClick={(event) => openFilter(event.currentTarget, 'end')}
            >
              <ListFilter />
            </Button>
            <DisplayMenu
              tab={tab} view={view} onChange={(change) => update(tab, change)}
              onReset={() => update(tab, (current) => ({ ...DEFAULT_VIEW, filter: current.filter }))}
            />
          </div>
        </div>
        {filtered && (
          <FilterBar
            filter={view.filter} onAdd={(element) => openFilter(element, 'start')}
            onRemove={(field) => update(tab, (current) => ({ filter: removeFilter(current.filter, field) }))}
            onClear={() => update(tab, { filter: {} })}
          />
        )}
        {list.status === 'error' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <span>{T.loadFailed}</span>
            <Button variant="outline" size="sm" onClick={list.retry}>{T.retry}</Button>
          </div>
        ) : list.status === 'ready' && list.items.length === 0 && !list.groups?.length ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">{T.empty}</div>
        ) : (
          view.layout === 'board'
            ? <Board list={list} view={view} tab={tab} show={show} collapsed={collapsed} onToggleLane={toggleGroup} onAddToLane={addTo} onStatus={changeStatus} onOpen={onOpen} />
            : (
              <IssueList
                list={list} view={view} tab={tab} show={show} collapsed={collapsed} onToggleGroup={toggleGroup} onAddToGroup={addTo}
                selected={selected} onSelect={select} onStatus={changeStatus} onOpen={onOpen}
              />
            )
        )}
        {tab === 'all' && list.status === 'ready' && (
          <footer className="flex h-9 shrink-0 items-center border-t px-4 text-xs text-muted-foreground">{T.total(list.total)}</footer>
        )}
      </Tabs.Root>
      {selected.size > 0 && view.layout !== 'board' && (
        <BulkBar
          count={selected.size} onClear={() => setSelected(new Set())}
          onStatus={(status) => bulk({ status }, (id, groupId) => request('issues/update', { id, patch: { status }, groupId }))}
          onPriority={(priority) => bulk({ priority }, (id, groupId) => request('issues/update', { id, patch: { priority }, groupId }))}
          onAgent={(agent) => bulk({ agent }, (id, groupId) => request('issues/assign', { id, agent, groupId }))}
        />
      )}
      <NewIssueDialog
        open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }} preset={creating?.preset}
        onCreate={async (fields) => { const result = await request('issues/add', { fields }); if (result?.outcome === 'success') refresh(); return result; }}
      />
      <FilterMenu
        open={menu.open} anchor={menu.anchor} filter={view.filter} counts={list.counts} facets={facets}
        onOpenChange={(open) => setMenu((current) => ({ ...current, open }))}
        onToggle={(field, value) => update(tab, (current) => ({ filter: toggleFilter(current.filter, field, value) }))}
      />
    </section>
  );
}
