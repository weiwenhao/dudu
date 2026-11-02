import { CalendarDays, User, X } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { agentLogo } from '../issues/agent-logos.js';
import { AGENT_NAMES } from '../issues/model.js';

// In Review uses the issue's status word; only failures retain a separate red activity mark.
function Mark({ reminder }) {
  if (reminder.kind === 'overdue') return <span className="inline-flex size-5 shrink-0 items-center justify-center text-danger-foreground" aria-hidden="true"><CalendarDays className="size-3.5" /></span>;
  const { agent, kind } = reminder;
  const name = AGENT_NAMES[agent] ?? agent ?? '';
  return (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true" data-agent={agent ?? ''}>
      {!agent ? <User className="size-3" /> : agentLogo(agent) ? <AgentLogo agent={agent} className="size-3" /> : <span className="text-[10px] leading-none">{name.slice(0, 1).toUpperCase()}</span>}
      {kind === 'stuck' && <span className="absolute -right-0.5 -bottom-0.5 size-[9px] rounded-full bg-destructive ring-2 ring-card" />}
    </span>
  );
}

/** What the pet says by itself: why now, which issue, the words themselves, the way in. One at a time; `more` counts those waiting. */
export function Reminder({ reminder, more, onClose, onOpen }) {
  const overdue = reminder.kind === 'overdue';
  const word = overdue ? T.overdue(reminder.daysLate ?? 1) : T.agentState[reminder.kind];
  return (
    <div className="dudu-pet-reminder" role="status" data-reminder-kind={reminder.kind}>
      <div className="dudu-pet-reminder-head">
        <Mark reminder={reminder} />
        <span className={cn('font-medium', overdue && 'text-danger-foreground')}>{word}</span>
        {reminder.ref && <span className="tabular-nums text-muted-foreground">{reminder.ref}</span>}
        <span className="ml-auto inline-flex items-center gap-1">
          {more > 0 && <span className="mr-0.5 text-[11px] tabular-nums text-muted-foreground">+{more}</span>}
          <button type="button" className="inline-flex size-5 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted" aria-label={T.pet.close} onClick={onClose}><X className="size-3.5" /></button>
        </span>
      </div>
      <div className="dudu-pet-reminder-text">{reminder.text}</div>
      <button type="button" className="dudu-pet-reminder-open" onClick={onOpen}>{T.widgets.sessions.openIssue}</button>
    </div>
  );
}
