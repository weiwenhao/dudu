import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListFilter, Plus } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Button } from '../components/button.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { Board } from './Board.jsx';
import { DisplayMenu } from './DisplayMenu.jsx';
import { FILTER_KEYS } from './filters.jsx';
import { appliedFilters, removeFilter, toggleFilter } from './filter-state.js';
import { FilterBar } from './FilterBar.jsx';
import { FilterMenu } from './FilterMenu.jsx';
import { IssueList } from './IssueList.jsx';
import { NewIssueDialog } from './NewIssueDialog.jsx';
import { useFacets } from './use-facets.js';
import { useIssueList } from './use-issue-list.js';
import { DEFAULT_VIEW, listRequest, useViews } from './view.js';

const TABS = ['active', 'backlog', 'all'];
const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function IssuesWidget({ request, onOpen }) {
  const [tab, setTab] = useState('active');
  const [creating, setCreating] = useState(false);
  const { viewOf, update } = useViews();
  const view = viewOf(tab);
  const query = useMemo(() => listRequest(tab, view), [tab, view]);
  const list = useIssueList(request, query);
  const { patch, refresh } = list;
  const changeStatus = useCallback(async (issue, status) => {
    if (status === issue.status) return;
    patch(issue.id, { status });
    try { await request('issues/update', { id: issue.id, patch: { status } }); }
    catch { /* the refresh below shows what the server really has */ }
    finally { refresh(); }
  }, [request, patch, refresh]);

  // What a row shows: the person's Display properties, minus what the grouping already says (a Project group needs no
  // Project chip on its rows; a Status group still keeps the status icon).
  const grouped = [view.group, view.subGroup];
  const show = useMemo(() => ({
    ...view.properties,
    project: view.properties.project && !grouped.includes('project'),
    agent: view.properties.agent && !grouped.includes('agent'),
  }), [view.properties, view.group, view.subGroup]); // eslint-disable-line react-hooks/exhaustive-deps -- `grouped` is those two

  // Folded groups are remembered per tab while the page is open.
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
      if (event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (!root.current?.getClientRects().length || !filterButton.current) return; // a hidden page does not take keys
      event.preventDefault();
      openFilter(filterButton.current, 'end');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFilter]);
  const filtered = appliedFilters(view.filter, FILTER_KEYS).length > 0;
  const facets = useFacets(request, menu.open, query.tab, query.filter);

  return (
    <section ref={root} aria-label={T.issues} className="@container flex h-full min-h-0 flex-col rounded-2xl border bg-card text-card-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <h2 className="font-semibold">{T.issues}</h2>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setCreating(true)}><Plus />{T.newIssue.title}</Button>
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
            ? <Board list={list} view={view} tab={tab} show={show} onStatus={changeStatus} onOpen={onOpen} />
            : <IssueList list={list} view={view} tab={tab} show={show} collapsed={collapsed} onToggleGroup={toggleGroup} onStatus={changeStatus} onOpen={onOpen} />
        )}
      </Tabs.Root>
      <NewIssueDialog
        open={creating} onOpenChange={setCreating}
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
