import { Activity, Bot, Box, CalendarDays, Plug } from 'lucide-react';
import { T } from '../strings.js';
import { DATE_FIELDS } from './dates.js';
import { PriorityIcon, StatusIcon } from './icons.jsx';
import { AGENT_NAMES, AGENT_STATE_ORDER, PRIORITY_ORDER, STATUS_ORDER } from './model.js';

const SOURCE_ORDER = ['owner', 'dudu', 'connector', 'session'];
const fixed = (order, label, counts, icon) => order.map((value) => ({ value, label: label(value), count: counts?.[value] ?? 0, icon: icon?.(value) }));
const found = (list) => new Map((list ?? []).map((entry) => [entry.key, entry.count]));

// A date field has ready-made ranges and no counts; one is ticked at a time.
const dateField = (key) => ({
  get name() { return T.dates[key]; }, order: DATE_FIELDS[key], label: (value) => T.dates[value],
  options: () => DATE_FIELDS[key].map((value) => ({ value, label: T.dates[value], count: null })),
});

/**
 * The fields a filter can hold, in the design's order. `label(value)` is how a ticked value reads on a chip; `options(data)` is the
 * list the second menu shows: `{ value, label, count, icon }`, counted from the list's own counts (status, priority) or from the
 * store's facets (the rest). `order` fixes the order a chip lists its values in.
 */
export const FILTER_FIELDS = {
  status: {
    get name() { return T.fields.status; }, rowIcon: <StatusIcon status="backlog" />, order: STATUS_ORDER, label: (value) => T.status[value],
    options: ({ counts }) => fixed(STATUS_ORDER, (value) => T.status[value], counts?.status, (value) => <StatusIcon status={value} />),
  },
  agent: {
    get name() { return T.fields.agent; }, rowIcon: <Bot className="size-4 text-muted-foreground" aria-hidden="true" />,
    label: (value) => (value == null ? T.noAgent : (AGENT_NAMES[value] ?? value)),
    options: ({ facets }) => (facets?.agent ?? []).map(({ key, count }) => ({ value: key, label: key == null ? T.noAgent : (AGENT_NAMES[key] ?? key), count })),
  },
  agentState: {
    get name() { return T.fields.agentState; }, rowIcon: <Activity className="size-4 text-muted-foreground" aria-hidden="true" />, order: AGENT_STATE_ORDER, label: (value) => T.agentState[value],
    options: ({ facets }) => { const counts = found(facets?.agentState); return AGENT_STATE_ORDER.map((value) => ({ value, label: T.agentState[value], count: counts.get(value) ?? 0 })); },
  },
  priority: {
    get name() { return T.fields.priority; }, rowIcon: <PriorityIcon priority="high" />, order: PRIORITY_ORDER, label: (value) => T.priority[value],
    options: ({ counts }) => fixed(PRIORITY_ORDER, (value) => T.priority[value], counts?.priority, (value) => <PriorityIcon priority={value} />),
  },
  project: {
    get name() { return T.fields.project; }, rowIcon: <Box className="size-4 text-muted-foreground" aria-hidden="true" />, label: (value) => (value == null ? T.noProject : value),
    options: ({ facets }) => (facets?.project ?? []).map(({ key, count }) => ({ value: key, label: key == null ? T.noProject : key, count })),
  },
  source: {
    get name() { return T.fields.source; }, rowIcon: <Plug className="size-4 text-muted-foreground" aria-hidden="true" />, order: SOURCE_ORDER, label: (value) => T.source[value],
    options: ({ facets }) => { const counts = found(facets?.source); return SOURCE_ORDER.map((value) => ({ value, label: T.source[value], count: counts.get(value) ?? 0 })); },
  },
  due: dateField('due'),
  created: dateField('created'),
  updated: dateField('updated'),
};

// The rows of the menu: a field each, except Dates, which holds three.
const rowOf = (key) => ({ get name() { return FILTER_FIELDS[key].name; }, rowIcon: FILTER_FIELDS[key].rowIcon, fields: [key] });
export const FILTER_ROWS = {
  status: rowOf('status'), agent: rowOf('agent'), agentState: rowOf('agentState'), priority: rowOf('priority'),
  dates: { get name() { return T.dates.name; }, rowIcon: <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />, fields: ['due', 'created', 'updated'] },
  project: rowOf('project'), source: rowOf('source'),
};

// The menu's groups, a line between each.
export const FILTER_GROUPS = [['status', 'agent', 'agentState', 'priority', 'dates'], ['project'], ['source']];

export const FILTER_KEYS = Object.keys(FILTER_FIELDS);
