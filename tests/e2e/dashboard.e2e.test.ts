// The dashboard in the real thing (gridstack in the packaged plugin, inside `dsh web`, in Chrome): the grid, editing, saving, Undo.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import type { Locator, Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

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
const edit = (page: Page) => page.getByRole('button', { name: 'Edit layout' }).click();

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

test('the first dashboard is one Issues widget that fills it and follows the window until it is pulled', async () => {
  const page = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await page.getByRole('region', { name: 'Issues' }).waitFor();
  const wide = await cells(issuesItem(page));
  assert.deepEqual([wide.x, wide.y, wide.h], [0, 0, 6]);
  assert.ok(wide.w >= 4, 'at least four columns');
  const stored = await saved();
  assert.deepEqual([stored.type, stored.w, stored.h], ['issues', 'fill', 6], 'nothing is written until the first change, and the default says "all the columns"');

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForFunction((before) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) < before, wide.w);
  const narrow = await cells(issuesItem(page));
  assert.ok(narrow.w >= 4 && narrow.w < wide.w, `${narrow.w} columns in a narrow window, ${wide.w} in a wide one`);
  // The board is as wide as the window now holds, not as wide as it was: nothing to scroll sideways.
  await page.waitForFunction(() => { const area = document.querySelector('.db-page'); return !!area && area.scrollWidth <= area.clientWidth + 1; });
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.waitForFunction((before) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) > before, narrow.w);
  await page.close();
});

test('pulling an edge resizes the widget, names the size beside the pointer, saves it, and Undo brings the old size back', async () => {
  const page = await dudu.openPanel({ viewport: { width: 1440, height: 900 } });
  await edit(page);
  const before = await cells(issuesItem(page));

  await pullEast(page, -300, { hold: true });
  await page.locator('.db-chip').waitFor();
  assert.match(await page.locator('.db-chip').innerText(), /^\d+×6$/);
  await page.mouse.up();
  await toast(page, 'Issues” resized to').waitFor();
  const after = await cells(issuesItem(page));
  assert.ok(after.w < before.w && after.w >= 4, `${before.w} -> ${after.w} columns`);
  const stored = await saved();
  assert.equal(stored.w, after.w, 'saved as a number of cells: it no longer follows the window');
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
  assert.equal((await cells(issuesItem(page))).w, 4, 'Issues is never narrower than four columns');
  await page.getByRole('button', { name: 'Restore default' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) > 4);
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
  await toast(page, 'Removed “Issues”').waitFor();
  assert.equal((await dudu.api('dashboard/get')).layout.widgets.length, 0);
  await page.getByRole('button', { name: 'Undo' }).last().click(); // the bar holds the last few changes; the newest is the last
  await page.locator('.grid-stack-item').waitFor();
  assert.equal((await dudu.api('dashboard/get')).layout.widgets.length, 1);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit layout' }).waitFor();
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

test('Add widget lists the widgets and marks the ones that are on the dashboard', async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await edit(page);
  await page.getByRole('button', { name: 'Add widget' }).click();
  const list = page.getByRole('dialog', { name: 'Add widget' });
  await list.getByText('Issues', { exact: true }).waitFor();
  await list.getByText('Added', { exact: true }).waitFor();
  await page.close();
});
