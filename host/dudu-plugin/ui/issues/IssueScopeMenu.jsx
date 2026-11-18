import { useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Command, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../components/context-menu.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { BASES, viewKey } from './saved-views.js';

/** B's scope switcher uses the same popover, command rows and saved-view actions as the existing controls. */
export function IssueScopeMenu({ value, saved, onChange, onRename, onDelete, open, onOpenChange, triggerRef, compact, iconOnly = compact, highlighted, children }) {
  const list = useRef(null);
  const label = saved.find(entry => viewKey(entry.id) === value)?.name ?? T.tabs[value] ?? T.tabs.active;
  const option = (id, name, props) => <CommandItem value={id} onSelect={() => { onChange(id); onOpenChange(false); }} {...props}>
    <span className="min-w-0 flex-1 truncate">{name}</span>
    {value === id && <Check className="size-3.5 text-muted-foreground" aria-hidden="true" />}
  </CommandItem>;
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <Button ref={triggerRef} variant="ghost" size="sm" aria-label={label} title={label}
        className={cn('h-7 min-w-0 shrink gap-2 px-2 text-[13px] font-medium data-[state=open]:bg-accent',
          iconOnly ? 'size-7 shrink-0 p-0' : 'max-w-40', highlighted && 'bg-accent')}>
        {!iconOnly && <span className="truncate">{label}</span>}
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className={cn('w-[170px]', compact && 'w-[280px]')}
      onOpenAutoFocus={event => { event.preventDefault(); list.current?.focus(); }}>
      <Command ref={list} label={T.widgets.titles.issues} defaultValue={value}>
        <CommandList>
          {BASES.map(id => option(id, T.tabs[id], { key: id }))}
          {saved.length > 0 && <CommandSeparator />}
          {saved.map(entry => <ContextMenu key={entry.id}>
            <ContextMenuTrigger asChild>
              {option(viewKey(entry.id), entry.name, { 'data-saved-view': entry.id, title: entry.name })}
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => { onOpenChange(false); onRename(entry); }}>{T.views.rename}</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => { onOpenChange(false); onDelete(entry); }}>{T.views.delete}</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>)}
        </CommandList>
      </Command>
      {children}
    </PopoverContent>
  </Popover>;
}
