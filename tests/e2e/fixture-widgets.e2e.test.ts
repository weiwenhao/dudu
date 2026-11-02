// Widgets whose data a real DSH cannot be made to give on every machine: the real interface and the real libraries, in a real
// browser, with the plugin's answers about accounts and sessions scripted (see fixture.mjs).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';
import { panelAction } from './harness.mjs';

const at = (hour: number, day = 0) => { const date = new Date(); date.setHours(hour, 0, 0, 0); return date.getTime() + day * 86400000; };
const usage = { providers: [
  { id: 'claude', name: 'Claude', state: 'ok', plan: 'Max', limited: false, windows: [
    { key: 'five_hour', label: '5 小时', used: 0.74, resetsAt: at(13), core: true }, { key: 'seven_day', label: '每周', used: 0.41, resetsAt: at(9, 3), core: true }] },
  { id: 'codex', name: 'ChatGPT', state: 'ok', plan: 'Plus', limited: true, windows: [
    { key: 'primary', label: '5 小时', used: 1, resetsAt: at(15), core: true }, { key: 'secondary', label: '每周', used: 0.3, resetsAt: at(9, 4), core: true }] },
  { id: 'gemini', name: 'Gemini', state: 'unavailable', plan: '', limited: false, windows: [] },
  // DeepSeek is paid from a wallet: its row is the balance, as DSH's account page writes it.
  { id: 'deepseek', name: 'DeepSeek', kind: 'balance', state: 'ok', plan: '', limited: false, windows: [], balance: [{ currency: 'CNY', text: '¥12.34' }] },
  { id: 'cursor', name: 'Cursor', state: 'hidden', plan: '', limited: false, windows: [] },
] };

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => { fixture = await startFixture({ handlers: { 'overview/usage': () => usage } }); });
after(async () => { await fixture?.stop(); });

