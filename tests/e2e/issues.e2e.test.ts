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

  // The status icon of the row changes the status in place, and says so at the bottom.
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

test('ticked rows change together and Shift ticks a run', async () => {
  const ids = [];
  for (const letter of ['A', 'B', 'C', 'D']) ids.push((await add({ title: `批量 ${letter}`, status: 'todo', priority: 'medium' })).id);
  const page = await dudu.openPanel();
  await rowOf(page, '批量 D').waitFor();

  // Ticking begins in a row's right-click menu (as in the Collector); there is no box until then.
  assert.equal(await page.getByRole('checkbox', { name: 'Select 批量 A', exact: true }).count(), 0);
  await rowOf(page, '批量 A').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select 批量 D', exact: true }).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await bar.getByText('4 selected').waitFor();

  await bar.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'In Progress' }).click();
  await toast(page, 'Updated 4 issues').waitFor();
  assert.deepEqual(await Promise.all(ids.map(async (id) => (await get(id)).status)), Array(4).fill('in_progress'));
  await bar.waitFor({ state: 'detached' });

  // Escape lets go of the ticks.
  await rowOf(page, '批量 B').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
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

test('status, display and nested filter popovers close with a click outside', async () => {
  await add({ title: '弹层关闭验收' });
  const page = await dudu.openPanel();
  const outside = async () => {
    const dashboard = page.getByRole('region', { name: 'Dashboard', exact: true });
    const box = await dashboard.boundingBox();
    assert.ok(box);
    // Wait for a stable click target; a raw mouse event can beat Radix's deferred outside listener on its opening frame.
    await dashboard.click({ position: { x: 30, y: box.height - 30 } });
    await page.locator('.dudu [data-slot="popover-content"]').waitFor({ state: 'hidden' });
  };
  await rowOf(page, '弹层关闭验收').getByRole('button', { name: /Change status/ }).click();
  await page.getByRole('combobox', { name: 'Change status…' }).waitFor();
  await outside();
  await issues(page).getByRole('button', { name: 'Display options' }).click();
  await page.getByText('Display properties', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Grouping', exact: true }).click();
  await page.getByRole('option', { name: 'Agent', exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'Display options', exact: true }).getByText('Grouping', { exact: true }).click();
  await page.getByRole('option', { name: 'Agent', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: 'Display options', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Grouping', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('dialog', { name: 'Display options', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Grouping', exact: true }).click();
  await outside();
  await issues(page).getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('combobox', { name: 'Add filter' }).waitFor();
  await page.getByRole('combobox', { name: 'Status', exact: true }).waitFor();
  const box = await issues(page).boundingBox();
  assert.ok(box);
  await issues(page).click({ position: { x: 30, y: box.height - 30 } });
  await page.waitForFunction(() => !document.querySelector('.dudu [data-slot="popover-content"]'));
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
  await page.getByRole('button', { name: 'New issue in In Progress' }).click();
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
  await lane.getByRole('button', { name: 'New issue in In Progress' }).click();
  await page.getByRole('textbox', { name: 'Issue title' }).fill('从看板列里新建的事');
  await page.getByRole('button', { name: 'Create issue' }).click();
  await lane.getByText('从看板列里新建的事').waitFor();

  await lane.getByRole('button', { name: 'Column options' }).click();
  await page.getByRole('button', { name: 'Collapse column' }).click();
  await lane.getByText('从看板列里新建的事').waitFor({ state: 'detached' });
  await lane.getByRole('button', { name: 'Expand column: In Progress' }).click();
  await lane.getByText('从看板列里新建的事').waitFor();
  await page.close();
});

test('comments preserve an agent question; Done asks how it went; a saved agent and project stay locked', async () => {
  const answered = await add({ title: '要回答的事', status: 'in_review', priority: 'urgent', ask: '第 3 条接受还是回绝？' });
  const page = await dudu.openPanel();

  await titleOf(page, '要回答的事').click();
  const card = page.getByRole('region', { name: 'In Review', exact: true });
  await card.getByText('第 3 条接受还是回绝？').waitFor();
  assert.equal(await page.locator('.dudu textarea').count(), 1);
  await page.getByRole('textbox', { name: 'Leave a comment…' }).fill('接受');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('listitem').getByText('接受', { exact: true }).waitFor();
  const afterReply = await get(answered.id);
  assert.equal(afterReply.ask, '第 3 条接受还是回绝？', 'a plain comment does not answer or send work');
  const { log } = await dudu.api('issues/get', { id: answered.id });
  assert.ok(log.some((entry: { kind: string; text: string }) => entry.kind === 'note' && entry.text === '接受'));

  assert.equal((await get(answered.id)).ref, null);
  assert.equal(await page.getByRole('button', { name: 'Copy ID' }).count(), 0, 'no public reference before choosing a project');
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'No agent' }).click();
  await page.getByRole('option', { name: 'Create project' }).click();
  const project = page.getByRole('dialog', { name: 'Create project' });
  await project.getByRole('textbox', { name: 'Project name' }).fill('Issue checks');
  await project.getByRole('textbox', { name: 'Project folder' }).fill(dudu.folder);
  await project.getByRole('button', { name: 'Create project', exact: true }).click();
  for (const [name, color] of [['Claude', 'rgb(217, 119, 87)'], ['ChatGPT', 'rgb(3, 3, 3)'], ['DeepSeek', 'rgb(77, 107, 254)']]) {
    const icon = page.getByRole('option', { name, exact: true }).locator('[data-agent-logo]');
    await icon.waitFor();
    assert.equal(await icon.evaluate((node) => getComputedStyle(node).color), color, `${name} keeps its brand colour in the agent menu`);
  }
  await page.getByRole('option', { name: 'ChatGPT' }).click();
  await toast(page, 'Assigned to ChatGPT').waitFor();
  const codex = page.getByRole('complementary', { name: 'Properties' }).locator('[data-agent-logo="codex"]');
  assert.equal(await codex.evaluate((node) => getComputedStyle(node).color), 'rgb(3, 3, 3)');
  assert.equal(await codex.locator('rect').count(), 0, 'Codex keeps the same unbacked mark as the other interface logos');
  const composer = page.getByRole('textbox', { name: 'Leave a comment…' });
  await composer.fill('@');
  const mention = page.getByRole('option', { name: '@ChatGPT', exact: true }).locator('[data-agent-logo="codex"]');
  await mention.waitFor();
  assert.equal(await mention.evaluate((node) => getComputedStyle(node).color), 'rgb(3, 3, 3)', 'mention suggestions use the same Codex icon');
  await composer.fill('');
  const assigned = await get(answered.id);
  assert.equal(assigned.agent, 'codex');
  assert.equal(assigned.ref, 'ISS-1');
  const properties = page.getByRole('complementary', { name: 'Properties' });
  const assignedAgent = properties.getByRole('button', { name: /^ChatGPT(?: · Open session)?$/ });
  assert.equal(await assignedAgent.isDisabled(), !assigned.session, 'a saved assignment opens its session when available and never reopens the agent picker');
  assert.equal(await properties.getByRole('button', { name: 'Issue checks', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Copy ID' }).click();
  await toast(page, `Copied ${assigned.ref}`).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), assigned.ref);

  // Marking it Done offers a line for the result, which is kept when it is saved.
  await properties.getByRole('button', { name: /^In (Progress|Review)$/ }).click();
  await page.getByRole('option', { name: 'Done' }).click();
  await toast(page, 'Marked as Done').waitFor();
  await page.getByRole('textbox', { name: 'Add a result…' }).fill('已回复供应商');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => true);
  assert.equal((await get(answered.id)).outcome, '已回复供应商');

  await page.close();
});

