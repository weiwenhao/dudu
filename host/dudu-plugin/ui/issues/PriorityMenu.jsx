import { useState } from 'react';
import { Check } from 'lucide-react';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';
import { PriorityIcon } from './icons.jsx';
import { PRIORITY_ORDER } from './model.js';

/** The priority menu of an issue's page: a filter box, the five priorities with their icons, the current one ticked. */
export function PriorityMenu({ priority, onSelect, children }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[232px]" align="start" aria-label={T.fields.priority}>
        <PriorityChoices priority={priority} onSelect={(id) => { setOpen(false); onSelect(id); }} />
      </PopoverContent>
    </Popover>
  );
}

export function PriorityChoices({ priority, onSelect }) {
  return <Command defaultValue={T.priority[priority]} onKeyDown={(event) => {
    if (!event.nativeEvent.isComposing && !event.target.value && /^[0-4]$/.test(event.key)) {
      event.preventDefault(); onSelect(['none', 'urgent', 'high', 'medium', 'low'][Number(event.key)]);
    }
  }}>
          <CommandInput placeholder={T.detail.setPriority} aria-label={T.detail.setPriority} />
          <CommandSeparator />
          <CommandList>
            {PRIORITY_ORDER.map((id) => (
              <CommandItem key={id} value={T.priority[id]} onSelect={() => onSelect(id)}>
                <PriorityIcon priority={id} />
                <span>{T.priority[id]}</span>
                <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                  {id === priority && <Check aria-hidden="true" />}
                  <kbd>{['none', 'urgent', 'high', 'medium', 'low'].indexOf(id)}</kbd>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>;
}
