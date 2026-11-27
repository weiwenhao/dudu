import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { CheckBox } from '../issues/FilterMenu.jsx';

const FIND_ABOVE = 8; // a list longer than this has a box to find a value in

/**
 * One filter of a range, as a pill after the range's own (the phone's design on every screen: the filters of a range are pills in the same row): the filter's name, or, once something is
 * chosen, what is chosen, in blue; it opens a list of values with the interface's own check boxes (`issues/FilterMenu.jsx`). `single` is a filter that takes one value at a time: choosing one
 * closes the list. `labelOf(value)` says a chosen value (also one the list no longer offers).
 */
export function FilterPill({ name, options, values, labelOf, onToggle, single = false }) {
  const [open, setOpen] = useState(false);
  const chosen = values.length > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={!chosen && options.length === 0} aria-haspopup="dialog" aria-expanded={open} aria-label={chosen ? `${name}: ${values.map(labelOf).join(', ')}` : name} data-chosen={chosen || undefined}
          className={cn('inline-flex h-7 max-w-[200px] shrink-0 items-center gap-1 rounded-full pr-2 pl-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
            chosen ? 'bg-ring/12 text-ring hover:bg-ring/20' : 'bg-muted text-foreground hover:bg-foreground/10', open && !chosen && 'bg-foreground/10')}>
          <span className="truncate">{chosen ? values.map(labelOf).join(', ') : name}</span>
          <ChevronDown className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[232px]" aria-label={name}>
        <Command>
          {options.length > FIND_ABOVE && <><CommandInput placeholder={T.filterOptions} aria-label={name} /><CommandSeparator /></>}
          <CommandList>
            {options.map((option) => {
              const on = values.includes(option.value);
              return (
                <CommandItem key={String(option.value)} value={option.label} onSelect={() => { onToggle(option.value); if (single) setOpen(false); }} data-checked={on}>
                  <CheckBox on={on} />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
