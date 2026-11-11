import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { DEFAULT_NEEDS_YOU_COLOR, NEEDS_YOU_COLORS } from '../../../assistant/needs-you-color.mjs';
import { Button } from '../components/button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip.jsx';
import { useToast } from '../components/toast.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';

const ColorContext = createContext({ color: DEFAULT_NEEDS_YOU_COLOR });
export const useNeedsYouColor = () => useContext(ColorContext);

export function NeedsYouColorProvider({ request, children }) {
  const toast = useToast();
  const [color, setColor] = useState(DEFAULT_NEEDS_YOU_COLOR);
  const chosen = useRef(false);
  useEffect(() => {
    let active = true;
    request('assistant/settings').then((result) => {
      if (active && !chosen.current && result?.outcome === 'success') setColor(result.settings.needsYouColor);
    }).catch(() => {});
    return () => { active = false; };
  }, [request]);
  const choose = async (next) => {
    chosen.current = true;
    setColor(next);
    try {
      const result = await request('assistant/settings', { patch: { needsYouColor: next } });
      if (result?.outcome !== 'success') toast({ message: T.toast.failed });
    } catch { toast({ message: T.toast.failed }); }
  };
  return <ColorContext.Provider value={{ color, choose }}>{children}</ColorContext.Provider>;
}

function Swatch({ option, selected }) {
  return <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: option.color }}>
    {selected && <Check className={cn('size-3', option.id === 'gold' ? 'text-[#0f1115]' : 'text-white')} />}
  </span>;
}

function moveFocus(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const choices = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]')];
  const current = Math.max(0, choices.indexOf(document.activeElement));
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 }[event.key] ?? 0;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (current + step + choices.length) % choices.length;
  choices[next]?.focus();
  event.preventDefault();
}

/** The approved 232px palette: the default row, then two rows of six colors. */
export function NeedsYouColorPicker({ className, children }) {
  const { color, choose } = useNeedsYouColor();
  const [open, setOpen] = useState(false);
  const content = useRef(null);
  if (!choose) return children;
  const select = (value) => { setOpen(false); void choose(value); };
  const first = NEEDS_YOU_COLORS[0];
  return <Popover open={open} onOpenChange={setOpen}>
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 data-[state=open]:bg-accent"
          aria-label={T.settings.statuses.color}>{children}</Button>
      </PopoverTrigger>
    </span>
    <PopoverContent ref={content} alignOffset={-8} className="h-[132px] w-[232px] p-[5px]" role="menu" aria-label={T.settings.statuses.color}
      onKeyDown={moveFocus} onOpenAutoFocus={(event) => { event.preventDefault(); content.current?.querySelector('[aria-checked="true"]')?.focus(); }}>
      <button type="button" role="menuitemradio" aria-checked={color === first.color} onClick={() => select(first.color)}
        className="flex h-8 w-full items-center gap-3 rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <Swatch option={first} selected={color === first.color} />
        <span>{T.needsYouColors[first.id]}</span>
        <span className="ml-auto text-xs text-muted-foreground">{T.settings.general.isDefault}</span>
      </button>
      <div className="mt-2 mb-[7px] border-t" />
      <TooltipProvider>
        <div className="grid grid-cols-6 gap-1 px-1">
          {NEEDS_YOU_COLORS.slice(1).map((option) => <Tooltip key={option.id}>
            <TooltipTrigger asChild>
              <button type="button" role="menuitemradio" aria-checked={color === option.color} aria-label={T.needsYouColors[option.id]}
                className="flex size-8 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => select(option.color)}>
                <Swatch option={option} selected={color === option.color} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{T.needsYouColors[option.id]}</TooltipContent>
          </Tooltip>)}
        </div>
      </TooltipProvider>
    </PopoverContent>
  </Popover>;
}
