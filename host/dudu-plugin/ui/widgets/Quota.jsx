import { RotateCw } from 'lucide-react';
import { Progress } from '../components/progress.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { Empty, Frame } from './Frame.jsx';
import { amountText, coreWindows, fitsBlocks, percentUsed, resetText, toneOf, windowName } from './quota-format.js';

const Q = T.widgets.quota;
// A line shows the 5-hour and the weekly window side by side from this width on (the widget's own, not the window's); narrower, one bar.
const WIDE = 400;
// The soonest reset among the windows that are full, or among all of them when none is.
const nextReset = (provider) => Math.min(...provider.windows.map((window) => window.resetsAt).filter(Number.isFinite));

function Hover({ provider, children }) {
  const balance = provider.kind === 'balance';
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <div className="font-medium">{provider.name}{provider.plan ? ` · ${provider.plan}` : ''}</div>
        {balance && <div>{provider.balance?.length ? `${Q.balance} ${amountText(provider)}` : Q.unknown}</div>}
        {!balance && provider.windows.map((window) => (
          <div key={window.key}>{Q.used(windowName(window.label), Math.round(window.used * 100))}{Number.isFinite(window.resetsAt) ? ` · ${Q.resets(resetText(window.resetsAt))}` : ''}</div>
        ))}
        {!balance && provider.windows.length === 0 && <div>{provider.state === 'login' ? Q.login : Q.unknown}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

/** One window of a line: its name, a bar, and the percent (or, when it is full, when it starts over). */
function Meter({ provider, window }) {
  const percent = Math.round(window.used * 100);
  const full = percent >= 100;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{windowName(window.label)}</span>
      <Progress value={percent} indicatorClassName={toneOf(percent)} aria-label={`${provider.name} ${windowName(window.label)}`} />
      <span className={cn('min-w-[34px] shrink-0 text-right text-xs tabular-nums', full ? 'text-danger-foreground' : 'text-muted-foreground')}>
        {full && Number.isFinite(window.resetsAt) ? <span className="inline-flex items-center gap-1"><RotateCw className="size-3" aria-hidden="true" />{resetText(window.resetsAt)}</span> : `${percent}%`}
      </span>
    </div>
  );
}

/** What a line says to a screen reader: each window with how much of it is used, or when the limit starts over. */
const windowsLabel = (provider, windows) => `${provider.name}: ${windows.map((window) => {
  const percent = Math.round(window.used * 100);
  return percent >= 100 ? `${windowName(window.label)}, ${Q.limitReached(resetText(window.resetsAt))}` : Q.used(windowName(window.label), percent);
}).join(', ')}`;

const LINE = 'flex h-7 items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** A wallet, not a plan: the agent and what is left, as DSH's account page writes it. */
function BalanceLine({ provider }) {
  const amounts = amountText(provider);
  return (
    <Hover provider={provider}>
      <div className={LINE} tabIndex={0} aria-label={amounts ? `${provider.name} ${Q.balance} ${amounts}` : `${provider.name} ${Q.unknown}`}>
        <span className="w-[72px] shrink-0 truncate">{provider.name}</span>
        <span className="flex-1" />
        <span className="shrink-0 text-sm tabular-nums">{amounts || <span className="text-xs text-muted-foreground">{Q.unknown}</span>}</span>
      </div>
    </Hover>
  );
}

/** One line: the agent, a bar, and the percent (or, when the limit is reached, when it starts over). A wide widget shows both windows. */
function Line({ provider, wide }) {
  if (provider.kind === 'balance') return <BalanceLine provider={provider} />;
  const windows = coreWindows(provider);
  if (wide && provider.state === 'ok' && windows.length > 0) {
    return (
      <Hover provider={provider}>
        <div className={cn(LINE, 'gap-4')} tabIndex={0} aria-label={windowsLabel(provider, windows)}>
          <span className="w-[72px] shrink-0 truncate">{provider.name}</span>
          {windows.map((window) => <Meter key={window.key} provider={provider} window={window} />)}
        </div>
      </Hover>
    );
  }
  const percent = percentUsed(provider);
  const reset = Number.isFinite(nextReset(provider)) ? resetText(nextReset(provider)) : '';
  const full = percent !== null && percent >= 100;
  return (
    <Hover provider={provider}>
      <div
        className={LINE} tabIndex={0}
        aria-label={percent === null ? `${provider.name} ${Q.unknown}` : full ? `${provider.name}: ${Q.limitReached(reset)}` : Q.label(provider.name, percent)}
      >
        <span className="w-[72px] shrink-0 truncate">{provider.name}</span>
        <Progress value={percent ?? 0} indicatorClassName={percent === null ? 'bg-transparent' : toneOf(percent)} aria-label={provider.name} />
        <span className={cn('w-[52px] shrink-0 text-right text-xs tabular-nums', full ? 'text-danger-foreground' : 'text-muted-foreground')}>
          {percent === null ? Q.unknown : full ? <span className="inline-flex items-center gap-1"><RotateCw className="size-3" aria-hidden="true" />{reset}</span> : `${percent}%`}
        </span>
      </div>
    </Hover>
  );
}

/** A taller widget: a block per agent with its plan, when it starts over, and each window on its own bar (a wallet is one amount). */
function Block({ provider }) {
  const balance = provider.kind === 'balance';
  const reset = !balance && provider.windows.length ? nextReset(provider) : NaN;
  return (
    <Hover provider={provider}>
      <div className="flex flex-col gap-1.5 rounded-lg px-2 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" tabIndex={0}>
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{provider.name}</span>
          {provider.plan && <span className="text-xs text-muted-foreground">{provider.plan}</span>}
          <span className="flex-1" />
          {Number.isFinite(reset) && <span className="text-xs text-muted-foreground">{Q.resetsAt(resetText(reset))}</span>}
          {balance && <span className="text-sm tabular-nums" aria-label={`${provider.name} ${Q.balance} ${amountText(provider) || Q.unknown}`}>{amountText(provider) || <span className="text-xs text-muted-foreground">{Q.unknown}</span>}</span>}
        </div>
        {!balance && provider.windows.map((window) => {
          const percent = Math.round(window.used * 100);
          return (
            <div key={window.key} className="flex items-center gap-2">
              <span className="w-[64px] shrink-0 truncate text-xs text-muted-foreground">{windowName(window.label)}</span>
              <Progress value={percent} indicatorClassName={toneOf(percent)} aria-label={`${provider.name} ${windowName(window.label)}`} />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums">{percent}%</span>
            </div>
          );
        })}
        {!balance && provider.windows.length === 0 && <span className="text-xs text-muted-foreground">{provider.state === 'login' ? Q.login : Q.unknown}</span>}
      </div>
    </Hover>
  );
}

/**
 * Subscription usage, one line per agent: the 5-hour and the weekly window side by side when the widget is wide, one bar for the highest
 * of them when it is narrow; an agent whose usage cannot be read says "—", never 0 %. DeepSeek, paid from a wallet, shows its balance.
 * A taller widget, tall enough for all of them, shows a block per agent.
 */
export function Quota({ size, useQuota }) {
  const { status, value } = useQuota();
  const providers = (value?.providers ?? []).filter((provider) => provider.state !== 'hidden');
  const tall = size?.height === undefined ? (size?.rows ?? 1) >= 2 : fitsBlocks(providers, size.height);
  const wide = (size?.width ?? 0) >= WIDE;
  return (
    <TooltipProvider>
      <Frame title={T.widgets.titles.quota}>
        {status === 'error' ? <Empty>{Q.unknown}</Empty> : status === 'ready' && providers.length === 0
          ? <Empty>{Q.empty}</Empty>
          : providers.map((provider) => (tall ? <Block key={provider.id} provider={provider} /> : <Line key={provider.id} provider={provider} wide={wide} />))}
      </Frame>
    </TooltipProvider>
  );
}
