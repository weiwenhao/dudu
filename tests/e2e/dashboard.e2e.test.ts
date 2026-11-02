// The dashboard in the real thing (gridstack in the packaged plugin, inside `dsh web`, in Chrome): the grid, editing, saving, Undo.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import type { Locator, Page } from 'playwright-core';
import { panelAction, startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => { dudu = await startDudu(); });
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

// A toast is announced twice (the bar and a hidden line for screen readers): either one will do.
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();
const item = (page: Page, name: string) => page.locator('.grid-stack-item').filter({ has: page.getByRole('region', { name }) });
const issuesItem = (page: Page) => page.locator('.grid-stack-item').first();
const cells = async (locator: Locator) => ({ x: Number(await locator.getAttribute('gs-x')), y: Number(await locator.getAttribute('gs-y')), w: Number(await locator.getAttribute('gs-w')), h: Number(await locator.getAttribute('gs-h')) });
const saved = async () => (await dudu.api('dashboard/get')).layout.widgets[0] as { type: string; x: number; y: number; w: number | string; h: number };
const edit = (page: Page) => panelAction(page, 'Edit layout');

/** Run in the page: the rows its height holds (a whole number of rows of `--db-row`, which share the height exactly), the rows Issues has, and what the page scrolls. */
const gridRows = () => {
  const scroller = document.querySelector('.db-page') as HTMLElement;
  const style = getComputedStyle(scroller);
  const room = scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const pitch = parseFloat(getComputedStyle(document.querySelector('.db-wrap') as HTMLElement).getPropertyValue('--db-row')) + 12;
  return { held: Math.round((room + 12) / pitch), issues: Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-h')), overflow: scroller.scrollHeight - scroller.clientHeight };
};
/** The grid once Issues has the rows the window holds (it follows the window a moment after the window changes). */
async function onScreen(page: Page) {
  let now = await page.evaluate(gridRows);
  for (let tries = 0; tries < 50 && now.held !== now.issues; tries++) {
    await page.waitForTimeout(100);
    now = await page.evaluate(gridRows);
  }
  return now;
}

/** Pulls the middle of a widget's east edge by `dx` pixels with the real mouse, in small steps, and lets go. */
async function pullEast(page: Page, dx: number, { hold = false } = {}) {
  const handle = await issuesItem(page).locator('.ui-resizable-e').boundingBox();
  assert.ok(handle);
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 6 });
  await page.mouse.move(x + dx, y, { steps: 6 });
  if (!hold) await page.mouse.up();
}

test('the first dashboard has fifteen columns and every row the window shows, and its cells scale with the window', async () => {
  const page = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await page.getByRole('region', { name: 'Issues' }).waitFor();
  const wide = await cells(issuesItem(page));
  assert.deepEqual([wide.x, wide.y, wide.w], [0, 0, 15]);
  const screen = await onScreen(page);
  assert.equal(screen.issues, screen.held, 'every row the window shows');
  assert.ok(screen.overflow <= 0, 'one screen: there is nothing to scroll');
  const widePixels = (await issuesItem(page).boundingBox())!.width;
  const stored = await saved();
  assert.deepEqual([stored.type, stored.w, stored.h], ['issues', 'fill', 'fill'], 'nothing is written until the first change, and the default says "all the columns" and "all the rows"');

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForFunction((before) => (document.querySelector('.grid-stack-item')?.getBoundingClientRect().width ?? before) < before, widePixels);
  const narrow = await cells(issuesItem(page));
  assert.deepEqual([narrow.x, narrow.y, narrow.w], [0, 0, 15], 'the columns keep their number while the cells shrink');
  const smaller = await onScreen(page);
  assert.equal(smaller.issues, smaller.held, 'and the rows are those a window of smaller cells holds');
  assert.ok(smaller.overflow <= 0 && smaller.held > screen.held);
  const narrowPixels = (await issuesItem(page).boundingBox())!.width;
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.waitForFunction((before) => (document.querySelector('.grid-stack-item')?.getBoundingClientRect().width ?? before) > before, narrowPixels);
  assert.equal((await cells(issuesItem(page))).w, 15);
  const larger = await onScreen(page);
  assert.ok(larger.issues === larger.held && larger.overflow <= 0 && larger.held < smaller.held);
  await page.close();
});

