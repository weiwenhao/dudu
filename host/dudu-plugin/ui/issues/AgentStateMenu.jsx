import { Check } from 'lucide-react';
import { Command, CommandItem, CommandList } from '../components/command.jsx';
import { T } from '../strings.js';
import { AgentStateIcon } from './icons.jsx';

/** What the boss can say about an agent's state by hand. Working is not among them: only a session that is running is working. */
export const MANUAL_AGENT_STATES = ['blocked', 'idle'];

/** The picker of the right-click menu: the three states with their icons, the current one ticked. */
export function AgentStateChoices({ state, onSelect }) {
  return <Command defaultValue={T.agentState[state]}>
    <CommandList>
      {MANUAL_AGENT_STATES.map((id) => (
        <CommandItem key={id} value={T.agentState[id]} onSelect={() => onSelect(id)}>
          <AgentStateIcon state={id} />
          <span>{T.agentState[id]}</span>
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">{id === state && <Check aria-hidden="true" />}</span>
        </CommandItem>
      ))}
    </CommandList>
  </Command>;
}
