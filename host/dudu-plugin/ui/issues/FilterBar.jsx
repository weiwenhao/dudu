import { Plus, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { FILTER_FIELDS, FILTER_KEYS } from './filters.jsx';
import { appliedFilters } from './filter-state.js';

/**
 * The row under the tabs once a filter is on: one chip per filter (× takes it off), "+ Filter" for another, Clear for all. `fields` and `keys` are
 * the filter's own (Issues' by default); `labelOf(key, value)` names a value the field cannot name by itself (a connector is kept by its id).
 */
export function FilterBar({ filter, onRemove, onClear, onAdd, fields = FILTER_FIELDS, keys = FILTER_KEYS, labelOf }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 px-3">
      {appliedFilters(filter, keys).map(([key, values]) => {
        const field = fields[key];
        return (
          <span key={key} className="inline-flex h-7 max-w-[320px] items-center gap-1.5 rounded-full border bg-background pr-1.5 pl-3 text-xs shadow-xs">
            <span className="font-medium">{field.name}</span>
            <span className="text-muted-foreground">{values.length > 1 ? T.isAnyOf : T.is}</span>
            <span className="truncate font-medium">{(field.order ? [...values].sort((a, b) => field.order.indexOf(a) - field.order.indexOf(b)) : values).map((value) => labelOf?.(key, value) ?? field.label(value)).join(', ')}</span>
            <Button variant="ghost" size="icon-xs" className="size-5 rounded-full" aria-label={`${T.removeFilter}: ${field.name}`} onClick={() => onRemove(key)}><X /></Button>
          </span>
        );
      })}
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={(event) => onAdd(event.currentTarget)}><Plus />{T.addFilterChip}</Button>
      <span className="ml-auto" />
      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onClear}>{T.clear}</Button>
    </div>
  );
}