test('pulling an edge resizes the widget, names the size beside the pointer, saves it, and Undo brings the old size back', async () => {
  const page = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await edit(page);
  const before = await cells(issuesItem(page));

  await pullEast(page, -300, { hold: true });
  await page.locator('.db-chip').waitFor();
  assert.match(await page.locator('.db-chip').innerText(), new RegExp(`^\\d+×${before.h}$`));
  await page.mouse.up();
  await toast(page, 'Issues」resized to').waitFor();
  const after = await cells(issuesItem(page));
  assert.ok(after.w < before.w && after.w >= 8, `${before.w} -> ${after.w} columns`);
  const stored = await saved();
  assert.deepEqual([stored.w, stored.h], [after.w, before.h], 'saved as numbers of cells: it no longer follows the window, in either direction');
  assert.equal(await page.locator('.db-chip').count(), 0);

  // The layout is the plugin's, not the page's: a new page finds it.
  const again = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await again.waitForFunction((w) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) === w, after.w);
  await again.close();

  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction((w) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) === w, before.w);
  assert.equal((await saved()).w, 'fill');
  await page.close();
});

test('a pull past the smallest size stops there and says so', async () => {
  const page = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await edit(page);
  await pullEast(page, -2000, { hold: true });
  await page.locator('.db-chip').filter({ hasText: 'Minimum size' }).waitFor();
  await page.mouse.up();
  assert.equal((await cells(issuesItem(page))).w, 6, 'Issues is never narrower than six columns');
  await page.getByRole('button', { name: 'Restore default' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) > 6);
  assert.equal((await saved()).w, 'fill');
  await toast(page, 'Restored default').waitFor();
  await page.close();
});

test('the keyboard moves, resizes and removes a widget in edit mode, and Escape leaves it', async () => {
  const page = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await edit(page);
  const before = await cells(issuesItem(page));
  await page.getByRole('group', { name: 'Issues' }).or(page.locator('.db-card').first()).first().focus();

  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForFunction((w) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) === w, before.w - 1);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-y')) === 1);
  const stored = await saved();
  assert.deepEqual([stored.w, stored.y], [before.w - 1, 1]);

  await page.keyboard.press('Delete');
  await page.locator('.grid-stack-item').waitFor({ state: 'detached' });
  await toast(page, 'Removed「Issues」').waitFor();
  assert.equal((await dudu.api('dashboard/get')).layout.widgets.length, 0);
  await page.getByRole('button', { name: 'Undo' }).last().click(); // the bar holds the last few changes; the newest is the last
  await page.locator('.grid-stack-item').waitFor();
  assert.equal((await dudu.api('dashboard/get')).layout.widgets.length, 1);

  await page.keyboard.press('Escape');
  await page.getByRole('toolbar', { name: 'Edit layout' }).waitFor({ state: 'hidden' });
  await page.close();
});

test('each change has its own bar with Undo for the newest change only, and a key typed inside a widget is not for the layout', async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await edit(page);
  const before = await cells(issuesItem(page));
  await page.locator('.db-card').first().focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForFunction((w) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) === w, before.w - 1);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-y')) === 1);
  await toast(page, 'Moved「Issues」').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Undo' }).count(), 1, 'the plugin keeps one change to undo, so only one bar offers it');
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-y')) === 0);
  assert.equal((await cells(issuesItem(page))).w, before.w - 1, 'only the newest change was undone');

  // In edit mode the widget's own controls are out of reach, so typing in one cannot move or remove the widget.
  const focused = await page.evaluate(() => { const box = document.querySelector('.db-surface input, .db-surface textarea, .db-surface button') as HTMLElement | null; box?.focus(); return document.activeElement === box; });
  assert.equal(focused, false);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.grid-stack-item').count(), 1);
  await page.close();
});

