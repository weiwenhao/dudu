import { Fragment, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverAnchor, PopoverContent } from '../components/popover.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { FILTER_FIELDS, FILTER_GROUPS, FILTER_ROWS } from './filters.jsx';
import { Triangle } from './icons.jsx';

const Kbd = ({ children }) => <kbd className="ml-auto rounded border bg-muted px-1.5 text-xs text-muted-foreground">{children}</kbd>;

function CheckBox({ on }) {
  return on
    ? <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-primary bg-primary text-primary-foreground shadow-xs"><Check className="size-3.5" aria-hidden="true" /></span>
    : <span className="size-4 shrink-0 rounded-[4px] border border-input shadow-xs dark:bg-input/30" />;
}

function Options({ fieldKey, options, filter, onToggle }) {
  return options.map((option) => {
    const on = (filter[fieldKey] ?? []).includes(option.value);
    return (
      <CommandItem key={String(option.value)} value={`${fieldKey}:${option.label}`} onSelect={() => onToggle(fieldKey, option.value)} data-checked={on}>
        <CheckBox on={on} />
        {option.icon}
        <span className="truncate">{option.label}</span>
        {option.count != null && <span className="ml-auto text-muted-foreground">{option.count}</span>}
      </CommandItem>
    );
  });
}

/**
 * The second list: the options of the highlighted row, each with a checkbox and a count; ticking filters the list at once. A row
 * that holds several fields (Dates) lists each under its own heading.
 */
function FilterOptions({ row, sections, filter, onToggle, inputRef, onBack }) {
  return (
    <Command onKeyDown={(event) => { if (event.key === 'ArrowLeft' && !event.target.value) { event.preventDefault(); onBack(); } }}>
      <CommandInput ref={inputRef} placeholder={T.filterOptions} aria-label={row.name} />
      <CommandSeparator />
      <CommandList>
        {sections.length === 1
          ? <Options fieldKey={sections[0].key} options={sections[0].options} filter={filter} onToggle={onToggle} />
          : sections.map((section) => (
            <CommandGroup key={section.key} heading={FILTER_FIELDS[section.key].name}>
              <Options fieldKey={section.key} options={section.options} filter={filter} onToggle={onToggle} />
            </CommandGroup>
          ))}
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
  const row = FILTER_ROWS[hot];
  // The second menu is placed beside the highlighted row, which only exists once the first menu has mounted: render once more
  // after that, so the anchor is read from the row and not from nothing.
  const [, remeasure] = useState(0);
  useEffect(() => { if (open) remeasure((count) => count + 1); }, [open]);
  const optionsAnchor = useRef(null);
  optionsAnchor.current = rows.current[hot] ?? null;
  const buttonAnchor = useRef(null);
  buttonAnchor.current = anchor?.element ?? null;
  const fieldInput = useRef(null);
  const menu = useRef(null);
  const optionsInput = useRef(null);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={buttonAnchor} />
      <PopoverContent
        ref={menu}
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
                  <CommandItem key={key} value={key} keywords={[FILTER_ROWS[key].name]} ref={(element) => { rows.current[key] = element; }}>
                    {FILTER_ROWS[key].rowIcon}
                    <span>{FILTER_ROWS[key].name}</span>
                    <Triangle direction="right" className={cn('ml-auto size-2 text-muted-foreground')} />
                  </CommandItem>
                ))}
              </Fragment>
            ))}
          </CommandList>
        </Command>
        {open && row && (
          <Popover open onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
            <PopoverAnchor virtualRef={optionsAnchor} />
            <PopoverContent
              side="left" align="start" alignOffset={-8} sideOffset={8} className="w-[232px]" aria-label={row.name}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onFocusOutside={(event) => event.preventDefault()}
              onPointerDownOutside={(event) => { if (menu.current?.contains(event.target)) event.preventDefault(); }}
            >
              <FilterOptions
                row={row} filter={filter} inputRef={optionsInput} onToggle={onToggle} onBack={() => fieldInput.current?.focus()}
                sections={row.fields.map((key) => ({ key, options: FILTER_FIELDS[key].options({ counts, facets }) }))}
              />
            </PopoverContent>
          </Popover>
        )}
      </PopoverContent>
    </Popover>
  );
}
