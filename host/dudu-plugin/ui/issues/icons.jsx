import { Box, Circle, LoaderCircle, User } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { DUE_ICON_TONE } from './due.js';
import { AGENT_LETTERS, AGENT_NAMES } from './model.js';
import { AgentLogo } from './AgentLogo.jsx';
import { agentLogo } from './agent-logos.js';
import { statusDefinition } from './workflow.js';
import { useNeedsYouColor } from './NeedsYouColor.jsx';

const STATUS_COLOR = {
  backlog: 'text-status-backlog',
  todo: 'text-status-todo',
  in_progress: 'text-status-progress',
  in_review: 'text-status-review',
  done: 'text-status-done',
  canceled: 'text-status-canceled',
};

const Svg = ({ className, style, children }) => (
  <svg className={className} style={style} viewBox="0 0 16 16" fill="none" aria-hidden="true">{children}</svg>
);

/** Started statuses choose their inner fill; the category's ring, check and cross keep their existing shapes. */
export function StatusIcon({ status, className, color, iconProgress }) {
  const definition = statusDefinition(status);
  status = definition?.type ?? status;
  const progress = iconProgress ?? definition?.iconProgress ?? (status === 'in_review' ? 0.75 : 0.5);
  const style = (color ?? definition?.color) ? { color: color ?? definition.color } : undefined;
  const cls = cn('size-4 shrink-0', STATUS_COLOR[status], className);
  const ring = <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" strokeDasharray={status === 'backlog' ? '1.6 2.4' : undefined} strokeLinecap="round" />;
  switch (status) {
    case 'in_progress':
    case 'in_review':
      return <Svg className={cls} style={style}>{ring}
        {progress === 0.25 && <path d="M8 8V4.2a3.8 3.8 0 0 1 3.8 3.8z" fill="currentColor" />}
        {progress === 0.5 && <path d="M8 4.2a3.8 3.8 0 0 1 0 7.6z" fill="currentColor" />}
        {progress === 0.75 && <path d="M8 8V4.2a3.8 3.8 0 1 1-3.8 3.8z" fill="currentColor" />}
        {progress === 1 && <circle cx="8" cy="8" r="3.8" fill="currentColor" />}
      </Svg>;
    case 'done':
      return <Svg className={cls} style={style}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></Svg>;
    case 'canceled':
      return <Svg className={cls} style={style}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></Svg>;
    default:
      return <Svg className={cls} style={style}>{ring}</Svg>;
  }
}

/** Group headings retain the approved palette and outward ripple; avatar unread badges stay solid red. */
export function SessionStateIcon({ state, className, active = false }) {
  const { color } = useNeedsYouColor();
  if (state === 'unread') {
    return <Svg className={cn('size-4 shrink-0 overflow-visible', className)} style={{ color }}>
      {active && <circle className="dudu-needs-you-ripple motion-reduce:hidden" cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="0.8" />}
      <circle cx="8" cy="8" r="6.5" fill="currentColor" fillOpacity="0.1" />
      <circle cx="8" cy="8" r="3.5" fill="currentColor" />
    </Svg>;
  }
  const Icon = { idle: Circle, processing: LoaderCircle, unassigned: User }[state] ?? Circle;
  return <Icon aria-hidden="true" strokeWidth={1.7} className={cn('size-4 shrink-0 text-muted-foreground', state === 'processing' && active && 'animate-spin motion-reduce:animate-none', className)} />;
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

export function ProjectChip({ name, shrink = false }) {
  // `shrink`: in a row that must stay one line (a card) a long name gives way, with an ellipsis, rather than pushing the chip to a second line.
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs text-foreground/80', shrink ? 'min-w-0' : 'shrink-0')}>
      <Box className="size-3.5 shrink-0" style={{ color: projectColor(name) }} aria-hidden="true" />
      {shrink ? <span className="truncate">{name}</span> : name}
    </span>
  );
}

/** Linear's ring for sub-issues, measured on the owner's screenshots of Linear (2026-11-08, at 2x): 14px across, a 2px stroke, an indigo arc (#5E6AD2) from the top,
 *  clockwise, as long as the part that is done, with flat ends, on a plain light-grey track (Linear's #DEDEDE; here the input border token, which follows the theme). */
export function ProgressRing({ done, total, className }) {
  const radius = 6;
  const length = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true" className={cn('size-3.5 shrink-0 text-[#5e6ad2]', className)}>
      <circle cx="7" cy="7" r={radius} stroke="var(--input)" strokeWidth="2" />
      {fraction > 0 && <circle cx="7" cy="7" r={radius} stroke="currentColor" strokeWidth="2" strokeDasharray={`${length * fraction} ${length}`} transform="rotate(-90 7 7)" />}
    </svg>
  );
}

/** The sub-issues of an issue as Linear shows them: a round chip with the ring and "done/total" (the board and the list). */
export const SUB_ISSUE_CHIP = 'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs text-foreground/80 tabular-nums';
export function SubIssueChip({ progress }) {
  return (
    <span data-issue-subissues="" title={T.subIssues.title} className={SUB_ISSUE_CHIP}>
      <ProgressRing done={progress.done} total={progress.total} />
      {T.subIssues.progress(progress.done, progress.total)}
    </span>
  );
}

