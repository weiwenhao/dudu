import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Gauge, Inbox, ListTodo, Reply, SquareArrowOutUpRight } from 'lucide-react';
import { T } from '../strings.js';
import { cn } from '../lib/cn.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { when } from '../issues/activity.js';
import { AgentAvatar } from '../issues/icons.jsx';
import { ConnectorAvatar } from '../collector/ConnectorAvatar.jsx';
import { Markdown } from '../sessions/Markdown.jsx';
import { scheduleLabel, stamp } from '../tasks/format.js';
import { plainText } from './group-events.mjs';
import { panelOf, updatedText } from '../quota/panel-model.mjs';
import { QuotaBlock } from '../quota/QuotaBlocks.jsx';

// Keep transcript cards after removing Desktop's composer shortcuts (owner, 2026-11-16).
const CARDS = [
  { kind: 'todo', Icon: ListTodo, label: () => T.status.todo },
  { kind: 'info', Icon: Inbox, label: () => T.widgets.titles.collector },
  { kind: 'task', Icon: Clock, label: () => T.tasks.title },
  { kind: 'quota', Icon: Gauge, label: () => T.widgets.titles.quota },
];

const emptyOf = (kind) => (kind === 'todo' ? T.empty : kind === 'info' ? T.collector.empty : kind === 'quota' ? T.widgets.quota.empty : T.pet.noTasks);

/** The little square buttons under an opened row: they carry no word (the mouse rests on them for their name), as the desktop's own icon buttons do. */
function RowButton({ label, tone, onClick, children }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cn('inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4', tone === 'strong'
        ? 'bg-[var(--dudu-soft)] text-[var(--dudu-strong)] hover:brightness-95' : 'bg-muted text-muted-foreground hover:bg-accent')}>
      {children}
    </button>
  );
}

/**
 * A row of the 待办 card is an issue: its agent's picture with the mark of its state, its ID, when its latest message was said and its title as the signature; under it that message, two lines of it. A click
 * opens the row downward to the whole message, and the two things to do with it: 回复 (the issue's @ goes into the box) and 打开会话 (its own conversation). An issue nobody has yet has no
 * conversation and nothing to say: its row opens the issue's page, as it always did. The two lines of the message are `line-clamp-2`, which is `display: -webkit-box`: a `block` class beside it took that away and a
 * long message ran on whole, so the row looked opened (owner, 2026-11-10: "默认展开了，这完全看不了").
 */
