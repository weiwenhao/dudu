import { useEffect, useRef, useState } from 'react';
import { ChevronUp, LoaderCircle } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip.jsx';
import { when } from '../issues/activity.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { T } from '../strings.js';
import { abortable } from '../lib/abortable.js';
import { Highlighted, Markdown } from './Markdown.jsx';
import { agentName, agentOf, projectOf } from './model.js';
import { previewCache } from './preview-cache.js';

const W = T.widgets.sessions;

/**
 * The end of the conversation, read when the session is chosen, and the page before it when asked. Reading never loads, adopts or
 * prompts the session. A search opens at its matching passage; ordinary browsing opens on the newest words.
 */
function useHistory(readSession, { provider, id, updatedAt, previewVersion, query }) {
  const session = { provider, id, updatedAt, previewVersion, query };
  const [history, setHistory] = useState(() => previewCache(readSession).get(session) ?? previewCache(readSession).latest(session) ?? { status: 'loading', messages: [], nextCursor: null });
  const [earlier, setEarlier] = useState({ busy: false, failed: false });
  const [attempt, setAttempt] = useState(0);
  const scroll = useRef(null);
  const reading = useRef(null);
  useEffect(() => () => reading.current?.abort(), []);
  useEffect(() => {
    setEarlier({ busy: false, failed: false });
    const cached = !attempt && previewCache(readSession).get({ provider, id, updatedAt, previewVersion, query });
    if (cached) { setHistory(cached); return undefined; }
    const controller = new AbortController();
    reading.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    // Cached pages read directly from SQLite. Keep the visible conversation while its newer version arrives.
    setHistory((current) => current.status === 'ready' ? current : { status: 'loading', messages: [], nextCursor: null });
    abortable(readSession({ provider, id, ...(query ? { query } : {}) }, { signal }), signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.outcome !== 'success' || !Array.isArray(result.messages)) throw new Error('Session unavailable');
      const ready = { ...result, status: 'ready', query };
      previewCache(readSession).set({ provider, id, updatedAt, previewVersion, query }, ready);
      setHistory(ready);
    }).catch(() => { if (!controller.signal.aborted) setHistory((current) => current.status === 'ready' ? current : { ...current, status: 'error' }); });
    return () => { controller.abort(); reading.current?.abort(); };
  }, [readSession, provider, id, updatedAt, previewVersion, query, attempt]);
  useEffect(() => {
    if (history.status !== 'ready' || history.query !== query || !scroll.current) return;
    const message = query && Number.isInteger(history.matchIndex) && scroll.current.querySelector(`[data-session-message="${history.matchIndex}"]`);
    const target = message && (message.querySelector('[data-session-search-match]') ?? [...message.querySelectorAll('mark')].sort((a, b) => b.textContent.length - a.textContent.length)[0] ?? message);
    if (target) {
      const region = scroll.current.getBoundingClientRect();
      const hit = target.getBoundingClientRect();
      scroll.current.scrollTop += hit.top - region.top - Math.max(0, (region.height - hit.height) / 2);
    } else scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [history.status, history.query, query]); // eslint-disable-line react-hooks/exhaustive-deps -- locate only the initial page; pagination preserves its scroll below
  const loadEarlier = async () => {
    if (earlier.busy) return;
    const controller = new AbortController();
    reading.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    setEarlier({ busy: true, failed: false });
    try {
      const result = await abortable(readSession({ provider, id, before: history.nextCursor, ...(query ? { query } : {}) }, { signal }), signal);
      if (controller.signal.aborted) return;
      if (result.outcome !== 'success' || !Array.isArray(result.messages)) throw new Error('Session unavailable');
      const height = scroll.current?.scrollHeight ?? 0;
      setHistory((current) => ({
        ...result, status: 'ready', query,
        ...(Number.isInteger(current.matchIndex) ? { matchIndex: current.matchIndex + result.messages.length } : {}),
        messages: [...result.messages, ...current.messages],
      }));
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop += scroll.current.scrollHeight - height; });
      setEarlier({ busy: false, failed: false });
    } catch { if (!controller.signal.aborted) setEarlier({ busy: false, failed: true }); }
  };
  return { history, earlier, loadEarlier, scroll, retry: () => setAttempt((value) => value + 1) };
}

