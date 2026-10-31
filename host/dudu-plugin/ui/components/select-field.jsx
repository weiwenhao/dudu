// The "select" of the Display options: a button that shows the current choice and opens a short list under it with the current
// one ticked (the design draws the tick at the left). Built from the Popover and Command of this folder, not Radix Select.
import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { Command, CommandItem, CommandList } from './command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from './popover.jsx';

export function SelectField({ value, options, onChange, label, className, disabled }) {
  const [open, setOpen] = useState(false);
  const list = useRef(null);
  const current = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button" role="combobox" aria-expanded={open} aria-label={label} disabled={disabled}
          className={cn('flex h-8 w-[124px] items-center justify-between gap-1 rounded-md border bg-transparent pr-1.5 pl-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30', className)}
        >
          <span className="truncate">{current?.label ?? ''}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[148px]" onOpenAutoFocus={(event) => { event.preventDefault(); list.current?.focus(); }}>
        <Command ref={list} label={label}>
          <CommandList>
            {options.map((option) => (
              <CommandItem key={String(option.value)} value={option.label} onSelect={() => { onChange(option.value); setOpen(false); }}>
                <span className="flex size-4 items-center justify-center">{option.value === value && <Check aria-hidden="true" />}</span>
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
