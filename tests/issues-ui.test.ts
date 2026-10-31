import assert from 'node:assert/strict';
import test from 'node:test';
import { dueInfo, shortDate } from '../host/dudu-plugin/ui/issues/due.js';
import { appliedFilters, removeFilter, toggleFilter } from '../host/dudu-plugin/ui/issues/filter-state.js';
import { flatten, groupLabel, SIZES, withEmptyGroups } from '../host/dudu-plugin/ui/issues/flatten.js';
import { DEFAULT_VIEW, displayChanged, listRequest } from '../host/dudu-plugin/ui/issues/view.js';

const view = (change = {}) => ({ ...DEFAULT_VIEW, ...change });
const HOUR = 3600000;
const DAY = 86400000;

test('a view that is all defaults asks the store for just its tab', () => {
  assert.deepEqual(listRequest('active', view()), { tab: 'active' });
  assert.deepEqual(listRequest('backlog', view()), { tab: 'backlog' });
  // All issues puts finished ones last by default, and so does the store: nothing to send.
  assert.deepEqual(listRequest('all', view()), { tab: 'all' });
});

test('only what differs from the defaults is sent', () => {
  assert.deepEqual(
    listRequest('active', view({ filter: { status: ['todo'] }, group: 'project', subGroup: 'status', order: 'due', reverse: true })),
    { tab: 'active', filter: { status: ['todo'] }, group: 'project', subGroup: 'status', order: 'due', reverse: true },
  );
  assert.equal(listRequest('all', view({ recency: false })).completedLast, false, 'All issues with the switch off');
  assert.equal(listRequest('active', view({ recency: true })).completedLast, true, 'another tab with the switch on');
  assert.equal('completedLast' in listRequest('all', view({ recency: true })), false, 'on in All issues is the store\'s own default');
  assert.equal('subGroup' in listRequest('active', view({ group: 'status', subGroup: 'status' })), false, 'a sub-group equal to the group is dropped');
});

test('the Board groups by Status unless told otherwise', () => {
  assert.equal(listRequest('active', view({ layout: 'board' })).group, 'status');
  assert.equal(listRequest('active', view({ layout: 'board', group: 'priority' })).group, 'priority');
  assert.equal('group' in listRequest('active', view()), false);
});

test('"Completed issues" becomes a time that stays the same within the hour, so the list is not re-fetched on every render', () => {
  const at = Date.UTC(2026, 9, 31, 10, 20, 30);
  const week = listRequest('all', view({ completed: 'week' }), at).filter;
  assert.deepEqual(week, { completedFrom: Math.floor(at / HOUR) * HOUR - 7 * DAY });
  assert.deepEqual(listRequest('all', view({ completed: 'week' }), at + 20 * 60000).filter, week);
  assert.notDeepEqual(listRequest('all', view({ completed: 'week' }), at + HOUR).filter, week);
  assert.equal(listRequest('all', view({ completed: 'day' }), at).filter?.completedFrom, Math.floor(at / HOUR) * HOUR - DAY);
  assert.equal(listRequest('all', view({ completed: 'none' }), at).filter?.completedFrom, Number.MAX_SAFE_INTEGER);
  const merged = listRequest('all', view({ completed: 'month', filter: { priority: ['urgent'] } }), at).filter;
  assert.deepEqual(Object.keys(merged ?? {}).sort(), ['completedFrom', 'priority']);
});

test('the blue dot on Display options follows the display options, not the filter', () => {
  assert.equal(displayChanged(view()), false);
  assert.equal(displayChanged(view({ filter: { status: ['todo'] } })), false);
  assert.equal(displayChanged(view({ group: 'status' })), true);
  assert.equal(displayChanged(view({ properties: { ...DEFAULT_VIEW.properties, source: true } })), true);
  assert.equal(displayChanged(view({ layout: 'board' })), true);
});

test('ticking filter options', () => {
  let filter = {};
  filter = toggleFilter(filter, 'status', 'todo');
  filter = toggleFilter(filter, 'status', 'in_progress');
  filter = toggleFilter(filter, 'priority', 'urgent');
  assert.deepEqual(filter, { status: ['todo', 'in_progress'], priority: ['urgent'] });
  assert.deepEqual(toggleFilter(filter, 'status', 'todo'), { priority: ['urgent'], status: ['in_progress'] });
  assert.deepEqual(toggleFilter({ status: ['todo'] }, 'status', 'todo'), {}, 'a field with nothing ticked disappears');
  assert.deepEqual(removeFilter(filter, 'priority'), { status: ['todo', 'in_progress'] });
  assert.deepEqual(appliedFilters({ status: ['todo'], priority: [], stale: ['x'] }, ['status', 'priority']), [['status', ['todo']]]);
});

