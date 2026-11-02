import { useState } from 'react';
import { Check } from 'lucide-react';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';
import { StatusIcon } from './icons.jsx';
import { STATUS_ORDER } from './model.js';

/**
 * Linear's "Change status" menu: a filter box (shortcut S), the six statuses with their icons, the current one ticked.
 * `children` is the trigger, the status icon of the row.
 */
export function StatusMenu({ status, open, onOpenChange, onSelect, children }) {
  // A row holds its menu's state itself (S opens it from outside); anywhere else the menu keeps its own.
  const [own, setOwn] = useState(false);
  const controlled = open !== undefined;
  const setOpen = (next) => (controlled ? onOpenChange?.(next) : setOwn(next));
  return (
    <Popover open={controlled ? open : own} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[232px]" alignOffset={-8}>
        <StatusChoices status={status} onSelect={(id) => { setOpen(false); onSelect(id); }} />
      </PopoverContent>
    </Popover>
  );
}

export function StatusChoices({ status, onSelect, shortcut = true }) {
  return <Command defaultValue={T.status[status]} onKeyDown={(event) => {
    if (!event.nativeEvent.isComposing && !event.target.value && /^[1-6]$/.test(event.key)) {
      event.preventDefault(); onSelect(STATUS_ORDER[Number(event.key) - 1]);
    }
  }}>
          <CommandInput placeholder={T.changeStatus} aria-label={T.changeStatus}>
            {shortcut && <kbd className="ml-auto rounded border bg-muted px-1.5 text-xs text-muted-foreground">S</kbd>}
          </CommandInput>
          <CommandSeparator />
          <CommandList>
            {STATUS_ORDER.map((id, index) => (
              <CommandItem key={id} value={T.status[id]} onSelect={() => onSelect(id)}>
                <StatusIcon status={id} />
                <span>{T.status[id]}</span>
                <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                  {id === status && <Check aria-hidden="true" />}
                  <kbd>{index + 1}</kbd>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>;
}
