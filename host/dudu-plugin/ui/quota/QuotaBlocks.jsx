import { Progress } from '../components/progress.jsx';
import { AgentLogo } from '../issues/AgentLogo.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { toneOf } from './quota-format.js';

// One source's block of the quota. The panel behind the header icon (owner, 2026-11-11: form B, "一家一块，一行一个窗口") and the card of 嘟嘟's chat (owner, 2026-11-11: "选 A", the panel's blocks as they
// are; drawings `.local/designs/quota-card-2026-11-11/`) both draw it, so the two cannot drift apart. The page only draws what `panel-model.mjs` returns.

const NUMBER = { warn: 'text-warning', hot: 'text-danger-foreground' };

function Figure({ row }) {
  const [from, to] = row.number ?? [0, 0];
  if (!row.number) return <span className="text-[13px] leading-4 font-semibold tabular-nums">{row.figure}</span>;
  return (
    <span className="text-[11px] leading-4 text-muted-foreground tabular-nums">
      {row.figure.slice(0, from)}<span className={cn('text-[13px] font-semibold', NUMBER[row.level] ?? 'text-foreground')}>{row.figure.slice(from, to)}</span>{row.figure.slice(to)}
    </span>
  );
}

function Row({ row }) {
  return (
    <div className="flex flex-col gap-[3px]" role="group" aria-label={row.label}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{row.label}</span>
        {row.out && row.phrase ? <span className="text-xs font-semibold text-danger-foreground">{row.phrase}</span> : <Figure row={row} />}
      </div>
      <Progress value={row.left} className="h-[3px] bg-muted" indicatorClassName={toneOf(row.used)} aria-label={row.label} />
      {row.reset && <span className="text-[10px] leading-3 text-muted-foreground">{row.reset}</span>}
    </div>
  );
}

/**
 * One source: its mark, name and plan (and when the plan ends), then a row for each window, or its balance. `className` is for the block's own padding: the panel's sides are 16 px, the card's 14 (like the
 * card's title row).
 */
export function QuotaBlock({ block, className }) {
  return (
    <section className={cn('flex flex-col gap-2.5 px-4 py-3 not-last:border-b', className)} aria-label={block.name}>
      <div className="flex items-center gap-2">
        <AgentLogo agent={block.agent} />
        <span className="text-[13px] leading-4 font-semibold">{block.name}</span>
        {(block.plan || block.term) && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {block.plan}{block.plan && block.term && ' · '}{block.term && <span title={block.term.title}>{block.term.text}</span>}
          </span>
        )}
      </div>
      {block.amount && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-muted-foreground">{T.widgets.quota.balance}</span>
          <span className="text-[13px] leading-4 font-semibold tabular-nums">{block.amount}</span>
        </div>
      )}
      {block.rows.map((row) => <Row key={row.key} row={row} />)}
    </section>
  );
}
