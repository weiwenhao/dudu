// Desktop's real frame CSS owns the window-control clearance; the issue header must inherit it.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => { dudu = await startDudu(); });
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

async function checkHeader(page: Page, expectedClearance: number) {
  const back = page.getByRole('button', { name: 'Back to Issues', exact: true });
  const header = back.locator('..');
  await page.waitForFunction(({ expected }) => {
    const button = document.querySelector('.dudu header button');
    return !document.querySelector('[data-animating]') && button &&
      parseFloat(getComputedStyle(button.parentElement!).paddingInlineStart) === Math.max(16, expected);
  }, { expected: expectedClearance });
  const geometry = await header.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const buttons = [...node.querySelectorAll('button')].map((button) => {
      const bounds = button.getBoundingClientRect();
      return {
        x: bounds.x, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        reachable: button.disabled || button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)),
      };
    });
    return {
      x: rect.x, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height,
      clearance: parseFloat(getComputedStyle(node).getPropertyValue('--dsh-frame-leading-clearance')) || 0,
      buttons,
    };
  });
  assert.equal(geometry.clearance, expectedClearance);
  assert.equal(geometry.height, 44);
  for (const button of geometry.buttons) {
    assert.ok(button.x >= geometry.x + Math.max(16, expectedClearance));
    assert.ok(button.right <= geometry.right - 16);
    assert.ok(button.top >= geometry.top && button.bottom <= geometry.bottom);
    assert.ok(button.reachable, 'header controls stay clickable outside the host window controls');
  }
  if (expectedClearance) {
    const seat = await page.locator('[data-shell-leading]').boundingBox();
    assert.ok(seat);
    assert.ok(seat.x + seat.width <= geometry.buttons[0].x, 'the host sidebar and new-session controls end before the breadcrumb');
  }
  await header.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).waitFor();
  await page.keyboard.press('Escape');
}

test('issue navigation clears Desktop window controls when the sidebar closes, including fullscreen and narrow windows', async () => {
  const title = 'A long issue title that must truncate before the navigation controls '.repeat(3);
  for (const name of [title, 'Another issue for previous and next navigation']) {
    await dudu.api('issues/add', { fields: { title: name, project: { name: 'Dudu', path: '/work/dudu' } } });
  }
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByRole('complementary', { name: 'Properties', exact: true }).waitFor();
  await checkHeader(page, 0);

  // These are the attributes Desktop gives the real DSH shell, not a replacement titlebar.
  await page.evaluate(() => { document.documentElement.dataset.platform = 'darwin'; });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await checkHeader(page, 160);
  await mkdir('.local/desktop-frame-nov02', { recursive: true });
  await page.screenshot({ path: '.local/desktop-frame-nov02/collapsed.png' });

  await page.evaluate(() => { document.documentElement.setAttribute('data-fullscreen', ''); });
  await checkHeader(page, 84);
  await page.evaluate(() => { document.documentElement.removeAttribute('data-fullscreen'); });
  await page.setViewportSize({ width: 720, height: 900 });
  await checkHeader(page, 160);
  await page.screenshot({ path: '.local/desktop-frame-nov02/narrow.png' });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-shell-leading]').getByRole('button', { name: 'Open sidebar', exact: true }).click();
  await checkHeader(page, 0);
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).click();
  await page.getByRole('region', { name: 'Issues', exact: true }).waitFor();
});
