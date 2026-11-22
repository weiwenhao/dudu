import { useRef } from 'react';
import { Check, Info, LoaderCircle, Search, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip.jsx';
import { cn } from '../lib/cn.js';
import { when } from '../issues/activity.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { ConversationAvatar } from '../issues/ConversationAvatar.jsx';
import { T } from '../strings.js';
import { Highlighted } from './Markdown.jsx';
import { agentOf, projectOf } from './model.js';
import { searchSnippet } from './highlight.js';

const W = T.widgets.sessions;
// The next page is asked for by scrolling, not by a button (owner, 2026-11-21: "下拉自动加载更多，不用我手动点"): as the inbox does (collector/CollectorWidget.jsx), a page being 50 rows, more than the list shows,
// so there is always something to scroll while there is more.
const NEAR_END = 120; // px from the end of the list at which the next page is asked for

/**
 * One session of a list. The task window's picker (tasks/SessionPicker.jsx) draws the same row: `checked` marks the one that is the value now (the trailing check the window's menus have), `disabled` a
 * session that cannot be chosen there.
 */
export function Row({ session, selected, terms, now, optionRef, onSelect, onKeyDown, checked = false, disabled = false }) {
  return <button type="button" role="option" aria-selected={selected} aria-disabled={disabled || undefined} ref={optionRef} tabIndex={selected ? 0 : -1} onClick={disabled ? undefined : onSelect} onKeyDown={onKeyDown}
    className={cn('flex w-full items-center gap-3 rounded-[10px] px-2 py-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected && 'bg-accent', disabled && 'opacity-55')}>
    <ConversationAvatar title={session.title || session.id} size={32} />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[14px]/5 font-medium"><Highlighted text={session.title || session.id} terms={terms} /></span>
      <span className="block truncate text-xs/4 text-muted-foreground" title={session.cwd}>{projectOf(session)} · {when(session.updatedAt, now)}</span>
      {session.evidence?.text && <span className="block truncate text-xs/4 text-muted-foreground"><Highlighted text={searchSnippet(session.evidence.text, terms)} terms={terms} /></span>}
    </span>
    <AgentLogo agent={agentOf(session)} className="size-4 shrink-0" />
    {session.issue && <span className="shrink-0 rounded-md border px-1.5 text-[11px]/4 text-muted-foreground tabular-nums">{session.issue.ref}</span>}
    {checked && <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
  </button>;
}

/**
 * The left half: a search box and the sessions, newest first. A row says what the session is and, when an issue already manages it, which.
 * The magnifier never changes. A small spinner at the right end says that the answer to what was typed is on its way.
 * Catalog refresh and indexing are shown in the dialog header; individual indexing failures stay in diagnostics.
 */
export function SessionList({ query, onQuery, onSearch, onRetry, terms, now, status, searching, unavailable, sessions, total, selectedKey, onSelect, onMore, canMore }) {
  const options = useRef(new Map());
  const choose = (index) => {
    const next = sessions[(index + sessions.length) % sessions.length];
    if (next) { onSelect(next.key); options.current.get(next.key)?.focus(); }
  };
  const pending = searching && Boolean(query.trim()) && sessions.length > 0; // with nothing to show yet the line in the list says it; one sign, not two
  return <div aria-busy={searching} className="flex min-h-0 max-h-[220px] shrink-0 flex-col border-b sm:max-h-none sm:w-[340px] sm:border-r sm:border-b-0">
    <div className="shrink-0 px-5 pt-3 pb-2">
      <div className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder={W.search} aria-label={W.search}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); onSearch?.(); }
            if (event.key === 'ArrowDown' && sessions.length) { event.preventDefault(); choose(Math.max(0, sessions.findIndex((item) => item.key === selectedKey))); }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden" />
        {pending ? <span role="status" className="flex size-5 shrink-0 items-center justify-center"><LoaderCircle className="size-3.5 animate-spin" aria-label={T.shell.loading} /></span>
          : query && <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" className="size-5 rounded-[5px]" aria-label={W.clear} onClick={() => onQuery('')}><X /></Button></TooltipTrigger>
          <TooltipContent>{W.clear}</TooltipContent>
        </Tooltip>}
      </div>
    </div>
    {status === 'error' || (unavailable && !sessions.length) ? <div className="flex flex-col items-center gap-2 px-5 py-10">
      <p role="alert" className="text-center text-sm text-danger-foreground">{W.failed}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>{T.retry}</Button>
    </div>
      : (status === 'loading' || searching) && !sessions.length ? <p role="status" className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{T.shell.loading}</p>
      : sessions.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">{W.empty}</p>
      : <ul role="listbox" aria-label={T.widgets.titles.sessions} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto overscroll-contain px-3 pb-3"
        onScroll={(event) => { const element = event.currentTarget; if (total > sessions.length && canMore && element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_END) onMore(); }}>
        {sessions.map((session, index) => <li key={session.key} role="none">
          <Row session={session} selected={session.key === selectedKey} terms={terms} now={now}
            optionRef={(element) => { if (element) options.current.set(session.key, element); else options.current.delete(session.key); }}
            onSelect={() => onSelect(session.key)}
            onKeyDown={(event) => {
              const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: sessions.length - 1 }[event.key];
              if (next !== undefined) { event.preventDefault(); choose(next); }
            }} />
        </li>)}
      </ul>}
    {unavailable && sessions.length > 0 && <p role="status" data-sessions-note="" className="flex shrink-0 items-start gap-1.5 px-5 pt-1 pb-3 text-xs text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />{W.listPartial}
    </p>}
  </div>;
}
