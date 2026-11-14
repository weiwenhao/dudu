import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssueCommands } from '../host/assistant/issues/api.mjs';
import { SCHEMA_VERSION } from '../host/assistant/issues/schema.mjs';

function world(t: any, file = ':memory:') {
  let clock = 100;
  const issues = createIssues({ file, now: () => ++clock });
  t.after(() => issues.close());
  const addStatus = (name: string, category = 'started') => {
    const result = issues.statusAdd({ name, category, color: '#f2994a', description: 'A saved workflow choice' });
    assert.equal(result.outcome, 'success', result.message);
    return result.status;
  };
  return { issues, addStatus };
}

test('workflow migration preserves existing issues, counters, history and project references across reopen', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-workflow-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'issues.db');
  const previous = createIssues({ file });
  const made = previous.add({ title: 'Existing work', status: 'in_review', project: { name: 'App', path: '/work/app' } }).issue;
  previous.log(made.id, { kind: 'progress', text: 'Original progress.\n\nKeep this history intact.' });
  const saved = previous.get(made.id);
  const events = previous.events().events;
  previous.close();
  const db = new DatabaseSync(file);
  db.exec(`
    DROP TRIGGER issues_workflow_insert;
    DROP TRIGGER issues_workflow_update;
    DROP TRIGGER issues_workflow_delete;
    DROP TABLE issue_workflow_counts;
    DROP INDEX issues_workflow_status;
    ALTER TABLE issues DROP COLUMN workflow_status;
    DROP TABLE issue_statuses;
    PRAGMA user_version=4;
  `);
  db.close();
  const { issues } = world(t, file);
  assert.deepEqual(issues.get(made.id), saved);
  assert.deepEqual(issues.events().events, events);
  assert.equal(issues.counts().byStatus.in_review, 1);
  assert.equal(issues.export().version, SCHEMA_VERSION);
  assert.equal(issues.statuses().statuses.length, 6);
  assert.equal(issues.export().issues[0].workflow_status, 'in_review');
});

test('custom status identity, color, description and default survive rename and reopening', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-workflow-default-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'issues.db');
  const { issues, addStatus } = world(t, file);
  const status = addStatus('Ready for an agent', 'unstarted');
  assert.equal(issues.statusUpdate(status.id, { isDefault: true }).outcome, 'success');
  const issue = issues.add({ title: 'Default custom status' }).issue;
  assert.equal(issue.status, status.id);
  assert.equal(issue.statusType, 'todo');
  issues.update(issue.id, { status: 'in_review' });
  issues.statusUpdate(status.id, { name: 'Ready', color: '#26b5ce', description: 'Approved description' });
  assert.equal(issues.get(issue.id).log[0].data.from, status.id, 'history uses the stable status id');
  assert.equal(issues.statuses().statuses.find((entry: any) => entry.id === status.id).name, 'Ready');
  issues.close();
  const reopened = createIssues({ file });
  t.after(() => reopened.close());
  const after = reopened.statuses().statuses.find((entry: any) => entry.id === status.id);
  assert.deepEqual([after.color, after.description, after.isDefault], ['#26b5ce', 'Approved description', true]);
  assert.equal(reopened.add({ title: 'Still the default' }).issue.status, status.id);
});

