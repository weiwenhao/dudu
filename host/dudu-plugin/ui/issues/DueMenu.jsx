import { useRef, useState } from 'react';
import { Button } from '../components/button.jsx';
import { Calendar } from '../components/calendar.jsx';
import { Command, CommandInput, CommandItem, CommandList } from '../components/command.jsx';
import { Dialog, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { Input } from '../components/input.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { dueOptionDate } from './due.js';
import { atNoon, dueInputValue, duePresets, parseDueInput } from './due-input.js';
import { DueDate, DueIcon } from './icons.jsx';

const presetLabel = (id) => id === 'tomorrow' ? T.snooze.tomorrow : T.due[id];
const composing = (event) => event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;

/** Shared by date chips, the detail page, the context submenu and Shift+D. */
export function DueChoices({ dueAt, onSelect, onCustom }) {
  const [query, setQuery] = useState('');
  const [now] = useState(Date.now);
  const presets = duePresets(now);
  const parsed = parseDueInput(query, now);
  const matches = presets.filter(({ id }) => presetLabel(id).toLowerCase().includes(query.trim().toLowerCase()));
  const row = ({ id, at }) => <CommandItem key={id} value={id} onSelect={() => onSelect(at)} className="h-8 rounded-none px-3.5 text-[13px]">
    <DueIcon className="text-muted-foreground" /><span>{id === 'parsed' ? dueOptionDate(at) : presetLabel(id)}</span>
    {id !== 'parsed' && <span className="ml-auto text-xs text-muted-foreground">{dueOptionDate(at)}</span>}
  </CommandItem>;
  return <Command shouldFilter={false} className="w-[232px] [&_[data-slot=command-input-wrapper]]:px-3.5" data-due-choices onKeyDownCapture={(event) => {
    if (event.key === 'Enter' && composing(event)) { event.preventDefault(); event.stopPropagation(); }
  }}>
    <CommandInput value={query} onValueChange={setQuery} placeholder={T.due.placeholder} aria-label={T.detail.dueDate}
      className="text-[13px]" autoFocus>
      <span aria-hidden="true" className="flex shrink-0 gap-1 text-xs text-muted-foreground">
        <kbd className="rounded border px-1">⇧</kbd><kbd className="rounded border px-1">D</kbd>
      </span>
    </CommandInput>
    <div className="h-px bg-border" />
    <CommandList className="py-1.5">
      {query.trim() && parsed != null ? row({ id: presets.find(({ at }) => at === parsed)?.id ?? 'parsed', at: parsed })
        : <>
          {!query.trim() && dueAt != null && <CommandItem value="remove" onSelect={() => onSelect(null)} className="h-8 rounded-none px-3.5 text-[13px]">
            <DueIcon clear className="text-muted-foreground" /><span>{T.due.remove}</span>
            <span className="ml-auto text-xs text-muted-foreground">{dueOptionDate(dueAt)}</span>
          </CommandItem>}
          <CommandItem value="custom" onSelect={onCustom} className="h-8 rounded-none px-3.5 text-[13px]">
            <DueIcon className="text-muted-foreground" /><span>{T.due.custom}</span>
          </CommandItem>
          {matches.map(row)}
        </>}
    </CommandList>
  </Command>;
}

/** Custom selection is a draft until Save, using the existing app dialog, input and calendar. */
export function DueDateDialog({ dueAt, onClose, onSelect, onCloseAutoFocus }) {
  const [value, setValue] = useState(() => dueInputValue(dueAt));
  const [month, setMonth] = useState(() => new Date(dueAt ?? Date.now()));
  const [now] = useState(Date.now);
  const parsed = parseDueInput(value, now);
  const save = () => { if (parsed != null) { onClose(); onSelect(parsed); } };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle className="font-semibold">{T.detail.dueDate}</DialogTitle>
      <label className="flex flex-col gap-2 text-sm">
        {T.detail.dueDate}
        <Input autoFocus value={value} aria-label={T.detail.dueDate} placeholder={T.due.placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            const date = parseDueInput(next, now);
            if (date != null) setMonth(new Date(date));
          }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !composing(event)) { event.preventDefault(); save(); } }} />
      </label>
      <Calendar mode="single" numberOfMonths={2} month={month} onMonthChange={setMonth}
        selected={parsed == null ? undefined : new Date(parsed)}
        onSelect={(date) => { if (date) setValue(dueInputValue(atNoon(date))); }}
        className="self-center" classNames={{ months: 'relative flex flex-col gap-4 sm:flex-row sm:gap-6', month: 'flex flex-col gap-2' }} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {dueAt != null && <Button variant="ghost" size="sm" className="mr-auto text-muted-foreground" onClick={() => { onClose(); onSelect(null); }}>{T.due.remove}</Button>}
        <Button variant="ghost" size="sm" onClick={onClose}>{T.newIssue.cancel}</Button>
        <Button size="sm" disabled={parsed == null} onClick={save}>{T.settings.general.save}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export function DueMenu({ dueAt, onChange, children }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const trigger = useRef(null);
  const owner = useRef(null);
  const restoreFocus = () => (trigger.current?.isConnected ? trigger.current : owner.current)?.focus({ preventScroll: true });
  return <>
    <Popover open={open} onOpenChange={(next) => {
      if (next) owner.current = trigger.current?.closest('[data-issue-card], [data-issue-row]');
      setOpen(next);
    }}>
      <PopoverTrigger asChild ref={trigger}>{children}</PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0" align="start" aria-label={T.detail.dueDate}
        onCloseAutoFocus={(event) => {
          if (custom) event.preventDefault();
          else if (!trigger.current?.isConnected) { event.preventDefault(); restoreFocus(); }
        }}>
        <DueChoices dueAt={dueAt} onSelect={(at) => { setOpen(false); onChange(at); }}
          onCustom={() => { setCustom(true); setOpen(false); }} />
      </PopoverContent>
    </Popover>
    {custom && <DueDateDialog dueAt={dueAt} onClose={() => setCustom(false)} onSelect={onChange}
      onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }} />}
  </>;
}

/** The date label is a real property control; its click never opens the surrounding issue or session. */
export function IssueDueDate({ issue, info, onChange, pill = false }) {
  return <DueMenu dueAt={issue.dueAt} onChange={(dueAt) => onChange(issue, { dueAt })}>
    <button type="button" data-issue-due={issue.id} aria-label={T.detail.dueDate} title={info.hint}
      onClick={(event) => event.stopPropagation()}
      className={cn('inline-flex h-6 shrink-0 items-center justify-center rounded-md text-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', pill && 'rounded-full border px-2')}>
      <DueDate info={info} />
    </button>
  </DueMenu>;
}
