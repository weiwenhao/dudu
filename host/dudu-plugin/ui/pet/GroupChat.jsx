import { useLayoutEffect, useRef, useState } from 'react';
import { Clock, Copy, Reply, Trash2 } from 'lucide-react';
import { T } from '../strings.js';
import { cn } from '../lib/cn.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { when } from '../issues/activity.js';
import { Markdown } from '../sessions/Markdown.jsx';
import { taskText } from '../tasks/format.js';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../components/context-menu.jsx';

// The lines of the group chat in 嘟嘟's thread (owner, 2026-11-10; docs/assistant.md 4.1, the drawing `.local/designs/group-chat-2026-11-10/desktop.png`): what the owner wrote to an issue (a bubble on the
// right with its blue @ID), what that issue's agent answered (a bubble on the left: the agent's logo, the issue's ID, when, and the title as the signature) and the dots while the answer is on its way.
// The result of a scheduled task done by 嘟嘟 itself is the fourth (owner, 2026-11-11, the left frame of `.local/designs/scheduled-tasks-fresh-session-2026-11-11/chat.png`): 嘟嘟's own words, so no bubble and no
// picture, under a header of a clock, the task's name and the time.
// The plugin keeps what each line says (host/assistant/home/group.mjs); the thread only knows which line it is.
const P = T.pet;
const nameOf = (issue) => issue?.ref ?? (issue?.id != null ? `#${issue.id}` : '');
/** How many lines of an answer the bubble shows before it is cut (the drawing's desktop thread had 5; six leave room for the capsule over the fade). */
const CLAMP_LINES = 6;

/** What a line puts on the clipboard: the owner's own words with their @, what the agent answered, or what a task's line says (its result, or why the run failed). */
export const lineText = (line) => (line?.kind === 'at' ? `@${nameOf(line.issue)} ${line.text ?? ''}`.trim() : line?.kind === 'task' ? taskText(line) : String(line?.text ?? ''));

/**
 * The right-click menu of a line of the thread (the owner's: Lark's, 回复 · 复制 · 删除): 回复 only where an issue can be answered (what an issue said, the owner's own @ lines), 复制 only where there are words,
 * 删除 always, and only in the red of the destructive colour. The row is tinted while the menu is open, from edge to edge as Lark's is. A menu of this pet belongs to it (`data-pet-menu`).
 */