/** Linear's due-date mark: a rounded calendar with a solid top, without binding rings or a grid of dots. */
export function DueIcon({ className, clear = false }) {
  return <Svg className={cn('size-4 shrink-0', className)}>
    <path d="M5 1.75h6A3.25 3.25 0 0 1 14.25 5v6A3.25 3.25 0 0 1 11 14.25H5A3.25 3.25 0 0 1 1.75 11V5A3.25 3.25 0 0 1 5 1.75Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5 1h6a4 4 0 0 1 4 4v1H1V5a4 4 0 0 1 4-4Z" fill="currentColor" />
    {clear && <g>
      <circle cx="11.5" cy="11.5" r="3.75" fill="var(--popover)" stroke="var(--popover)" strokeWidth="2" />
      <circle cx="11.5" cy="11.5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="m9.4 9.4 4.2 4.2" stroke="currentColor" strokeWidth="1.3" />
    </g>}
  </Svg>;
}

export function DueDate({ info, className }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-foreground', className)}>
      <DueIcon className={DUE_ICON_TONE[info.kind]} />
      {info.text}
    </span>
  );
}

// Idle needs no badge. Sleep never covers unread.
const BADGE = {
  processing: 'animate-spin border-[1.5px] border-muted-foreground/30 border-t-muted-foreground bg-background motion-reduce:animate-none',
  unread: 'bg-[#ec1313]',
};

// Deep sleep (the owner picked this picture on 2026-11-05, and the colour, a moon yellow #e8b923, the same day): a crescent takes the place of the idle ring, centred where the ring is centred (the marks sit
// 2px in from the corner; a crescent is lighter than a disc, so it is drawn 1px larger than the box on every side). The moon is a circle (radius 6.8 of a 16
// grid) with a bite (radius 5.2) taken out toward the upper right, placed so that its full circle is concentric with the box. The thin edge round it is the
// ring's colour (`--tw-ring-color`: the background in the sidebar, where it is transparent like the ring of every mark there, and the tag's card in the Office); Tailwind's
// `--tw-*` properties do not inherit, so it is read on the span, where the ring class sets it, and the stroke is inherited from there.
const CRESCENT = 'M14.999 8.256A6.8 6.8 0 1 1 7.761 1.018A5.2 5.2 0 0 0 14.999 8.256Z';

export function AgentActivity({ state, asleep = false, className }) {
  const mark = state;
  if (asleep && mark === 'idle') {
    return (
      <span aria-hidden="true" data-agent-activity="sleep" style={{ stroke: 'var(--tw-ring-color)' }}
        className={cn('absolute -right-0.5 -bottom-0.5 size-2 text-[#e8b923] ring-background', className, 'rounded-none border-0 bg-transparent ring-0')}>
        <svg viewBox="0 0 16 16" fill="currentColor" className="absolute -inset-px size-[calc(100%+2px)] overflow-visible">
          <path d={CRESCENT} style={{ strokeWidth: 4, strokeLinejoin: 'round', paintOrder: 'stroke' }} />
        </svg>
      </span>
    );
  }
  return BADGE[mark] ? <span aria-hidden="true" data-agent-activity={mark}
    className={cn('absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-1 ring-background', BADGE[mark], className)}>
  </span> : null;
}

export function AgentAvatar({ agent, state = 'idle', asleep = false, compact = false, className, logoClassName, showTitle = true, showActivity = true }) {
  const frame = cn('relative flex shrink-0 select-none', compact ? 'size-4' : 'size-6', className);
  if (!agent) {
    return (
      <span className={frame} title={showTitle ? T.noAgent : undefined} role={showTitle ? undefined : 'img'} aria-label={showTitle ? undefined : T.noAgent}>
        <span className="flex size-full items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
          <User className="size-3" aria-hidden="true" />
        </span>
      </span>
    );
  }
  const name = AGENT_NAMES[agent] ?? agent;
  const letter = AGENT_LETTERS[agent] ?? name.slice(0, 1).toUpperCase();
  const sleeping = asleep && state === 'idle';
  const label = `${name} · ${sleeping ? T.deepSleep : T.sessionState[state] ?? T.sessionState.idle}`;
  return (
    <span className={frame} data-session-state={state ?? 'idle'} title={showTitle ? label : undefined} role={showTitle ? undefined : 'img'} aria-label={showTitle ? undefined : label}>
      <span className={cn('flex size-full items-center justify-center text-xs text-muted-foreground', !agentLogo(agent) && 'rounded-full bg-muted')}>{agentLogo(agent) ? <AgentLogo agent={agent} className={cn(compact ? 'size-4' : 'size-5', logoClassName)} /> : letter}</span>
      {showActivity && <AgentActivity state={state} asleep={sleeping} className={!compact && 'size-2.5 ring-2'} />}
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
