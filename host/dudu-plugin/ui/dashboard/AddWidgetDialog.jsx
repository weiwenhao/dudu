import { useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { WidgetSample } from './WidgetSample.jsx';

const D = T.dashboard;
const dimensions = ({ w, h }) => `${w === 'fill' ? D.fullWidth : w} × ${h === 'fill' ? D.fullHeight : h}`;

function WidgetPicker({ registry, onBoard, onAdd }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => registry.find((widget) => !onBoard.has(widget.id))?.id ?? registry[0]?.id);
  const options = useRef(new Map());
  const search = query.trim().toLocaleLowerCase();
  const matches = registry.filter((widget) => [widget.label, widget.description, widget.source, widget.id].some((text) => text?.toLocaleLowerCase().includes(search)));
  const widget = matches.find((item) => item.id === selected) ?? matches[0];
  const there = widget && onBoard.has(widget.id);
  const choose = (index) => {
    const next = matches[(index + matches.length) % matches.length];
    if (next) { setSelected(next.id); options.current.get(next.id)?.focus(); }
  };
  return <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
    <div className="flex min-h-0 shrink-0 flex-col border-b sm:w-[264px] sm:border-r sm:border-b-0">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={D.searchWidgets} aria-label={D.searchWidgets}
            onKeyDown={(event) => { if (event.key === 'ArrowDown' && matches.length) { event.preventDefault(); choose(Math.max(0, matches.findIndex((item) => item.id === widget?.id))); } }}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
      </div>
      <ul role="listbox" aria-label={D.addTitle} className="flex max-h-[160px] min-h-0 flex-col gap-0.5 overflow-auto px-2 pb-2 sm:max-h-none sm:flex-1">
        {matches.map((item, index) => <li key={item.id} role="none">
          <button type="button" role="option" aria-label={item.label} aria-selected={widget?.id === item.id}
            ref={(element) => { if (element) options.current.set(item.id, element); else options.current.delete(item.id); }}
            tabIndex={widget?.id === item.id ? 0 : -1} onClick={() => setSelected(item.id)}
            onKeyDown={(event) => {
              const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: matches.length - 1 }[event.key];
              if (next !== undefined) { event.preventDefault(); choose(next); }
            }}
            className={cn('flex h-[52px] w-full items-center gap-3 rounded-[10px] px-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', widget?.id === item.id && 'bg-accent')}>
            <span className="relative h-[38px] w-14 shrink-0 overflow-hidden rounded-[7px] border bg-card">
              <WidgetSample widget={item} thumbnail />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px]/5 font-medium">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.source ? D.source(item.source) : dimensions(item.size)}</span>
            </span>
            {onBoard.has(item.id) && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{D.added}</span>}
          </button>
        </li>)}
      </ul>
    </div>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-5">
      {/* No frame and no fill: the grid behind the sample fades out at the edges (WidgetSample), so the preview is not a closed box. */}
      <div data-widget-preview={widget?.id} className="relative min-h-[100px] flex-1 overflow-hidden">
        {widget && <WidgetSample key={widget.id} widget={widget} />}
      </div>
      {widget && <div className="flex shrink-0 items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 text-lg/6 font-semibold">{widget.label}
            {widget.source && <span className="text-xs font-normal text-muted-foreground">{D.source(widget.source)}</span>}
          </div>
        </div>
        <Button variant={there ? 'outline' : 'default'} className="h-9 shrink-0 rounded-lg px-[18px]" disabled={there}
          aria-label={there ? D.added : `${D.add} ${widget.label}`} onClick={() => onAdd(widget.id)}>
          {there && <Check />}{there ? D.added : D.add}
        </Button>
      </div>}
    </div>
  </div>;
}

/** The owner's gallery design: searchable thumbnails on the left and a live, read-only widget on the right. */
export function AddWidgetDialog({ open, onOpenChange, registry, onBoard, onAdd }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="h-[min(680px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:h-[min(560px,calc(100dvh-2rem))] sm:max-w-[880px]">
      <div className="flex h-14 shrink-0 items-center border-b pr-3.5 pl-5">
        <DialogTitle className="text-[16px] font-semibold">{D.addTitle}</DialogTitle>
        <DialogDescription className="sr-only">{D.addDescription}</DialogDescription>
        <DialogClose asChild><Button variant="ghost" size="icon-sm" className="ml-auto size-7 rounded-md text-muted-foreground" aria-label={T.pet.close}><X /></Button></DialogClose>
      </div>
      <WidgetPicker registry={registry} onBoard={onBoard} onAdd={onAdd} />
    </DialogContent>
  </Dialog>;
}
