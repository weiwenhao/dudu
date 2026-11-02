// The three entries above the board (docs/assistant.md 4.1), in the real interface and browser (see fixture.mjs).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Locator, Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';
import { panelAction } from './harness.mjs';

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => { fixture = await startFixture(); });
after(async () => { await fixture?.stop(); });

const entryOf = (page: Page) => {
  const entry = page.getByRole('toolbar', { name: 'Dudu menu', exact: true });
  return { entry, gear: entry.getByRole('button', { name: 'Settings', exact: true }), layout: entry.getByRole('button', { name: 'Edit layout', exact: true }), sessions: entry.getByRole('button', { name: 'Sessions', exact: true }) };
};
const focusGear = async (page: Page, gear: Locator) => {
  for (let tabs = 0; tabs < 40; tabs++) {
    await page.keyboard.press('Tab');
    if (await gear.evaluate((element) => element === document.activeElement)) return;
  }
  assert.fail('Tab never reached the gear.');
};

test('all three icons stay visible in a row above the board, without covering a card or depending on hover', async () => {
  const page = await fixture.open();
  const { entry, gear, layout, sessions } = entryOf(page);
  await gear.waitFor();
  assert.equal(await layout.isVisible(), true);
  assert.equal(await sessions.isVisible(), true);
  assert.deepEqual(await page.locator('.db-entry button').evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? '').trim())), ['', '', ''], 'three icons, no words');
  const card = (await page.locator('.db-surface').first().boundingBox())!;
  const buttons = await entry.getByRole('button').all();
  const boxes = await Promise.all(buttons.map((button) => button.boundingBox()));
  assert.ok(boxes.every((box) => box && box.y + box.height <= card.y), 'all controls sit above the card');
  assert.ok(boxes.every((box) => box && box.y === boxes[0]!.y), 'one horizontal row');
  assert.ok(boxes[0]!.x < boxes[1]!.x && boxes[1]!.x < boxes[2]!.x, 'settings, layout, sessions');
  await page.mouse.move(400, 400);
  assert.equal(await layout.isVisible(), true);
  assert.equal(await sessions.isVisible(), true);
  await page.context().close();
});

test('the three entries open their controls and restore focus, and editing keeps the top window space', async () => {
  const page = await fixture.open();
  const { entry, gear, layout, sessions } = entryOf(page);
  await sessions.click();
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  await dialog.getByRole('searchbox', { name: 'Search sessions', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Sessions');
  await sessions.click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('toolbar', { name: 'Edit layout', exact: true }).count(), 0, 'and nothing starts');

  const top = (await page.locator('.db-page').boundingBox())!.y;
  await layout.click();
  await page.getByRole('toolbar', { name: 'Edit layout', exact: true }).waitFor();
  assert.equal(await entry.count(), 0, 'no entry while the layout is edited');
  assert.equal((await page.locator('.db-page').boundingBox())!.y, top, 'the board stays below the same window space');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await entry.waitFor();

  await gear.click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.context().close();
});

test('Tab reaches each entry in order and a session dialog returns focus to the same button', async () => {
  const page = await fixture.open();
  const { gear, layout, sessions } = entryOf(page);
  await gear.waitFor();
  await focusGear(page, gear);
  await page.keyboard.press('Tab');
  assert.equal(await layout.evaluate((element) => element === document.activeElement), true, 'the next stop is the layout icon');
  await page.keyboard.press('Tab');
  assert.equal(await sessions.evaluate((element) => element === document.activeElement), true, 'the next stop is the sessions icon');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Sessions');
  assert.equal(await layout.isVisible(), true);
  await page.context().close();
});

test('the add gallery fits a small window and its preview never takes layout shortcuts', async () => {
  const page = await fixture.open({ size: { width: 430, height: 740 } });
  await panelAction(page, 'Edit layout');
  await page.getByRole('button', { name: 'Add widget', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add widget', exact: true });
  await dialog.getByRole('option', { name: 'Issues', exact: true }).click();
  await dialog.locator('[data-widget-preview="issues"] section').waitFor();
  await page.keyboard.press('f');
  assert.equal(await page.getByRole('combobox', { name: 'Add filter', exact: true }).count(), 0, 'a preview cannot open a filter outside its inert surface');
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 430 && bounds.y + bounds.height <= 740);
  const content = await dialog.evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, height: node.clientHeight, bottom: node.scrollHeight }));
  assert.ok(content.scroll <= content.width + 1 && content.bottom <= content.height + 1, JSON.stringify(content));
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('toolbar', { name: 'Edit layout', exact: true }).waitFor();
  await page.context().close();
});

test('the add preview is not a closed box: no border and no fill, its grid sits on the widget\'s cells and fades out at the edges', async () => {
  const page = await fixture.open();
  await panelAction(page, 'Edit layout');
  await page.getByRole('button', { name: 'Add widget', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add widget', exact: true });
  await dialog.getByRole('option', { name: 'Quota', exact: true }).click();
  const preview = dialog.locator('[data-widget-preview="quota"]');
  await preview.locator('svg line').first().waitFor({ state: 'attached' }); // a line has no area, so it is never "visible"
  const look = await preview.evaluate((node) => {
    const style = getComputedStyle(node);
    const grid = node.querySelector('svg') as SVGElement;
    const card = node.querySelector('[style*="scale("]') as HTMLElement;
    const [box, shown] = [node.getBoundingClientRect(), card.getBoundingClientRect()];
    const scale = shown.width / parseFloat(card.style.width);
    return {
      borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], fill: style.backgroundColor,
      // two masks, one for each direction, and they multiply
      masks: [getComputedStyle(grid.parentElement!).maskImage, getComputedStyle(grid.parentElement!.parentElement!).maskImage],
      scale, cardLeft: shown.left - box.left, cardRight: shown.right - box.left,
      columns: [...grid.querySelectorAll('line')].filter((line) => line.getAttribute('x1') === line.getAttribute('x2')).map((line) => Number(line.getAttribute('x1'))),
    };
  });
  assert.deepEqual(look.borders, ['0px', '0px', '0px', '0px'], 'no frame');
  assert.equal(look.fill, 'rgba(0, 0, 0, 0)', 'no fill');
  assert.ok(look.masks.every((mask) => mask.includes('linear-gradient')), `the grid fades out toward the edges: ${look.masks}`);
  assert.ok(look.scale <= 1.5 + 0.01, `a small widget is not blown up to fill the room (${look.scale})`);
  // The lines run in the middle of the gaps (half of 12px before and after the widget), so it sits on its cells.
  const near = (x: number) => look.columns.some((column) => Math.abs(column - x) < 0.6);
  assert.ok(near(look.cardLeft - 6 * look.scale) && near(look.cardRight + 6 * look.scale), JSON.stringify(look));
  await page.context().close();
});
