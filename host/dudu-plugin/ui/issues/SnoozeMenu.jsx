import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';
import { snoozeOptions } from './snooze.js';

const item = 'flex h-8 w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent';

/** Snooze: a few times to hide an agent's question until, and Clear when one is set. `children` is the trigger. */
export function SnoozeMenu({ snoozedUntil, onSnooze, children }) {
  const [open, setOpen] = useState(false);
  const pick = (until) => { setOpen(false); onSnooze(until); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[200px]" align="end" aria-label={T.detail.snooze}>
        {snoozeOptions().map((option) => <button key={option.id} type="button" className={item} onClick={() => pick(option.until)}>{T.snooze[option.id]}</button>)}
        {snoozedUntil != null && <button type="button" className={`${item} text-muted-foreground`} onClick={() => pick(null)}>{T.snooze.clear}</button>}
      </PopoverContent>
    </Popover>
  );
}
