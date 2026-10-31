import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Box, CalendarDays, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { actorName, describe, when } from './activity.js';
import { dueInfo, DUE_TONE } from './due.js';
import { DueMenu } from './DueMenu.jsx';
import { AgentAvatar, PriorityIcon, projectColor, StatusIcon } from './icons.jsx';
import { AGENT_NAMES } from './model.js';
import { PriorityMenu } from './PriorityMenu.jsx';
import { StatusMenu } from './StatusMenu.jsx';
import { useIssue } from './use-issue.js';

const Section = ({ children }) => <h2 className="mb-2 text-sm text-muted-foreground">{children}</h2>;
const propertyButton = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent';

/** A title or description that is plain text until it is clicked: edits are saved when it loses focus. */
function EditableText({ value, onSave, className, placeholder, multiline, label }) {
  const [draft, setDraft] = useState(value);
  const field = useRef(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { // a textarea grows with its text
    const el = field.current;
    if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; }
  }, [draft]);
  const save = () => { const next = draft.trim(); if (next !== value && (next || multiline)) onSave(next); else setDraft(value); };
  return (
    <textarea
      ref={field} rows={1} value={draft} placeholder={placeholder} aria-label={label} spellCheck={false}
      onChange={(event) => setDraft(event.target.value)} onBlur={save}
      onKeyDown={(event) => { if (!multiline && event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur(); } }}
      className={cn('block w-full resize-none overflow-hidden rounded-md bg-transparent outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}
    />
  );
}

// The person is drawn like an agent that has not been assigned: a dashed circle with a person in it.
const Actor = ({ actor }) => <AgentAvatar agent={actor === 'owner' ? null : actor} state="idle" />;

function LogLine({ entry, logo, now }) {
  const { sentence, detail, comment } = describe(entry);
  const name = actorName(entry.actor);
  const glyph = entry.actor === 'dudu' ? <img src={logo} alt="" className="size-[18px] shrink-0" /> : <Actor actor={entry.actor} />;
  if (comment) {
    return (
      <li className="flex flex-col gap-1.5 rounded-xl border p-3">
        <div className="flex items-center gap-2">{glyph}<span className="font-medium">{name}</span><span className="text-xs text-muted-foreground">{when(entry.at, now)}</span></div>
        <p className="break-words whitespace-pre-wrap">{comment}</p>
      </li>
    );
  }
  return (
    <li className="flex gap-3 px-1">
      <span className="flex h-5 w-[18px] shrink-0 items-center justify-center">{glyph}</span>
      <div className="min-w-0">
        <p><span>{name}</span> <span>{sentence}</span> <span className="text-muted-foreground">· {when(entry.at, now)}</span></p>
        {detail && <p className="break-words text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

function AskCard({ issue, since, now }) {
  const name = AGENT_NAMES[issue.agent] ?? issue.agent ?? '';
  return (
    <section className="rounded-xl border" aria-label={T.detail.needsYou}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <AgentAvatar agent={issue.agent} state="idle" />
          <span className="font-medium">{name}</span>
          {since != null && <span className="text-xs text-muted-foreground">{when(since, now)}</span>}
          <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs"><span className="size-1.5 rounded-full bg-warning" />{T.detail.needsYou}</span>
        </div>
        <p className="break-words whitespace-pre-wrap">{issue.ask}</p>
      </div>
    </section>
  );
}

function Composer({ onSend }) {
  const [text, setText] = useState('');
  const send = async () => { const value = text.trim(); if (!value) return; setText(''); await onSend(value); };
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3 shadow-xs">
      <textarea
        value={text} rows={2} placeholder={T.detail.leaveComment} aria-label={T.detail.leaveComment}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); } }}
        className="block min-h-10 w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground"
      />
      <div className="flex justify-end">
        <Button variant="outline" size="icon-sm" className="size-7 rounded-full" aria-label={T.detail.send} disabled={!text.trim()} onClick={send}><ArrowUp /></Button>
      </div>
    </div>
  );
}

/**
 * An issue's page, as designed: breadcrumb and previous/next on top; the title, description, Activity and a comment box on the
 * left; Properties (status, priority, agent, due date) and Project on the right. `ids` is the list the person came from.
 */
