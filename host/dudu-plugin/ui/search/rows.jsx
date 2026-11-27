import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { when } from '../issues/activity.js';
import { ConversationMark } from '../issues/ConversationAvatar.jsx';
import { ConversationTitle, issueOf } from '../issues/conversation-row.jsx';
import { conversationTime } from '../issues/conversation-time.js';
import { AgentAvatar } from '../issues/icons.jsx';
import { ConnectorAvatar } from '../collector/ConnectorAvatar.jsx';
import { scheduleLabel, stamp } from '../tasks/format.js';
import { markParts } from './search-model.js';

/** A text with the words of the query in the app's blue (the phone's blue is the interface's `--ring`), as Lark marks them. */
export function Marked({ text, words }) {
  return <>{markParts(text, words).map((part, index) => (part.hit ? <mark key={index} className="bg-transparent font-medium text-ring">{part.text}</mark> : part.text))}</>;
}

const enter = (open) => (event) => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); open(); } };

/**
 * A conversation, as the list has it (the same row: its avatar with the state mark, title, time, and the agent's mark): the text of the conversation that matched, up to two lines, in place of the
 * last message, and the open conversation shaded as it is in the list. `badge(entry, size)` is the list's own avatar.
 */
export function SessionResultRow({ entry, words, selected, badge, onOpen }) {
  const issue = issueOf(entry);
  const label = issue.parent ? `${issue.parent.title}#${issue.title}` : issue.title;
  return (
    <div role="listitem">
      <div tabIndex={0} className="dudu-conversation-row" data-search-row="session" data-snippet={entry.snippet ? '' : undefined} aria-label={label} aria-current={selected ? 'true' : undefined} title={label}
        onClick={() => onOpen(entry)} onKeyDown={enter(() => onOpen(entry))}>
        {badge(entry, 40)}
        <div className="dudu-conversation-row-copy">
          <div className="dudu-conversation-row-title">
            <ConversationTitle issue={issue} mark={(text) => <Marked text={text} words={words} />} />
            {entry.receivedAt > 0 && <time className="dudu-conversation-row-time" dateTime={new Date(entry.receivedAt).toISOString()}>{conversationTime(entry.receivedAt)}</time>}
          </div>
          <div className="dudu-conversation-row-preview">
            <span className="dudu-conversation-summary" title={entry.snippet ?? entry.preview}>{entry.snippet ? <Marked text={entry.snippet} words={words} /> : entry.preview}</span>
            {entry.issue && (issue.agent ? <AgentLogo agent={issue.agent} className="size-3" /> : <AgentAvatar compact className="!size-3" />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A collected record, as the Collector's row has it: where it comes from as a small picture (with the board's red mark while nobody has read it), the title and when, and under it who it is from and
 * which collector brought it; when only the text of the record matched, the line of the text that did.
 */
export function RecordResultRow({ record, words, onOpen }) {
  const by = [record.ref, record.from, record.connectorName].filter(Boolean).join(' · ');
  return (
    <div role="listitem">
      <div tabIndex={0} className="dudu-conversation-row" data-search-row="record" aria-label={record.title} onClick={() => onOpen(record)} onKeyDown={enter(() => onOpen(record))}>
        <span className="relative flex size-7 shrink-0" aria-hidden="true">
          <ConnectorAvatar icon={record.connectorIcon} name={record.connectorName} size={28} />
          {record.unread && <ConversationMark state="unread" size={28} />}
        </span>
        <div className="dudu-conversation-row-copy">
          <span className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium"><Marked text={record.title} words={words} /></span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{when(record.at)}</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">{record.snippet ? <Marked text={record.snippet} words={words} /> : <Marked text={by} words={words} />}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * A scheduled task, as the chat's task card has it (`QuickCards.jsx` TaskRow) and the phones' task page: the mark of the agent that runs it, its name, when it runs and when it runs next, and at the right
 * whether it is on; a task that is off (paused, ended) is dimmed and has no next run.
 */
export function TaskResultRow({ task, words, onOpen }) {
  const quiet = task.status !== 'active';
  const line = [task.schedule ? scheduleLabel(task.schedule) : '', !quiet && task.nextRunAt ? `${T.tasks.next} ${stamp(task.nextRunAt, task.schedule?.timezone)}` : ''].filter(Boolean).join(' · ');
  return (
    <div role="listitem">
      <div tabIndex={0} className="dudu-conversation-row" data-search-row="task" aria-label={task.title} onClick={() => onOpen(task)} onKeyDown={enter(() => onOpen(task))}>
        <span className={cn('shrink-0', quiet && 'opacity-55')}><AgentLogo agent={task.agent} className="size-5" /></span>
        <div className="dudu-conversation-row-copy">
          <div className={cn('truncate text-sm font-medium', quiet && 'text-muted-foreground')}><Marked text={task.title} words={words} /></div>
          <div className="truncate text-xs text-muted-foreground">{line}</div>
        </div>
        <span className="shrink-0 text-xs" style={{ color: quiet ? 'var(--muted-foreground)' : 'var(--dudu-success)' }}>{T.tasks.statuses[task.status]}</span>
      </div>
    </div>
  );
}
