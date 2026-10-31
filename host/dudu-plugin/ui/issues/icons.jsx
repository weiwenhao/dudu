import { Box, CalendarDays, User } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { DUE_TONE } from './due.js';
import { AGENT_LETTERS, AGENT_NAMES } from './model.js';

const STATUS_COLOR = {
  backlog: 'text-status-backlog',
  todo: 'text-status-todo',
  in_progress: 'text-status-progress',
  in_review: 'text-status-review',
  done: 'text-status-done',
  canceled: 'text-status-canceled',
};

const Svg = ({ className, children }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">{children}</svg>
);

/** Linear's status shapes: dashed circle, empty circle, half, three quarters, check, cross. */
export function StatusIcon({ status, className }) {
  const cls = cn('size-4 shrink-0', STATUS_COLOR[status], className);
  const ring = <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" strokeDasharray={status === 'backlog' ? '1.6 2.4' : undefined} strokeLinecap="round" />;
  switch (status) {
    case 'in_progress':
      return <Svg className={cls}>{ring}<path d="M8 4.2a3.8 3.8 0 0 1 0 7.6z" fill="currentColor" /></Svg>;
    case 'in_review':
      return <Svg className={cls}>{ring}<path d="M8 8V4.2a3.8 3.8 0 1 1-3.8 3.8z" fill="currentColor" /></Svg>;
    case 'done':
      return <Svg className={cls}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
    case 'canceled':
      return <Svg className={cls}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></Svg>;
    default:
      return <Svg className={cls}>{ring}</Svg>;
  }
}

const BARS = [[2, 9, 5], [6.5, 6, 8], [11, 3, 11]];
const LEVEL = { high: 3, medium: 2, low: 1 };

/** Urgent is an orange square with a bang; High, Medium, Low are three bars lit 3, 2, 1; No priority is three dashes. */
export function PriorityIcon({ priority, className }) {
  if (priority === 'urgent') {
    return (
      <Svg className={cn('size-4 shrink-0', className)}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" style={{ fill: 'var(--priority-urgent)' }} />
        <path d="M8 4.6v4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11" r="1" fill="#fff" />
      </Svg>
    );
  }
  if (!LEVEL[priority]) {
    return (
      <Svg className={cn('size-4 shrink-0 text-muted-foreground', className)}>
        <path d="M2 8h2.6M6.7 8h2.6M11.4 8h2.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </Svg>
    );
  }
  return (
    <Svg className={cn('size-4 shrink-0 text-muted-foreground', className)}>
      {BARS.map(([x, y, height], index) => <rect key={x} x={x} y={y} width="3" height={height} rx="1" fill="currentColor" opacity={index < LEVEL[priority] ? 1 : 0.28} />)}
    </Svg>
  );
}

// Each project gets a colour of its own, the same one everywhere: picked from the name, so it needs no stored state.
const PROJECT_COLORS = ['#26b5ce', '#f2994a', '#8f6bde', '#4cb782', '#eb5757', '#5e6ad2', '#f2c94c', '#95a2b3'];
export function projectColor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

export function ProjectChip({ name }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs text-foreground/80">
      <Box className="size-3.5" style={{ color: projectColor(name) }} aria-hidden="true" />
      {name}
    </span>
  );
}

export function DueDate({ info, className }) {
  return (
    <span className={cn('inline-flex items-center gap-1', DUE_TONE[info.kind], className)} title={info.hint}>
      <CalendarDays className="size-3" aria-hidden="true" />
      {info.text}
    </span>
  );
}

// What the agent is doing, as a mark on the avatar's corner: a turning ring, an amber dot, a red dot; Idle draws nothing.
const BADGE = {
  working: 'animate-spin border-[1.5px] border-muted-foreground/30 border-t-foreground bg-background motion-reduce:animate-none',
  needs_you: 'bg-warning',
  stuck: 'bg-destructive',
};

export function AgentAvatar({ agent, state }) {
  if (!agent) {
    return (
      <span className="relative flex size-6 shrink-0 select-none" title={T.noAgent}>
        <span className="flex size-full items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
          <User className="size-3" aria-hidden="true" />
        </span>
      </span>
    );
  }
  const name = AGENT_NAMES[agent] ?? agent;
  const letter = AGENT_LETTERS[agent] ?? name.slice(0, 1).toUpperCase();
  return (
    <span className="relative flex size-6 shrink-0 select-none" title={`${name} · ${T.agentState[state] ?? T.agentState.idle}`}>
      <span className="flex size-full items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">{letter}</span>
      {BADGE[state] && <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background', BADGE[state])} />}
    </span>
  );
}

/** Linear's small solid triangle: it folds a group (down, right) and marks a menu row that opens another menu (right). */
export function Triangle({ direction = 'down', className }) {
  const path = direction === 'down' ? 'M1.6 3.2h6.8L5 7.6z' : 'M3.2 1.6v6.8L7.6 5z';
  return (
    <svg className={cn('size-2.5 shrink-0', className)} viewBox="0 0 10 10" fill="currentColor" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