test('stepping to the next issue keeps the list; Escape leaves a title as it was; older activity stays after a refresh', async () => {
  const first = await add({ title: '步进 1', status: 'todo', priority: 'urgent' });
  await add({ title: '步进 2', status: 'todo', priority: 'urgent' });
  await add({ title: '步进 3', status: 'todo', priority: 'urgent' });
  const page = await dudu.openPanel();
  await titleOf(page, '步进 1').click();
  const header = page.locator('.dudu header').filter({ has: page.getByRole('button', { name: 'Back to Issues', exact: true }) });
  assert.equal(await header.getByText('Dudu', { exact: true }).count(), 0, 'the redundant brand breadcrumb is gone');
  const position = async () => (await header.innerText()).match(/\d+ \/ \d+/)?.[0];
  const start = await position();
  assert.match(start ?? '', /^\d+ \/ \d+$/);
  // Next twice: the list is still held after the first step (it was lost once, so the arrows and the counter vanished).
  await page.getByRole('button', { name: 'Next issue' }).click();
  await page.getByRole('button', { name: 'Next issue' }).click();
  await page.waitForFunction((from) => !document.body.innerText.includes(from), start ?? '');
  assert.match((await position()) ?? '', /^\d+ \/ \d+$/);
  await page.getByRole('button', { name: 'Previous issue' }).click();

  // Escape in the title box is a cancel, not a save.
  await page.getByRole('button', { name: 'Back to Issues' }).click();
  await titleOf(page, '步进 1').click();
  await page.getByRole('button', { name: 'Untitled', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Untitled' });
  await title.fill('改了一半的标题');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Untitled', exact: true }).waitFor();
  assert.equal((await get(first.id)).title, '步进 1');

  // A long activity: older entries that were asked for stay after the page refreshes itself (every five seconds).
  const long = await add({ title: '记录很长的事', status: 'todo', priority: 'low' });
  for (let n = 1; n <= 60; n++) await dudu.api('issues/log', { id: long.id, kind: 'note', text: `第 ${n} 条记录` });
  await page.getByRole('button', { name: 'Back to Issues' }).click();
  await titleOf(page, '记录很长的事').click();
  await page.getByRole('button', { name: 'Load earlier' }).click();
  await page.getByText('第 1 条记录', { exact: true }).waitFor();
  await page.waitForTimeout(6500);
  await page.getByText('第 1 条记录', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Load earlier' }).count(), 0, 'nothing older is left to load');
  await page.close();
});

test('a draft agent can change before the issue is created', async () => {
  await dudu.api('projects/create', { name: 'Draft selection', path: process.cwd() });
  const page = await dudu.openPanel();
  await issues(page).getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
  // The project comes first and the agent only once there is one: no box that chooses both (owner, 2026-11-06)
  assert.equal(await dialog.getByRole('button', { name: 'No agent', exact: true }).count(), 0, 'no agent to choose until there is a project');
  await dialog.getByRole('button', { name: 'Choose a project', exact: true }).click();
  await page.getByRole('option', { name: /Draft selection/ }).click();
  await dialog.getByRole('button', { name: 'No agent', exact: true }).click();
  assert.equal(await page.locator('[data-slot="popover-content"]').getByText('Draft selection').count(), 0, 'and its list holds agents only, no project to switch to');
  await page.getByRole('option', { name: 'Claude', exact: true }).click();
  await dialog.getByRole('button', { name: 'Claude', exact: true }).click();
  await page.getByRole('option', { name: 'ChatGPT', exact: true }).click();
  await dialog.getByRole('button', { name: 'ChatGPT', exact: true }).click();
  await page.getByRole('option', { name: 'No agent', exact: true }).click();
  await dialog.getByRole('button', { name: 'No agent', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
