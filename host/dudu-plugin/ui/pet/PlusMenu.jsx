import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { CompactIcon, ContextIcon, PaperclipIcon } from './icons.jsx';

const P = T.pet;

function Item({ icon: Icon, label, hint, checked, disabled, onSelect }) {
  return <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} disabled={disabled} onClick={onSelect}
    className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50">
    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="shrink-0">{label}</span>
    {hint && <span className={cn('min-w-0 flex-1 truncate text-right text-[13px] text-muted-foreground')}>{hint}</span>}
    {checked && <Check className="size-4 shrink-0" aria-hidden="true" />}
  </button>;
}

/**
 * What "+" gives: add a file (a picture is a file too), attach where the person is (Context), and Compact, the one command of the window. The menu is as wide as the box
 * and opens above it (anchored to the box, not to the button inside it). Context stays on until it is taken off; it is not offered when no page is known (the person is not on a 嘟嘟 page).
 */
export function PlusMenu({ anchor, disabled, contextOn, contextAvailable, compactDisabled, onFile, onContext, onCompact }) {
  const [open, setOpen] = useState(false);
  const pick = (action) => { setOpen(false); action(); };
  return <Popover open={open} onOpenChange={setOpen}>
    {anchor && <PopoverAnchor virtualRef={anchor} />}
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={T.dashboard.add} aria-haspopup="menu" disabled={disabled}
        className="size-[30px] rounded-full bg-muted text-foreground hover:bg-foreground/15 data-[state=open]:bg-foreground/15 dark:hover:bg-foreground/15">
        <Plus className="size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent data-pet-menu="" side="top" align="start" role="menu" aria-label={T.dashboard.add} className="w-[min(416px,calc(100vw-72px))] p-1">
      <Item icon={PaperclipIcon} label={P.file} onSelect={() => pick(onFile)} />
      <Item icon={ContextIcon} label={P.context} hint={P.contextHint} checked={contextOn} disabled={!contextOn && !contextAvailable} onSelect={() => pick(onContext)} />
      <div className="-mx-1 my-1 h-px bg-border" role="separator" />
      <Item icon={CompactIcon} label={P.compact} hint={P.compactHint} disabled={compactDisabled} onSelect={() => pick(onCompact)} />
    </PopoverContent>
  </Popover>;
}
