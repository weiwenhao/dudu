import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide, Kanban, List, SlidersHorizontal } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { SelectField } from '../components/select-field.jsx';
import { Switch } from '../components/switch.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { displayChanged, PROPERTY_ORDER } from './view.js';

const D = T.display;
const GROUP_FIELDS = ['status', 'agent', 'project', 'priority'];
const ORDER_FIELDS = ['priority', 'status', 'due', 'updated', 'created'];
const COMPLETED = ['all', 'day', 'week', 'month', 'none'];
const groupOptions = (without, none) => [
  ...(none ? [{ value: null, label: D.noGrouping }] : []),
  ...GROUP_FIELDS.filter((field) => field !== without).map((field) => ({ value: field, label: D.groupBy[field] })),
];

const Separator = () => <div className="-mx-1.5 my-1.5 border-t" role="separator" />;

function Line({ label, reverse, children }) {
  return (
    <div className="flex h-9 items-center gap-1 px-2 text-sm">
      <span className="flex-1">{label}</span>
      {reverse ?? <span className="size-6" />}
      {children}
    </div>
  );
}

const ReverseButton = ({ label, onClick, children }) => (
  <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={D.reverse(label)} onClick={onClick}>{children}</Button>
);

function ToggleLine({ label, checked, onChange }) {
  return (
    <div className="flex h-9 items-center justify-between px-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

/**
 * Linear's Display options: the layout, how the rows are grouped and ordered, whether finished issues sink to the end and how
 * far back they go, and which properties a row shows. The button carries a blue dot while anything differs from the default.
 */
export function DisplayMenu({ tab, view, onChange, onReset }) {
  const board = view.layout === 'board';
  const group = view.group ?? (board ? 'status' : null);
  const recency = view.recency ?? tab === 'all';
  const changed = displayChanged(view);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" className="relative size-7 rounded-full data-[state=open]:bg-accent" aria-label={D.title}>
          <SlidersHorizontal />
          {changed && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-ring" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px]" aria-label={D.title}>
        <div className="grid grid-cols-2 gap-1.5 px-1 pt-0.5 pb-1">
          <Button variant={board ? 'outline' : 'secondary'} size="sm" onClick={() => onChange({ layout: 'list' })}><List />{D.list}</Button>
          <Button variant={board ? 'secondary' : 'outline'} size="sm" onClick={() => onChange({ layout: 'board' })}><Kanban />{D.board}</Button>
        </div>
        <Separator />
        <Line
          label={board ? D.columns : D.grouping}
          reverse={<ReverseButton label={board ? D.columns : D.grouping} onClick={() => onChange({ reverseGroups: !view.reverseGroups })}><ArrowUpDown /></ReverseButton>}
        >
          <SelectField
            label={board ? D.columns : D.grouping} value={group} options={groupOptions(null, !board)}
            onChange={(value) => onChange({ group: value, subGroup: value === view.subGroup ? null : (value ? view.subGroup : null) })}
          />
        </Line>
        <Line label={board ? D.rows : D.subGrouping}>
          <SelectField
            label={board ? D.rows : D.subGrouping} value={group ? view.subGroup : null} options={groupOptions(group, true)} disabled={!group}
            onChange={(value) => onChange({ subGroup: value })}
          />
        </Line>
        <Line
          label={D.ordering}
          reverse={<ReverseButton label={D.ordering} onClick={() => onChange({ reverse: !view.reverse })}>{view.reverse ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}</ReverseButton>}
        >
          <SelectField label={D.ordering} value={view.order} options={ORDER_FIELDS.map((field) => ({ value: field, label: D.orderBy[field] }))} onChange={(value) => onChange({ order: value })} />
        </Line>
        <ToggleLine label={D.recency} checked={recency} onChange={(checked) => onChange({ recency: checked })} />
        <Separator />
        <Line label={D.completedIssues}>
          <SelectField label={D.completedIssues} value={view.completed} options={COMPLETED.map((value) => ({ value, label: D.completed[value] }))} onChange={(value) => onChange({ completed: value })} />
        </Line>
        <Separator />
        <div className="px-2 pt-1 pb-0.5 text-sm font-medium">{board ? D.boardOptions : D.listOptions}</div>
        <ToggleLine label={board ? D.showEmptyColumns : D.showEmptyGroups} checked={view.showEmpty} onChange={(checked) => onChange({ showEmpty: checked })} />
        <div className="px-2 pt-2 pb-1.5 text-sm">{D.properties}</div>
        <div className="flex flex-wrap gap-1.5 px-2 pb-2">
          {PROPERTY_ORDER.map((property) => {
            const on = view.properties[property];
            return (
              <button
                key={property} type="button" aria-pressed={on} onClick={() => onChange({ properties: { ...view.properties, [property]: !on } })}
                className={cn('inline-flex h-7 items-center rounded-full px-3 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', on ? 'bg-secondary font-medium text-foreground' : 'border text-muted-foreground')}
              >
                {D.property[property]}
              </button>
            );
          })}
        </div>
        <Separator />
        <div className="flex h-9 items-center justify-end px-2">
          <Button variant="ghost" size="sm" onClick={onReset}>{D.reset}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
