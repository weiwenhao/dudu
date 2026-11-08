import { RotateCw } from 'lucide-react';
import { Progress } from '../components/progress.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { Empty, Frame } from './Frame.jsx';
import { amountText, resetText, toneOf, windowName } from './quota-format.js';

const Q = T.widgets.quota;
// What a widget's own width and height (not the window's) decide: the agents' names beside their marks, and when each window starts over under its bar.
const NAMED = 330;
const ROOMY = { width: 400, height: 190 };
// Below this height (two rows of a laptop's window are about 126px) the table tightens its padding so that both windows stay in sight.
const COMPACT = 150;

/** The windows every plan has, the rows of the table: the 5-hour one, then the weekly one, then any other core window, in the order they are met. */
// (a reading that flags none of its windows as core, from an older plugin, counts all of them)
const flagged = (providers) => providers.some((provider) => provider.windows?.some((window) => window.core));
const isCore = (window, providers) => window.core || !flagged(providers);

function rowsOf(providers) {
  const names = [];
  for (const provider of providers) for (const window of provider.windows ?? []) {
    const name = windowName(window.label);
    if (isCore(window, providers) && !names.includes(name)) names.push(name);
  }
  const rank = (name) => (name === Q.fiveHour ? 0 : name === Q.weekly ? 1 : 2);
  return names.sort((a, b) => rank(a) - rank(b));
}

const windowOf = (provider, name, providers) => provider.windows?.find((window) => isCore(window, providers) && windowName(window.label) === name);

