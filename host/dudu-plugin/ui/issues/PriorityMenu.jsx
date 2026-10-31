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
        <Command>
          <CommandInput placeholder={T.detail.setPriority} aria-label={T.detail.setPriority} />
          <CommandSeparator />
          <CommandList>
            {PRIORITY_ORDER.map((id) => (
              <CommandItem key={id} value={T.priority[id]} onSelect={() => { setOpen(false); onSelect(id); }}>
                <PriorityIcon priority={id} />
                <span>{T.priority[id]}</span>
                {id === priority && <Check className="ml-auto" aria-hidden="true" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