export function MessageRow({ children, onReply, onCopy, onDelete }) {
  const item = 'gap-2.5 text-[13px] [&_svg]:text-muted-foreground';
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="dudu-pet-row">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent data-pet-menu="" data-pet-context-menu="" className="dudu-pet-menu w-40 rounded-xl border-input">
        {onCopy && <ContextMenuItem className={item} onSelect={onCopy}><Copy strokeWidth={1.8} aria-hidden="true" />{P.copy}</ContextMenuItem>}
        {onReply && <ContextMenuItem className={item} onSelect={onReply}><Reply strokeWidth={1.8} aria-hidden="true" />{P.reply}</ContextMenuItem>}
        {(onCopy || onReply) && <ContextMenuSeparator />}
        <ContextMenuItem className={cn(item, 'text-destructive [&_svg]:text-destructive')} onSelect={onDelete}><Trash2 strokeWidth={1.8} aria-hidden="true" />{P.remove}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The agent's picture on the left of its lines: its logo, or the first letter of the issue's ID when the issue has no agent that is known. */
function Face({ issue, onOpen }) {
  const body = issue?.agent ? <AgentLogo agent={issue.agent} className="size-[22px]" /> : <span className="flex size-[22px] items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground">{nameOf(issue).slice(0, 1)}</span>;
  return <button type="button" aria-label={nameOf(issue)} onClick={onOpen} className="dudu-pet-guest-face">{body}</button>;
}

/** Who a line of an issue is by: its ID in the strong grey, when, then the title as the signature (the owner, round 3: "签名放在时间的后面"). */
function Label({ issue, at }) {
  return (
    <div className="dudu-pet-guest-label">
      <span className="shrink-0 font-semibold text-muted-foreground">{nameOf(issue)}</span>
      {at != null && <span className="shrink-0 text-[11px] text-muted-foreground/75">{when(at)}</span>}
      <span className="min-w-0 truncate text-muted-foreground/75" title={issue?.title || undefined}>{issue?.title}</span>
    </div>
  );
}

/**
 * The answer of an issue's agent: markdown, cut at six lines the way Lark cuts a long message (owner, 2026-11-11, from a Lark screenshot): the last lines fade into the bubble and a white capsule, 展开, sits over the
 * fade; opened, the bubble grows where it stands and a capsule, 收起, ends it, and closing it brings the bubble back into view. Only the capsule changes it, so a click that selects words opens nothing.
 */
function Answer({ text, open, setOpen, running }) {
  const [longer, setLonger] = useState(false);
  const root = useRef(null);
  const body = useRef(null);
  const closing = useRef(false);
  useLayoutEffect(() => {
    const element = body.current;
    if (element && !open) setLonger(element.scrollHeight > element.clientHeight + 1);
  }, [text, open]);
  useLayoutEffect(() => {
    if (!open && closing.current) { closing.current = false; root.current?.scrollIntoView({ block: 'nearest' }); }
  }, [open]);
  return (
    <div ref={root} className="dudu-pet-guest-bubble">
      <div className="relative">
        <div ref={body} className={open ? undefined : cn('dudu-pet-clamp', longer && 'dudu-pet-clamp--cut')} style={open ? undefined : { WebkitLineClamp: CLAMP_LINES }}><Markdown text={text} /></div>
        {longer && !open && <button type="button" className="dudu-pet-fold" aria-expanded="false" onClick={() => setOpen(true)}>{P.expand}</button>}
      </div>
      {open && <button type="button" className="dudu-pet-fold dudu-pet-fold--end" aria-expanded="true" onClick={() => { closing.current = true; setOpen(false); }}>{P.collapse}</button>}
      {running && <ReplyDots className="dudu-pet-dots--reply" />}
    </div>
  );
}

/** A line the owner's issue answered with (`reply`), on the left. `onOpenIssue` is what a click on the picture does (the issue's page). */
export function GuestMessage({ line, onOpenIssue, expanded, onExpandedChange, running = false }) {
  return (
    <div className="dudu-pet-guest" data-group-issue={nameOf(line.issue)} data-group-waiting={running ? nameOf(line.issue) : undefined} aria-busy={running || undefined}>
      <Face issue={line.issue} onOpen={() => onOpenIssue(line.issue)} />
      <div className="min-w-0">
        <Label issue={line.issue} at={line.at} />
        <Answer text={line.text ?? ''} open={expanded} setOpen={onExpandedChange} running={running} />
      </div>
    </div>
  );
}

/** The same dots remain after text arrives, until the forwarded run actually ends. */
function ReplyDots({ className }) {
  return <div className={cn('dudu-pet-dots', className)} aria-hidden="true"><i /><i /><i /></div>;
}

/** The dots of an issue that has not answered yet. */
export function WaitingMessage({ line, onOpenIssue, expanded, onExpandedChange }) {
  if (line.liveReply?.text) {
    return <GuestMessage running line={{ ...line, kind: 'reply', text: line.liveReply.text, at: line.liveReply.at }} onOpenIssue={onOpenIssue} expanded={expanded} onExpandedChange={onExpandedChange} />;
  }
  return (
    <div className="dudu-pet-guest" data-group-waiting={nameOf(line.issue)} role="status" aria-busy="true">
      <Face issue={line.issue} onOpen={() => onOpenIssue(line.issue)} />
      <div className="min-w-0">
        <Label issue={line.issue} />
        <ReplyDots className="dudu-pet-guest-bubble" />
      </div>
    </div>
  );
}

/** What the owner wrote to an issue: the bubble of their own words with the @ID in blue. No tick under it (owner, 2026-11-11: "不需要"). */
export function AtMessage({ line }) {
  return (
    <div className="dudu-pet-at" data-group-at={nameOf(line.issue)}>
      <div className="dudu-pet-message dudu-pet-message--owner"><span className="dudu-pet-mark">@{nameOf(line.issue)}</span> {line.text}</div>
    </div>
  );
}

/**
 * The result of a run of a scheduled task of 嘟嘟 (`task`): 嘟嘟's own words, drawn as its other messages are (`dudu-pet-message--dudu`: no bubble, no picture), under a header of a clock, the task's name and when the
 * run ended, in the grey of the other lines' headers. A run that failed says so in front of the reason. A task is not an issue: there is no 回复 for it, and a click on it goes nowhere.
 */
export function TaskMessage({ line }) {
  return (
    <div className="dudu-pet-task" data-group-task={line.task?.id}>
      <div className="dudu-pet-task-label">
        <Clock className="size-[13px] shrink-0 self-center text-muted-foreground/75" aria-hidden="true" />
        <span className="min-w-0 truncate font-semibold text-muted-foreground" title={line.task?.title || undefined}>{line.task?.title}</span>
        {line.at != null && <span className="ml-0.5 shrink-0 text-[11px] text-muted-foreground/75">{when(line.at)}</span>}
      </div>
      <div className="dudu-pet-message dudu-pet-message--dudu">{taskText(line)}</div>
    </div>
  );
}
