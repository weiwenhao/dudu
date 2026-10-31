import { X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { AgentMenu } from './AgentMenu.jsx';
import { PriorityMenu } from './PriorityMenu.jsx';
import { StatusMenu } from './StatusMenu.jsx';

/**
 * The bar that comes up at the bottom once rows are ticked: how many, and Status, Priority and Agent for all of them at once.
 * It sits over the page (absolute, in the widget), not in the window.
 */
export function BulkBar({ count, onClear, onStatus, onPriority, onAgent }) {
  const action = (label) => <Button variant="ghost" size="sm">{label}</Button>;
  return (
    <div role="toolbar" aria-label={T.bulk.toolbar} className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
      <span className="px-2 text-sm font-medium whitespace-nowrap">{T.bulk.selected(count)}</span>
      <Button variant="ghost" size="icon-xs" aria-label={T.bulk.clear} onClick={onClear}><X /></Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <StatusMenu onSelect={onStatus}>{action(T.fields.status)}</StatusMenu>
      <PriorityMenu onSelect={onPriority}>{action(T.fields.priority)}</PriorityMenu>
      <AgentMenu align="end" onSelect={onAgent}>{action(T.fields.agent)}</AgentMenu>
    </div>
  );
}
