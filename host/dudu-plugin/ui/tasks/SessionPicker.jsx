import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LoaderCircle, Search, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { useServices } from '../services.jsx';
import { T } from '../strings.js';
import { matchSessions, queryTerms } from '../sessions/highlight.js';
import { agentOf } from '../sessions/model.js';
import { Row } from '../sessions/SessionList.jsx';
import { useNow } from '../sessions/use-now.js';
import { canRunIn } from './format.js';

const W = T.widgets.sessions;
const PAGE = 50;
// The list asks for every conversation there is (the server's cap), so that what is typed can be answered from it at once, as the 会话 window does (sessions/Sessions.jsx).
const ALL = 500;
// Room the popup wants under (or over) its row before it opens there, in px: the search box and about five rows.
const ROOM = 380;
const read = (request, body, signal) => request('sessions/list', body, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });

/** One reading of the conversations DSH has (`inDsh`: from any workspace) for what is asked. The answer belongs to its words: after a change the old one is not kept. */
function useRead(request, body, enabled = true) {
  const key = JSON.stringify(body);
  const [state, setState] = useState({ key: null, status: 'loading', value: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const abort = new AbortController();
    void read(request, JSON.parse(key), abort.signal).then((result) => {
      if (!Array.isArray(result?.sessions)) throw new Error();
      if (!abort.signal.aborted) setState({ key, status: 'ready', value: result });
    }).catch(() => { if (!abort.signal.aborted) setState({ key, status: 'error', value: null }); });
    return () => abort.abort();
  }, [request, key, enabled, attempt]);
  // Until the answer to these words is there, the state says loading (an answer of other words is not shown for them).
  return { ...(state.key === key ? state : { status: 'loading', value: null }), retry: () => { setState({ key: null, status: 'loading', value: null }); setAttempt((count) => count + 1); } };
}

/**
 * The search box and the conversations of the popup: the list of the 会话 window (sessions/Sessions.jsx, SessionList.jsx) with the same row, the same search (titles, folders, ids and what was said inside; the
 * words found are marked and a line shows what was found in a conversation) and the same 更多会话. Typing is answered from the list at once; the plugin's answer, which also looks inside the conversations, takes
 * its place when it is there. Arrow keys move through the rows, Enter chooses.
 */
function Choices({ value, options, onPick }) {
  const { request } = useServices();
  const now = useNow();
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [pages, setPages] = useState({ asked: '', count: 1 }); // a new search starts from the first page again
  const [active, setActive] = useState('');
  const rows = useRef(new Map());
  const input = useRef(null);
  useEffect(() => { const timer = setTimeout(() => setAsked(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const typed = query.trim();
  const all = useRead(request, { query: '', limit: ALL, inDsh: true });
  const found = useRead(request, { query: asked, limit: ALL, inDsh: true }, Boolean(asked));
  const waiting = typed !== asked;
  const answered = Boolean(typed) && !waiting && found.status === 'ready' && found.value ? found.value : null;
  const local = useMemo(() => matchSessions(all.value?.sessions, typed), [all.value, typed]);
  const list = !typed ? all.value?.sessions ?? [] : answered ? answered.sessions : local;
  const searching = typed ? waiting || found.status === 'loading' : all.status === 'loading';
  const status = list.length === 0 && (typed ? found.status === 'error' && !waiting : all.status === 'error') ? 'error' : searching ? 'loading' : 'ready';
  const limit = (pages.asked === asked ? pages.count : 1) * PAGE;
  const sessions = list.slice(0, limit);
  // The row that is lit: the one the arrow keys came to, else the one that is the value now, else the first.
  const current = sessions.find((item) => item.key === active) ?? sessions.find((item) => item.dshSessionId === value) ?? sessions[0];
  const terms = queryTerms(typed);
  const pending = searching && Boolean(typed) && sessions.length > 0; // with nothing to show yet the line in the list says it; one sign, not two
  const choose = (index) => {
    const next = sessions[(index + sessions.length) % sessions.length];
    if (next) { setActive(next.key); rows.current.get(next.key)?.focus(); }
  };
  const pick = (session) => { if (session && canRunIn(session, options)) onPick(session); };
  // The one that is the value now comes into view, once the list is there.
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || all.status !== 'ready') return;
    first.current = false;
    const mine = (all.value?.sessions ?? []).find((item) => item.dshSessionId === value);
    if (mine) rows.current.get(mine.key)?.scrollIntoView({ block: 'nearest' });
  }, [all.status, all.value, value]);
  return <>
    <div className="dudu-session-search flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <input ref={input} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={W.search} aria-label={W.search}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); pick(current); }
          if (event.key === 'ArrowDown' && sessions.length) { event.preventDefault(); choose(Math.max(0, sessions.findIndex((item) => item.key === current?.key))); }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden" />
      {pending ? <span role="status" className="flex size-5 shrink-0 items-center justify-center"><LoaderCircle className="size-3.5 animate-spin" aria-label={T.shell.loading} /></span>
        : query && <Button variant="ghost" size="icon-xs" className="size-5 rounded-[5px]" aria-label={W.clear} title={W.clear} onClick={() => { setQuery(''); input.current?.focus(); }}><X /></Button>}
    </div>
    {status === 'error' ? <div className="flex flex-col items-center gap-2 px-5 py-8">
      <p role="alert" className="text-center text-sm text-danger-foreground">{W.failed}</p>
      <Button variant="ghost" size="sm" onClick={() => (typed ? found : all).retry()}>{T.retry}</Button>
    </div>
      : status === 'loading' && !sessions.length ? <p role="status" className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{T.shell.loading}</p>
      : sessions.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">{W.empty}</p>
      : <ul role="listbox" aria-label={T.tasks.linked} aria-busy={searching} className="dudu-session-list flex flex-col gap-0.5 overflow-auto overscroll-contain">
        {sessions.map((session, index) => <li key={session.key} role="none">
          <Row session={session} selected={session.key === current?.key} checked={session.dshSessionId === value} disabled={!canRunIn(session, options)} terms={terms} now={now}
            optionRef={(element) => { if (element) rows.current.set(session.key, element); else rows.current.delete(session.key); }}
            onSelect={() => pick(session)}
            onKeyDown={(event) => {
              const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: sessions.length - 1 }[event.key];
              if (next !== undefined) { event.preventDefault(); choose(next); }
            }} />
        </li>)}
        {list.length > sessions.length && <li role="none" className="pt-1"><Button variant="ghost" size="sm" className="w-full" onClick={() => setPages({ asked, count: (pages.asked === asked ? pages.count : 1) + 1 })}>{W.more}</Button></li>}
      </ul>}
  </>;
}

