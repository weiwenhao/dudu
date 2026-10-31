import { useState } from 'react';
import { Button } from '../components/button.jsx';
import { Calendar } from '../components/calendar.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';

// A due date is a day, not a moment: noon local time keeps it on that day in every time zone near it.
const atNoon = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime();

/** Sets or clears the due date of an issue: a month calendar and Clear, in a small popover. */
export function DueMenu({ dueAt, onChange, children }) {
  const [open, setOpen] = useState(false);
  const selected = dueAt == null ? undefined : new Date(dueAt);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start" aria-label={T.detail.dueDate}>
        <Calendar
          mode="single" selected={selected} defaultMonth={selected}
          onSelect={(date) => { if (date) { onChange(atNoon(date)); setOpen(false); } }}
        />
        {dueAt != null && (
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => { onChange(null); setOpen(false); }}>{T.detail.clearDue}</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