/** Makes room (Issues is pulled to the left, to nine of the fifteen columns, from the keyboard), adds the widget, and leaves edit mode. */
async function withWidget(page: Page, name: string) {
  await panelAction(page, 'Edit layout');
  await page.locator('.db-card').first().focus();
  for (let n = 0; n < 6; n++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByRole('button', { name: `Add ${name}` }).click();
  await page.getByRole('region', { name }).waitFor();
  await page.getByRole('button', { name: 'Done' }).click();
  return page.getByRole('region', { name });
}

/** The widget on its own, at a size in the interface's own units (112px cells): what its width and height make of it, whatever the grid is. */
async function standalone(cols: number, rows: number) {
  // (the preview counts cells of 56px, half of those units: it is a box of that size, not the dashboard's grid)
  const page = await fixture.open({ widgetPreview: { id: 'quota', cols: cols * 2, rows: rows * 2 } });
  const quota = page.getByRole('region', { name: 'Quota' });
  await quota.getByText('Claude', { exact: true }).waitFor();
  return { page, quota };
}
const toneOf = async (bar: ReturnType<Page['getByRole']>) => (await bar.locator('div').first().getAttribute('class')) ?? '';

test('Quota on the dashboard: every harness has its row, DeepSeek shows its balance, a reading that says nothing is no row', async () => {
  const page = await fixture.open();
  const quota = await withWidget(page, 'Quota');
  await quota.getByText('Claude', { exact: true }).waitFor();
  await quota.getByText('ChatGPT', { exact: true }).waitFor();
  assert.equal(await quota.getByText('Gemini').count(), 1, 'an agent whose usage cannot be read keeps its row');
  await quota.getByText('¥12.34').waitFor();
  assert.equal(await quota.getByText('Cursor').count(), 0);
  await page.context().close();
});

test('Quota, narrow: one bar of the highest window, coloured by use, a full limit says when it starts over, "—" when unreadable', async () => {
  const { page, quota } = await standalone(2, 2); // 212px wide
  assert.equal(await quota.getByText('Weekly', { exact: true }).count(), 0, 'a narrow line has no room for the window names');
  await quota.getByText('74%').waitFor();
  assert.match(await toneOf(quota.getByRole('progressbar', { name: 'Claude', exact: true })), /bg-warning/, '74 % is amber');
  assert.match(await toneOf(quota.getByRole('progressbar', { name: 'ChatGPT', exact: true })), /bg-destructive/);
  assert.equal(await quota.getByText('100%').count(), 0);
  await quota.getByLabel(/ChatGPT: Limit reached, resets/).waitFor();
  await quota.getByText('—').waitFor(); // Gemini: never 0 %
  await quota.getByText('¥12.34').waitFor();
  assert.equal(await quota.getByText('Cursor').count(), 0);

  // Hovering names the plan and every window with when it starts over.
  await quota.getByText('Claude', { exact: true }).hover();
  await page.getByText('Claude · Max').waitFor();
  await page.getByText('5-hour 74% used · resets 13:00').first().waitFor();
  await page.getByText(/Weekly 41% used · resets/).first().waitFor();
  await page.context().close();
});

test('Quota, wide: the 5-hour and the weekly window side by side on one line, each coloured by its own use', async () => {
  const { page, quota } = await standalone(4, 2); // 436px wide, too low for blocks
  const claude = quota.getByLabel('Claude: 5-hour 74% used, Weekly 41% used');
  await claude.waitFor();
  assert.deepEqual(await claude.locator('xpath=.//span[contains(@class,"text-xs")]').allInnerTexts(), ['5-hour', '74%', 'Weekly', '41%'], 'both windows, on the one line');
  assert.equal(await claude.evaluate((row) => row.getBoundingClientRect().height), 28, 'it is still one 28px line');
  assert.match(await toneOf(quota.getByRole('progressbar', { name: 'Claude 5-hour' })), /bg-warning/);
  assert.match(await toneOf(quota.getByRole('progressbar', { name: 'Claude Weekly' })), /bg-ring/, '41 % is blue');
  // A limit that is reached shows when that window starts over instead of 100 %; the other window is read as usual.
  const chatgpt = quota.getByLabel(/^ChatGPT: 5-hour, Limit reached, resets .*, Weekly 30% used$/);
  await chatgpt.waitFor();
  await chatgpt.getByText('15:00').waitFor();
  await chatgpt.getByText('30%').waitFor();
  assert.match(await toneOf(quota.getByRole('progressbar', { name: 'ChatGPT 5-hour' })), /bg-destructive/);
  assert.equal(await quota.getByText('100%').count(), 0);
  // Unreadable stays "—" and a wallet stays an amount, on lines of their own.
  await quota.getByText('—').waitFor();
  await quota.getByLabel('DeepSeek Balance ¥12.34').waitFor();
  assert.equal(await quota.getByRole('progressbar').count(), 4 + 1, 'two windows for each of two agents, and the empty track of the one that cannot be read');
  // The hover still says everything.
  await quota.getByText('Claude', { exact: true }).hover();
  await page.getByText('Claude · Max').waitFor();
  await page.getByText(/Weekly 41% used · resets/).first().waitFor();
  await page.context().close();
});

test('Quota, taller: a block per agent with its plan, the next reset and each window on a bar; DeepSeek is its balance', async () => {
  const { page, quota } = await standalone(4, 4); // 436px high, room for the four blocks
  await quota.getByText('Resets 13:00').waitFor();
  await quota.getByText('Weekly').first().waitFor();
  await quota.getByText('41%').waitFor();
  await quota.getByText('¥12.34').waitFor();
  assert.equal(await quota.getByText('5-hour').count(), 2, 'a bar for the 5-hour window of each of the two agents');
  await quota.getByText('DeepSeek', { exact: true }).hover();
  await page.getByText('Balance ¥12.34').waitFor();
  await page.context().close();
});

test('Quota: blocks only when they all fit; a widget too low for them falls back to lines instead of cutting the last block off', async () => {
  const { page, quota } = await standalone(4, 2); // 212px high: the four blocks need 286px
  assert.equal(await quota.getByText('Resets 13:00').count(), 0, 'lines, not blocks');
  assert.equal(await quota.getByLabel(/^Claude: /).count(), 1);
  assert.equal(await quota.evaluate((section) => { const content = section.querySelector('.du-widget-content')!; return content.scrollHeight <= content.clientHeight; }), true, 'every line fits, nothing scrolls');
  await page.context().close();
});