test('workflow icon progress migrates old shapes and persists owner choices without changing issues', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-workflow-icons-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'issues.db');
  const previous = createIssues({ file });
  const custom = previous.statusAdd({ name: 'Investigating', category: 'started', color: '#f2994a' }).status;
  const issue = previous.add({ title: 'Keep this workflow', status: custom.id }).issue;
  const saved = previous.get(issue.id);
  const events = previous.events();
  const counts = previous.counts();
  previous.close();
  const db = new DatabaseSync(file);
  db.exec(`ALTER TABLE issue_statuses DROP COLUMN icon_progress; PRAGMA user_version=${SCHEMA_VERSION - 1};`);
  db.close();

  const { issues } = world(t, file);
  const boss = createIssueCommands({ issues });
  const all = (await boss.execute('statuses')).statuses;
  assert.deepEqual(all.filter((entry: any) => entry.category === 'started').map((entry: any) => entry.iconProgress), [0.5, 0.75, 0.5]);
  assert.ok(all.filter((entry: any) => entry.category !== 'started').every((entry: any) => entry.iconProgress === null));
  assert.deepEqual(issues.get(issue.id), saved);
  assert.deepEqual(issues.events(), events);
  assert.deepEqual(issues.counts(), counts);
  for (const iconProgress of [0, 0.5, 0.75, 1, 0.25]) {
    const result = await boss.execute('status-update', { id: custom.id, patch: { iconProgress } });
    assert.equal(result.outcome, 'success', result.message);
    assert.equal(result.status.iconProgress, iconProgress);
  }
  const snapshot = issues.statuses();
  for (const iconProgress of [-0.25, 0.1, 1.25, '1/4', null]) {
    assert.equal((await boss.execute('status-update', { id: custom.id, patch: { name: 'Must not be written', iconProgress } })).code, 'invalid_status');
  }
  assert.equal(issues.statusUpdate('done', { iconProgress: 0.25 }).code, 'invalid_status');
  assert.equal(issues.statusAdd({ name: 'Wrong category', category: 'unstarted', iconProgress: 0.5 }).code, 'invalid_status');
  assert.deepEqual(issues.statuses(), snapshot, 'invalid icon changes leave every field intact');
  assert.deepEqual(issues.get(issue.id), saved, 'icon changes do not touch the workflow, activity or timestamps');
  assert.deepEqual(issues.events(), events);
  assert.deepEqual(issues.counts(), counts);
  const added = await boss.execute('status-add', { fields: { name: 'Quarter filled', category: 'started', iconProgress: 0.25 } });
  assert.equal(added.outcome, 'success');
  assert.equal(added.status.iconProgress, 0.25);
  issues.close();
  const reopened = createIssues({ file });
  t.after(() => reopened.close());
  for (const id of [custom.id, added.status.id]) {
    assert.equal(reopened.statuses().statuses.find((entry: any) => entry.id === id).iconProgress, 0.25);
  }
});

test('custom workflow groups, filters, counts and status order agree across keyset pages', (t) => {
  const { issues, addStatus } = world(t);
  const first = addStatus('Investigating');
  const second = addStatus('Implementing');
  const statuses = [first.id, 'in_review', second.id, 'in_progress'];
  assert.equal(issues.statusOrder('started', statuses).outcome, 'success');
  for (const status of ['todo', first.id, second.id, 'in_review', 'in_progress', first.id]) {
    assert.equal(issues.add({ title: `Work ${status}`, status }).outcome, 'success');
  }
  const grouped = issues.list({ group: 'status' });
  assert.deepEqual(grouped.groups.map((group: any) => group.key), [...statuses, 'todo']);
  assert.equal(grouped.counts.status[first.id], 2);
  assert.equal(issues.counts().active, 6);
  assert.equal(issues.list({ filter: { status: [second.id] } }).total, 1);
  const ordered = issues.list({ order: 'status', limit: 200 }).items;
  const paged: any[] = [];
  let cursor: string | null = null;
  do {
    const next = issues.list({ order: 'status', limit: 2, cursor });
    assert.equal(next.outcome, 'success', next.message);
    paged.push(...next.items);
    cursor = next.nextCursor;
  } while (cursor);
  assert.deepEqual(paged.map((issue) => issue.id), ordered.map((issue: any) => issue.id));
  assert.deepEqual(ordered.map((issue: any) => issue.status), [first.id, first.id, 'in_review', second.id, 'in_progress', 'todo']);
  assert.equal(issues.office().board[0], 6, 'unassigned custom work remains on the whiteboard');
  issues.statusOrder('started', [...statuses].reverse());
  assert.deepEqual(issues.list({ group: 'status' }).groups.map((group: any) => group.key), [...statuses].reverse().concat('todo'));
});

test('custom completed and canceled statuses keep terminal bookkeeping and outcome guards', (t) => {
  const { issues, addStatus } = world(t);
  const done = addStatus('Accepted', 'completed');
  const canceled = addStatus('Declined', 'canceled');
  const issue = issues.add({ title: 'Finish work', ask: 'A real question' }).issue;
  assert.equal(issues.update(issue.id, { status: done.id }, { actor: 'dudu' }).outcome, 'needs_clarification');
  const move = issues.update(issue.id, { status: done.id });
  assert.equal(move.issue.statusType, 'done');
  assert.ok(move.issue.resolvedAt);
  assert.equal(move.issue.ask, '');
  assert.equal(issues.list().total, 0);
  assert.equal(issues.list({ tab: 'all' }).total, 1);
  assert.equal(issues.counts().active, 0);
  const reopened = issues.update(issue.id, { status: 'todo' }).issue;
  assert.equal(reopened.status, 'todo');
  assert.equal(reopened.resolvedAt, null);
  assert.equal(issues.update(issue.id, { status: canceled.id, outcome: 'No longer required' }, { actor: 'dudu' }).issue.statusType, 'canceled');
  assert.equal(issues.counts().byStatus[canceled.id], 1);
  assert.equal(issues.statusUpdate(done.id, { isDefault: true }).code, 'invalid_status');
  const accepted = issues.update(issue.id, { status: done.id, outcome: 'Accepted by boss' }).issue;
  assert.equal(issues.statusRemove(done.id, 'done').outcome, 'success');
  const moved = issues.get(issue.id).issue;
  assert.equal(moved.resolvedAt, accepted.resolvedAt, 'relabeling completed work does not change its completion time');
  assert.equal(moved.outcome, 'Accepted by boss');
});

