import { Gauge, RotateCw } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../components/button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { Skeleton } from '../components/skeleton.jsx';
import { getLocale, subscribeLocale } from '../lib/locale.mjs';
import { T } from '../strings.js';
import { panelOf, updatedText } from './panel-model.mjs';
import { QuotaBlock } from './QuotaBlocks.jsx';

// The quota behind an icon in the dashboard's header (owner, 2026-11-11: "在 dashboard 右上角增加一个额度图标，点击之后展示额度"; form B, "一家一块，一行一个窗口"; drawings
// `.local/designs/quota-icon-2026-11-11/`). Opening it is the only thing that asks for a reading: the plugin keeps the last ones (`quota.db`), answers at once, and reads a source in the background
// only when fifteen minutes have passed since it was last asked. While a reading is under way the panel looks again every few seconds (it only looks: that asks for nothing); nothing runs while it is closed.
// The blocks are `QuotaBlocks.jsx`'s, which the card of 嘟嘟's chat draws too.

const LOOK_EVERY = 3000;
const LOOKS = 10;
// read when it is drawn, never kept: the interface's language is known only after the page has loaded (a word kept at load stays English)
const titleOf = () => T.widgets.titles.quota;

/** Grey bars where the first reading is still being made. */
function Waiting() {
  return (
    <div className="flex flex-col gap-3 px-4 py-3" aria-hidden="true">
      {[0, 1].map((n) => (
        <div key={n} className="flex flex-col gap-2">
          <div className="flex items-center gap-2"><Skeleton className="size-4 rounded-full" /><Skeleton className="h-3 w-16" /></div>
          <div className="flex justify-between"><Skeleton className="h-2.5 w-12" /><Skeleton className="h-2.5 w-16" /></div>
          <Skeleton className="h-[3px] w-full" />
        </div>
      ))}
    </div>
  );
}

export function QuotaPanel({ view, failed }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const panel = panelOf(view);
  const waiting = !panel || (panel.blocks.length === 0 && panel.refreshing);
  const updated = updatedText(panel?.readAt);
  const title = titleOf();
  return (
    <div role="region" aria-label={title} aria-busy={waiting || panel?.refreshing || undefined}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="text-[13px] leading-4 font-semibold">{title}</span>
        <span className="flex items-center gap-1 text-[11px] leading-4 text-muted-foreground tabular-nums">
          {panel?.refreshing && <RotateCw className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {updated}
        </span>
      </div>
      {waiting && !failed ? <Waiting /> : panel?.blocks.length ? panel.blocks.map((block) => <QuotaBlock key={block.key} block={block} />) : (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{panel ? T.widgets.quota.empty : T.widgets.quota.unknown}</p>
      )}
    </div>
  );
}

/** The icon, and the panel it opens. */
export function QuotaButton({ request }) {
  useSyncExternalStore(subscribeLocale, getLocale);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);
  const [failed, setFailed] = useState(false);
  const title = titleOf();
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    let timer;
    let looks = 0;
    const look = async (ask) => {
      try {
        const next = await request('quota/get', { ask });
        if (!active) return;
        setView(next);
        setFailed(false);
        if (next.refreshing && looks++ < LOOKS) timer = setTimeout(() => { void look(false); }, LOOK_EVERY);
      } catch {
        if (active) setFailed(true);
      }
    };
    void look(true);
    return () => { active = false; clearTimeout(timer); };
  }, [open, request]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={title} title={title}><Gauge aria-hidden="true" /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] overflow-hidden p-0"><QuotaPanel view={view} failed={failed} /></PopoverContent>
    </Popover>
  );
}
