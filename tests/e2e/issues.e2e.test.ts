// The Issues widget in the real thing: the packaged plugin inside `dsh web`, driven in Chrome (see harness.mjs). Run: npm run test:e2e
// One DSH serves the whole file, so each test makes the issues it needs under titles of its own and looks only at those.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => { dudu = await startDudu(); });
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

const DAY = 86400000;
const noon = (days = 0) => { const date = new Date(); date.setHours(12, 0, 0, 0); return date.getTime() + days * DAY; };
const issues = (page: Page) => page.getByRole('region', { name: 'Issues' });
const rowOf = (page: Page, title: string) => issues(page).getByRole('listitem').filter({ hasText: title });
const titleOf = (page: Page, title: string) => rowOf(page, title).getByRole('button', { name: title, exact: true });
// A toast is announced twice (the bar and a hidden line for screen readers): either one will do.
const toast = (page: Page, text: string) => page.getByText(text, { exact: true }).first();
const add = async (fields: Record<string, unknown>) => (await dudu.api('issues/add', { fields })).issue as { id: number };
const get = async (id: number) => (await dudu.api('issues/get', { id })).issue;

test('an issue made in the New issue window shows in Active, opens on its own page and can be changed there', async () => {
  const page = await dudu.openPanel();
  await issues(page).getByText('No issues').waitFor();

  await issues(page).getByRole('button', { name: 'New issue' }).click();
  await page.getByRole('textbox', { name: 'Issue title' }).fill('回复供应商合同的修改意见');
  await page.getByRole('button', { name: 'Create issue' }).click();
  await rowOf(page, '回复供应商合同的修改意见').waitFor();

  // The status icon of the row changes the status in place, and says so at the bottom with Undo.
  await rowOf(page, '回复供应商合同的修改意见').getByRole('button', { name: /Change status/ }).click();
  await page.getByRole('option', { name: 'In Progress' }).click();
  await rowOf(page, '回复供应商合同的修改意见').getByRole('button', { name: /^In Progress\./ }).waitFor();
  await toast(page, 'Status set to In Progress').waitFor();

  // Its own page: the id, the properties, and a priority set there is what the store has afterwards.
  await titleOf(page, '回复供应商合同的修改意见').click();
  await page.getByRole('button', { name: 'No priority' }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await page.getByRole('button', { name: 'High' }).waitFor();
  const { items } = await dudu.api('issues/list', { tab: 'active' });
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'in_progress');
  assert.equal(items[0].priority, 'high');
  await page.close();
});

test('ticked rows change together, Shift ticks a run, and Undo puts every one back', async () => {
  const ids = [];
  for (const letter of ['A', 'B', 'C', 'D']) ids.push((await add({ title: `批量 ${letter}`, status: 'todo', priority: 'medium' })).id);
  const page = await dudu.openPanel();
  await rowOf(page, '批量 D').waitFor();

  await page.getByRole('checkbox', { name: 'Select 批量 A' }).click();
  await page.getByRole('checkbox', { name: 'Select 批量 D' }).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await bar.getByText('4 selected').waitFor();

  await bar.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'In Progress' }).click();
  await toast(page, 'Updated 4 issues').waitFor();
  assert.deepEqual(await Promise.all(ids.map(async (id) => (await get(id)).status)), Array(4).fill('in_progress'));
  await bar.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Undo' }).click();
  await rowOf(page, '批量 A').getByRole('button', { name: /^Todo\./ }).waitFor();
  assert.deepEqual(await Promise.all(ids.map(async (id) => (await get(id)).status)), Array(4).fill('todo'));

  // Escape lets go of the ticks.
  await page.getByRole('checkbox', { name: 'Select 批量 B' }).click();
  await bar.getByText('1 selected').waitFor();
  await page.keyboard.press('Escape');
  await bar.waitFor({ state: 'detached' });
  await page.close();
});

test('the Dates filter keeps the issues in range and its chip takes it off', async () => {
  await add({ title: '逾期的事', priority: 'low', dueAt: noon(-1) });
  await add({ title: '今天的事', priority: 'low', dueAt: noon(0) });
  await add({ title: '下周的事', priority: 'low', dueAt: noon(5) });
  await add({ title: '没有日期的事', priority: 'low' });
  const page = await dudu.openPanel();
  for (const title of ['逾期的事', '今天的事', '下周的事', '没有日期的事']) await rowOf(page, title).waitFor();

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('option', { name: 'Dates' }).click();
  await page.getByRole('option', { name: 'Overdue' }).click();
  await rowOf(page, '逾期的事').waitFor();
  await rowOf(page, '今天的事').waitFor({ state: 'detached' });
  await rowOf(page, '没有日期的事').waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Remove filter: Due date' }).click();
  await rowOf(page, '今天的事').waitFor();

  // A date field holds one choice: ticking another range replaces it.
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('option', { name: 'Dates' }).click();
  await page.getByRole('option', { name: 'Next 7 days' }).click();
  await rowOf(page, '下周的事').waitFor();
  await rowOf(page, '逾期的事').waitFor({ state: 'detached' });
  await page.getByRole('option', { name: 'Today' }).click();
  await rowOf(page, '今天的事').waitFor();
  await rowOf(page, '下周的事').waitFor({ state: 'detached' });
  await page.close();
});