function Transcript({ session, terms, readSession }) {
  const { history, earlier, loadEarlier, scroll, retry } = useHistory(readSession, { ...session, query: session.evidence ? terms.join(' ') : '' });
  return <div ref={scroll} role="region" aria-label={W.history} tabIndex={0} className="min-h-0 flex-1 overflow-auto overscroll-contain border-t px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
    {history.status === 'loading' ? <p role="status" className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{T.shell.loading}</p>
      : history.status === 'error' ? <div className="flex items-center gap-2 py-2">
        <p role="alert" className="text-sm text-danger-foreground">{W.failed}</p>
        <Button variant="ghost" size="sm" onClick={retry}>{T.retry}</Button>
      </div>
      : <>
        {history.nextCursor && <div className="mb-3 flex justify-center">
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={earlier.busy} onClick={loadEarlier}>
            {earlier.busy ? <LoaderCircle className="animate-spin" /> : <ChevronUp />}{T.detail.loadEarlier}
          </Button>
        </div>}
        {earlier.failed && <p role="alert" className="mb-3 text-center text-xs text-danger-foreground">{W.failed}</p>}
        {history.messages.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{W.noMessages}</p> : history.messages.map((message, index) => (message.role === 'user'
          // What the person said stays plain text (their asterisks are theirs); what an agent said is shown as the markdown it is.
          ? <div key={index} data-session-message={index} className="mb-5 flex justify-end last:mb-0">
            <div className="max-w-[80%] rounded-2xl bg-muted/75 px-3.5 py-2.5 text-sm leading-[22px] break-words whitespace-pre-wrap [overflow-wrap:anywhere]"><Highlighted text={message.text} terms={terms} /></div>
          </div>
          : <div key={index} data-session-message={index} className="mb-5 last:mb-0"><Markdown text={message.text} terms={terms} /></div>))}
      </>}
  </div>;
}

/**
 * The right half: what the session is, its conversation, and what can be done with it. An issue that manages it replaces "Take over"
 * with "Open issue"; a session already in DSH says "Open session" where a harness one says "Import".
 */
export function SessionDetail({ session, terms, now, readSession, busy, failure, onOpen, onTakeOver, onOpenIssue }) {
  const pending = (action) => busy === action && <LoaderCircle className="animate-spin" />;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="shrink-0 px-5 pt-5 pb-4">
      <div className="flex items-center gap-2.5">
        <h2 className="min-w-0 truncate text-lg/6 font-semibold"><Highlighted text={session.title || session.id} terms={terms} /></h2>
        {session.issue && <span className="shrink-0 rounded-md border px-1.5 text-[11px]/4 text-muted-foreground tabular-nums">{session.issue.ref}</span>}
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px]/[18px] text-muted-foreground">
        <AgentLogo agent={agentOf(session)} className="size-3.5" />
        <span className="shrink-0">{agentName(session)}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate" title={session.cwd}>{projectOf(session)}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{when(session.updatedAt, now)}</span>
      </div>
    </div>
    <Transcript key={JSON.stringify([session.provider, session.id, session.evidence ? terms.join(' ') : ''])}
      session={session} terms={terms} readSession={readSession} />
    <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
      {failure && <p role="alert" className="mr-auto text-[13px]/5 text-danger-foreground">{failure}</p>}
      {busy && <p role="status" className="mr-auto flex items-center gap-2 text-[13px]/5 text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />{T.shell.busy}</p>}
      <Button variant="outline" className="h-9 rounded-lg px-4" disabled={Boolean(busy)} onClick={onOpen}>
        {pending('open')}{session.dshSessionId || session.issue ? T.detail.openSession : W.importLabel}
      </Button>
      {session.issue
        ? <Button className="h-9 rounded-lg px-4" disabled={Boolean(busy)} onClick={onOpenIssue}>{W.openIssue}</Button>
        : <Tooltip>
          <TooltipTrigger asChild>
            <Button className="h-9 rounded-lg px-4" disabled={Boolean(busy)} onClick={onTakeOver}>{pending('takeover')}{W.takeOverLabel}</Button>
          </TooltipTrigger>
          <TooltipContent>{W.takeoverLabel}</TooltipContent>
        </Tooltip>}
    </div>
  </div>;
}
