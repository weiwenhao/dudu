import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Expand, LoaderCircle, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { useToast } from '../components/toast.jsx';
import { useServices } from '../services.jsx';
import { T } from '../strings.js';
import { AgentLogo } from './AgentLogo.jsx';
import { useIssueSession } from './use-issue-session.js';

function CopyResume({ command }) {
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const reset = useRef(null);
  useEffect(() => () => clearTimeout(reset.current), []);
  const copy = async () => {
    if (copying) return;
    setCopying(true);
    setCopied(false);
    clearTimeout(reset.current);
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      reset.current = setTimeout(() => setCopied(false), 2000);
    } catch { toast({ key: 'resume-copy', message: T.toast.failed }); }
    finally { setCopying(false); }
  };
  return <Button variant="ghost" size="icon-sm" className="text-muted-foreground" data-copy-resume=""
    aria-label={command} title={copied ? T.shell.copied : command} aria-busy={copying} disabled={copying} onClick={copy}>
    {copying ? <LoaderCircle className="animate-spin" /> : copied ? <Check /> : <Copy />}
    <span role="status" className="sr-only">{copied ? T.shell.copied : ''}</span>
  </Button>;
}

/** The host owns the conversation, composer and draft; this window only supplies its size and session binding. */
export function IssueSessionDialog({ issue, resolveSession, actions, renderConversation, renderSessionHeader, onClose }) {
  const { request } = useServices();
  const session = useIssueSession(request, issue);
  const [reference, setReference] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanding, setExpanding] = useState(false);
  const surface = useRef(null);
  const opener = useRef(null);
  useEffect(() => {
    let active = true;
    let retained;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Session opening timed out.', 'TimeoutError')), 15_000);
    void (async () => {
      try {
        const target = await resolveSession(issue, { signal: controller.signal });
        if (!active) return;
        retained = await actions.retainSession(target, { signal: controller.signal });
        if (active) setReference(retained);
        else retained.release();
      } catch { if (active) setFailed(true); }
      finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); retained?.release(); };
  }, [issue, resolveSession, actions, attempt]);
  const expand = async () => {
    if (!reference || expanding) return;
    setExpanding(true);
    try {
      const rect = surface.current?.getBoundingClientRect();
      await actions.openSession({ sessionId: reference.sessionId }, { from: rect?.toJSON() });
      onClose();
    } catch { setFailed(true); setExpanding(false); }
  };
  // DSH portals its model menus to body. Radix's modal trap would hide them and block their pointer/focus events.
  return <Dialog open modal={false} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent ref={surface} data-dudu-conversation-dialog
      className="h-[min(900px,calc(100dvh-4rem))] w-[min(1008px,calc(100vw-4rem))] gap-0 overflow-hidden p-0 sm:max-w-none"
      onOpenAutoFocus={() => { opener.current = document.activeElement; }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!expanding && opener.current?.isConnected) opener.current.focus();
      }}
      onEscapeKeyDown={(event) => {
        const hostMenu = [...(surface.current?.querySelectorAll('[aria-expanded="true"][aria-controls]') ?? [])]
          .some((trigger) => document.getElementById(trigger.getAttribute('aria-controls')));
        if (hostMenu || surface.current?.querySelector('[data-dudu-session-header-action] [aria-expanded="true"]')) event.preventDefault();
      }}
      aria-describedby={undefined}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <AgentLogo agent={issue.agent} className="size-4" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DialogTitle className="min-w-0 truncate text-sm font-medium">{issue.ref ? `${issue.ref} ` : ''}{issue.title}</DialogTitle>
          {reference && renderSessionHeader?.(reference, { onNavigate: onClose })}
        </div>
        {session?.command && <CopyResume key={session.command} command={session.command} />}
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={T.detail.openSession} title={T.detail.openSession}
          disabled={!reference || expanding} onClick={expand}>{expanding ? <LoaderCircle className="animate-spin" /> : <Expand />}</Button>
        <DialogClose asChild><Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={T.pet.close}><X /></Button></DialogClose>
      </header>
      {reference && <div className="dudu-host-conversation flex min-h-0 flex-1 flex-col">{renderConversation(reference)}</div>}
      {failed ? <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-muted-foreground">
        <span>{T.widgets.sessions.openFailed}</span>
        <Button variant="outline" size="sm" onClick={() => { setFailed(false); setReference(null); setAttempt((value) => value + 1); }}>{T.retry}</Button>
      </div> : !reference && <div role="status" className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />{T.shell.loading}
      </div>}
    </DialogContent>
  </Dialog>;
}
