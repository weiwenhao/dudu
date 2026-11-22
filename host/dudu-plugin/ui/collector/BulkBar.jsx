import { forwardRef, useState } from 'react';
import { Check, CheckCheck, Forward, Trash2, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { MenuIcon } from '../components/menu-icon.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip.jsx';
import { T } from '../strings.js';
import { ConversationPicker } from './ConversationPicker.jsx';

// The same keys as the dialog's list: cmdk owns navigation and text in its box; Escape, Left and Tab still leave it.
const pickerKeys = (event) => {
  if (event.target.closest('[cmdk-root]') && !['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) event.stopPropagation();
};

/**
 * One action of the bar. Its words, as the bar of Issues has them, while the widget is wide enough for them; in a narrower one, on the same single line,
 * the icon the row's menu gives the same action, the words as its name and its tooltip (`level` 0: wide; 1 and up: narrow).
 */
const Action = forwardRef(function Action({ level, label, icon: Icon, ...props }, ref) {
  if (level === 0) return <Button ref={ref} variant="ghost" size="sm" {...props}>{label}</Button>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button ref={ref} variant="ghost" size="icon-sm" aria-label={label} {...props}><MenuIcon icon={Icon} /></Button></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});

/** An action of the bar that opens the list of conversations the ticked rows are forwarded to. */
function Share({ level, label, icon, request, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Action level={level} label={label} icon={icon} /></PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-80" aria-label={label} onKeyDown={pickerKeys}>
        <ConversationPicker request={request} onSelect={(issue) => { setOpen(false); onSelect(issue); }} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The bar that comes up at the bottom once rows are ticked, the way it does in Issues: how many, "select all" (every row that is loaded), and what can be done with all of them at once. To handle:
 * forward them to a conversation, mark them handled or delete them. It sits over the widget, not over the window, and
 * stays on one line: `level` says how narrow the widget is (0 wide enough for the words, 1 the actions are icons, 2 the count is left to screen readers too). In the narrowest
 * widget the icons are still wider than it: the bar then keeps inside the widget and scrolls sideways, with no bar of its own.
 */
export function BulkBar({ request, level = 0, count, onClear, onSelectAll, onShareSession, onDone, onDelete }) {
  return (
    <TooltipProvider>
      <div role="toolbar" aria-label={T.bulk.toolbar} className="absolute bottom-5 left-1/2 z-20 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg [scrollbar-width:none]">
        <span className={level > 1 ? 'sr-only' : 'px-2 text-sm font-medium whitespace-nowrap'}>{T.bulk.selected(count)}</span>
        <Button variant="ghost" size="icon-xs" aria-label={T.bulk.clear} onClick={onClear}><X /></Button>
        {/* Select all: every row that is loaded; not offered once they all are ticked. */}
        {onSelectAll && <Action level={level} label={T.bulk.selectAll} icon={CheckCheck} onClick={onSelectAll} />}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Share level={level} label={T.collector.shareSession} icon={Forward} request={request} onSelect={onShareSession} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Action level={level} label={T.collector.markDone} icon={Check} onClick={onDone} />
        <Action level={level} label={T.collector.remove} icon={Trash2} onClick={onDelete} />
      </div>
    </TooltipProvider>
  );
}
