import { RotateCw } from 'lucide-react';
import { Progress } from '../components/progress.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { useServices } from '../services.jsx';
import { Empty, Frame } from './Frame.jsx';
import { percentUsed, resetText, toneOf, windowName } from './quota-format.js';
import { usePolled } from './use-polled.js';

const Q = T.widgets.quota;
// The soonest reset among the windows that are full, or among all of them when none is.
const nextReset = (provider) => Math.min(...provider.windows.map((window) => window.resetsAt).filter(Number.isFinite));

function Hover({ provider, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <div className="font-medium">{provider.name}{provider.plan ? ` · ${provider.plan}` : ''}</div>
        {provider.windows.map((window) => (
          <div key={window.key}>{Q.used(windowName(window.label), Math.round(window.used * 100))}{Number.isFinite(window.resetsAt) ? ` · ${Q.resets(resetText(window.resetsAt))}` : ''}</div>
        ))}
        {provider.windows.length === 0 && <div>{provider.state === 'login' ? Q.login : Q.unknown}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

/** One line: the agent, a bar, and the percent (or, when the limit is reached, when it starts over). */
function Line({ provider }) {
  const percent = percentUsed(provider);
  const reset = Number.isFinite(nextReset(provider)) ? resetText(nextReset(provider)) : '';
  const full = percent !== null && percent >= 100;
  return (
    <Hover provider={provider}>
      <div
        className="flex h-7 items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" tabIndex={0}
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

/** A taller widget: a block per agent with its plan, when it starts over, and each window on its own bar. */
function Block({ provider }) {
  const reset = provider.windows.length ? nextReset(provider) : NaN;
  return (
    <Hover provider={provider}>
      <div className="flex flex-col gap-1.5 rounded-lg px-2 py-1.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" tabIndex={0}>
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{provider.name}</span>
          {provider.plan && <span className="text-xs text-muted-foreground">{provider.plan}</span>}
          <span className="flex-1" />
          {Number.isFinite(reset) && <span className="text-xs text-muted-foreground">{Q.resetsAt(resetText(reset))}</span>}
        </div>
        {provider.windows.map((window) => {
          const percent = Math.round(window.used * 100);
          return (
            <div key={window.key} className="flex items-center gap-2">
              <span className="w-[64px] shrink-0 truncate text-xs text-muted-foreground">{windowName(window.label)}</span>
              <Progress value={percent} indicatorClassName={toneOf(percent)} aria-label={`${provider.name} ${windowName(window.label)}`} />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums">{percent}%</span>
            </div>
          );
        })}
        {provider.windows.length === 0 && <span className="text-xs text-muted-foreground">{provider.state === 'login' ? Q.login : Q.unknown}</span>}
      </div>
    </Hover>
  );
}

/**
 * Subscription usage, one line per agent that has a subscription (a pay-as-you-go agent has none to show); an agent whose usage cannot
 * be read says "—", never 0 %. A taller widget shows a block per agent.
 */
export function Quota({ size }) {
  const { request } = useServices();
  const { status, value } = usePolled(request, 'overview/usage', {}, { every: 120_000 });
  const providers = (value?.providers ?? []).filter((provider) => provider.state !== 'hidden');
  const tall = (size?.rows ?? 1) >= 2;
  return (
    <TooltipProvider>
      <Frame title={T.widgets.titles.quota}>
        {status === 'ready' && providers.length === 0
          ? <Empty>{Q.empty}</Empty>
          : providers.map((provider) => (tall ? <Block key={provider.id} provider={provider} /> : <Line key={provider.id} provider={provider} />))}
      </Frame>
    </TooltipProvider>
  );
}