function Hover({ provider, children }) {
  const balance = provider.kind === 'balance';
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <div className="font-medium">{provider.name}{provider.plan ? ` · ${provider.plan}` : ''}</div>
        {balance && <div>{provider.balance?.length ? `${Q.balance} ${amountText(provider)}` : Q.unknown}</div>}
        {!balance && provider.windows.map((window) => (
          <div key={window.key}>{Q.leftLine(windowName(window.label), 100 - Math.round(window.used * 100))}{Number.isFinite(window.resetsAt) ? ` · ${Q.resets(resetText(window.resetsAt))}` : ''}</div>
        ))}
        {!balance && provider.windows.length === 0 && <div>{provider.state === 'login' ? Q.login : Q.unknown}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

const FOCUS = 'rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** The mark of an agent over its column (with its name when the widget is wide enough for it). */
function Head({ provider, named, compact }) {
  return (
    <th scope="col" className="p-0 pb-1 align-bottom font-normal">
      <Hover provider={provider}>
        <div tabIndex={0} aria-label={provider.name} className={cn(FOCUS, 'flex items-center justify-center gap-1.5 px-0.5', compact ? 'py-0' : 'py-0.5')}>
          <AgentLogo agent={provider.id} />
          {named && <span className="truncate text-xs text-muted-foreground">{provider.name}</span>}
        </div>
      </Hover>
    </th>
  );
}

/** What is left of one window of one agent: the number and a bar of it (and, when there is room, when it starts over). A full limit says when it starts over instead of 0 %. */
function Cell({ provider, name, roomy, compact, providers }) {
  const window = windowOf(provider, name, providers);
  if (!window) return <td className="p-0 text-center align-top text-xs text-muted-foreground"><Hover provider={provider}><div tabIndex={0} aria-label={`${provider.name} ${name} ${Q.unknown}`} className={cn(FOCUS, 'px-0.5', compact ? 'py-0.5' : 'py-1')}>{Q.unknown}</div></Hover></td>;
  const used = Math.round(window.used * 100);
  const left = Math.max(0, 100 - used);
  const full = used >= 100;
  const reset = Number.isFinite(window.resetsAt) ? resetText(window.resetsAt) : '';
  const label = full ? `${provider.name} ${name}: ${Q.limitReached(reset)}` : Q.leftOf(provider.name, name, left);
  return (
    <td className="p-0 align-top">
      <Hover provider={provider}>
        <div tabIndex={0} aria-label={label} className={cn(FOCUS, 'flex flex-col gap-[3px] px-0.5', compact ? 'py-0.5' : 'py-1')}>
          <span className={cn('text-[13px] leading-4 font-medium tabular-nums', used >= 90 ? 'text-danger-foreground' : used >= 70 ? 'text-warning' : 'text-foreground')}>
            {full && reset ? <span className="inline-flex items-center gap-1"><RotateCw className="size-3" aria-hidden="true" />{reset}</span> : `${left}%`}
          </span>
          <Progress value={left} className="h-[3px] bg-muted" indicatorClassName={toneOf(used)} aria-label={`${provider.name} ${name}`} />
          {roomy && reset && !full && <span className="text-[10px] leading-3 text-muted-foreground">{Q.resets(reset)}</span>}
        </div>
      </Hover>
    </td>
  );
}

/** A wallet has no window: its column is one cell, the amount, over every row. */
function Wallet({ provider, span }) {
  const amounts = amountText(provider);
  return (
    <td rowSpan={span} className="border-l p-0 pl-2 align-middle">
      <Hover provider={provider}>
        <div tabIndex={0} aria-label={amounts ? `${provider.name} ${Q.balance} ${amounts}` : `${provider.name} ${Q.unknown}`} className={cn(FOCUS, 'flex flex-col items-center gap-0.5 px-0.5 py-1')}>
          <span className="text-sm tabular-nums">{amounts || <span className="text-xs text-muted-foreground">{Q.unknown}</span>}</span>
          <span className="text-[10px] text-muted-foreground">{Q.balance}</span>
        </div>
      </Hover>
    </td>
  );
}

/**
 * What is left of each agent's subscription, as a table: the agents are the columns (their marks over them), the windows every plan has (5-hour, weekly) are the rows,
 * each named once at the left, and the corner says that the numbers are what is left. An agent whose usage cannot be read says "—" (never 0 %); DeepSeek, paid from a wallet,
 * is a column whose one cell is the balance. Hovering names the plan and every window with when it starts over.
 */
export function Quota({ size, useQuota }) {
  const { status, value } = useQuota();
  const providers = (value?.providers ?? []).filter((provider) => provider.state !== 'hidden');
  const rows = rowsOf(providers);
  const width = size?.width ?? 0;
  const named = width >= NAMED;
  const roomy = width >= ROOMY.width && (size?.height ?? 0) >= ROOMY.height;
  const compact = size?.height !== undefined && size.height < COMPACT;
  return (
    <TooltipProvider>
      <Frame title={T.widgets.titles.quota} className="px-3 pb-3">
        {status === 'error' ? <Empty>{Q.unknown}</Empty> : status === 'ready' && providers.length === 0 ? <Empty>{Q.empty}</Empty>
          : rows.length === 0 ? (
            // Nothing with windows to put in rows (only a wallet, or agents that say nothing yet): one line for each.
            <ul className="flex flex-col gap-1">{providers.map((provider) => (
              <li key={provider.id} className="flex h-7 items-center gap-2 px-1">
                <AgentLogo agent={provider.id} /><span className="truncate">{provider.name}</span><span className="flex-1" />
                <span className="text-sm tabular-nums">{provider.kind === 'balance' ? amountText(provider) || Q.unknown : provider.state === 'login' ? <span className="text-xs text-muted-foreground">{Q.login}</span> : Q.unknown}</span>
              </li>
            ))}</ul>
          ) : (
            <table className={cn('w-full table-fixed border-separate', roomy ? 'border-spacing-x-2.5 border-spacing-y-1.5' : 'border-spacing-x-1.5 border-spacing-y-0.5')}>
              <thead>
                <tr>
                  <th scope="col" className={cn('p-0 pb-1 text-left align-bottom text-[10px] font-normal text-muted-foreground', roomy ? 'w-[52px]' : 'w-[34px]')}>{Q.left}</th>
                  {providers.map((provider) => <Head key={provider.id} provider={provider} named={named} compact={compact} />)}
                </tr>
              </thead>
              <tbody>
                {rows.map((name, index) => (
                  <tr key={name}>
                    <th scope="row" className={cn('p-0 text-left align-top text-[10px] font-normal whitespace-nowrap text-muted-foreground', compact ? 'pt-0.5' : 'pt-1')}>{name}</th>
                    {providers.map((provider) => (provider.kind === 'balance'
                      ? (index === 0 ? <Wallet key={provider.id} provider={provider} span={rows.length} /> : null)
                      : <Cell key={provider.id} provider={provider} name={name} roomy={roomy} compact={compact} providers={providers} />))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Frame>
    </TooltipProvider>
  );
}
