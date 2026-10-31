import { useState } from 'react';
import { Check } from 'lucide-react';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';
import { AgentAvatar } from './icons.jsx';
import { AGENT_NAMES } from './model.js';

const AGENTS = Object.keys(AGENT_NAMES);

/**
 * The agent menu: No agent and the agents there are, the current one ticked. `note` is a line under the list (an agent change
 * starts a new session; the page says so). `children` is the trigger.
 */
export function AgentMenu({ agent, onSelect, note, align = 'start', side, children }) {
  const [open, setOpen] = useState(false);
  const pick = (value) => { setOpen(false); onSelect(value); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[248px]" align={align} side={side} aria-label={T.fields.agent}>
        <Command>
          <CommandInput placeholder={T.detail.setAgent} aria-label={T.detail.setAgent} />
          <CommandSeparator />
          <CommandList>
            <CommandItem value={T.noAgent} onSelect={() => pick(null)}>
              <AgentAvatar agent={null} />
              <span>{T.noAgent}</span>
              {!agent && <Check className="ml-auto" aria-hidden="true" />}
            </CommandItem>
            {AGENTS.map((id) => (
              <CommandItem key={id} value={AGENT_NAMES[id]} onSelect={() => pick(id)}>
                <AgentAvatar agent={id} state="idle" />
                <span>{AGENT_NAMES[id]}</span>
                {id === agent && <Check className="ml-auto" aria-hidden="true" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        {note && <p className="px-2 pt-1.5 pb-1 text-xs text-muted-foreground">{note}</p>}
      </PopoverContent>
    </Popover>
  );
}
