import { useEffect, useMemo, useState } from 'react';
import { TooltipProvider } from '../components/tooltip.jsx';
import { useToast } from '../components/toast.jsx';
import { T } from '../strings.js';
import { matchSessions, queryTerms } from './highlight.js';
import { SessionDetail } from './SessionDetail.jsx';
import { SessionList } from './SessionList.jsx';
import { useNow } from './use-now.js';

const W = T.widgets.sessions;
const PAGE = 50;
// The list asks for every session there is (the server's cap), so that what is typed can be answered from it at once.
export const ALL = 500;

/**
 * The sessions of the harnesses on this computer and of DSH in one list, and the one chosen beside it: its conversation, then what can
 * be done with it. Choosing only reads (it never loads, adopts or prompts a session); Import / Open session and Take over act.
 * docs/assistant.md 4.1 (Sessions).
 */
export function Sessions({ useSessions, readSession, openSession, openIssue, takeOverSession, addSession }) {
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [pages, setPages] = useState({ asked: '', count: 1 }); // a new search starts from the first page again
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState(null);
  const [managed, setManaged] = useState({});
  const toast = useToast();
  useEffect(() => { const timer = setTimeout(() => setAsked(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const limit = (pages.asked === asked ? pages.count : 1) * PAGE;
  const now = useNow();
  // The list as it is, shared with the one the page already read in the background (so the window opens with it), and the server's answer to what was typed.
  const all = useSessions({ query: '', limit: ALL });
  const found = useSessions({ query: asked, limit: ALL });
  const typed = query.trim();
  const waiting = typed !== asked;
  // What is typed is answered at once from the list itself (titles, folders, ids); the server's answer, which also looks inside the conversations, takes its place when it
  // is there. Results belong to their words: an unrelated old list is never kept, which looked as if search had done nothing.
  const answered = Boolean(typed) && !waiting && found.status === 'ready' && found.value ? found.value : null;
  const local = useMemo(() => matchSessions(all.value?.sessions, typed), [all.value, typed]);
  const rows = !typed ? all.value?.sessions ?? [] : answered ? answered.sessions : local;
  const meta = answered ?? all.value;
  // One sign that something is on its way: the spinner in the box while there are rows to look at, the line in the list while there are none yet.
  const searching = typed ? waiting || found.status === 'loading' : all.status === 'loading';
  const status = rows.length === 0 && (typed ? found.status === 'error' && !waiting : all.status === 'error') ? 'error' : searching ? 'loading' : 'ready';
  const sessions = rows.slice(0, limit).map((item) => managed[item.key] ? { ...item, ...managed[item.key] } : item);
  const session = sessions.find((item) => item.key === chosen) ?? sessions[0];
  // What is shown stays shown: the list may change or reorder under it, and the session beside it does not jump to another one (which would
  // read that one's conversation, and blink).
  if (session && session.key !== chosen) setChosen(session.key);
  const terms = queryTerms(typed);
  const choose = (key) => { setChosen(key); setFailure(null); };
  const search = () => {
    if (typed !== asked) setAsked(typed);
    else void found.refresh?.({ refresh: true });
  };
  const run = async (action, work, failed) => {
    setBusy(action);
    setFailure(null);
    try { await work(); } catch { setFailure({ key: session.key, text: failed }); } finally { setBusy(''); }
  };
  return <TooltipProvider disableHoverableContent>
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <SessionList query={query} onQuery={setQuery} onSearch={search} onRetry={() => void (typed ? found : all).refresh?.()}
        terms={terms} now={now} status={status}
        searching={searching} unavailable={meta?.unavailable} sessions={sessions} total={rows.length}
        selectedKey={session?.key} onSelect={choose} canMore onMore={() => setPages({ asked, count: (pages.asked === asked ? pages.count : 1) + 1 })} />
      {session && <SessionDetail key={session.key} session={session} terms={terms} now={now} readSession={readSession} busy={busy}
        failure={failure?.key === session.key ? failure.text : ''}
        onOpen={() => run('open', () => openSession(session), W.openFailed)}
        onOpenIssue={() => openIssue?.(session.issue.id)}
        onTakeOver={() => run('takeover', async () => {
          const result = await takeOverSession({ provider: session.provider, id: session.id });
          if (!['success', 'no_op'].includes(result.outcome) || !result.issue) throw new Error(W.takeoverFailed);
          // It is in DSH now: DSH's sidebar lists it (failing to is not failing to take over).
          if (result.session) void Promise.resolve().then(() => addSession?.(result.session)).catch(() => {});
          setManaged((current) => ({ ...current, [session.key]: {
            issue: { id: result.issue.id, ref: result.issue.ref },
            ...(result.session ? { dshSessionId: result.session.sessionId, workspaceId: result.session.workspaceId } : {}),
          } }));
          toast({ key: 'session-takeover', message: W.takeoverSuccess });
          // Then the issue itself (owner, 2026-11-08: "接管之后直接打开 issue 详情"): the way "Open issue" goes, which closes this window first.
          openIssue?.(result.issue.id);
        }, W.takeoverFailed)} />}
    </div>
  </TooltipProvider>;
}
