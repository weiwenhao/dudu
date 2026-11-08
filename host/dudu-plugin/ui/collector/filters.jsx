import { CalendarDays, Plug } from 'lucide-react';
import { T } from '../strings.js';

// What the Collector widget can be filtered by, in the shape the Issues filter menu takes (issues/FilterMenu.jsx `schema`): the source of a
// row (which connector brought it) and its date, one range at a time, in the words Issues already has.
export const DATES = ['day', 'week', 'month'];
/** The fields that take one choice at a time (issues/filter-state.js `toggleFilter`). */
export const SINGLE = ['date'];

export const COLLECTOR_FIELDS = {
  connector: {
    get name() { return T.fields.source; }, rowIcon: <Plug className="size-4 text-muted-foreground" aria-hidden="true" />, label: (value) => value,
    options: ({ facets }) => (facets?.connector ?? []).map(({ key, name, count }) => ({ value: key, label: name, count })),
  },
  date: {
    get name() { return T.dates.name; }, rowIcon: <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />, order: DATES, label: (value) => T.dates[value],
    options: () => DATES.map((value) => ({ value, label: T.dates[value], count: null })),
  },
};
export const COLLECTOR_KEYS = Object.keys(COLLECTOR_FIELDS);

const rowOf = (key) => ({ get name() { return COLLECTOR_FIELDS[key].name; }, rowIcon: COLLECTOR_FIELDS[key].rowIcon, fields: [key] });
export const COLLECTOR_SCHEMA = {
  fields: COLLECTOR_FIELDS, rows: { connector: rowOf('connector'), date: rowOf('date') }, groups: [['connector', 'date']], first: 'connector',
};
