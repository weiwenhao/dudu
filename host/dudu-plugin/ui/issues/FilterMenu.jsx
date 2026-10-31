import { Fragment, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverAnchor, PopoverContent } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { FILTER_FIELDS, FILTER_GROUPS } from './filters.jsx';
import { Triangle } from './icons.jsx';

const Kbd = ({ children }) => <kbd className="ml-auto rounded border bg-muted px-1.5 text-xs text-muted-foreground">{children}</kbd>;

function CheckBox({ on }) {
  return on
    ? <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-primary bg-primary text-primary-foreground shadow-xs"><Check className="size-3.5" aria-hidden="true" /></span>
    : <span className="size-4 shrink-0 rounded-[4px] border border-input shadow-xs dark:bg-input/30" />;
}

/** The second list: the options of one field, each with a checkbox and a count; ticking filters the list at once. */
function FilterOptions({ field, options, selected, onToggle, inputRef, onBack }) {
  return (
    <Command onKeyDown={(event) => { if (event.key === 'ArrowLeft' && !event.target.value) { event.preventDefault(); onBack(); } }}>
      <CommandInput ref={inputRef} placeholder={T.filterOptions} aria-label={field.name} />
      <CommandSeparator />
      <CommandList>
        {options.map((option) => {
          const on = selected.includes(option.value);
          return (
            <CommandItem key={String(option.value)} value={option.label} onSelect={() => onToggle(option.value)} data-checked={on}>
              <CheckBox on={on} />
              {option.icon}
              <span className="truncate">{option.label}</span>
              <span className="ml-auto text-muted-foreground">{option.count}</span>
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
}

/**
 * Linear's filter menu, as designed: a box to find a field, the fields (each opens its options in a second menu beside it),
 * and the options with checkboxes and counts. The field that is highlighted, by pointer or by the arrow keys, is the one whose
 * options are showing. `anchor` is the button that opened it ({ element, align }).
 */
export function FilterMenu({ open, anchor, onOpenChange, filter, counts, facets, onToggle }) {
  const [hot, setHot] = useState('status');
  const rows = useRef({});
  const field = FILTER_FIELDS[hot];
  // The second menu is placed beside the highlighted row, which only exists once the first menu has mounted: render once more
  // after that, so the anchor is read from the row and not from nothing.
  const [, remeasure] = useState(0);
  useEffect(() => { if (open) remeasure((count) => count + 1); }, [open]);
  const optionsAnchor = useRef(null);
  optionsAnchor.current = rows.current[hot] ?? null;
  const buttonAnchor = useRef(null);
  buttonAnchor.current = anchor?.element ?? null;
  const fieldInput = useRef(null);
  const optionsInput = useRef(null);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={buttonAnchor} />
      <PopoverContent
        align={anchor?.align ?? 'end'} className="w-[232px]" aria-label={T.addFilter}
        onCloseAutoFocus={(event) => { event.preventDefault(); anchor?.element?.focus(); }}
      >
        <Command value={hot} onValueChange={setHot} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); optionsInput.current?.focus(); } }}>
          <CommandInput ref={fieldInput} placeholder={T.addFilter} aria-label={T.addFilter}><Kbd>F</Kbd></CommandInput>
          <CommandList>
            {FILTER_GROUPS.map((group, index) => (
              <Fragment key={index}>
                <CommandSeparator />
                {group.map((key) => (
                  <CommandItem key={key} value={key} keywords={[FILTER_FIELDS[key].name]} ref={(element) => { rows.current[key] = element; }}>
                    {FILTER_FIELDS[key].rowIcon}
                    <span>{FILTER_FIELDS[key].name}</span>
                    <Triangle direction="right" className={cn('ml-auto size-2 text-muted-foreground')} />
                  </CommandItem>
                ))}
              </Fragment>
            ))}
          </CommandList>
        </Command>
        {open && field && (
          <Popover open onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
            <PopoverAnchor virtualRef={optionsAnchor} />
            {/* Focus lands in the first menu a moment after this one mounts, which would count as "outside" and dismiss it (and the
                first menu with it): only Escape closes this one, and the first menu's own outside-click closes both. */}
            <PopoverContent
              side="left" align="start" alignOffset={-8} sideOffset={8} className="w-[232px]" aria-label={field.name}
              onOpenAutoFocus={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}
            >
              <FilterOptions
                field={field} options={field.options({ counts, facets })} selected={filter[hot] ?? []} inputRef={optionsInput}
                onToggle={(value) => onToggle(hot, value)} onBack={() => fieldInput.current?.focus()}
              />
            </PopoverContent>
          </Popover>
        )}
      </PopoverContent>
    </Popover>
  );
}
