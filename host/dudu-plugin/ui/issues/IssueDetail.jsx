import { statusLabel, statusType } from './workflow.js';
import { useEffect, useRef, useState } from 'react';
import { Box, ChevronDown, ChevronRight, ChevronUp, Copy, Expand, ExternalLink, LoaderCircle, Tag } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { useToast } from '../components/toast.jsx';
import { TooltipProvider } from '../components/tooltip.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { actorName, describe, isComment, storedSystemText, when } from './activity.js';
import { AgentMenu } from './AgentMenu.jsx';
import { dueInfo, DUE_ICON_TONE } from './due.js';
import { DueMenu } from './DueMenu.jsx';
import { AgentAvatar, DueIcon, PriorityIcon, projectColor, StatusIcon, SubIssueChip } from './icons.jsx';
import { AGENT_NAMES } from './model.js';
import { PriorityMenu } from './PriorityMenu.jsx';
import { StatusMenu } from './StatusMenu.jsx';
import { useIssue } from './use-issue.js';
import { useIssueSession } from './use-issue-session.js';
import { ProjectMenu } from './ProjectMenu.jsx';
import { LabelChip, LabelMenu } from './LabelMenu.jsx';
import { SubIssues } from './SubIssues.jsx';
import { MessageComposer } from './MessageComposer.jsx';
import { MentionText } from './MentionText.jsx';
import { CommentAttachments } from './Attachments.jsx';
import { AddLinkDialog, LinksSection } from './Links.jsx';
import { RichText } from './RichText.jsx';

const Section = ({ children }) => <h2 className="mb-1.5 text-sm text-muted-foreground">{children}</h2>;
const propertyButton = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent';

