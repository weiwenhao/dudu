import { forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import { Check, ListFilter, RotateCcw, Trash2 } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { Button } from '../components/button.jsx';
import { Checkbox } from '../components/checkbox.jsx';
import { useToast } from '../components/toast.jsx';
import { cn } from '../lib/cn.js';
import { isTyping } from '../lib/typing.js';
import { when } from '../issues/activity.js';
import { appliedFilters, removeFilter, toggleFilter } from '../issues/filter-state.js';
import { FilterBar } from '../issues/FilterBar.jsx';
import { FilterMenu } from '../issues/FilterMenu.jsx';
import { StatusIcon } from '../issues/icons.jsx';
import { keepVisible, selectRow } from '../issues/selection.js';
import { NewIssueDialog } from '../issues/NewIssueDialog.jsx';
import { T } from '../strings.js';
import { BulkBar } from './BulkBar.jsx';
import { ConnectorAvatar } from './ConnectorAvatar.jsx';
import { COLLECTOR_FIELDS, COLLECTOR_KEYS, COLLECTOR_SCHEMA, SINGLE } from './filters.jsx';
import { issueRef } from './IssuePicker.jsx';
import { RecordDialog } from './RecordDialog.jsx';
import { RecordMenu } from './RecordMenu.jsx';
import { useNarrowness } from './use-narrowness.js';
import { useRecords } from './use-records.js';
import { TABS, useCollectorView } from './view.js';

const NEAR_END = 120; // px from the end of the list at which the next page is asked for
// The widths (px) under which the bulk bar, which stays on one line, gives up room: below the first its actions are icons (with the words, the bar is 674px
// and wants 12px at each side), below the second its count is left to screen readers too (a widget is 196px wide at the narrowest, 362px at 1440px).
const BAR_STEPS = [700, 256];

/**
 * One row: a box to tick it, then where it comes from as a small picture (the owner, 2026-11-07: the box goes in front of the picture, it does not cover it), the title
 * and when, then who it is from and which collector brought it (the issue it became, in place of the time, once it is handled). As in Issues, the box has a place of its
 * own that every row keeps, so the pictures line up; it shows when the pointer is on the row, and on every row once any row is ticked. The pointer on the row also brings
 * the two things that are one click: handled, and delete (restore, in their place, for a row that was put aside or handled). A row that is handled has nothing to do in
 * bulk: no box, and no place for one.
 */
const Row = forwardRef(function Row({ record, tab, selected, selecting, onSelect, onOpen, onDone, onRemove, onRestore, className, ...props }, ref) {
  const by = [record.from, record.connectorName].filter(Boolean).join(' · ');
  const boxed = selected || selecting;
  // Handled with an issue is the issue's: nothing to do with it here. Anything else has the two one-click buttons.
  const quick = tab === 'todo' ? [[T.collector.markDone, Check, onDone], [T.collector.remove, Trash2, onRemove]]
    : record.issue ? [] : [[T.collector.restore, RotateCcw, onRestore], [T.collector.remove, Trash2, onRemove]];
  return (
    <div ref={ref} {...props} data-record-row={record.id}
      className={cn('group relative flex h-12 w-full shrink-0 items-center gap-2.5 rounded-lg px-3 hover:bg-accent/60 has-[:focus-visible]:bg-accent/60 data-[state=open]:bg-accent/60', selected && 'bg-accent/60', className)}>
      {tab !== 'done' && (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Checkbox
            checked={selected} aria-label={T.bulk.select(record.title)}
            className={cn(!boxed && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
            onClick={(event) => { event.stopPropagation(); onSelect(record.id, event.shiftKey); }}
          />
        </span>
      )}
      <ConnectorAvatar icon={record.connectorIcon} name={record.connectorName} />
      <button type="button" onClick={onOpen} className="flex h-full min-w-0 flex-1 flex-col justify-center rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate font-medium">{record.title}</span>
          <span className={cn('flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums', quick.length > 0 && !boxed && 'group-hover:opacity-0 group-focus-within:opacity-0')}>
            {tab === 'done' && record.issue ? <><StatusIcon status={record.issue.status} />{issueRef(record.issue)}</> : when(record.at)}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">{by}</span>
      </button>
      {quick.length > 0 && (
        <span className={cn('absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100', boxed && 'hidden')}>
          {quick.map(([label, Icon, run]) => (
            <Button key={label} variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={() => run(record)}><Icon aria-hidden="true" /></Button>
          ))}
        </span>
      )}
    </div>
  );
});

/**
 * What the connectors collected (docs/assistant.md 4.1, "Collector"): three tabs (to handle, handled, ignored), a filter like Issues', a row
 * for each record. A click opens it in full; a right click shares it to an issue, makes an issue of it, opens its source, or ignores it.
 * Reading and the owner's marks are the plugin's `inbox/*` calls; nothing here asks a model.
 */
export function CollectorWidget({ request, openIssue }) {
  const toast = useToast();
  const root = useRef(null);
  const narrow = useNarrowness(root, BAR_STEPS);
  const view = useCollectorView();
  const { tab } = view;
  const filter = view.filterOf(tab);
  const scope = JSON.stringify([tab, filter]);
  const [paged, setPaged] = useState({ scope, pages: 1 });
  const pages = paged.scope === scope ? paged.pages : 1;
  const records = useRecords(request, { tab, filter, pages });
  const { refresh } = records;
  const items = records.value?.items ?? [];
  const [opened, setOpened] = useState(null);
  const [creating, setCreating] = useState(null);

  // Ticked rows, by record number: what a bulk action is done to. They go with the tab or the filter (a new one starts with nothing ticked, and going
  // back to the old one does not bring the ticks back), and with a row that leaves the list (derived at each draw from what was ticked in this scope).
  const [picked, setPicked] = useState({ scope, ids: new Set() });
  if (picked.scope !== scope) setPicked({ scope, ids: new Set() });
  const anchor = useRef(null);
  const visibleIds = items.map((record) => record.id);
  const selected = picked.scope === scope ? keepVisible(picked.ids, visibleIds) : new Set();
  const select = (id, shift) => {
    setPicked({ scope, ids: selectRow(selected, id, { shift, anchor: anchor.current, ids: visibleIds }) });
    anchor.current = id;
  };
  const clearSelection = () => { setPicked({ scope, ids: new Set() }); anchor.current = null; };
  const chosen = items.filter((record) => selected.has(record.id));
  // "Select all", in the bar that comes up once a row is ticked: every row that is loaded; it is not offered when they all are ticked already.
  const allSelected = items.length > 0 && selected.size === items.length;
  const selectAll = () => {
    setPicked({ scope, ids: new Set(visibleIds) });
    anchor.current = null;
  };

  // A filter keeps the connectors by id; the chips say them by name, which the list brings.
  const names = records.value?.names;

  const filterButton = useRef(null);
  const [menu, setMenu] = useState({ open: false, anchor: null });
  const openFilter = (element, align) => setMenu({ open: true, anchor: { element, align } });
  const filtered = appliedFilters(filter, COLLECTOR_KEYS).length > 0;
  const more = records.value?.nextCursor != null;
  // A page is 50 rows, more than any widget holds, so there is something to scroll whenever there is more to ask for.
  const wantMore = () => setPaged((current) => ({ scope, pages: (current.scope === scope ? current.pages : 1) + 1 }));

  const call = useCallback(async (action, body) => {
    try { return await request(action, body); } catch { return null; }
  }, [request]);
  const ok = (result) => ['success', 'no_op'].includes(result?.outcome);
  const actions = useMemo(() => {
    // One mark (ignore, restore) on one or several records, with one Undo for all of them.
    const mark = async (action, back, records, message) => {
      const ids = records.map((record) => record.id);
      if (!ok(await call(action, { ids }))) { toast({ message: T.toast.failed }); return; }
      refresh();
      toast({ message, action: { label: T.toast.undo, run: async () => { await call(back, { ids }); refresh(); } } });
    };
    // One or several records shared to an issue (a note in its activity) or to the session of one (a message to its agent).
    const shareTo = async (records, issue, to) => {
      const ids = records.map((record) => record.id);
      if (!ok(await call('inbox/share', { ids, issue: issue.id, ...(to === 'session' ? { to } : {}) }))) { toast({ message: T.toast.failed }); return; }
      refresh();
      toast({ message: to === 'session' ? T.collector.toast.sharedSession(issueRef(issue)) : T.collector.toast.shared(issueRef(issue)) });
    };
    return {
      openSource: (record) => window.open(record.url, '_blank', 'noopener,noreferrer'),
      openIssue: (record) => { if (record.issue) openIssue?.(record.issue.id); },
      ignore: (record) => mark('inbox/ignore', 'inbox/restore', [record], T.collector.toast.ignored),
      // Restore takes the mark off; its Undo puts the same mark back (a row handled on its own, or put aside).
      restore: (record) => mark('inbox/restore', tab === 'done' ? 'inbox/done' : 'inbox/ignore', [record], T.collector.toast.restored),
      ignoreMany: (records) => mark('inbox/ignore', 'inbox/restore', records, T.collector.toast.ignored),
      restoreMany: (records) => mark('inbox/restore', tab === 'done' ? 'inbox/done' : 'inbox/ignore', records, T.collector.toast.restored),
      // Handled on their own (no issue needed), or wrong: Undo is Restore, which brings a deleted row back to the tab it was in.
      done: (record) => mark('inbox/done', 'inbox/restore', [record], T.collector.toast.done),
      doneMany: (records) => mark('inbox/done', 'inbox/restore', records, T.collector.toast.done),
      remove: (record) => mark('inbox/delete', 'inbox/restore', [record], T.collector.toast.deleted),
      removeMany: (records) => mark('inbox/delete', 'inbox/restore', records, T.collector.toast.deleted),
      share: (record, issue) => shareTo([record], issue, 'issue'),
      shareMany: (records, issue) => shareTo(records, issue, 'issue'),
      shareSession: (record, issue) => shareTo([record], issue, 'session'),
      shareSessionMany: (records, issue) => shareTo(records, issue, 'session'),
      // The New issue dialog opens with the record's title and text; the issue it makes is marked as the record's, and the record is linked to it.
      async makeIssue(record, draft) {
        const found = draft ?? (await call('inbox/get', { id: record.id }))?.draft;
        if (found) setCreating({ record, draft: found }); else toast({ message: T.toast.failed });
      },
    };
  }, [call, openIssue, refresh, tab, toast]);

  return (
    <section ref={root} aria-label={T.widgets.titles.collector} className="@container relative flex h-full min-h-0 flex-col"
      // F opens the filter, as in Issues, but only while the focus is in this widget: two widgets on one page would otherwise both answer.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && selected.size) { clearSelection(); return; }
        if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || event.key.toLowerCase() !== 'f' || !filterButton.current) return;
        event.preventDefault();
        openFilter(filterButton.current, 'end');
      }}>
      {/* The filter sits in the title row, at the right edge the tab row kept it at (the owner moved it up, 2026-11-05). */}
      <header className="flex h-12 shrink-0 items-center gap-2 pr-3 pl-4">
        <h2 className="font-semibold">{T.widgets.titles.collector}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            ref={filterButton} variant="outline" size="icon-sm" className={cn('size-7 rounded-full', menu.open && 'bg-accent')}
            aria-label={T.filterButton} aria-haspopup="dialog" aria-expanded={menu.open} onClick={(event) => openFilter(event.currentTarget, 'end')}
          >
            <ListFilter />
          </Button>
        </div>
      </header>
      <Tabs.Root value={tab} onValueChange={view.setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1.5 px-3">
          {/* In the narrowest widget the three tabs are wider than it: they scroll sideways in their own row, with no bar. */}
          <Tabs.List className="-mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" aria-label={T.widgets.titles.collector}>
            {TABS.map((id) => (
              <Tabs.Trigger key={id} value={id} asChild>
                <Button variant={tab === id ? 'secondary' : 'outline'} size="sm" className={cn('h-7 rounded-full px-3 text-xs', tab === id && 'font-medium')}>{T.collector.tabs[id]}</Button>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>
        {filtered && (
          <FilterBar
            filter={filter} fields={COLLECTOR_FIELDS} keys={COLLECTOR_KEYS} labelOf={(key, value) => (key === 'connector' ? names?.[value] ?? value : undefined)}
            onAdd={(element) => openFilter(element, 'start')}
            onRemove={(field) => view.setFilter(tab, (current) => removeFilter(current, field))}
            onClear={() => view.setFilter(tab, {})}
          />
        )}
        {records.status === 'error' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <span>{T.collector.loadFailed}</span>
            <Button variant="outline" size="sm" onClick={refresh}>{T.retry}</Button>
          </div>
        ) : records.status === 'ready' && items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">{T.collector.empty}</div>
        ) : (
          <div
            className="mx-3 mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto pb-2"
            onScroll={(event) => { const element = event.currentTarget; if (more && element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_END) wantMore(); }}
          >
            {items.map((record) => (
              <RecordMenu key={record.id} record={record} tab={tab} request={request} actions={actions}>
                <Row
                  record={record} tab={tab} selected={selected.has(record.id)} selecting={selected.size > 0} onSelect={select} onOpen={() => setOpened(record)}
                  onDone={actions.done} onRemove={actions.remove} onRestore={actions.restore}
                />
              </RecordMenu>
            ))}
          </div>
        )}
      </Tabs.Root>
      {chosen.length > 0 && tab !== 'done' && (
        <BulkBar
          request={request} tab={tab} level={narrow} count={chosen.length} onClear={clearSelection} onSelectAll={allSelected ? undefined : selectAll}
          onShare={(issue) => { actions.shareMany(chosen, issue); clearSelection(); }}
          onShareSession={(issue) => { actions.shareSessionMany(chosen, issue); clearSelection(); }}
          onIgnore={() => { actions.ignoreMany(chosen); clearSelection(); }}
          onRestore={() => { actions.restoreMany(chosen); clearSelection(); }}
          onDone={() => { actions.doneMany(chosen); clearSelection(); }}
          onDelete={() => { actions.removeMany(chosen); clearSelection(); }}
        />
      )}
      <FilterMenu
        open={menu.open} anchor={menu.anchor} filter={filter} facets={records.value?.facets} schema={COLLECTOR_SCHEMA}
        onOpenChange={(open) => setMenu((current) => ({ ...current, open }))}
        onToggle={(field, value) => view.setFilter(tab, (current) => toggleFilter(current, field, value, SINGLE))}
      />
      {opened && <RecordDialog key={opened.id} card={opened} tab={tab} request={request} actions={actions} onClose={() => { setOpened(null); refresh(); }} />}
      {creating && (
        <NewIssueDialog
          key={creating.record.id} open request={request} initial={creating.draft} preset={{ source: 'connector', sourceRef: creating.draft.sourceRef }}
          onOpenChange={(open) => { if (!open) setCreating(null); }}
          onCreate={async (fields) => {
            const made = await request('issues/add', { fields });
            if (made?.outcome === 'success') { await call('inbox/link', { id: creating.record.id, issue: made.issue.id }); refresh(); }
            return made;
          }}
        />
      )}
    </section>
  );
}