export function IssueDetail({ request, id, ids, logo, onBack, onOpen }) {
  const { status, issue, log, nextLogCursor, change, addNote, loadEarlier } = useIssue(request, id);
  const now = Date.now();
  const position = ids.indexOf(id);
  const due = issue ? dueInfo(issue.dueAt, now) : null;
  const askedAt = log.find((entry) => entry.kind === 'blocked')?.at ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <img src={logo} alt="" className="size-[18px]" />
        <span className="font-medium">嘟嘟</span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        <button type="button" className="rounded-md px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={onBack} aria-label={T.detail.back}>{T.issues}</button>
        {issue && (
          <>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 truncate font-medium">DUDU-{issue.id} {issue.title}</span>
          </>
        )}
        <span className="flex-1" />
        {position >= 0 && ids.length > 1 && (
          <>
            <span className="text-xs text-muted-foreground">{T.detail.position(position + 1, ids.length)}</span>
            <Button variant="ghost" size="icon-xs" aria-label={T.detail.next} disabled={position >= ids.length - 1} onClick={() => onOpen(ids[position + 1])}><ChevronDown /></Button>
            <Button variant="ghost" size="icon-xs" aria-label={T.detail.previous} disabled={position <= 0} onClick={() => onOpen(ids[position - 1])}><ChevronUp /></Button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {status === 'missing' || status === 'error' ? (
          <p className="p-10 text-center text-muted-foreground">{T.detail.notFound}</p>
        ) : !issue ? null : (
          <div className="mx-auto flex w-full max-w-[960px] gap-14 px-6 pt-10 pb-16">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <EditableText value={issue.title} label={T.detail.untitled} placeholder={T.detail.untitled} className="text-2xl/8 font-semibold" onSave={(title) => change({ title })} />
              <EditableText value={issue.brief} label={T.detail.description} placeholder={T.detail.description} multiline className="text-[15px]/6" onSave={(brief) => change({ brief })} />
              <hr className="my-2" />
              <h2 className="font-semibold">{T.detail.activity}</h2>
              <ul className="flex flex-col gap-4">
                {nextLogCursor && <li><Button variant="ghost" size="sm" onClick={loadEarlier}>{T.detail.loadEarlier}</Button></li>}
                {[...log].reverse().map((entry) => <LogLine key={entry.id} entry={entry} logo={logo} now={now} />)}
              </ul>
              {issue.ask && issue.agentState === 'needs_you' && <AskCard issue={issue} since={askedAt} now={now} />}
              <Composer onSend={addNote} />
            </div>
            <aside className="flex w-[220px] shrink-0 flex-col gap-6 pt-1" aria-label={T.detail.properties}>
              <div>
                <Section>{T.detail.properties}</Section>
                <StatusMenu status={issue.status} onSelect={(next) => change({ status: next })}>
                  <button type="button" className={propertyButton}><StatusIcon status={issue.status} />{T.status[issue.status]}</button>
                </StatusMenu>
                <PriorityMenu priority={issue.priority} onSelect={(next) => change({ priority: next })}>
                  <button type="button" className={propertyButton}><PriorityIcon priority={issue.priority} />{T.priority[issue.priority]}</button>
                </PriorityMenu>
                <div className={cn(propertyButton, 'cursor-default hover:bg-transparent')}>
                  <AgentAvatar agent={issue.agent} state={issue.agentState} />
                  {issue.agent ? (AGENT_NAMES[issue.agent] ?? issue.agent) : T.noAgent}
                </div>
                <DueMenu dueAt={issue.dueAt} onChange={(dueAt) => change({ dueAt })}>
                  <button type="button" className={cn(propertyButton, due && DUE_TONE[due.kind])} title={due?.hint}>
                    <CalendarDays className="size-4" aria-hidden="true" />{due ? due.text : T.detail.noDueDate}
                  </button>
                </DueMenu>
              </div>
              <div>
                <Section>{T.detail.project}</Section>
                <div className={cn(propertyButton, 'cursor-default hover:bg-transparent')}>
                  <Box className="size-4" style={issue.project?.name ? { color: projectColor(issue.project.name) } : undefined} aria-hidden="true" />
                  {issue.project?.name ?? T.detail.noProjectSet}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
