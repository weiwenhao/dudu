import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Checkbox } from '../components/checkbox.jsx';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { colorOf, LABEL_COLORS, loadLabels, useLabels } from './labels.js';

export const LabelDot = ({ color, className }) => <span aria-hidden="true" className={cn('size-2.5 shrink-0 rounded-full', className)} style={{ background: colorOf(color) }} />;

/** A label as a chip, the height and border of the project and due-date chips beside it. */
export function LabelChip({ label, shrink = false }) {
  return (
    <span data-issue-label={label.id} className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs text-foreground/80', shrink ? 'min-w-0' : 'shrink-0')}>
      <LabelDot color={label.color} />
      {shrink ? <span className="truncate">{label.name}</span> : label.name}
    </span>
  );
}

/**
 * Linear's label picker: a filter box, the labels with a box each (any number can be ticked, the menu stays open), and, when what was typed is not a label,
 * "Create new label" which asks for a colour (the nine of Linear) and then makes the label and ticks it. `value` is the ids ticked; `onChange(ids)` is told
 * each time. The ones ticked when it opened are listed first, and stay where they are while the boxes are changed.
 */
export function LabelChoices({ request, value, onChange }) {
  const { labels, create } = useLabels(request);
  const [ticked, setTicked] = useState(value ?? []);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(null); // the name waiting for its colour
  const [problem, setProblem] = useState('');
  const [first] = useState(() => new Set(value ?? []));
  useEffect(() => { void loadLabels(request, true).catch(() => {}); }, [request]);
  // Follows the issue when it says something else than what was ticked here (a change made elsewhere, or one that was refused).
  const key = JSON.stringify(value ?? []);
  const [seen, setSeen] = useState(key);
  if (seen !== key) { setSeen(key); setTicked(value ?? []); }
  const choose = (next) => { setTicked(next); onChange(next); };
  const toggle = (id) => choose(ticked.includes(id) ? ticked.filter((one) => one !== id) : [...ticked, id]);
  const ordered = [...labels.filter((label) => first.has(label.id)), ...labels.filter((label) => !first.has(label.id))];
  const typed = query.trim().replace(/\s+/g, ' ');
  const known = labels.some((label) => label.name.toLowerCase() === typed.toLowerCase());

  if (naming) {
    return <Command key="colour">
      <CommandInput autoFocus placeholder={T.labels.pickColor} aria-label={T.labels.pickColor} />
      <CommandSeparator />
      <CommandList>
        {Object.keys(LABEL_COLORS).map((color) => <CommandItem key={color} value={T.labels.colors[color]} onSelect={async () => {
          setProblem('');
          try {
            const result = await create(naming, color);
            if (result?.outcome !== 'success') { setProblem(T.labels.createFailed); return; }
            setNaming(null);
            setQuery('');
            first.add(result.label.id);
            choose([...ticked, result.label.id]);
          } catch { setProblem(T.labels.createFailed); }
        }}><LabelDot color={color} className="mx-0.5" />{T.labels.colors[color]}</CommandItem>)}
      </CommandList>
      {problem && <p role="alert" className="px-3 py-2 text-xs text-danger-foreground">{problem}</p>}
    </Command>;
  }
  return <Command key="labels">
    <CommandInput value={query} onValueChange={setQuery} placeholder={T.labels.search} aria-label={T.labels.search} />
    <CommandSeparator />
    <CommandList>
      {!typed && <CommandEmpty>{T.labels.empty}</CommandEmpty>}
      {ordered.map((label) => <CommandItem key={label.id} value={label.name} onSelect={() => toggle(label.id)} data-label-option={label.id}>
        <Checkbox checked={ticked.includes(label.id)} tabIndex={-1} aria-hidden="true" className="pointer-events-none" />
        <LabelDot color={label.color} />
        <span className="truncate">{label.name}</span>
      </CommandItem>)}
      {typed && !known && <CommandItem value={`create ${typed}`} forceMount onSelect={() => setNaming(typed)}><Plus />{T.labels.create(typed)}</CommandItem>}
    </CommandList>
  </Command>;
}

/** The picker in a popover, on whatever is its child (the Labels property of the page, the chip of the New issue window). */
export function LabelMenu({ request, value, onChange, children, align = 'start' }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent className="w-[272px]" align={align} aria-label={T.labels.name}>
      {open && <LabelChoices request={request} value={value} onChange={onChange} />}
    </PopoverContent>
  </Popover>;
}
