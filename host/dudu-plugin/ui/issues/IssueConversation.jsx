import { useCallback, useRef, useState } from 'react';
import { Expand, LoaderCircle } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { AgentLogo } from './AgentLogo.jsx';
import { CopyResume } from './IssueSessionDialog.jsx';
import { useRetainedSession } from './use-retained-session.js';
import { useIssueSession } from './use-issue-session.js';
import { useConversationFind } from './use-conversation-find.jsx';
import { T } from '../strings.js';

/** The very same DSH conversation slot/composer used in the dialog; only its surrounding surface changes. */
export function IssueConversation({ issue, request, services }) {
  const [attempt, setAttempt] = useState(0);
  const [expandFailed, setExpandFailed] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const resolve = useCallback((target, options) => target.id === 'assistant'
    ? request('assistant/conversation', {}, options)
    : services.resolveIssueSession(target, options), [request, services]);
  const { reference, failed } = useRetainedSession(issue, resolve, services.actions, attempt);
  const surface = useRef(null);
  const find = useConversationFind({ root: surface, reference, actions: services.actions });
  const native = useIssueSession(request, issue.id === 'assistant' ? null : issue);
  const expand = async () => {
    if (!reference || expanding) return;
    setExpanding(true);
    try { await services.actions.openSession({ sessionId: reference.sessionId }); }
    catch { setExpandFailed(true); }
    finally { setExpanding(false); }
  };
  return <div ref={surface} data-dudu-find-surface className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
      <AgentLogo agent={issue.agent} className="size-4" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium" title={issue.title}>{issue.ref ? `${issue.ref} ` : ''}{issue.title}</h3>
        {reference && services.renderSessionHeader?.(reference, { sessionId: reference.sessionId })}
      </div>
      {find.button}
      {native?.command && <CopyResume key={native.command} command={native.command} />}
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={T.detail.openSession} title={T.detail.openSession}
        disabled={!reference || expanding} onClick={expand}>{expanding ? <LoaderCircle className="animate-spin" /> : <Expand />}</Button>
    </header>
    {find.bar}
    {reference && <div data-dudu-find-content className="dudu-host-conversation flex min-h-0 flex-1 flex-col">{services.renderConversation(reference)}</div>}
    {failed || expandFailed ? <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-muted-foreground">
      <span>{T.widgets.sessions.openFailed}</span>
      <Button variant="outline" size="sm" onClick={() => { setExpandFailed(false); setAttempt(value => value + 1); }}>{T.retry}</Button>
    </div> : !reference && <div role="status" className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />{T.shell.loading}
    </div>}
  </div>;
}