test('a grouped list is one flat column of bars, sub-group lines, rows and placeholders', () => {
  const issue = (id: number) => ({ id, title: `t${id}` });
  const groups = [
    { key: 'in_progress', count: 3, groups: [
      { key: 'app', count: 2, items: [issue(1), issue(2)], cursor: 'next-app' },
      { key: null, count: 1, items: [issue(3)], cursor: null },
    ] },
    { key: 'todo', count: 1, groups: [{ key: 'docs', count: 1, items: [issue(4)], cursor: null }] },
  ];
  const shape = (entries: Array<{ type: string; label?: string; issue?: { id: number } }>) => entries.map((entry) => (entry.type === 'issue' ? `#${entry.issue?.id}` : entry.type === 'more' ? 'more' : `${entry.type}:${entry.label}`));
  assert.deepEqual(
    shape(flatten(groups, { collapsed: new Set(), group: 'status', subGroup: 'project' })),
    ['group:In Progress', 'subgroup:app', '#1', '#2', 'more', 'subgroup:No project', '#3', 'group:Todo', 'subgroup:docs', '#4'],
  );
  assert.deepEqual(
    shape(flatten(groups, { collapsed: new Set(['g:in_progress']), group: 'status', subGroup: 'project' })),
    ['group:In Progress', 'group:Todo', 'subgroup:docs', '#4'],
    'a folded group keeps its bar and loses what is under it',
  );
  const more = flatten(groups, { collapsed: new Set(), group: 'status', subGroup: 'project' }).find((entry) => entry.type === 'more');
  assert.deepEqual(more?.path, { key: 'in_progress', subKey: 'app' }, 'the placeholder knows which group to ask the store about');
  const ids = flatten(groups, { collapsed: new Set(), group: 'status', subGroup: 'project' }).map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'every entry has its own key');
  assert.deepEqual(Object.keys(SIZES).sort(), ['group', 'issue', 'more', 'subgroup']);
});

test('group names come from the field: fixed words for status and priority, "No …" for an empty value', () => {
  assert.equal(groupLabel('status', 'in_review'), 'In Review');
  assert.equal(groupLabel('priority', 'none'), 'No priority');
  assert.equal(groupLabel('agent', null), 'No agent');
  assert.equal(groupLabel('agent', 'claude'), 'Claude');
  assert.equal(groupLabel('project', null), 'No project');
  assert.equal(groupLabel('project', 'scripts'), 'scripts');
});

test('"Show empty groups" adds the missing values of an enumerated field in the store\'s order, per tab', () => {
  const have = [{ key: 'todo', count: 2, items: [{ id: 1 }], cursor: null }];
  assert.deepEqual(withEmptyGroups(have, 'status', 'active').map((group: { key: string }) => group.key), ['in_progress', 'in_review', 'todo']);
  assert.deepEqual(withEmptyGroups(have, 'status', 'backlog').map((group: { key: string }) => group.key), ['backlog']);
  assert.equal(withEmptyGroups(have, 'status', 'all').length, 6);
  const todo = withEmptyGroups(have, 'status', 'all').find((group: { key: string }) => group.key === 'todo');
  assert.equal(todo, have[0], 'a group that has rows is kept as it is');
  assert.equal(withEmptyGroups(have, 'project', 'all'), have, 'a field with open-ended values cannot list the empty ones');
});

test('due dates read as Linear does: tone by how near, "Today", no year within this year', () => {
  const now = new Date(2026, 9, 31, 15, 0).getTime(); // Oct 31 2026, local
  const at = (month: number, day: number, hour = 9) => new Date(2026, month - 1, day, hour).getTime();
  assert.equal(dueInfo(null, now), null);
  assert.deepEqual(dueInfo(at(10, 30), now)?.kind, 'late');
  assert.equal(dueInfo(at(10, 30), now)?.text, 'Oct 30');
  assert.equal(dueInfo(at(10, 30), now)?.hint, 'Oct 30 · 1 day overdue');
  assert.equal(dueInfo(at(10, 31, 1), now)?.kind, 'today', 'earlier today is still today');
  assert.equal(dueInfo(at(10, 31, 1), now)?.text, 'Today');
  assert.equal(dueInfo(at(11, 3), now)?.kind, 'soon');
  assert.equal(dueInfo(at(11, 3), now)?.hint, 'Nov 3 · in 3 days');
  assert.equal(dueInfo(at(11, 7), now)?.kind, 'soon', 'seven days ahead is still this week');
  assert.equal(dueInfo(at(11, 8), now)?.kind, 'later');
  assert.equal(dueInfo(new Date(2027, 0, 5).getTime(), now)?.text, 'Jan 5, 2027');
  assert.equal(shortDate(at(10, 1), now), 'Oct 1');
});