/** A title or description that is plain text until it is clicked: edits are saved when it loses focus. */
function EditableText({ value, onSave, className, placeholder, multiline, label }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const field = useRef(null);
  const cancelled = useRef(false); // Escape leaves the box through blur, which would save what is in it
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { // a textarea grows with its text
    const el = field.current;
    if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; }
  }, [draft, editing]);
  const save = () => {
    setEditing(false);
    if (cancelled.current) { cancelled.current = false; setDraft(value); return; }
    const next = draft.trim();
    if (next !== value && (next || multiline)) onSave(next); else setDraft(value);
  };
  if (!editing) return <button type="button" aria-label={label}
    className={cn('block w-full cursor-text rounded-md text-left whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50', !value && 'text-muted-foreground', className)}
    onClick={() => { setEditing(true); requestAnimationFrame(() => field.current?.focus()); }}>{value || placeholder}</button>;
  return (
    <textarea
      ref={field} rows={1} value={draft} placeholder={placeholder} aria-label={label} spellCheck={false}
      onChange={(event) => setDraft(event.target.value)} onBlur={save}
      onKeyDown={(event) => { if (!multiline && event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { cancelled.current = true; setDraft(value); event.currentTarget.blur(); } }}
      className={cn('block w-full resize-none overflow-hidden rounded-md bg-transparent outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}
    />
  );
}

// The person is drawn like an agent that has not been assigned: a dashed circle with a person in it.
const Actor = ({ actor }) => <AgentAvatar agent={actor === 'owner' ? null : actor} state="idle" />;

/** Long words are cut to a few lines, so that no entry is a wall of text; the link under them opens the rest (and shuts it again). */
function Clamp({ text, lines, className }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 160 || text.split('\n').length > 2;
  return (
    <div className={className}>
      <p className={cn('break-words whitespace-pre-wrap', long && !open && lines)}><MentionText text={text} /></p>
      {long && <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline">{open ? T.detail.showLess : T.detail.showMore}</button>}
    </div>
  );
}

// Comments keep their author header and body; status changes use Linear's compact activity line.
function StatusLine({ entry, now }) {
  return <li className="flex items-start gap-3 py-1 text-sm text-muted-foreground" data-issue-status-change="">
    <StatusIcon status={entry.data?.to} className="mt-0.5" />
    <span className="min-w-0 break-words">
      {actorName(entry.actor)} {describe(entry).sentence}
      <span aria-hidden="true" className="mx-1.5">·</span>
      <time className="whitespace-nowrap" dateTime={Number.isFinite(entry.at) ? new Date(entry.at).toISOString() : undefined}>{when(entry.at, now)}</time>
    </span>
  </li>;
}

function LogLine({ issueId, entry, logo, now }) {
  const { detail, comment } = describe(entry);
  const name = actorName(entry.actor);
  const glyph = entry.actor === 'dudu' ? <img src={logo} alt="" className="size-[18px] shrink-0" /> : <Actor actor={entry.actor} />;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">{glyph}<span className="font-medium">{name}</span><span className="text-xs text-muted-foreground">{when(entry.at, now)}</span></div>
      <CommentAttachments issueId={issueId} items={entry.data?.attachments} />
      {(comment || detail) && <Clamp text={comment ?? detail ?? ''} lines="line-clamp-6" />}
    </li>
  );
}

function AskCard({ issue, entry, logo, now }) {
  const byDudu = !issue.agent || !issue.sessions?.some((session) => session.key === issue.session && session.state === 'waiting_owner');
  const name = byDudu ? T.brand : AGENT_NAMES[issue.agent] ?? T.brand;
  const status = statusLabel(issue.status);
  return (
    <section aria-label={status}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {byDudu ? <img src={logo} alt="" className="size-[18px] shrink-0" /> : <AgentAvatar agent={issue.agent} state="idle" />}
          <span className="font-medium">{name}</span>
          {entry?.at != null && <span className="text-xs text-muted-foreground">{when(entry.at, now)}</span>}
          <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs"><StatusIcon status={issue.status} className="size-3" />{status}</span>
        </div>
        <p className="break-words whitespace-pre-wrap">{entry ? storedSystemText(entry) : issue.ask}</p>
      </div>
    </section>
  );
}

const firstLink = (text) => /https?:\/\/\S+/.exec(text ?? '')?.[0] ?? null;

/**
 * An issue's page, as designed: breadcrumb and previous/next on top; the title, description, Activity and a comment box on the
 * left; Properties (status, priority, agent, due date) and Project on the right. `ids` is the list the person came from.
 */
export function IssueDetail({ request, id, ids, logo, onBack, onOpen, openSession, previewSession }) {
  const { status, issue, log, activeQuestion, nextLogCursor, change, assign, message, loadEarlier, reload } = useIssue(request, id);
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const openConversation = async () => {
    if (opening) return;
    setOpening(true);
    try { await openSession?.(issue); }
    catch { toast({ message: T.widgets.sessions.openFailed }); }
    finally { setOpening(false); }
  };
  const [addingLink, setAddingLink] = useState(null); // the kind of link being added (link, pull_request, document), or null
  const [askResult, setAskResult] = useState(null); // the id of an issue the owner just marked Done and may say how it went
  const session = useIssueSession(request, issue);
  // Where an issue that came from a connector came from: the connector's name and the link of what it was made from.
  const [found, setFound] = useState(null);
  useEffect(() => {
    let active = true;
    if (issue?.source === 'connector') {
      request('issues/source', { id }).then((result) => { if (active && result.outcome === 'success') setFound({ id, source: result.source ?? null }); }).catch(() => { /* the link in the description is still there */ });
    }
    return () => { active = false; };
  }, [id, issue?.source, issue?.sourceRef, request]);
  const origin = found?.id === id ? found.source : null;
  const now = Date.now();
  // Every change on this page says so at the bottom.
  const done = (result, message) => {
    if (result?.outcome === 'success' && result.eventId) toast({ message });
    else if (result && result.outcome !== 'no_op') toast({ message: T.toast.failed });
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText(issue.ref); toast({ message: T.toast.copied(issue.ref) }); } catch { toast({ message: T.toast.failed }); }
  };
  const source = origin?.url ?? (issue ? firstLink(issue.sourceRef) : null);
  const position = ids.indexOf(id);
  const due = issue ? dueInfo(issue.dueAt, now) : null;
  const waiting = Boolean(issue?.ask);
  const question = waiting ? activeQuestion ?? log.find((entry) => entry.kind === 'blocked' && entry.text === issue?.ask) : null;
  const discussion = [...log, ...(question && !log.some((entry) => entry.id === question.id) ? [question] : [])]
    .filter((entry) => entry.id === question?.id || entry.kind === 'status' || isComment(entry)).sort((a, b) => a.at - b.at || a.id - b.id);
  return (
    <TooltipProvider>
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4 ps-[max(1rem,var(--dsh-frame-leading-clearance,0px))]" data-window-drag>
        <button type="button" className="shrink-0 rounded-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={onBack} aria-label={T.detail.back}>{T.issues}</button>
        {issue && (
          <>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate font-medium">{issue.ref} {issue.title}</span>
          </>
        )}
        <span className="flex-1" />
        {position >= 0 && ids.length > 1 && (
          <>
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{T.detail.position(position + 1, ids.length)}</span>
            <Button variant="ghost" size="icon-xs" aria-label={T.detail.next} disabled={position >= ids.length - 1} onClick={() => onOpen(ids[position + 1])}><ChevronDown /></Button>
            <Button variant="ghost" size="icon-xs" aria-label={T.detail.previous} disabled={position <= 0} onClick={() => onOpen(ids[position - 1])}><ChevronUp /></Button>
          </>
        )}
        {issue && (
          <div className="flex shrink-0 items-center gap-1 text-muted-foreground" data-window-drag-recall>
            {issue.ref && <Button variant="ghost" size="icon-sm" aria-label={T.detail.copyId} title={T.detail.copyId} onClick={copyId}><Copy /></Button>}
            <Button
              variant="ghost" size="icon-sm" aria-label={issue.session ? T.detail.openSession : T.detail.openSource} title={issue.session ? T.detail.openSession : T.detail.openSource}
              disabled={opening || (!issue.session && !source)} onClick={() => (issue.session ? openConversation() : window.open(source, '_blank', 'noopener,noreferrer'))}
            >
              {opening ? <LoaderCircle className="animate-spin" /> : issue.session ? <Expand /> : <ExternalLink />}
            </Button>
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {status === 'missing' || status === 'error' ? (
          <p className="p-10 text-center text-muted-foreground">{T.detail.notFound}</p>
        ) : !issue ? <p role="status" className="p-10 text-center text-muted-foreground">{T.shell.loading}</p> : (
          <div className="mx-auto flex w-full max-w-[1008px] flex-col gap-8 px-6 pt-12 pb-16 md:flex-row md:gap-14">
            <div className="min-w-0 flex-1">
              <EditableText value={issue.title} label={T.detail.untitled} placeholder={T.detail.untitled} className="text-2xl/8 font-semibold tracking-tight" onSave={(title) => change({ title })} />
              {issue.parent && <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" data-issue-parent={issue.parent.id}>
                {T.subIssues.subIssueOf}
                <button type="button" onClick={() => onOpen(issue.parent.id)} className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-2.5 text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <StatusIcon status={issue.parent.status} className="size-3.5" />
                  {issue.parent.ref && <span className="text-muted-foreground tabular-nums">{issue.parent.ref}</span>}
                  <span className="max-w-[320px] truncate font-medium">{issue.parent.title}</span>
                </button>
                {issue.parent.subIssues && <SubIssueChip progress={issue.parent.subIssues} />}
              </div>}
              <RichText key={issue.id} className="mt-5" value={issue.brief} label={T.detail.description} placeholder={T.detail.description} onSave={(brief) => change({ brief })} />
              <SubIssues request={request} issue={issue} onOpen={onOpen} reload={reload} />
              <LinksSection request={request} issue={issue} reload={reload} onAdd={setAddingLink} />
              <section className="mt-8 border-t pt-5" data-issue-discussion="">
                <h2 className="mb-4 font-semibold">{T.detail.activity}</h2>
                <ul className="flex flex-col gap-4">
                  {nextLogCursor && <li><Button variant="ghost" size="sm" onClick={loadEarlier}>{T.detail.loadEarlier}</Button></li>}
                  {discussion.map((entry) => entry.id === question?.id
                    ? <li key={entry.id}><AskCard issue={issue} entry={entry} logo={logo} now={now} /></li>
                    : entry.kind === 'status' ? <StatusLine key={entry.id} entry={entry} now={now} />
                    : <LogLine key={entry.id} issueId={issue.id} entry={entry} logo={logo} now={now} />)}
                </ul>
                <div className="mt-5"><MessageComposer key={issue.id} issueId={issue.id} agent={issue.agent} logo={logo}
                  outcome={askResult === issue.id && statusType(issue.status) === 'done' && !issue.outcome}
                  onSkip={() => setAskResult(null)}
                  onSend={async (text, options) => {
                    if (askResult === issue.id && statusType(issue.status) === 'done' && !issue.outcome) {
                      const result = await change({ outcome: text });
                      if (result?.outcome === 'success') setAskResult(null);
                      return result;
                    }
                    return message(text, options);
                  }} /></div>
              </section>
            </div>
            <aside className="flex w-full shrink-0 flex-col gap-8 md:w-[264px]" aria-label={T.detail.properties}>
              <div>
                <Section>{T.detail.properties}</Section>
                <StatusMenu
                  status={issue.status}
                  onSelect={async (next) => {
                    const result = await change({ status: next });
                    done(result, statusType(next) === 'done' ? T.toast.markedDone : T.toast.status(statusLabel(next)));
                    if (statusType(next) === 'done' && result?.outcome === 'success') setAskResult(issue.id);
                  }}
                >
                  <button type="button" className={propertyButton}><StatusIcon status={issue.status} />{statusLabel(issue.status)}</button>
                </StatusMenu>
                <PriorityMenu priority={issue.priority} onSelect={async (next) => done(await change({ priority: next }), T.toast.priority(T.priority[next]))}>
                  <button type="button" className={propertyButton}><PriorityIcon priority={issue.priority} />{T.priority[issue.priority]}</button>
                </PriorityMenu>
                <AgentMenu
                  agent={issue.agent} project={issue.project} request={request} locked={Boolean(issue.agent)}
                  onSelect={async (next, project) => done(await assign(next, project), next ? T.toast.assigned(AGENT_NAMES[next] ?? next) : T.toast.unassigned)}
                >
                  <button type="button" disabled={Boolean(issue.agent) && !issue.session} className={propertyButton}
                    aria-label={issue.agent && issue.session ? `${AGENT_NAMES[issue.agent] ?? issue.agent} · ${T.detail.openSession}` : undefined}
                    title={issue.agent && issue.session ? T.detail.openSession : undefined}
                    onClick={() => { if (issue.agent && issue.session) previewSession(issue); }}>
                    <AgentAvatar agent={issue.agent} state={issue.sessionState} asleep={issue.deepSleep} compact />
                    {issue.agent ? (AGENT_NAMES[issue.agent] ?? issue.agent) : T.noAgent}
                  </button>
                </AgentMenu>
                <DueMenu dueAt={issue.dueAt} onChange={async (dueAt) => done(await change({ dueAt }), dueAt == null ? T.toast.dueRemoved : T.toast.dueSet)}>
                  <button type="button" data-issue-due={issue.id} className={propertyButton} title={due?.hint}>
                    <DueIcon className={due ? DUE_ICON_TONE[due.kind] : 'text-muted-foreground'} />{due ? due.text : T.detail.noDueDate}
                  </button>
                </DueMenu>
              </div>
              <div>
                <Section>{T.labels.name}</Section>
                <LabelMenu request={request} value={(issue.labels ?? []).map((label) => label.id)} onChange={(labels) => change({ labels })}>
                  <button type="button" data-issue-labels={issue.id} className={cn(propertyButton, 'h-auto min-h-8 flex-wrap gap-1.5 py-1')}>
                    {issue.labels?.length ? issue.labels.map((label) => <LabelChip key={label.id} label={label} />) : <><Tag className="size-4 text-muted-foreground" aria-hidden="true" />{T.labels.add}</>}
                  </button>
                </LabelMenu>
              </div>
              <div>
                <Section>{T.detail.project}</Section>
                <ProjectMenu request={request} project={issue.project} locked={Boolean(issue.agent)} onSelect={async (project) => { const result = await change({ project }); if (result?.outcome !== 'success' && result?.outcome !== 'no_op') toast({ message: T.toast.failed }); }}>
                <button type="button" disabled={Boolean(issue.agent)} className={propertyButton}>
                  <Box className="size-4" style={issue.project?.name ? { color: projectColor(issue.project.name) } : undefined} aria-hidden="true" />
                  {issue.project?.name ?? T.detail.noProjectSet}
                </button>
                </ProjectMenu>
              </div>
              {origin && <div>
                <Section>{T.detail.source}</Section>
                <button type="button" className={propertyButton} title={origin.url} aria-label={`${origin.name} · ${T.detail.openSource}`}
                  onClick={() => window.open(origin.url, '_blank', 'noopener,noreferrer')}>
                  <span className="min-w-0 flex-1 truncate">{origin.name}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </div>}
              {session?.sessionId && <div>
                <Section>{T.source.session}</Section>
                <button type="button" className={cn(propertyButton, 'h-auto min-h-8')} disabled={!session.command}
                  title={session.command ?? session.sessionId} aria-label={session.command ?? session.sessionId}
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(session.command); toast({ message: T.toast.copied(session.command) }); }
                    catch { toast({ message: T.toast.failed }); }
                  }}>
                  <code className="min-w-0 flex-1 truncate text-xs">{session.sessionId}</code>
                  {session.command && <Copy className="size-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </div>}
            </aside>
          </div>
        )}
      </div>
      {issue && addingLink && <AddLinkDialog key={addingLink} request={request} issue={issue} kind={addingLink} onClose={() => setAddingLink(null)} onAdded={reload} />}
    </div>
    </TooltipProvider>
  );
}