/**
 * The row 关联会话 of a task that goes into a conversation DSH already has (owner, 2026-11-17: "这个样式不太对 … 重新设计一下", the design `.local/designs/task-session-picker-2026-11-17/`, A). The row says which one; its
 * popup, as wide as the rows it belongs to, lists every conversation of every workspace to choose from. `options` are the task options (what the plugin can run); `onPick` gets the row of `sessions/list`.
 */
export function SessionPicker({ label, value, options, disabled = false, onPick }) {
  const { request } = useServices();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState('bottom');
  const [picked, setPicked] = useState(null);
  const trigger = useRef(null);
  // A saved task knows only the id of its conversation: the row asks the plugin for its title.
  useEffect(() => {
    if (!value || picked?.dshSessionId === value) return undefined;
    const abort = new AbortController();
    void read(request, { query: value, limit: 5, inDsh: true }, abort.signal).then((result) => {
      const row = result?.sessions?.find((item) => item.dshSessionId === value);
      if (row && !abort.signal.aborted) setPicked(row);
    }).catch(() => {});
    return () => abort.abort();
  }, [request, value]); // eslint-disable-line react-hooks/exhaustive-deps -- `picked` is what this settles
  const shown = value ? (picked?.dshSessionId === value ? picked : null) : null;
  // Where it opens is settled once, when it opens: over the row when there is not room enough under it and more over it, so that it does not jump from one side to the other while the list gets shorter and longer.
  const change = (next) => {
    if (next && trigger.current) {
      const box = trigger.current.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      setSide(below >= ROOM || below >= box.top ? 'bottom' : 'top');
    }
    setOpen(next);
  };
  return <Popover open={open} onOpenChange={change}>
    <PopoverTrigger asChild>
      <button ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-label={label} disabled={disabled}
        className="dudu-task-rule-select outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="dudu-task-rule-label">{label}</span>
        <span className="dudu-task-select-face">{shown && <AgentLogo agent={agentOf(shown)} />}<span className="min-w-0 truncate">{value ? (shown?.title || shown?.id || value) : ''}</span><ChevronDown className="size-3.5 shrink-0" aria-hidden="true" /></span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" alignOffset={-12} side={side} sideOffset={4} avoidCollisions={false} className="dudu-task-menu dudu-session-menu">
      <Choices value={value} options={options} onPick={(session) => { setPicked(session); onPick(session); setOpen(false); }} />
    </PopoverContent>
  </Popover>;
}