test('All issues finds Chinese words and writes the total in its footer', async () => {
  await add({ title: '合同归档', priority: 'low' });
  await add({ title: '另一份合同的备注', priority: 'low' });
  await add({ title: '不相干的整理', priority: 'low' });
  const page = await dudu.openPanel();
  await page.getByRole('tab', { name: 'All issues' }).click();
  await rowOf(page, '不相干的整理').waitFor();
  const everything = (await dudu.api('issues/counts')).total as number;
  await issues(page).getByText(`${everything} issues`).waitFor();

  await page.getByRole('searchbox', { name: 'Search issues' }).fill('合同');
  await rowOf(page, '合同归档').waitFor();
  await rowOf(page, '另一份合同的备注').waitFor();
  await rowOf(page, '不相干的整理').waitFor({ state: 'detached' });
  const found = (await dudu.api('issues/search', { q: '合同' })).total as number;
  await issues(page).getByText(found === 1 ? '1 issue' : `${found} issues`).waitFor();
  await page.close();
});

test('a group bar and a board column add an issue to their own group, and a column folds', async () => {
  await add({ title: '分组里已有的事', status: 'in_progress', priority: 'none' });
  const page = await dudu.openPanel();
  await rowOf(page, '分组里已有的事').waitFor();

  await page.getByRole('button', { name: 'Display options' }).click();
  await page.getByRole('combobox', { name: 'Grouping', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('button', { name: 'Display options' }).click(); // closes it again
  await page.getByRole('button', { name: 'Add issue to In Progress' }).click();
  await page.getByRole('textbox', { name: 'Issue title' }).fill('从分组条里新建的事');
  await page.getByRole('button', { name: 'Create issue' }).click();
  await rowOf(page, '从分组条里新建的事').waitFor();
  const made = (await dudu.api('issues/search', { q: '分组条' })).items[0];
  assert.equal(made.status, 'in_progress');

  await page.getByRole('button', { name: 'Display options' }).click();
  await page.getByRole('button', { name: 'Board' }).click();
  await page.getByRole('button', { name: 'Display options' }).click();
  const lane = page.getByRole('region', { name: 'In Progress' });
  await lane.getByText('从分组条里新建的事').waitFor();
  await lane.getByRole('button', { name: 'Add issue to In Progress' }).click();
  await page.getByRole('textbox', { name: 'Issue title' }).fill('从看板列里新建的事');
  await page.getByRole('button', { name: 'Create issue' }).click();
  await lane.getByText('从看板列里新建的事').waitFor();

  await lane.getByRole('button', { name: 'In Progress options' }).click();
  await page.getByRole('button', { name: 'Collapse column' }).click();
  await lane.getByText('从看板列里新建的事').waitFor({ state: 'detached' });
  await lane.getByRole('button', { name: 'Expand column: In Progress' }).click();
  await lane.getByText('从看板列里新建的事').waitFor();
  await page.close();
});

test('an agent\'s question is answered on the issue page; Snooze hides it; Done asks how it went; the agent changes in the menu', async () => {
  const answered = await add({ title: '要回答的事', status: 'in_progress', priority: 'urgent', agent: 'claude', ask: '第 3 条接受还是回绝？' });
  const snoozed = await add({ title: '要推迟的事', status: 'in_progress', priority: 'urgent', agent: 'claude', ask: '要不要同时升级 npm？' });
  const page = await dudu.openPanel();

  await titleOf(page, '要回答的事').click();
  const card = page.getByRole('region', { name: 'Needs you' });
  await card.getByText('第 3 条接受还是回绝？').waitFor();
  await card.getByRole('textbox', { name: 'Reply…' }).fill('接受');
  await page.keyboard.press('Control+Enter');
  await card.waitFor({ state: 'detached' });
  await page.getByText('接受', { exact: true }).waitFor();
  const afterReply = await get(answered.id);
  assert.equal(afterReply.ask, '');
  const { log } = await dudu.api('issues/get', { id: answered.id });
  assert.ok(log.some((entry: { kind: string; text: string }) => entry.kind === 'decision' && entry.text === '接受'));

  // Copy ID puts DUDU-n on the clipboard; the agent menu changes the agent and says what it did.
  await page.getByRole('button', { name: 'Copy ID' }).click();
  await toast(page, `Copied DUDU-${answered.id}`).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `DUDU-${answered.id}`);
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: /Claude/ }).click();
  await page.getByRole('option', { name: 'ChatGPT' }).click();
  await toast(page, 'Assigned to ChatGPT').waitFor();
  assert.equal((await get(answered.id)).agent, 'codex');

  // Marking it Done offers a line for the result, which is kept when it is saved.
  await page.getByRole('button', { name: 'In Progress', exact: true }).click();
  await page.getByRole('option', { name: 'Done' }).click();
  await toast(page, 'Marked as Done').waitFor();
  await page.getByRole('textbox', { name: 'Add a result…' }).fill('已回复供应商');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => true);
  assert.equal((await get(answered.id)).outcome, '已回复供应商');

  // Another issue: Snooze takes its question away until the time chosen.
  await page.getByRole('button', { name: 'Back to Issues' }).click();
  await titleOf(page, '要推迟的事').click();
  await page.getByRole('region', { name: 'Needs you' }).waitFor();
  await page.getByRole('button', { name: 'Snooze', exact: true }).click();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await toast(page, 'Snoozed').waitFor();
  await page.getByRole('region', { name: 'Needs you' }).waitFor({ state: 'detached' });
  const asleep = await get(snoozed.id);
  assert.ok(asleep.snoozeUntil > Date.now());
  assert.equal(asleep.agentState, 'idle');
  await page.close();
});