function TodoRow({ row, open, onToggle, onReply, onOpenSession, onOpenIssue }) {
  const latest = row.latest;
  const answerable = Boolean(row.sessionId && latest?.text);
  const mine = latest?.who === 'me';
  return (
    <div data-card-issue={row.id}>
      <button type="button" aria-expanded={answerable ? open : undefined} onClick={() => (answerable ? onToggle(row.id) : onOpenIssue(row))}
        className="flex w-full items-start gap-3 px-3.5 pt-2.5 pb-2.5 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent/60">
        <AgentAvatar agent={row.agent} state={row.sessionState} asleep={row.deepSleep === true} showTitle={false} />
        <span className="min-w-0 flex-1">
          <span className="flex h-6 items-center gap-2">
            <span className="shrink-0 text-[13px] font-semibold tabular-nums">{row.ref ?? `#${row.id}`}</span>
            {latest && <span className="shrink-0 text-xs text-muted-foreground/75">{when(latest.at)}</span>}
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{row.title}</span>
            {answerable && (open ? <ChevronUp className="size-3.5 shrink-0 text-muted-foreground/75" aria-hidden="true" /> : <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/75" aria-hidden="true" />)}
          </span>
          {latest && !open && (
            <span className={cn('mt-0.5 line-clamp-2 text-xs leading-[17px] [overflow-wrap:anywhere]', mine ? 'text-muted-foreground/75' : 'text-muted-foreground')}>{(mine ? T.pet.you : '') + plainText(latest.text)}</span>
          )}
        </span>
      </button>
      {open && answerable && (
        <div className="pr-3.5 pb-2.5 pl-[50px]">
          <div className={cn('max-h-[168px] overflow-y-auto rounded-lg px-2.5 py-2', mine ? 'bg-[var(--dudu-soft)]' : 'bg-muted')} data-todo-latest>
            <Markdown text={(mine ? T.pet.you : '') + latest.text} className="text-[13px] leading-[19px]" />
          </div>
          <div className="mt-2 flex justify-end gap-1.5">
            <RowButton label={T.pet.reply} tone="strong" onClick={() => onReply(row)}><Reply strokeWidth={1.8} aria-hidden="true" /></RowButton>
            <RowButton label={T.detail.openSession} onClick={() => onOpenSession(row)}><SquareArrowOutUpRight strokeWidth={1.8} aria-hidden="true" /></RowButton>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ row }) {
  return (
    <div className="flex h-14 items-center gap-3 px-3.5">
      <ConnectorAvatar icon={row.connectorIcon} name={row.connectorName} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.title}</div>
        <div className="truncate text-xs text-muted-foreground">{[row.ref, row.from, row.connectorName].filter(Boolean).join(' · ')}</div>
      </div>
      {row.at != null && <span className="shrink-0 text-xs text-muted-foreground">{when(row.at)}</span>}
    </div>
  );
}

function TaskRow({ row }) {
  const paused = row.status === 'paused';
  const line = [row.schedule ? scheduleLabel(row.schedule) : '', row.nextRunAt ? `${T.tasks.next} ${stamp(row.nextRunAt, row.schedule?.timezone)}` : ''].filter(Boolean).join(' · ');
  return (
    <div className="flex h-[52px] items-center gap-3 px-3.5">
      <span className={paused ? 'opacity-55' : undefined}><AgentLogo agent={row.agent} className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <div className={paused ? 'truncate text-sm font-medium text-muted-foreground' : 'truncate text-sm font-medium'}>{row.title}</div>
        <div className="truncate text-xs text-muted-foreground">{line}</div>
      </div>
      <span className="shrink-0 text-xs" style={{ color: paused ? 'var(--muted-foreground)' : 'var(--dudu-success)' }}>{T.tasks.statuses[row.status]}</span>
    </div>
  );
}

/**
 * One card in the thread. The height follows the rows up to what fits; beyond that the rows scroll under the title. An empty list leaves the title and says so on its right in the same grey as the pages do
 * (owner, 2026-11-10: "卡片只剩标题那一行"). `onOpenIssue(row)` opens an issue's page; `onReply(row)` and `onOpenSession(row)` are what an opened Todo row does. Cards of information and tasks are no longer made;
 * the ones already in the thread still show. The 额度 card is not capped: it is the panel's blocks, whole, with the time of the reading at the right of its title (as the panel has it).
 */
export function CardMessage({ card, onOpenIssue, onReply, onOpenSession }) {
  const [openRow, setOpenRow] = useState(null);
  const entry = CARDS.find((one) => one.kind === card?.kind);
  if (!entry) return null;
  const { Icon } = entry;
  const rows = card.rows ?? [];
  const quota = card.kind === 'quota';
  // The quota card is the panel's blocks: a source with nothing to say is no block, and a card with no block is an empty one. `readAt` is missing on a card made before the time was kept.
  const panel = quota ? panelOf({ providers: rows, readAt: card.readAt }) : null;
  const empty = quota ? !panel.blocks.length : rows.length === 0;
  const updated = panel ? updatedText(panel.readAt) : '';
  return (
    <section className="overflow-hidden rounded-xl border border-input bg-card text-sm" aria-label={entry.label()} data-quick-card={card.kind}>
      {/* Not a `<header>`: the conversation window styles every header inside it as its own title bar (pet.css: 46px, 16/10 padding). */}
      <div className="flex h-10 items-center gap-2 px-3.5" data-quick-card-title>
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <h3 className="text-sm font-semibold">{entry.label()}</h3>
        {!empty && !quota && <span className="text-xs text-muted-foreground tabular-nums">{card.total ?? rows.length}</span>}
        {empty && <span className="ml-auto text-muted-foreground">{emptyOf(card.kind)}</span>}
        {!empty && updated && <span className="ml-auto text-[11px] leading-4 text-muted-foreground tabular-nums">{updated}</span>}
      </div>
      {!empty && quota && <div className="border-t">{panel.blocks.map((block) => <QuotaBlock key={block.key} block={block} className="px-3.5" />)}</div>}
      {!empty && !quota && (
        <ul className="max-h-[300px] divide-y overflow-y-auto border-t">
          {rows.map((row) => (
            <li key={row.id}>
              {card.kind === 'todo'
                ? <TodoRow row={row} open={openRow === row.id} onToggle={(id) => setOpenRow((current) => (current === id ? null : id))} onReply={onReply} onOpenSession={onOpenSession} onOpenIssue={onOpenIssue} />
                : card.kind === 'info' ? <InfoRow row={row} /> : <TaskRow row={row} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
