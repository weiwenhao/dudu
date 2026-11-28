import { forwardRef, useRef, useState } from 'react';
import { Check, ListFilter, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
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
import { ConversationMark } from '../issues/ConversationAvatar.jsx';
import { StatusIcon } from '../issues/icons.jsx';
import { keepVisible, selectRow } from '../issues/selection.js';
import { NewIssueDialog } from '../issues/NewIssueDialog.jsx';
import { T } from '../strings.js';
import { BulkBar } from './BulkBar.jsx';
import { MenuIcon } from '../components/menu-icon.jsx';
import { ConnectorAvatar } from './ConnectorAvatar.jsx';
import { COLLECTOR_FIELDS, COLLECTOR_KEYS, COLLECTOR_SCHEMA, SINGLE } from './filters.jsx';
import { issueRef } from './ConversationPicker.jsx';
import { RecordDialog } from './RecordDialog.jsx';
import { RecordMenu } from './RecordMenu.jsx';
import { useCompletion } from './use-completion.js';
import { useRecordActions } from './use-record-actions.js';
import { useNarrowness } from './use-narrowness.js';
import { useRecords } from './use-records.js';
import { TABS, useCollectorView } from './view.js';

const NEAR_END = 120; // px from the end of the list at which the next page is asked for
// The widths (px) under which the bulk bar, which stays on one line, gives up room: below the first its actions are icons (with the words, the bar is 674px
// and wants 12px at each side), below the second its count is left to screen readers too (a widget is 196px wide at the narrowest, 362px at 1440px).
const BAR_STEPS = [700, 256];

/**
 * One row: a box to tick it, then where it comes from as a small picture (the owner, 2026-11-07: the box goes in front of the picture, it does not cover it), the title
 * and when, then its number, who it is from and which collector brought it (the issue it became, in place of the time, once it is handled). The number is first on that line, so a
 * row that is cut short keeps it, and the pointer's buttons, which cover the time, do not hide it (owner, 2026-11-11, option A of `.local/designs/record-id-2026-11-11/`, on rows that
 * read alike: "设计一个 id 吧，不然我都不知道哪个是哪个"). The box and its place appear only in
 * selection mode, entered through the row's context menu (the owner, 2026-11-09). Outside that mode the pointer on the row brings the two things
 * that are one click: handled and delete (restore, in the place of handled, for a row that was handled). A row that is handled has nothing to do in bulk. The button that filled in the context
 * is gone from the row (the owner, 2026-11-18: "这个按钮也可以去掉了"): the context menu and the record's window have it.
 * While the record's context is being filled in (`completing`) a small spinner stands before the time, as the connectors' rows have theirs.
 * A record nobody has read (`unread`) has the board's red mark at the upper-right corner of its picture, as on the phone (the owner, 2026-11-21: "逻辑和手机端一致"); the plugin never
 * says that of a handled record, and the mark has no words.
 */
const Row = forwardRef(function Row({ record, tab, selected, selecting, marking, completing, onSelect, onOpen, onDone, onRemove, onRestore, className, ...props }, ref) {
  const by = [record.ref, record.from, record.connectorName].filter(Boolean).join(' · ');
  // Handled with an issue is the issue's: nothing to do with it here. Anything else has the one-click buttons.
  const quick = tab === 'todo' ? [[T.collector.markDone, Check, onDone], [T.collector.remove, Trash2, onRemove]]
    : record.issue ? [] : [[T.collector.restore, RotateCcw, onRestore], [T.collector.remove, Trash2, onRemove]];
  return (
    <div ref={ref} {...props} data-record-row={record.id}
      className={cn('group relative flex h-12 w-full shrink-0 items-center gap-2.5 rounded-lg px-3 hover:bg-accent/60 has-[:focus-visible]:bg-accent/60 data-[state=open]:bg-accent/60', selected && 'bg-accent/60', className)}>
      {selecting && (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <Checkbox
            checked={selected} aria-label={T.bulk.select(record.title)}
            onClick={(event) => { event.stopPropagation(); onSelect(record.id, event.shiftKey); }}
          />
        </span>
      )}
      <span className="relative flex size-7 shrink-0" aria-hidden="true">
        <ConnectorAvatar icon={record.connectorIcon} name={record.connectorName} size={28} />
        {record.unread && <ConversationMark state="unread" size={28} />}
      </span>
      <button type="button" onClick={(event) => { if (selecting) onSelect(record.id, event.shiftKey); else onOpen(); }} className="flex h-full min-w-0 flex-1 flex-col justify-center rounded text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate font-medium">{record.title}</span>
          <span className={cn('flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums', quick.length > 0 && !selecting && 'group-hover:opacity-0 group-focus-within:opacity-0')}>
            {completing && <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />}
            {tab === 'done' && record.issue ? <><StatusIcon status={record.issue.status} />{issueRef(record.issue)}</> : when(record.at)}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">{by}</span>
      </button>
      {quick.length > 0 && (
        <span className={cn('absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100', selecting && 'hidden')}>
          {quick.map(([label, Icon, run, waiting]) => {
            // Delete is red, as in the row's menu, and its can as wide in ink as the check beside it: at the set's one visual size it looked the smaller of the two in a 12px slot
            // (owner, 2026-11-23: 「两个图标大小不一，删除图标小了…应该用红色吧」).
            const remove = Icon === Trash2;
            return (
              <Button key={label} variant="ghost" size="icon-xs" className={remove ? 'text-destructive hover:text-destructive' : undefined} disabled={marking || waiting} aria-label={label} aria-busy={waiting || undefined} title={label} onClick={() => run(record)}><MenuIcon icon={Icon} slot={12} visual={remove ? 17 : undefined} /></Button>
            );
          })}
        </span>
      )}
    </div>
  );
});

/**
 * What the connectors collected (docs/assistant.md 4.1, "Collector"): two tabs (to handle, handled), a filter like Issues', a row
 * for each record. A click opens it in full; a right click selects it, shares it to the session of an issue, makes an issue of it, opens its source, fills in its context, or marks it handled.
 * Reading and the owner's marks are the plugin's `inbox/*` calls; nothing here asks a model (filling in context is the plugin asking the collector's own session, which the owner asked for: `completion.js`).
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
  const { refresh, beginMark, marking } = records;
  // Fill in context: the plugin asks the collector's own session to read the conversation around a record, a few seconds to a few minutes; a failure is said the way the other actions' are.
  // The plugin's own reason (English) when it gave one: "更改没能保存" would say something else.
  const completion = useCompletion(request, (reason) => toast({ message: reason || T.toast.failed }));
  const { start: startCompletion, follow: followCompletion } = completion;
  const items = records.value?.items ?? [];
  const [opened, setOpened] = useState(null);
  const [creating, setCreating] = useState(null);

  // The context menu ticks the first row to enter selection mode; unticking the last one leaves it. Ticks and the Shift anchor reset with the tab or filter.
  // A row that leaves the list is dropped from the ticks, derived at each draw from what was ticked in this scope.
  const [picked, setPicked] = useState({ scope, ids: new Set(), anchor: null });
  if (picked.scope !== scope) setPicked({ scope, ids: new Set(), anchor: null });
  const visibleIds = items.map((record) => record.id);
  const selected = picked.scope === scope && tab !== 'done' ? keepVisible(picked.ids, visibleIds) : new Set();
  const selecting = selected.size > 0;
  const select = (id, shift) => {
    setPicked({ scope, ids: selectRow(selected, id, { shift, anchor: selecting ? picked.anchor : null, ids: visibleIds }), anchor: id });
  };
  const clearSelection = () => setPicked({ scope, ids: new Set(), anchor: null });
  const chosen = items.filter((record) => selected.has(record.id));
  // "Select all", in the bar that comes up once a row is ticked: every row that is loaded; it is not offered when they all are ticked already.
  const allSelected = items.length > 0 && selected.size === items.length;
  const selectAll = () => {
    setPicked({ scope, ids: new Set(visibleIds), anchor: null });
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

  // What a record can be made to do (use-record-actions.js: the same for the search page's window of a record).
  const { call, actions } = useRecordActions({ request, toast, openIssue, beginMark, refresh, startCompletion, followCompletion, setCreating });

  return (
    <section ref={root} aria-label={T.widgets.titles.collector} className="@container relative flex h-full min-h-0 flex-col"
      // F opens the filter, as in Issues, but only while the focus is in this widget: two widgets on one page would otherwise both answer.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && selecting) { event.preventDefault(); clearSelection(); return; }
        if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || event.key.toLowerCase() !== 'f' || !filterButton.current) return;
        event.preventDefault();
        openFilter(filterButton.current, 'end');
      }}>
      <Tabs.Root value={tab} onValueChange={view.setTab} className="flex min-h-0 flex-1 flex-col">
        {/* No title: the three tabs and the filter are the first row (owner, 2026-11-16), the filter at the right edge it was moved to on 2026-11-05; the section's name is for the screen reader.
            In the narrowest widget the tabs are wider than their room: they scroll sideways, with no bar, and the filter stays where it is. */}
        <div className="flex h-12 shrink-0 items-center gap-2 pr-3 pl-3">
          <Tabs.List className="-mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" aria-label={T.widgets.titles.collector}>
            {TABS.map((id) => (
              <Tabs.Trigger key={id} value={id} asChild>
                <Button variant={tab === id ? 'secondary' : 'outline'} size="sm" className={cn('h-7 rounded-full px-3 text-xs', tab === id && 'font-medium')}>{T.collector.tabs[id]}</Button>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              ref={filterButton} variant="outline" size="icon-sm" className={cn('size-7 rounded-full', menu.open && 'bg-accent')}
              aria-label={T.filterButton} aria-haspopup="dialog" aria-expanded={menu.open} onClick={(event) => openFilter(event.currentTarget, 'end')}
            >
              <ListFilter />
            </Button>
          </div>
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
              <RecordMenu key={record.id} record={record} tab={tab} request={request} actions={actions} selected={selected.has(record.id)} completing={completion.running.has(record.id)} onSelectRecord={select}>
                <Row
                  record={record} tab={tab} selected={selected.has(record.id)} selecting={selecting} marking={marking.has(record.id)} completing={completion.running.has(record.id)} onSelect={select} onOpen={() => setOpened(record)}
                  onDone={actions.done} onRemove={actions.remove} onRestore={actions.restore}
                />
              </RecordMenu>
            ))}
          </div>
        )}
      </Tabs.Root>
      {chosen.length > 0 && tab !== 'done' && (
        <BulkBar
          request={request} level={narrow} count={chosen.length} onClear={clearSelection} onSelectAll={allSelected ? undefined : selectAll}
          onShareSession={(issue) => { actions.shareSessionMany(chosen, issue); clearSelection(); }}
          onDone={() => { actions.doneMany(chosen); clearSelection(); }}
          onDelete={() => { actions.removeMany(chosen); clearSelection(); }}
        />
      )}
      <FilterMenu
        open={menu.open} anchor={menu.anchor} filter={filter} facets={records.value?.facets} schema={COLLECTOR_SCHEMA}
        onOpenChange={(open) => setMenu((current) => ({ ...current, open }))}
        onToggle={(field, value) => view.setFilter(tab, (current) => toggleFilter(current, field, value, SINGLE))}
      />
      {opened && (
        <RecordDialog
          onRead={records.refresh}
          key={opened.id} card={opened} tab={tab} request={request} actions={actions} marking={marking.has(opened.id)}
          completing={completion.running.has(opened.id)} onClose={() => { setOpened(null); refresh(); }}
        />
      )}
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

