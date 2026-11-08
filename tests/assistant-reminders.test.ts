import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { reminders } from '../host/assistant/home/reminders.mjs';

const NOON = new Date(2026, 10, 1, 12, 0, 0).getTime();
const DAY = 86_400_000;

function world(sessions: Record<string, string> = {}) {
  const issues = createIssues({ file: ':memory:', now: () => NOON, sessionState: (session: string) => sessions[session] ?? null });
  const add = (fields: any) => (issues.add({ status: 'in_progress', project: { name: 'app', path: '/work/app' }, ...fields }) as any).issue;
  return { issues, add };
}

test('a question waiting for the owner is the first reminder, in the words of the question', () => {
  const { issues, add } = world();
  const issue = add({ title: '迁移账单表', agent: 'claude', ask: '用 Postgres 还是 MySQL？' });
  const [first, ...rest] = reminders(issues, NOON);
  assert.equal(rest.length, 0);
  assert.equal(first.kind, 'needs_you');
  assert.equal(first.id, issue.id);
  assert.equal(first.text, '用 Postgres 还是 MySQL？');
  assert.equal(first.agent, 'claude');
  issues.close();
});

test('a session that waits without a question reads as the issue title', () => {
  const { issues, add } = world({ 'dsh:a': 'waiting_owner' });
  add({ title: '重写 provider 插件', agent: 'codex', session: 'dsh:a' });
  assert.deepEqual(reminders(issues, NOON).map(({ kind, text }) => [kind, text]), [['blocked', '重写 provider 插件']]);
  issues.close();
});

test('In Review work is available for intervention even without an explicit question', () => {
  const { issues, add } = world();
  const issue = add({ title: '中断的工作', status: 'in_review', agent: 'codex', session: 'dsh:stopped' });
  assert.deepEqual(reminders(issues, NOON).map(({ id, kind, text }) => [id, kind, text]), [[issue.id, 'needs_you', issue.title]]);
  issues.close();
});

test('working sessions cannot produce stale review reminders while workflow catches up', () => {
  const { issues, add } = world({ 'dsh:resumed': 'running' });
  const issue = add({ title: '已继续工作', status: 'in_review', agent: 'codex', session: 'dsh:resumed', ask: '旧的待审核问题' });
  assert.deepEqual(reminders(issues, NOON), []);
  issues.update(issue.id, { dueAt: NOON - DAY });
  assert.deepEqual(reminders(issues, NOON).map(({ kind }) => kind), ['overdue'], 'a due-date reminder remains independent of review');
  issues.close();
});

test('a due date before today is overdue by whole calendar days; today and a snoozed issue are not', () => {
  const { issues, add } = world();
  add({ title: '昨天到期', dueAt: NOON - DAY });
  add({ title: '三天前到期', dueAt: NOON - 3 * DAY });
  add({ title: '今天到期', dueAt: NOON - 1000 });
  const snoozed = add({ title: '推迟了的', dueAt: NOON - 2 * DAY });
  issues.snooze(snoozed.id, NOON + DAY);
  const found = reminders(issues, NOON);
  assert.deepEqual(found.map(({ kind, title, daysLate }) => [kind, title, daysLate]), [['overdue', '三天前到期', 3], ['overdue', '昨天到期', 1]], 'the longest overdue first');
  issues.close();
});

test('blocked sessions still give reminders before workflow synchronization, after due reminders', () => {
  const { issues, add } = world({ 'dsh:bad': 'error', 'dsh:ask': 'waiting_owner' });
  add({ title: '卡住的', agent: 'codex', session: 'dsh:bad' });
  add({ title: '逾期的', dueAt: NOON - DAY });
  add({ title: '在等的', agent: 'claude', session: 'dsh:ask' });
  assert.deepEqual(reminders(issues, NOON).map(({ kind }) => kind), ['overdue', 'blocked', 'blocked']);
  issues.close();
});

test('one issue is one reminder: the question comes first, though it is overdue too', () => {
  const { issues, add } = world();
  add({ title: '又问又逾期', ask: '先做哪个？', dueAt: NOON - DAY });
  assert.deepEqual(reminders(issues, NOON).map(({ kind }) => kind), ['needs_you']);
  issues.close();
});

test('the key changes with the state, not with the day or an unrelated edit', () => {
  const { issues, add } = world();
  const late = add({ title: '逾期', dueAt: NOON - DAY });
  const asked = add({ title: '提问', agent: 'claude', ask: '第一个问题' });
  const first = Object.fromEntries(reminders(issues, NOON).map((item) => [item.id, item.key]));
  const tomorrow = Object.fromEntries(reminders(issues, NOON + DAY).map((item) => [item.id, item.key]));
  assert.equal(tomorrow[late.id], first[late.id], 'one more day late is the same reminder');
  issues.update(asked.id, { brief: '补充说明' });
  assert.equal(reminders(issues, NOON).find((item) => item.id === asked.id)!.key, first[asked.id], 'an edit that is not the question');
  issues.update(asked.id, { ask: '第二个问题' });
  assert.notEqual(reminders(issues, NOON).find((item) => item.id === asked.id)!.key, first[asked.id], 'a new question');
  issues.update(late.id, { dueAt: NOON - 2 * DAY });
  assert.notEqual(reminders(issues, NOON).find((item) => item.id === late.id)!.key, first[late.id], 'a new due date');
  issues.close();
});

test('finished issues and issues without trouble give nothing', () => {
  const { issues, add } = world();
  add({ title: '平常的' });
  const done = add({ title: '做完了', ask: '问题' , dueAt: NOON - DAY });
  issues.complete(done.id, { outcome: '完成' });
  assert.deepEqual(reminders(issues, NOON), []);
  issues.close();
});
