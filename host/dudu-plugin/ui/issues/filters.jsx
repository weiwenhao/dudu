import { Activity, Bot, Box, Plug } from 'lucide-react';
import { T } from '../strings.js';
import { PriorityIcon, StatusIcon } from './icons.jsx';
import { AGENT_NAMES, AGENT_STATE_ORDER, PRIORITY_ORDER, STATUS_ORDER } from './model.js';

const SOURCE_ORDER = ['owner', 'dudu', 'connector', 'session'];
const fixed = (order, label, counts, icon) => order.map((value) => ({ value, label: label(value), count: counts?.[value] ?? 0, icon: icon?.(value) }));
const found = (list) => new Map((list ?? []).map((entry) => [entry.key, entry.count]));

/**
 * The fields of the filter menu, in the design's order. `label(value)` is how a ticked value reads on a chip; `options(data)` is the
 * list the second menu shows: `{ value, label, count, icon }`, counted from the list's own counts (status, priority) or from the
 * store's facets (the rest). `order` fixes the order a chip lists its values in.
 */
export const FILTER_FIELDS = {
  status: {
    name: T.fields.status, rowIcon: <StatusIcon status="backlog" />, order: STATUS_ORDER, label: (value) => T.status[value],
    options: ({ counts }) => fixed(STATUS_ORDER, (value) => T.status[value], counts?.status, (value) => <StatusIcon status={value} />),
  },
  agent: {
    name: T.fields.agent, rowIcon: <Bot className="size-4 text-muted-foreground" aria-hidden="true" />,
    label: (value) => (value == null ? T.noAgent : (AGENT_NAMES[value] ?? value)),
    options: ({ facets }) => (facets?.agent ?? []).map(({ key, count }) => ({ value: key, label: key == null ? T.noAgent : (AGENT_NAMES[key] ?? key), count })),
  },
  agentState: {
    name: T.fields.agentState, rowIcon: <Activity className="size-4 text-muted-foreground" aria-hidden="true" />, order: AGENT_STATE_ORDER, label: (value) => T.agentState[value],
    options: ({ facets }) => { const counts = found(facets?.agentState); return AGENT_STATE_ORDER.map((value) => ({ value, label: T.agentState[value], count: counts.get(value) ?? 0 })); },
  },
  priority: {
    name: T.fields.priority, rowIcon: <PriorityIcon priority="high" />, order: PRIORITY_ORDER, label: (value) => T.priority[value],
    options: ({ counts }) => fixed(PRIORITY_ORDER, (value) => T.priority[value], counts?.priority, (value) => <PriorityIcon priority={value} />),
  },
  project: {
    name: T.fields.project, rowIcon: <Box className="size-4 text-muted-foreground" aria-hidden="true" />, label: (value) => (value == null ? T.noProject : value),
    options: ({ facets }) => (facets?.project ?? []).map(({ key, count }) => ({ value: key, label: key == null ? T.noProject : key, count })),
  },
  source: {
    name: T.fields.source, rowIcon: <Plug className="size-4 text-muted-foreground" aria-hidden="true" />, order: SOURCE_ORDER, label: (value) => T.source[value],
    options: ({ facets }) => { const counts = found(facets?.source); return SOURCE_ORDER.map((value) => ({ value, label: T.source[value], count: counts.get(value) ?? 0 })); },
  },
};

// The menu's groups, a line between each (Dates, in the first, is not built yet: the design names it without its options).
export const FILTER_GROUPS = [['status', 'agent', 'agentState', 'priority'], ['project'], ['source']];

export const FILTER_KEYS = Object.keys(FILTER_FIELDS);
