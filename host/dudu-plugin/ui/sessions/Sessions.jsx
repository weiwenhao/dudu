import { useEffect, useState } from 'react';
import { TooltipProvider } from '../components/tooltip.jsx';
import { T } from '../strings.js';
import { queryTerms } from './highlight.js';
import { SessionDetail } from './SessionDetail.jsx';
import { SessionList } from './SessionList.jsx';
import { useNow } from './use-now.js';

const W = T.widgets.sessions;
const PAGE = 50;

/**
 * The sessions of the harnesses on this computer and of DSH in one list, and the one chosen beside it: its conversation, then what can
 * be done with it. Choosing only reads (it never loads, adopts or prompts a session); Import / Open session and Take over act.
 * docs/assistant.md 4.1 (Sessions).
 */
export function Sessions({ useSessions, readSession, openSession, openIssue, takeOverSession, addSession }) {
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [more, setMore] = useState({ asked: '', pages: 1 }); // a new search starts from the first page again
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState(null);
  useEffect(() => { const timer = setTimeout(() => setAsked(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const pages = more.asked === asked ? more.pages : 1;
  const limit = pages * PAGE;
  const now = useNow();
  const { status, value } = useSessions({ query: asked, limit });
  // A new search or page is a new question and starts empty; the list keeps the last answer until the new one comes, so it does not blink.
  const [last, setLast] = useState(null);
  if (status === 'ready' && value !== last) setLast(value);
  const answer = status === 'loading' ? last : value;
  const sessions = answer?.sessions ?? [];
  const session = sessions.find((item) => item.key === chosen) ?? sessions[0];
  // What is shown stays shown: the list may change or reorder under it, and the session beside it does not jump to another one (which would
  // read that one's conversation, and blink).
  if (session && session.key !== chosen) setChosen(session.key);
  const terms = queryTerms(asked);
  const choose = (key) => { setChosen(key); setFailure(null); };
  const run = async (action, work, failed) => {
    setBusy(action);
    setFailure(null);
    try { await work(); } catch { setFailure({ key: session.key, text: failed }); } finally { setBusy(''); }
  };
  return <TooltipProvider disableHoverableContent>
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <SessionList query={query} onQuery={setQuery} terms={terms} now={now} status={status === 'loading' && last ? 'ready' : status} sessions={sessions} total={answer?.total ?? 0}
        selectedKey={session?.key} onSelect={choose} canMore={limit < 500} onMore={() => setMore({ asked, pages: pages + 1 })} />
      {session && <SessionDetail key={session.key} session={session} terms={terms} now={now} readSession={readSession} busy={busy}
        failure={failure?.key === session.key ? failure.text : ''}
        onOpen={() => run('open', () => openSession(session), W.openFailed)}
        onOpenIssue={() => openIssue?.(session.issue.id)}
        onTakeOver={() => run('takeover', async () => {
          const result = await takeOverSession({ provider: session.provider, id: session.id });
          if (!['success', 'no_op'].includes(result.outcome) || !result.issue) throw new Error(W.takeoverFailed);
          // It is in DSH now: DSH's sidebar lists it (failing to is not failing to take over).
          if (result.session) await Promise.resolve(addSession?.(result.session)).catch(() => {});
          openIssue?.(result.issue.id);
        }, W.takeoverFailed)} />}
    </div>
  </TooltipProvider>;
}
