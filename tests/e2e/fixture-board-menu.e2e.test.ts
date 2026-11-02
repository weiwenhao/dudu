import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';

let fixture: Awaited<ReturnType<typeof startFixture>>;
let current: Page;
before(async () => {
  fixture = await startFixture({ handlers: {
    'projects/list': () => ({ outcome: 'success', projects: [{ id: 'work', name: 'Work', path: '/work' }] }),
    'projects/create': ({ name, path }: { name: string; path: string }) => ({ outcome: 'success', project: { name, path } }),
  } });
});
after(async () => { await fixture?.stop(); });
afterEach(async (context) => {
  if (context.passed !== false || !current || current.isClosed()) return;
  await mkdir('.local/board-menu-nov02', { recursive: true });
  await current.screenshot({ path: '.local/board-menu-nov02/failed.png' });
  console.log(await current.locator('body').ariaSnapshot());
});

const card = (page: Page, title: string) => page.getByRole('article', { name: title, exact: true });
const context = (page: Page) => page.locator('[data-slot="context-menu-content"]');
const submenu = (page: Page) => page.locator('[data-slot="context-menu-sub-content"]');
const get = (id: number) => fixture.issues.get(id).issue;

async function board() {
  const page = current = await fixture.open();
  await page.getByRole('button', { name: 'Display options', exact: true }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.keyboard.press('Escape');
  return page;
}

test('a card context menu searches its property submenu, saves one issue and closes outside without opening the issue', async () => {
  const { issue } = fixture.issues.add({ title: 'Context menu card', project: { name: 'Work', path: '/work' } });
  const { issue: untouched } = fixture.issues.add({ title: 'Unchanged card' });
  const page = await board();
  await card(page, issue.title).click({ button: 'right' });
  await context(page).getByRole('menuitem', { name: /^Status/ }).hover();
  const search = submenu(page).getByRole('combobox', { name: 'Change status…', exact: true });
  await submenu(page).getByRole('option', { name: /^Todo/ }).waitFor();
  assert.equal(await submenu(page).getByRole('option', { name: /^Todo/ }).getAttribute('data-selected'), 'true');
  await search.fill('review');
  await mkdir('.local/board-menu-nov02', { recursive: true });
  await page.screenshot({ path: '.local/board-menu-nov02/status.png' });
  await search.press('Enter');
  await context(page).waitFor({ state: 'hidden' });
  assert.equal(get(issue.id).status, 'in_review');
  assert.equal(get(untouched.id).status, 'todo');
  assert.equal(await page.getByRole('button', { name: 'Back to Issues', exact: true }).count(), 0);
  assert.equal(await page.getByRole('toolbar', { name: 'Bulk actions', exact: true }).count(), 0);

  await card(page, issue.title).click({ button: 'right' });
  await context(page).getByRole('menuitem', { name: /^Priority/ }).hover();
  await submenu(page).getByRole('option', { name: /^High/ }).waitFor();
  const heading = await page.locator('section > header h2').boundingBox();
  assert.ok(heading);
  await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
  await context(page).waitFor({ state: 'hidden' });
  await submenu(page).waitFor({ state: 'hidden' });
  await page.context().close();
});

test('card shortcuts edit priority and date, and assignment chooses a project before the agent then locks both', async () => {
  const { issue } = fixture.issues.add({ title: 'Card shortcuts and assignment' });
  const page = await board();
  await card(page, issue.title).hover();
  await page.keyboard.press('p');
  await page.getByRole('combobox', { name: 'Set priority…', exact: true }).waitFor();
  await page.keyboard.press('2');
  await page.getByRole('combobox', { name: 'Set priority…', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(get(issue.id).priority, 'high');

  await card(page, issue.title).hover();
  await page.keyboard.press('Shift+D');
  const calendar = page.getByRole('dialog', { name: 'Due date', exact: true });
  await calendar.locator('[data-day] button').nth(10).click();
  await calendar.waitFor({ state: 'hidden' });
  assert.ok(get(issue.id).dueAt);

  await card(page, issue.title).click({ button: 'right' });
  await context(page).getByRole('menuitem', { name: /^Agent/ }).hover();
  await submenu(page).getByRole('combobox', { name: 'Choose a project', exact: true }).waitFor();
  assert.equal(await submenu(page).getByRole('option', { name: 'ChatGPT', exact: true }).count(), 0);
  await submenu(page).getByRole('option', { name: /^Work/ }).click();
  await submenu(page).getByRole('option', { name: 'ChatGPT', exact: true }).click();
  await context(page).waitFor({ state: 'hidden' });
  await card(page, issue.title).locator('[data-agent-logo="codex"]').waitFor();
  assert.equal(get(issue.id).agent, 'codex');
  assert.equal(get(issue.id).project.path, '/work');
  await page.keyboard.press('a');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole('combobox', { name: 'Set agent…', exact: true }).count(), 0);
  await page.keyboard.press('Shift+P');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole('combobox', { name: 'Choose a project', exact: true }).count(), 0);
  await card(page, issue.title).click({ button: 'right' });
  assert.equal(await context(page).getByRole('menuitem', { name: /^Agent/ }).getAttribute('aria-disabled'), 'true');
  assert.equal(await context(page).getByRole('menuitem', { name: /^Project/ }).getAttribute('aria-disabled'), 'true');
  await page.keyboard.press('Escape');
  await context(page).waitFor({ state: 'hidden' });
  await page.context().close();
});

test('card deletion uses the existing confirmation and card background opens the issue', async () => {
  const { issue } = fixture.issues.add({ title: 'Delete just this card', project: { name: 'Work', path: '/work' } });
  const page = await board();
  await card(page, issue.title).hover();
  await page.keyboard.press('ControlOrMeta+Backspace');
  const dialog = page.getByRole('dialog', { name: 'This will be deleted', exact: true });
  await dialog.getByText(issue.title, { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(get(issue.id));
  await card(page, issue.title).click({ button: 'right' });
  await context(page).getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await card(page, issue.title).waitFor({ state: 'hidden' });
  assert.equal(fixture.issues.get(issue.id).outcome, 'error');
  const other = card(page, 'Unchanged card');
  await other.click({ position: { x: 8, y: 8 } });
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  await page.context().close();
});

test('list rows use the same single-issue context menu and shortcuts without changing other selected rows', async () => {
  const { issue } = fixture.issues.add({ title: 'List context menu', project: { name: 'Work', path: '/work' } });
  const { issue: untouched } = fixture.issues.add({ title: 'Selected but unchanged' });
  const page = current = await fixture.open();
  await page.getByRole('checkbox', { name: `Select ${untouched.title}`, exact: true }).click({ force: true });
  const row = page.locator(`[data-issue-row="${issue.id}"]`);
  await row.click({ button: 'right' });
  await context(page).getByRole('menuitem', { name: /^Priority/ }).hover();
  await submenu(page).getByRole('option', { name: /^High/ }).click();
  await context(page).waitFor({ state: 'hidden' });
  assert.equal(get(issue.id).priority, 'high');
  assert.equal(get(untouched.id).priority, 'none');
  assert.equal(await page.getByRole('button', { name: 'Back to Issues', exact: true }).count(), 0);
  await row.hover();
  await page.keyboard.press('s');
  const status = page.getByRole('combobox', { name: 'Change status…', exact: true });
  await status.fill('review');
  await status.press('Enter');
  await status.waitFor({ state: 'hidden' });
  assert.equal(get(issue.id).status, 'in_review');
  await row.click({ button: 'right' });
  await context(page).getByRole('menuitem', { name: /^Project/ }).hover();
  await submenu(page).getByRole('combobox', { name: 'Choose a project', exact: true }).waitFor();
  const heading = await page.locator('section > header h2').boundingBox();
  assert.ok(heading);
  await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
  await context(page).waitFor({ state: 'hidden' });
  await submenu(page).waitFor({ state: 'hidden' });
  await page.context().close();
});
