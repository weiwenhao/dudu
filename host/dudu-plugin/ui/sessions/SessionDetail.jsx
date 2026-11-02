import { useEffect, useRef, useState } from 'react';
import { ChevronUp, LoaderCircle } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip.jsx';
import { when } from '../issues/activity.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { T } from '../strings.js';
import { Highlighted, Markdown } from './Markdown.jsx';
import { agentName, agentOf, projectOf } from './model.js';

const W = T.widgets.sessions;

/**
 * The end of the conversation, read when the session is chosen, and the page before it when asked. Reading never loads, adopts or
 * prompts the session. It opens on the newest words, the way a conversation does.
 */
function useHistory(readSession, { provider, id }) {
  const [history, setHistory] = useState({ status: 'loading', messages: [], nextCursor: null });
  const [earlier, setEarlier] = useState({ busy: false, failed: false });
  const scroll = useRef(null);
  useEffect(() => {
    let active = true;
    // A moment's wait, so that going down the list with the arrow keys reads the session it stops at and not each one it passes.
    const timer = setTimeout(() => {
      readSession({ provider, id }).then((result) => {
        if (!active) return;
        if (result.outcome !== 'success' || !Array.isArray(result.messages)) throw new Error('Session unavailable');
        setHistory({ ...result, status: 'ready' });
      }).catch(() => { if (active) setHistory((current) => ({ ...current, status: 'error' })); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [readSession, provider, id]);
  useEffect(() => { if (history.status === 'ready' && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [history.status]);
  const loadEarlier = async () => {
    setEarlier({ busy: true, failed: false });
    try {
      const result = await readSession({ provider, id, before: history.nextCursor });
      if (result.outcome !== 'success' || !Array.isArray(result.messages)) throw new Error('Session unavailable');
      const height = scroll.current?.scrollHeight ?? 0;
      setHistory((current) => ({ ...result, status: 'ready', messages: [...result.messages, ...current.messages] }));
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop += scroll.current.scrollHeight - height; });
      setEarlier({ busy: false, failed: false });
    } catch { setEarlier({ busy: false, failed: true }); }
  };
  return { history, earlier, loadEarlier, scroll };
}

function Transcript({ session, terms, readSession }) {
  const { history, earlier, loadEarlier, scroll } = useHistory(readSession, session);
  return <div ref={scroll} role="region" aria-label={W.history} tabIndex={0} className="min-h-0 flex-1 overflow-auto overscroll-contain border-t px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
    {history.status === 'loading' ? <p role="status" className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{T.shell.loading}</p>
      : history.status === 'error' ? <p role="alert" className="py-2 text-sm text-danger-foreground">{W.failed}</p>
      : <>
        {history.nextCursor && <div className="mb-3 flex justify-center">
          <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={earlier.busy} onClick={loadEarlier}>
            {earlier.busy ? <LoaderCircle className="animate-spin" /> : <ChevronUp />}{T.detail.loadEarlier}
          </Button>
        </div>}
        {earlier.failed && <p role="alert" className="mb-3 text-center text-xs text-danger-foreground">{W.failed}</p>}
        {history.messages.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{W.noMessages}</p> : history.messages.map((message, index) => (message.role === 'user'
          // What the person said stays plain text (their asterisks are theirs); what an agent said is shown as the markdown it is.
          ? <div key={index} className="mb-5 flex justify-end last:mb-0">
            <div className="max-w-[80%] rounded-2xl bg-muted/75 px-3.5 py-2.5 text-sm leading-[22px] break-words whitespace-pre-wrap [overflow-wrap:anywhere]"><Highlighted text={message.text} terms={terms} /></div>
          </div>
          : <div key={index} className="mb-5 last:mb-0"><Markdown text={message.text} terms={terms} /></div>))}
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
    <Transcript session={session} terms={terms} readSession={readSession} />
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
