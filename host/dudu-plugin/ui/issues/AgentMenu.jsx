import { useState } from 'react';
import { Box, Check } from 'lucide-react';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';
import { AgentAvatar } from './icons.jsx';
import { AGENT_NAMES } from './model.js';
import { ProjectChoices } from './ProjectMenu.jsx';

const AGENTS = Object.keys(AGENT_NAMES);

/**
 * Assignment requires a project first. Saved assignments can keep the trigger as a static label.
 */
export function AgentMenu({ agent, project, request, onSelect, locked = false, align = 'start', side, children }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(project);
  const [choosing, setChoosing] = useState(false);
  const pick = (value) => { setOpen(false); onSelect(value, selected); };
  const changeOpen = (value) => { setOpen(value); if (value) { setSelected(project); setChoosing(Boolean(request && !project?.path)); } };
  if (locked) return children;
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[248px]" align={align} side={side} aria-label={T.fields.agent}>
        {choosing ? <ProjectChoices request={request} project={selected} onSelect={(value) => { setSelected(value); setChoosing(false); }} /> : <>
        {request && <button type="button" onClick={() => setChoosing(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent"><Box className="size-3.5" />{selected?.name ?? T.projects.choose}</button>}
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
        </Command></>}
      </PopoverContent>
    </Popover>
  );
}
