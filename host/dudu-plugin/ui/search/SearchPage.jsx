import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, LoaderCircle, Search, Trash2, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { useToast } from '../components/toast.jsx';
import { RecordDialog } from '../collector/RecordDialog.jsx';
import { useCompletion } from '../collector/use-completion.js';
import { useRecordActions } from '../collector/use-record-actions.js';
import { NewIssueDialog } from '../issues/NewIssueDialog.jsx';
import { toggleFilter } from '../issues/filter-state.js';
import { AGENT_NAMES } from '../issues/model.js';
import { cn } from '../lib/cn.js';
import { useServices } from '../services.jsx';
import { T } from '../strings.js';
import { requestTask } from '../tasks/navigation.js';
import { usePolled } from '../widgets/use-polled.js';
import { FilterPill } from './FilterPill.jsx';
import { RecordResultRow, SessionResultRow, TaskResultRow } from './rows.jsx';
import {
  PLACES, agentOfEntry, answerState, distinct, filterSessions, filterTasks, frequent, groupsOf, inboxArguments, isUnfiltered, projectOfEntry, readHistory, readOpened, recordTab, saveHistory,
  searchWords, withWord,
} from './search-model.js';
import { useSearchAnswer, useSettled } from './use-search.js';

const QUERY_DELAY_MS = 250; // as the Issues list's own search box
const CHANGED_DELAY_MS = 1000;
const RANGE_ROWS = 100; // the most rows the plugin answers with for one place
const ALL = { tab: 'all' }; // 常用 and a range of conversations with nothing typed read the 全部 list, not the tab the list column is on
const NO_FILTERS = { sessions: {}, inbox: {}, tasks: {} };
const SINGLE = { sessions: ['updated'], inbox: ['state'], tasks: [] }; // the filters that take one value at a time
const UPDATED = ['day', 'week', 'month'];
const TASK_STATUSES = ['active', 'paused', 'ended'];

const placeName = (place) => (place === 'sessions' ? T.widgets.titles.sessions : place === 'inbox' ? T.widgets.titles.collector : T.tasks.title);
const agentLabel = (value) => (value === 'dudu' ? T.brand : value == null ? T.noAgent : AGENT_NAMES[value] ?? value);
const projectLabel = (value) => (value == null ? T.noProject : value);
const filterChoices = (group, field, rows, pick) => group?.facets?.[field]?.map(({ key }) => key) ?? distinct(rows, pick);

// An input method (a Chinese one, say) reports Esc as its "Process" key while it holds a composition; only one that is not composing is Esc (as the find bar of a conversation reads it).
const isEscape = (event) => !(event.isComposing ?? event.nativeEvent?.isComposing) && (event.key === 'Escape' || event.code === 'Escape');

