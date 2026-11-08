import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Box } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '../components/popover.jsx';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { AGENT_NAMES } from '../issues/model.js';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { completionAt, issueAddress, rankSkills } from './completion.mjs';

export function useSuggestions({ actions, request, ensure, input, text, setText, open }) {
  const [query, setQuery] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(0);
  const [recipient, setRecipient] = useState(null);
  const [skillNames, setSkillNames] = useState([]); // what DSH last listed: the draft shows these /names in blue
  const caret = useRef(null);
  const dismissed = useRef(null);
  const epoch = useRef(0);
  const id = useId();
  const kind = query?.kind;
  const skillQuery = kind === 'skill' ? query.query : '';
  const issueQuery = kind === 'issue' ? query.query : '';
  const key = query ? `${query.epoch}:${kind}:${issueQuery}` : '';
  useEffect(() => {
    if (!kind || !open) return;
    let active = true;
    const abort = new AbortController();
    const load = async () => {
      if (kind === 'issue') {
        const result = await request('issues/recipients', { q: issueQuery, limit: 50 });
        if (result.outcome !== 'success') throw new Error();
        return result.items;
      }
      if (!actions.conversationSkills) throw new Error();
      const target = await ensure();
      abort.signal.throwIfAborted();
      return actions.conversationSkills(target.sessionId, abort.signal);
    };
    void load().then((entries) => {
      if (!active) return;
      if (kind === 'skill') setSkillNames(entries.map((entry) => entry.name));
      setCatalog({ key, entries, status: 'ready' });
    })
      .catch((error) => {
        if (active) { console.warn(`[dudu] ${kind} catalog:`, error?.message ?? String(error)); setCatalog({ key, entries: [], status: 'error' }); }
      });
    return () => { active = false; abort.abort(); };
  }, [kind, key, issueQuery, open, actions, request, ensure]);
  const items = useMemo(() => {
    const entries = catalog?.key === key ? catalog.entries : [];
    return kind === 'skill' ? rankSkills(entries, skillQuery) : entries;
  }, [kind, key, catalog, skillQuery]);
  const status = catalog?.key === key ? catalog.status : 'loading';
  const activeIndex = Math.min(selected, Math.max(0, items.length - 1));
  const close = useCallback(() => {
    const element = input.current;
    if (element) dismissed.current = { text: element.value, start: element.selectionStart, end: element.selectionEnd };
    setQuery(null);
  }, [input]);
  const inspect = (element, reopen = false) => {
    const previous = dismissed.current;
    if (!reopen && previous?.text === element.value && previous.start === element.selectionStart && previous.end === element.selectionEnd) return;
    dismissed.current = null;
    const next = completionAt(element.value, element.selectionStart, element.selectionEnd);
    if (query?.kind === next?.kind && query?.query === next?.query && query?.start === next?.start && query?.end === next?.end) return;
    setSelected(0);
    setQuery(next ? { ...next, epoch: query?.kind === next.kind ? query.epoch : ++epoch.current } : null);
  };
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.focus();
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [input, text]);
  const choose = (item) => {
    const token = kind === 'issue' ? `@${issueAddress(item)}` : `/${item.name}`;
    const after = text.slice(query.end);
    const insertion = token + (/^\s/u.test(after) ? '' : ' ');
    caret.current = query.start + insertion.length;
    if (kind === 'issue') setRecipient(item);
    setText(text.slice(0, query.start) + insertion + after);
    close();
  };
  const keyDown = (event) => {
    if (!query || event.nativeEvent.isComposing) return false;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(); return true;
    }
    if (items.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key) && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setSelected((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      else choose(items[activeIndex]);
      return true;
    }
    // A slow catalog must never turn the Enter intended to pick an item into a prompt.
    if (status === 'loading' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); return true; }
    return false;
  };
  return { id, query: open ? query : null, items, status, selected: activeIndex, setSelected, close, inspect, choose, keyDown, recipient, skillNames,
    controls: query && open ? { 'aria-autocomplete': 'list', 'aria-controls': id, 'aria-expanded': true, 'aria-activedescendant': items.length ? `${id}-${activeIndex}` : undefined } : { 'aria-autocomplete': 'list', 'aria-expanded': false } };
}

/** The existing pet menu's anchor, radius, spacing and focus behavior, with metadata rows like ProjectChoices. */
export function Suggestions({ suggestions: menu, anchor, input }) {
  const selected = useRef(null);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [menu.selected, menu.items]);
  const issue = menu.query?.kind === 'issue';
  const label = issue ? T.detail.mention : T.settings.nav.skills;
  return <Popover open={Boolean(menu.query)} onOpenChange={(open) => { if (!open) menu.close(); }}>
    <PopoverAnchor virtualRef={anchor} />
    <PopoverContent data-pet-menu="" side="top" align="start" aria-label={label}
      className="w-[min(416px,calc(100vw-72px))] p-1"
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={(event) => { if (event.target === input.current) event.preventDefault(); }}>
      <div id={menu.id} role="listbox" aria-label={label} aria-busy={menu.status === 'loading'} className="max-h-[240px] overflow-y-auto overscroll-contain">
        {menu.items.map((item, index) => <button type="button" key={issue ? item.id : item.name}
          ref={index === menu.selected ? selected : undefined} id={`${menu.id}-${index}`} role="option" aria-selected={index === menu.selected}
          aria-label={issue ? `${issueAddress(item)} ${item.title} ${AGENT_NAMES[item.agent] ?? item.agent} ${item.project?.name ?? T.noProject}` : `/${item.name}`}
          title={issue ? item.title : item.description}
          className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent', issue ? 'h-10' : 'min-h-12 py-2', index === menu.selected && 'bg-accent')}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => menu.setSelected(index)} onClick={() => menu.choose(item)}>
          {issue
            // One line: the agent's logo, the ID, the title, and at the right the project (the logo says which agent; its name is not written).
            ? <>
              <AgentLogo agent={item.agent} className="size-4 shrink-0" />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{issueAddress(item)}</span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="flex max-w-[40%] shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Box className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{item.project?.name ?? T.noProject}</span>
              </span>
            </>
            : <>
              <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{`/${item.name}`}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </>}
        </button>)}
        {!menu.items.length && <div className="px-2.5 py-5 text-center text-sm text-muted-foreground" role="status">
          {menu.status === 'loading' ? T.shell.loading : menu.status === 'error' ? T.shell.unavailable : issue ? T.empty : T.settings.skills.empty}
        </div>}
      </div>
    </PopoverContent>
  </Popover>;
}