test('Add widget lists only the three designed built-ins and marks the ones on the dashboard', async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await edit(page);
  await page.getByRole('button', { name: 'Add widget' }).click();
  const list = page.getByRole('dialog', { name: 'Add widget' });
  await list.getByRole('searchbox', { name: 'Search widgets', exact: true }).waitFor();
  assert.deepEqual(await list.getByRole('option').evaluateAll((options) => options.map((item) => item.getAttribute('aria-label'))), ['Issues', 'Quota', 'Office']);
  await list.getByRole('button', { name: 'Add Quota', exact: true }).waitFor();
  await list.getByRole('option', { name: 'Office', exact: true }).click();
  await list.getByRole('button', { name: 'Add Office', exact: true }).waitFor();
  await list.locator('[data-widget-preview="office"] [data-office-stage][data-mode]').waitFor();
  assert.equal((await dudu.api('dashboard/get')).layout.widgets.length, 1, 'choosing a preview does not add it');
  const box = await list.boundingBox();
  assert.ok(box && Math.abs(box.width - 880) < 2 && Math.abs(box.height - 560) < 2, 'the desktop gallery uses the design dimensions');
  await list.getByRole('option', { name: 'Issues', exact: true }).click();
  assert.equal(await list.getByRole('button', { name: 'Added', exact: true }).isDisabled(), true, 'an existing widget is previewable but cannot be added twice');
  await list.getByRole('searchbox').fill('subscription');
  assert.equal(await list.getByRole('option').count(), 1, 'search includes the description');
  await list.getByRole('button', { name: 'Add Quota', exact: true }).waitFor();
  for (const name of ['Overview', 'Upcoming', 'Stuck', 'Inputs', 'Sessions']) {
    assert.equal(await list.getByText(name, { exact: true }).count(), 0, name);
  }
  await list.getByRole('searchbox').fill('');
  await list.getByRole('searchbox').press('ArrowDown');
  await page.keyboard.press('End');
  assert.equal(await list.getByRole('option', { name: 'Office', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'hidden' });
  await page.getByRole('toolbar', { name: 'Edit layout', exact: true }).waitFor();
  await page.close();
});

test('an add notification leaves Add widget clickable, Undo affects only the latest addition, and the notification expires', async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await edit(page);
  const add = page.getByRole('button', { name: 'Add widget', exact: true });
  await add.click();
  await page.getByRole('option', { name: 'Quota', exact: true }).click();
  await page.getByRole('button', { name: 'Add Quota', exact: true }).click();
  await toast(page, 'Added「Quota」').waitFor();
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const [bar, button] = [await undo.boundingBox(), await add.boundingBox()];
  assert.ok(bar && button && bar.y + bar.height < button.y, 'the notification sits above the editing toolbar');
  await add.click({ timeout: 5000 });
  await page.getByRole('option', { name: 'Office', exact: true }).click();
  await page.getByRole('button', { name: 'Add Office', exact: true }).click();
  await page.getByRole('region', { name: 'Office', exact: true }).waitFor();
  await toast(page, 'Added「Office」').waitFor();
  await undo.click();
  await page.getByRole('region', { name: 'Office', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('region', { name: 'Quota', exact: true }).waitFor();
  assert.deepEqual((await dudu.api('dashboard/get')).layout.widgets.map((widget: any) => widget.type), ['issues', 'quota']);
  // A fresh notification expires while the pointer and keyboard focus stay on the toolbar.
  await add.click();
  await page.getByRole('option', { name: 'Office', exact: true }).click();
  await page.getByRole('button', { name: 'Add Office', exact: true }).click();
  await toast(page, 'Added「Office」').waitFor();
  await add.focus();
  await add.hover();
  await undo.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.close();
});