/** The grey line magnifier and one line of grey words: the page with nothing to show (nothing typed in a range, nothing found), one picture for both. */
function Empty({ children }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-[13px] text-muted-foreground">
      <Search className="size-10 text-muted-foreground/40" strokeWidth={1.3} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

const Loading = () => <div role="status" className="flex items-center justify-center gap-2 p-5 text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{T.shell.loading}</div>;

const Failed = ({ onRetry }) => (
  <div role="alert" className="flex flex-col items-center gap-3 p-5 text-muted-foreground">
    <span>{T.searchPage.failed}</span><Button variant="outline" size="sm" onClick={onRetry}>{T.retry}</Button>
  </div>
);

const pill = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-full text-[13px] whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** A group of the answer to the words alone: the place, how many rows matched, the first rows, and 更多 into that place. */
function Group({ place, total, onMore, children }) {
  return (
    <section aria-label={placeName(place)}>
      <div className="mt-1 flex h-8 items-center px-4 text-xs text-muted-foreground">
        <b className="mr-1.5 font-semibold text-foreground">{placeName(place)}</b><span className="tabular-nums">{total}</span>
        <button type="button" onClick={onMore} className="ml-auto flex items-center gap-0.5 rounded outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {T.searchPage.more}<ChevronRight className="size-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div role="list">{children}</div>
    </section>
  );
}

/**
 * The search page: the conversation list column turns into it (the open conversation stays where it is; a click on a result opens it there). The phone's design, with the desktop's sizes
 * (owner, 2026-11-27; `.local/designs/phone-search-2026-11-27/`): a field and 取消, three ranges as pills (会话, 收件箱, 任务), and under them
 *   - nothing typed: the words searched for before (搜索历史) and the conversations most opened (常用, the 全部 list, the one opened last first);
 *   - words typed: the three places in groups of three rows with 更多, each place in the rows of its own page, the words found in blue;
 *   - a range chosen (a pill with ×; × or the pill goes back): that place alone, with its filters as pills in the same row, and a line saying how to search while nothing is typed or chosen.
 * The plugin applies the range's filters before limiting results. With no keyword, the conversations are the board's own rows. `selected` is the open conversation's id,
 * `onOpen(entry)` opens a conversation, `badge(entry, size)` is the list's own avatar, `onOpenIssue(id)` opens an issue's page.
 */
export function SearchPage({ request, selected, onOpen, badge, onOpenIssue, onClose }) {
  const toast = useToast();
  const services = useServices();
  const input = useRef(null);
  const body = useRef(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState(null); // null, or the one place that was chosen
  const [filters, setFilters] = useState(NO_FILTERS);
  const [history, setHistory] = useState(() => readHistory());
  // When each conversation was opened, as of the moment the page opened: 常用 keeps its order while the page is there (a row opened from it does not jump away under the pointer).
  const [openedAt] = useState(() => readOpened());
  const [recordOpen, setRecordOpen] = useState(null);
  const [creating, setCreating] = useState(null);
  const [composing, setComposing] = useState(false); // an input method (a Chinese one) holds words that are not typed yet: they are not searched for
  const [names, setNames] = useState({}); // the collectors' names by id (the answer of the inbox brings them): what the filter by source offers
  const [namesFrom, setNamesFrom] = useState(null);
  const q = query.trim();
  const settled = useSettled(q, QUERY_DELAY_MS, composing);
  const asked = q === '' ? '' : settled; // emptying the field is answered at once; typing waits for a pause
  const all = usePolled(request, 'home/list', ALL, { every: 5000 });
  const question = useMemo(() => {
    if (scope === null) return asked ? { q: asked } : null;
    if (scope === 'sessions' && !asked) return null; // the 全部 list is the answer
    const criteria = scope === 'inbox' ? inboxArguments(filters.inbox) : { filters: filters[scope] };
    return { q: asked, scope, limit: RANGE_ROWS, ...criteria };
  }, [scope, asked, filters]);
  const answer = useSearchAnswer(request, question);
  const value = answer.value;
  if (value?.inbox?.names && value.inbox.names !== namesFrom) { setNamesFrom(value.inbox.names); setNames(value.inbox.names); } // kept once read: the answer of another place has none
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [scope, asked]);
  const words = useMemo(() => searchWords(asked), [asked]);

  const remember = (word) => {
    const next = withWord(history, word);
    if (next === history) return;
    saveHistory(next);
    setHistory(next);
  };
  const enter = (place) => { setScope(place); input.current?.focus(); };
  const openSession = (entry) => { remember(q); onOpen(entry); };
  const openRecord = (record) => { remember(q); setRecordOpen(record); };
  const openTask = (task) => { remember(q); requestTask(task.id); };

  // The window of a record is the Collector's (`RecordDialog`) with the Collector's actions; a mark is not shown before it is saved here, the answer is asked for again after it.
  const completion = useCompletion(request, useCallback((reason) => toast({ message: reason || T.toast.failed }), [toast]));
  const beginMark = useCallback((action, records) => ({ records, settle: () => {} }), []);
  const refresh = answer.retry;
  const { invalidate: invalidateAll } = all;
  // A conversation read (the red mark of its row goes) or the list changed: the rows shown are asked for again, as the list column's own are; a busy agent changes the list often, so the question waits for a pause.
  useEffect(() => {
    let timer = null;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => { void invalidateAll(); refresh(); }, CHANGED_DELAY_MS); };
    window.addEventListener('dudu:session-read', changed);
    window.addEventListener('dudu:home-changed', changed);
    return () => { clearTimeout(timer); window.removeEventListener('dudu:session-read', changed); window.removeEventListener('dudu:home-changed', changed); };
  }, [invalidateAll, refresh]);
  const { call, actions } = useRecordActions({ request, toast, openIssue: onOpenIssue ?? services.openIssue, beginMark, refresh, startCompletion: completion.start, followCompletion: completion.follow, setCreating });

  // ---- What the range filters offer, and the rows they leave.
  const sessions = value?.q === asked ? value.sessions : null;
  const tasks = value?.q === asked ? value.tasks : null;
  const sessionBase = !asked ? all.value?.conversations ?? [] : sessions?.items ?? [];
  const rangeFilters = scope === 'sessions' ? [
    { key: 'agent', name: T.fields.agent, options: filterChoices(sessions, 'agent', sessionBase, agentOfEntry).map((one) => ({ value: one, label: agentLabel(one) })), labelOf: agentLabel },
    { key: 'project', name: T.fields.project, options: filterChoices(sessions, 'project', sessionBase, projectOfEntry).map((one) => ({ value: one, label: projectLabel(one) })), labelOf: projectLabel },
    { key: 'updated', name: T.dates.updated, options: UPDATED.map((one) => ({ value: one, label: T.dates[one] })), labelOf: (one) => T.dates[one] },
  ] : scope === 'inbox' ? [
    { key: 'state', name: T.fields.status, options: ['todo', 'done'].map((one) => ({ value: one, label: T.collector.tabs[one] })), labelOf: (one) => T.collector.tabs[one] },
    { key: 'connector', name: T.fields.source, options: Object.entries(names).map(([id, name]) => ({ value: id, label: name })), labelOf: (id) => names[id] ?? id },
  ] : scope === 'tasks' ? [
    { key: 'status', name: T.fields.status, options: TASK_STATUSES.map((one) => ({ value: one, label: T.tasks.statuses[one] })), labelOf: (one) => T.tasks.statuses[one] },
    { key: 'agent', name: T.fields.agent, options: filterChoices(tasks, 'agent', tasks?.items ?? [], (task) => task.agent).map((one) => ({ value: one, label: agentLabel(one) })), labelOf: agentLabel },
  ] : [];
  const toggle = (key, one) => setFilters((current) => ({ ...current, [scope]: toggleFilter(current[scope], key, one, SINGLE[scope]) }));

  const rowOf = {
    sessions: (entry) => <SessionResultRow key={entry.id} entry={entry} words={words} selected={selected === entry.id} badge={badge} onOpen={openSession} />,
    inbox: (record) => <RecordResultRow key={record.id} record={record} words={words} onOpen={openRecord} />,
    tasks: (task) => <TaskResultRow key={task.id} task={task} words={words} onOpen={openTask} />,
  };

  let content;
  if (scope === null && !q) {
    const conversations = frequent(all.value?.conversations ?? [], openedAt);
    content = (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-secondary py-2.5" ref={body}>
        {history.length > 0 && (
          <section className="px-4" aria-label={T.searchPage.history}>
            <div className="flex h-[30px] items-center text-sm font-semibold">
              {T.searchPage.history}
              <button type="button" aria-label={T.clear} title={T.clear} onClick={() => { saveHistory([]); setHistory([]); input.current?.focus(); }}
                className="-mr-1 ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <Trash2 className="size-[15px]" strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {history.map((word) => (
                <button key={word} type="button" onClick={() => { setQuery(word); input.current?.focus(); }} className={cn(pill, 'max-w-full bg-background px-3 hover:bg-accent')}><span className="truncate">{word}</span></button>
              ))}
            </div>
          </section>
        )}
        {conversations.length > 0 && (
          <section className="mx-2 rounded-[10px] bg-card px-3.5 pt-3 pb-1.5" aria-label={T.searchPage.frequent}>
            <div className="flex h-6 items-center text-sm font-medium">{T.searchPage.frequent}</div>
            <div role="list" className="mt-0.5">
              {conversations.map((entry) => (
                <div key={entry.id} role="listitem">
                  <button type="button" onClick={() => onOpen(entry)} aria-current={selected === entry.id ? 'true' : undefined}
                    className="flex h-[52px] w-full items-center gap-3 rounded-md text-left outline-none hover:bg-accent/60 focus-visible:bg-accent/60">
                    {badge(entry, 36)}<span className="min-w-0 flex-1 truncate text-[14px] leading-5">{entry.issue ? entry.title : T.brand}</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  } else if (scope === null) {
    const state = answer.status === 'idle' || (answer.status === 'loading' && !value) ? 'waiting' : answer.status === 'error' ? 'error' : answerState(value);
    content = (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6" ref={body}>
        {state === 'waiting' ? <Loading /> : state === 'error' ? <Failed onRetry={answer.retry} />
          : state === 'empty' ? <Empty>{T.searchPage.noResults}</Empty>
          : groupsOf(value).map((group) => <Group key={group.place} place={group.place} total={group.total} onMore={() => enter(group.place)}>{group.items.map(rowOf[group.place])}</Group>)}
      </div>
    );
  } else {
    // A range. Nothing typed and nothing chosen: the line that says how to search. Conversations with nothing typed are the 全部 list's.
    const bare = !q && isUnfiltered(filters[scope]);
    const own = scope === 'sessions' && !asked;
    const waiting = own && q !== ''; // typed, and not asked for yet: the 全部 list is not the answer to it
    const group = answer.matches ? value?.[scope] : null;
    let rows = null;
    if (!bare) {
      if (own) rows = all.value ? filterSessions(sessionBase, filters.sessions) : null;
      else if (group && !group.failed) {
        if (scope === 'inbox' || group.facets) rows = group.items;
        else rows = scope === 'sessions' ? filterSessions(group.items, filters.sessions) : filterTasks(group.items, filters.tasks);
      }
    }
    const failed = own ? all.status === 'error' && !all.value : answer.status === 'error' || group?.failed === true;
    content = (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6" ref={body}>
        {bare ? <Empty>{T.searchPage.hint[scope]}</Empty>
          : waiting ? <Loading />
          : failed ? <Failed onRetry={own ? all.refresh : answer.retry} />
          : rows === null ? <Loading />
          : rows.length === 0 ? <Empty>{T.searchPage.noResults}</Empty>
          : <div role="list">{rows.map(rowOf[scope])}</div>}
      </div>
    );
  }

  return (
    <div role="search" aria-label={T.searchPage.open} className="dudu-conversation-sidebar" data-conversation-search
      onKeyDown={(event) => { if (!event.defaultPrevented && isEscape(event)) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <div className="flex shrink-0 items-center gap-2 py-1.5 pr-4 pl-3">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted pr-3 pl-3.5 text-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/50">
          <Search className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          <input ref={input} type="text" inputMode="search" enterKeyHint="search" autoComplete="off" spellCheck={false} value={query} placeholder={T.searchPage.placeholder} aria-label={T.searchPage.placeholder}
            onChange={(event) => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !(event.isComposing ?? event.nativeEvent?.isComposing)) remember(q); }}
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground" />
          {query && (
            <button type="button" aria-label={T.widgets.sessions.clear} title={T.widgets.sessions.clear} onClick={() => { setQuery(''); input.current?.focus(); }}
              className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-[5px] outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"><X className="size-3.5" strokeWidth={2} aria-hidden="true" /></button>
          )}
        </div>
        <button type="button" onClick={onClose} className="shrink-0 rounded px-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">{T.searchPage.cancel}</button>
      </div>
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none]">
        {scope === null
          ? PLACES.map((place) => <button key={place} type="button" onClick={() => enter(place)} className={cn(pill, 'bg-muted px-3 hover:bg-foreground/10')}>{placeName(place)}</button>)
          : <>
            <button type="button" aria-pressed="true" onClick={() => enter(null)} className={cn(pill, 'bg-ring/12 pr-2 pl-3 text-ring hover:bg-ring/20')}>{placeName(scope)}<X className="size-3.5" strokeWidth={2.2} aria-hidden="true" /></button>
            {rangeFilters.map((one) => <FilterPill key={`${scope}:${one.key}`} name={one.name} options={one.options} values={filters[scope][one.key] ?? []} labelOf={one.labelOf} single={SINGLE[scope].includes(one.key)} onToggle={(item) => toggle(one.key, item)} />)}
          </>}
      </div>
      {content}
      {recordOpen && (
        <RecordDialog key={recordOpen.id} card={recordOpen} tab={recordTab(recordOpen)} request={request} actions={actions} marking={false}
          completing={completion.running.has(recordOpen.id)} onRead={refresh} onClose={() => { setRecordOpen(null); refresh(); }} />
      )}
      {creating && (
        <NewIssueDialog key={creating.record.id} open request={request} initial={creating.draft} preset={{ source: 'connector', sourceRef: creating.draft.sourceRef }}
          onOpenChange={(open) => { if (!open) setCreating(null); }}
          onCreate={async (fields) => {
            const made = await request('issues/add', { fields });
            if (made?.outcome === 'success') {
              await call('inbox/link', { id: creating.record.id, issue: made.issue.id });
              refresh();
              window.dispatchEvent(new Event('dudu:home-changed'));
            }
            return made;
          }} />
      )}
    </div>
  );
}
