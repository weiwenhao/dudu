import { useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Command, CommandItem, CommandList } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { CHAT_TABS } from './saved-views.js';

/**
 * The conversation layout's three tabs as a menu, for a list too narrow for the track of tabs. The popover is the one every control uses, its rows the command rows
 * of the other menus; the list's tools (filter, display options, new issue) sit under the tabs as `children`.
 */
export function IssueScopeMenu({ value, onChange, open, onOpenChange, triggerRef, highlighted, children }) {
  const list = useRef(null);
  const label = T.tabs[value] ?? T.tabs.active;
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <Button ref={triggerRef} variant="ghost" size="sm" aria-label={label} title={label}
        className={cn('size-7 min-w-0 shrink-0 gap-2 p-0 text-[13px] font-medium data-[state=open]:bg-accent', highlighted && 'bg-accent')}>
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[280px]"
      onOpenAutoFocus={event => { event.preventDefault(); list.current?.focus(); }}>
      <Command ref={list} label={T.widgets.titles.issues} defaultValue={value}>
        <CommandList>
          {CHAT_TABS.map(id => <CommandItem key={id} value={id} onSelect={() => { onChange(id); onOpenChange(false); }}>
            <span className="min-w-0 flex-1 truncate">{T.tabs[id]}</span>
            {value === id && <Check className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          </CommandItem>)}
        </CommandList>
      </Command>
      {children}
    </PopoverContent>
  </Popover>;
}
