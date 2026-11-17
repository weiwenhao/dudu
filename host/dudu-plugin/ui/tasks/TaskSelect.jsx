import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';

/** DSH's rule rows and preset menu: value on the right, trailing selection check, and an anchored scrollable popup. `blank`: the row has no value of its own yet (it follows a conversation that is not chosen), a dash. */
export function TaskSelect({ label, value, options, onChange, searchable = false, customValue, disabled = false, className, row = false, blank = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const list = useRef(null);
  const current = options.find((option) => option.value === value);
  const custom = customValue?.(search);
  const choices = custom && !options.some((option) => option.value === custom) ? [{ value: custom, label: custom }, ...options] : options;
  const close = () => { setOpen(false); setSearch(''); };
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (!value) setSearch(''); }}>
    <PopoverTrigger asChild>
      <button type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-label={label} disabled={disabled}
        className={cn(row ? 'dudu-task-rule-select' : 'dudu-task-select', 'outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
        {row && <span className="dudu-task-rule-label">{label}</span>}
        <span className="dudu-task-select-face">{!blank && current?.icon}<span className="min-w-0 truncate">{blank ? '—' : (current?.label ?? value ?? '')}</span><ChevronDown className="size-3.5 shrink-0" aria-hidden="true" /></span>
      </button>
    </PopoverTrigger>
    <PopoverContent align={row ? 'end' : 'start'} sideOffset={4} collisionPadding={12} className="dudu-task-menu" onOpenAutoFocus={(event) => { if (!searchable) { event.preventDefault(); list.current?.focus(); } }}>
      <Command ref={list} label={label} defaultValue={`option:${value}`} loop>
        {searchable && <div className="dudu-task-menu-search"><CommandInput aria-label={label} placeholder={label} value={search} onValueChange={setSearch} /></div>}
        <CommandList className="dudu-task-choices"><CommandEmpty>{T.collector.empty}</CommandEmpty>
          {choices.map((option) => <CommandItem key={option.value} value={`option:${option.value}`} keywords={[option.label, String(option.value)]} disabled={option.disabled} className="dudu-task-menu-item" onSelect={() => { onChange(option.value); close(); }}>
            {option.icon}<span className="min-w-0 flex-1 truncate">{option.label}</span>
            {value === option.value && <Check className="size-3.5" aria-hidden="true" />}
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
