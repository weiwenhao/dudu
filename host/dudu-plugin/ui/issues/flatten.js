import { T } from '../strings.js';
import { AGENT_NAMES } from './model.js';

// The heights of what the list is made of (px). A group bar has 4px of air above it, a sub-group's too.
export const SIZES = { group: 40, subgroup: 36, issue: 44, more: 44 };

export const groupLabel = (field, key) => {
  if (field === 'status') return T.status[key] ?? String(key);
  if (field === 'priority') return T.priority[key] ?? String(key);
  if (field === 'agentState') return T.agentState[key] ?? String(key);
  if (field === 'agent') return key == null ? T.noAgent : (AGENT_NAMES[key] ?? key);
  return key == null ? T.noProject : key;
};

/**
 * The store's groups as one flat list for the virtualizer: a bar for each group, a line for each sub-group, the rows, and a
 * placeholder where a group has more rows to fetch. A folded group keeps its bar and loses what is under it.
 */
export function flatten(groups, { collapsed, group: field, subGroup: subField }) {
  const entries = [];
  const push = (rows, cursor, path) => {
    for (const issue of rows) entries.push({ type: 'issue', id: `i:${issue.id}`, issue });
    if (cursor) entries.push({ type: 'more', id: `m:${JSON.stringify(path)}`, path });
  };
  for (const group of groups) {
    const id = `g:${String(group.key)}`;
    entries.push({ type: 'group', id, field, groupKey: group.key, get label() { return groupLabel(field, group.key); }, count: group.count, folded: collapsed.has(id) });
    if (collapsed.has(id)) continue;
    if (group.groups) {
      for (const sub of group.groups) {
        const subId = `s:${String(group.key)}|${String(sub.key)}`;
        entries.push({ type: 'subgroup', id: subId, field: subField, groupKey: sub.key, get label() { return groupLabel(subField, sub.key); }, count: sub.count, folded: collapsed.has(subId) });
        if (!collapsed.has(subId)) push(sub.items, sub.cursor, { key: group.key, subKey: sub.key });
      }
    } else {
      push(group.items, group.cursor, { key: group.key });
    }
  }
  return entries;
}

// The groups a list shows when "Show empty groups" is on: every value of an enumerated field, in the store's order.
const EMPTY_GROUPS = {
  status: { active: ['in_progress', 'in_review', 'todo'], backlog: ['backlog'], all: ['in_progress', 'in_review', 'todo', 'backlog', 'done', 'canceled'] },
  priority: { active: ['urgent', 'high', 'medium', 'low', 'none'], backlog: ['urgent', 'high', 'medium', 'low', 'none'], all: ['urgent', 'high', 'medium', 'low', 'none'] },
};

export function withEmptyGroups(groups, field, tab) {
  const wanted = EMPTY_GROUPS[field]?.[tab];
  if (!wanted) return groups;
  const have = new Map(groups.map((group) => [group.key, group]));
  return wanted.map((key) => have.get(key) ?? { key, count: 0, items: [], cursor: null });
}