test('deleting a used status moves issues atomically and retains history', (t) => {
  const { issues, addStatus } = world(t);
  const status = addStatus('Queued', 'unstarted');
  issues.statusUpdate('todo', { isDefault: true });
  const first = issues.add({ title: 'One' }).issue;
  const second = issues.add({ title: 'Two' }).issue;
  const events = issues.events().events.length;
  assert.equal(issues.statusRemove('todo').code, 'status_in_use');
  assert.equal(issues.statusRemove('todo', 'in_review').code, 'invalid_status');
  assert.equal(issues.get(first.id).issue.status, 'todo');
  assert.equal(issues.events().events.length, events);
  const removed = issues.statusRemove('todo', status.id);
  assert.equal(removed.moved, 2);
  assert.equal(issues.get(first.id).issue.status, status.id);
  assert.equal(issues.get(second.id).issue.status, status.id);
  assert.equal(issues.counts().byStatus[status.id], 2);
  const definitions = issues.statuses().statuses;
  assert.equal(definitions.find((entry: any) => entry.id === 'todo').archived, true);
  assert.equal(definitions.find((entry: any) => entry.id === status.id).isDefault, true);
  const move = issues.events({ issueId: first.id }).events[0];
  assert.deepEqual([move.before.status, move.after.status], ['todo', status.id]);
  assert.equal(issues.add({ title: 'Automatic intake', status: 'todo' }, { actor: 'dudu' }).issue.status, status.id);
  assert.equal(issues.update(first.id, { status: 'todo' }, { actor: 'dudu' }).issue.status, status.id);
  assert.equal(issues.statusRemove(status.id, 'todo').code, 'last_status');
});

test('workflow input validation rejects duplicate translated names, invalid order and invalid colors without writes', (t) => {
  const { issues, addStatus } = world(t);
  const custom = addStatus('External dependency');
  for (const name of ['Todo', '待办', 'external dependency']) assert.equal(issues.statusAdd({ name, category: 'started' }).code, 'duplicate_status');
  const snapshot = issues.statuses();
  assert.equal(issues.statusAdd({ name: 'Bad', category: 'unknown' }).code, 'invalid_status');
  assert.equal(issues.statusUpdate(custom.id, { color: '#fff' }).code, 'invalid_status');
  assert.equal(issues.statusUpdate(custom.id, { color: ['#f2994a'] }).code, 'invalid_status');
  assert.equal(issues.statusUpdate(custom.id, { category: 'completed' }).code, 'invalid_status');
  assert.equal(issues.statusOrder('started', ['in_progress', 'in_progress', custom.id]).code, 'invalid_status');
  assert.equal(issues.statusOrder('started', ['in_progress']).code, 'invalid_status');
  assert.equal(issues.statusRemove('missing').code, 'unknown_status');
  assert.equal(issues.statusRemove({}).code, 'unknown_status');
  assert.equal(issues.statusRemove('backlog').code, 'last_status');
  assert.deepEqual(issues.statuses(), snapshot);
});

test('workflow definitions are readable through the standard API but only trusted boss commands can edit them', async (t) => {
  const { issues } = world(t);
  const boss = createIssueCommands({ issues });
  const dudu = createIssueCommands({ issues, actor: 'dudu' });
  const definition = { name: 'Waiting on a colleague', category: 'started' };
  assert.equal((await dudu.execute('statuses')).statuses.length, 6);
  for (const action of ['status-add', 'status-update', 'status-remove', 'status-order']) {
    assert.equal((await dudu.execute(action, { fields: definition, actor: 'owner' })).code, 'owner_only');
  }
  const added = await boss.execute('status-add', { fields: definition, actor: 'dudu' });
  assert.equal(added.outcome, 'success');
  assert.equal((await dudu.execute('update', { id: issues.add({ title: 'Use a custom status' }).issue.id, patch: { status: added.status.id } })).issue.status, added.status.id);
});
