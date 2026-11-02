// The dashboard's grid (docs/assistant.md 4.1): fifteen columns and as many rows as the window holds, and the default Issues fills exactly
// one screen, whatever the window, with nothing to scroll and nothing blank under it (the rows share the height, so the card ends at the
// bottom margin, which is the one at the top). The real page in a real browser, with no DSH (see fixture.mjs).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';
import { panelAction } from './harness.mjs';

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => { fixture = await startFixture(); });
after(async () => { await fixture?.stop(); });

const GAP = 12;

/** The saved layout once it satisfies `done`: the page saves a moment after it changes. */
async function savedWhen(done: (widgets: any[]) => boolean) {
  for (let tries = 0; tries < 50; tries++) {
    const { widgets } = fixture.dashboard.get().layout;
    if (done(widgets)) return widgets;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return assert.fail(`The layout was not saved: ${JSON.stringify(fixture.dashboard.get().layout.widgets)}`);
}

/** What the page shows of its grid: the room it has, the cell, and what Issues takes of it. */
async function measure(page: Page) {
  await page.locator('.grid-stack-item').first().waitFor();
  return page.evaluate(() => {
    const scroller = document.querySelector('.db-page') as HTMLElement;
    const wrap = document.querySelector('.db-wrap') as HTMLElement;
    const item = document.querySelector('.grid-stack-item') as HTMLElement;
    const surface = item.querySelector('.db-surface') as HTMLElement;
    const style = getComputedStyle(scroller);
    const room = { width: scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: scroller.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
    return {
      room, cell: parseFloat(getComputedStyle(wrap).getPropertyValue('--db-cell')), row: parseFloat(getComputedStyle(wrap).getPropertyValue('--db-row')),
      cols: Number(item.getAttribute('gs-w')), rows: Number(item.getAttribute('gs-h')), y: Number(item.getAttribute('gs-y')),
      scroll: { height: scroller.scrollHeight - scroller.clientHeight, width: scroller.scrollWidth - scroller.clientWidth, page: document.documentElement.scrollHeight - innerHeight },
      top: surface.getBoundingClientRect().top, bottom: surface.getBoundingClientRect().bottom, pageBottom: scroller.getBoundingClientRect().bottom - parseFloat(style.paddingBottom), view: innerHeight,
    };
  });
}

/**
 * What "one screen" means for the grid as measured: every row, sharing the height of the room, so that the card ends exactly where the room ends
 * (nothing blank under it: the owner's screenshot had a strip of 65px at 1700 × 1000), nothing to scroll in either direction, and a row that is
 * about as tall as a column is wide.
 */
function assertOneScreen(m: Awaited<ReturnType<typeof measure>>, label: string) {
  assert.equal(m.cols, 15, `${label}: fifteen columns`);
  assert.equal(m.y, 0, label);
  assert.ok(Math.abs(m.rows * (m.row + GAP) - GAP - m.room.height) < 0.5, `${label}: ${m.rows} rows of ${m.row}px fill ${m.room.height}px`);
  assert.ok(Math.abs(m.pageBottom - m.bottom) < 0.5, `${label}: the card ends at ${m.bottom} and the room at ${m.pageBottom}: ${m.pageBottom - m.bottom}px blank under it`);
  assert.ok(Math.abs(m.row / m.cell - 1) <= 0.1, `${label}: a row of ${m.row}px against a column of ${m.cell}px`);
  assert.deepEqual([m.scroll.height <= 0, m.scroll.page <= 0], [true, true], `${label}: no vertical scrolling: ${JSON.stringify(m.scroll)}`);
  assert.ok(m.scroll.width <= 0, `${label}: no horizontal scrolling either: ${JSON.stringify(m.scroll)}`);
  assert.ok(m.bottom <= m.view, `${label}: the card ends inside the window`);
}

for (const size of [{ width: 900, height: 700 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 2000, height: 1094 }, { width: 1100, height: 600 }, { width: 2560, height: 1300 }, { width: 1100, height: 2000 }]) {
  test(`at ${size.width} × ${size.height} the default Issues is every column and every row: one screen, nothing to scroll, nothing blank under it`, async () => {
    const page = await fixture.open({ size });
    const m = await measure(page);
    assertOneScreen(m, `${size.width} × ${size.height}`);
    // The board starts right under the header row (the page has no top padding of its own) and ends the page's 20px above the window's bottom,
    // not that and a part of a row.
    const header = await page.locator('.db-header').evaluate((node) => node.getBoundingClientRect().bottom);
    assert.equal(m.top, header, 'the card starts under the header row');
    assert.ok(Math.abs(m.view - m.bottom - 20) < 0.5, `the bottom margin is ${m.view - m.bottom}px`);
    await page.context().close();
  });
}

test('the default Issues follows the window: bigger or smaller, it keeps filling it and the page does not scroll', async () => {
  const page = await fixture.open({ size: { width: 1440, height: 900 } });
  const before = await measure(page);
  await page.setViewportSize({ width: 1440, height: 600 }); // under the 48px header row and above the 20px bottom margin: six rows, as few as the row still reads as square
  await page.waitForFunction((rows) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-h')) < rows, before.rows);
  const shorter = await measure(page);
  assert.ok(shorter.rows < before.rows && shorter.scroll.height <= 0, JSON.stringify({ before: before.rows, shorter: shorter.rows, scroll: shorter.scroll }));
  assertOneScreen(shorter, '1440 × 600');
  await page.setViewportSize({ width: 1440, height: 1300 });
  await page.waitForFunction((rows) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-h')) > rows, before.rows);
  const taller = await measure(page);
  assert.ok(taller.rows > before.rows, JSON.stringify({ before: before.rows, taller: taller.rows }));
  assertOneScreen(taller, '1440 × 1300');
  // A narrower window has smaller cells, so more rows fit: it follows the width as well.
  await page.setViewportSize({ width: 1000, height: 1300 });
  await page.waitForFunction((rows) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-h')) > rows, taller.rows);
  assertOneScreen(await measure(page), '1000 × 1300');
  // Nothing was saved by looking: the file still holds the default, which says "fill" for both sides.
  assert.deepEqual(fixture.dashboard.get().layout.widgets, [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 'fill' }]);
  await page.context().close();
});

test('a widget is added at its size in the cells of fifteen columns: Office at 5 × 3 (its minimum), Quota at 3 × 2, below a filling Issues', async () => {
  const page = await fixture.open({ size: { width: 1440, height: 900 } });
  const { rows } = await measure(page);
  await panelAction(page, 'Edit layout');
  for (const [name, w, h] of [['Quota', 3, 2], ['Office', 5, 3]] as const) {
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add widget', exact: true });
    await dialog.getByRole('option', { name, exact: true }).click();
    await dialog.getByRole('button', { name: `Add ${name}`, exact: true }).click();
    await page.getByRole('region', { name, exact: true }).waitFor();
    const item = page.locator('.grid-stack-item').filter({ has: page.getByRole('region', { name, exact: true }) });
    assert.deepEqual([await item.getAttribute('gs-w'), await item.getAttribute('gs-h')], [String(w), String(h)], name);
  }
  const quota = Number(await page.locator('.grid-stack-item').filter({ has: page.getByRole('region', { name: 'Quota', exact: true }) }).getAttribute('gs-y'));
  assert.equal(quota, rows, 'below the rows Issues fills');
  const saved = fixture.dashboard.get().layout.widgets.map((item: any) => [item.type, item.w, item.h]);
  assert.deepEqual(saved, [['issues', 'fill', 'fill'], ['quota', 3, 2], ['office', 5, 3]]);
  await page.context().close();
});

test('what sits below a filling Issues is pushed down by a taller window and comes back with a shorter one, without the page reading that as a change from outside', async () => {
  const page = await fixture.open({ size: { width: 1440, height: 900 } });
  const { rows } = await measure(page);
  await panelAction(page, 'Edit layout');
  await page.getByRole('button', { name: 'Add widget', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add widget', exact: true });
  await dialog.getByRole('option', { name: 'Quota', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add Quota', exact: true }).click();
  await page.getByRole('region', { name: 'Quota', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const quota = page.locator('.grid-stack-item').filter({ has: page.getByRole('region', { name: 'Quota', exact: true }) });
  const row = async () => Number(await quota.getAttribute('gs-y'));
  assert.equal(await row(), rows);

  // The elements are marked: a layout the page shows again from the plugin makes new ones.
  await page.locator('.grid-stack-item').evaluateAll((items) => items.forEach((item) => item.setAttribute('data-mark', 'same')));
  await page.setViewportSize({ width: 1440, height: 1300 });
  await page.waitForFunction((from) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-h')) > from, rows);
  const taller = await measure(page);
  assert.equal(await row(), taller.rows, 'Quota stays right under Issues');
  await page.waitForTimeout(2600); // the page asks the plugin for the layout every two seconds
  assert.equal(await page.locator('.grid-stack-item[data-mark="same"]').count(), 2, 'nothing was shown again');
  assert.equal(await row(), taller.rows);
  assert.deepEqual(fixture.dashboard.get().layout.widgets.map((item: any) => [item.type, item.y]), [['issues', 0], ['quota', rows]], 'and nothing was saved by looking');

  // Back to the first window: the layout as saved is what the plugin answers for it, and that is what the page shows.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction((from) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-h')) === from, rows);
  await page.waitForFunction((from) => Number(document.querySelectorAll('.grid-stack-item')[1]?.getAttribute('gs-y')) === from, rows, { timeout: 6000 });
  await page.context().close();
});

test('pulling Issues ends the filling of both sides: it has the cells it had, and the layout is saved as numbers', async () => {
  const page = await fixture.open({ size: { width: 1440, height: 900 } });
  const before = await measure(page);
  await panelAction(page, 'Edit layout');
  await page.locator('.db-card').first().focus();
  await page.keyboard.press('Shift+ArrowLeft'); // one cell narrower
  await page.waitForFunction((cols) => Number(document.querySelector('.grid-stack-item')?.getAttribute('gs-w')) === cols, before.cols - 1);
  const [issues] = await savedWhen(([first]) => first.w !== 'fill');
  assert.deepEqual([issues.type, issues.w, issues.h], ['issues', before.cols - 1, before.rows], 'both sides are numbers now');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  // It no longer follows the window: a taller window leaves room under it and nothing scrolls.
  await page.setViewportSize({ width: 1440, height: 1300 });
  await page.waitForTimeout(400);
  const taller = await measure(page);
  assert.equal(taller.rows, before.rows, 'it keeps the rows it had');
  assert.ok(taller.scroll.height <= 0);
  await page.context().close();
});
