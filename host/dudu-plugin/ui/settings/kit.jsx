// What every page of the settings window is made of, so that they are one design and not eight: a page (its title, and what it can do as a
// whole at the right), the groups on it (a small title over one card), the rows of a card (a name at the left, what to do with it at the
// right, a line of detail under the name), the three kinds of button (the action of a row, the main action of a form, the icon of a
// row), and the three states of a page that is read (reading, could not be read, nothing there).
import { forwardRef, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Command, CommandItem, CommandList } from '../components/command.jsx';
import { Input } from '../components/input.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { Skeleton } from '../components/skeleton.jsx';
import { Textarea } from '../components/textarea.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';

/**
 * A page: the title on the same edge as the cards under it (with a way back before it, on a page one opens from another), the page's
 * own action at the right of it (Add, Save, Check again), then its groups, 24px apart.
 */
export function Page({ title, back, action, children }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {back}
          <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      {children}
    </div>
  );
}

/**
 * A group of rows: a caption (12px, muted, so that the rows are what one reads first) on the line the rows' text starts on and, at its
 * right, what can be done with the group as a whole; under them one card. `label` is the name a screen reader gives the group when the
 * title is not a plain piece of text.
 */
export function Group({ title, label, action, children, className, ...props }) {
  return (
    <section aria-label={label ?? (typeof title === 'string' ? title : undefined)} className={cn('flex flex-col gap-2', className)} {...props}>
      {(title || action) && (
        <header className="flex min-h-6 items-center justify-between gap-3 pr-2 pl-5">
          <h3 className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">{title}</h3>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className="rounded-[20px] border bg-card px-5">{children}</div>
    </section>
  );
}

/**
 * One row of a card: `title` and under it the line of `meta` (12px, grey) at the left, `children` (a switch, a button, a field) at the right.
 * A window too narrow for both puts what is at the right under the name. A row that is a form or a block of text takes the whole width with `block`.
 */
export function Row({ as: Tag = 'div', title, meta, children, block = false, className, ...props }) {
  return (
    <Tag className={cn('border-t border-border/60 py-3 first:border-t-0', !block && 'flex min-h-[40px] flex-wrap items-center gap-x-4 gap-y-2', className)} {...props}>
      {block ? children : (
        <>
          <div className="min-w-[120px] flex-1">
            {title && <div className="text-sm font-medium [overflow-wrap:anywhere]">{title}</div>}
            {meta && <div className="text-xs/[18px] text-muted-foreground [overflow-wrap:anywhere]">{meta}</div>}
          </div>
          {children && <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">{children}</div>}
        </>
      )}
    </Tag>
  );
}

/** The action of a row or of a group: an outline button, 30px high. */
export const ActionButton = forwardRef(function ActionButton({ className, ...props }, ref) {
  return <Button ref={ref} variant="outline" size="sm" className={cn('h-[30px] rounded-[10px] px-3.5 shadow-none', className)} {...props} />;
});

/** The main action of a form: filled, as big as an action. */
export const PrimaryButton = forwardRef(function PrimaryButton({ className, ...props }, ref) {
  return <Button ref={ref} size="sm" className={cn('h-[30px] rounded-[10px] px-3.5 shadow-none', className)} {...props} />;
});

/** The main action of a form that deletes or revokes something: red. */
export const DangerButton = forwardRef(function DangerButton({ className, ...props }, ref) {
  return <Button ref={ref} variant="destructive" size="sm" className={cn('h-[30px] rounded-[10px] px-3.5 shadow-none', className)} {...props} />;
});

/** What a form lets go of (Cancel, Back): no box. */
export const QuietButton = forwardRef(function QuietButton({ className, ...props }, ref) {
  return <Button ref={ref} variant="ghost" size="sm" className={cn('h-[30px] rounded-[10px] px-3 text-muted-foreground', className)} {...props} />;
});

/** The icon of a row (edit, delete): 28px, no box until the pointer is on it. It always has a name for a screen reader (`label`). */
export const IconAction = forwardRef(function IconAction({ label, className, children, ...props }, ref) {
  return <Button ref={ref} variant="ghost" size="icon-sm" aria-label={label} title={label} className={cn('size-7 rounded-lg text-muted-foreground', className)} {...props}>{children}</Button>;
});

/** A field of a form, 32px high with the corners of the buttons. */
export const Field = forwardRef(function Field({ className, ...props }, ref) {
  return <Input ref={ref} className={cn('h-8 rounded-[10px] px-3', className)} {...props} />;
});

/** The text field of a form that takes several lines. */
export const TextField = forwardRef(function TextField({ className, ...props }, ref) {
  return <Textarea ref={ref} className={cn('rounded-[12px] px-3 py-2.5 leading-5', className)} {...props} />;
});

/**
 * A choice among a few things, in a form: closed it is a field (its label, what is chosen, a chevron); open, the popover's own list under it, the
 * chosen one marked, a short note at the right of a row where there is one (`options`: [{ value, label, hint? }]). The list is as wide as the field.
 */
export function Choice({ label, value, options, onChange, disabled, showLabel = true }) {
  const [open, setOpen] = useState(false);
  const list = useRef(null);
  const current = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button" role="combobox" aria-expanded={open} aria-label={label} disabled={disabled}
          className="flex h-8 w-full min-w-0 items-center gap-3 rounded-[10px] border border-input bg-transparent pr-2 pl-3 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showLabel && <span className="shrink-0 text-muted-foreground">{label}</span>}
          <span className="min-w-0 flex-1 truncate">{current?.label ?? ''}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)]" onOpenAutoFocus={(event) => { event.preventDefault(); list.current?.focus(); }}>
        <Command ref={list} label={label} defaultValue={current?.label}>
          <CommandList>
            {options.map((option) => (
              <CommandItem key={String(option.value)} value={option.label} onSelect={() => { onChange(option.value); setOpen(false); }}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A form whose save was refused keeps the cursor. The button that was pressed is disabled while the save runs, and a disabled button gives up
 * the focus; without this, Esc (which cancels the form, and must not close the window) would have nothing to hear it.
 */
export function useFocusAfterRefusal(form, problem, busy) {
  useEffect(() => {
    if (problem && !busy && document.activeElement === document.body) form.current?.querySelector('input:not([disabled]), textarea:not([disabled])')?.focus();
  }, [form, problem, busy]);
}

/** What went wrong with a change, under the thing that was changed. */
export function Problem({ children, className }) {
  return children ? <p role="alert" className={cn('text-xs/[18px] text-danger-foreground', className)}>{children}</p> : null;
}

/** Nothing is there (yet): a line in the middle of the card. */
export function Empty({ children }) {
  return <p className="py-10 text-center text-muted-foreground">{children}</p>;
}

/** The page could not be read: say so, and offer to try again. */
export function Failed({ onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
      <span>{T.settings.failed}</span>
      <ActionButton onClick={onRetry}>{T.settings.retry}</ActionButton>
    </div>
  );
}

/** True once `ms` have passed since it was first drawn: a page that is read at once never shows its placeholder. */
function useAfter(ms) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return late;
}

/** What stands where a card of rows will be, while it is read. */
export function Reading({ rows = 3 }) {
  const late = useAfter(250);
  if (!late) return null;
  return (
    <div role="status" aria-busy="true" aria-label={T.shell.loading} className="rounded-[20px] border bg-card px-5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-[56px] flex-col justify-center gap-2 border-t border-border/60 py-3 first:border-t-0">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/** The shell of something that is read (`useLoaded`): the placeholder while it is, the failure with Retry, then what was read. */
export function Loading({ state, rows, children }) {
  if (state.status === 'error') return <Failed onRetry={state.reload} />;
  return state.value ? children(state.value) : <Reading rows={rows} />;
}
