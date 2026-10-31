// Widgets whose data a real DSH cannot be made to give on every machine: the real interface and the real libraries, in a real
// browser, with the plugin's answers about accounts and sessions scripted (see fixture.mjs).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';

const at = (hour: number, day = 0) => { const date = new Date(); date.setHours(hour, 0, 0, 0); return date.getTime() + day * 86400000; };
const usage = { providers: [
  { id: 'claude', name: 'Claude', state: 'ok', plan: 'Max', limited: false, windows: [
    { key: 'five_hour', label: '5 小时', used: 0.74, resetsAt: at(13), core: true }, { key: 'seven_day', label: '每周', used: 0.41, resetsAt: at(9, 3), core: true }] },
  { id: 'codex', name: 'ChatGPT', state: 'ok', plan: 'Plus', limited: true, windows: [
    { key: 'primary', label: '5 小时', used: 1, resetsAt: at(15), core: true }, { key: 'secondary', label: '每周', used: 0.3, resetsAt: at(9, 4), core: true }] },
  { id: 'gemini', name: 'Gemini', state: 'unavailable', plan: '', limited: false, windows: [] },
  { id: 'deepseek', name: 'DeepSeek', state: 'hidden', plan: '', limited: false, windows: [] },
] };

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => { fixture = await startFixture({ handlers: { 'overview/usage': () => usage } }); });
after(async () => { await fixture?.stop(); });

/** Makes room (Issues is pulled to the left half from the keyboard), adds the widget, and leaves edit mode. */
async function withWidget(page: Page, name: string) {
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.locator('.db-card').first().focus();
  for (let n = 0; n < 4; n++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('button', { name: `Add ${name}` }).click();
  await page.getByRole('region', { name }).waitFor();
  await page.getByRole('button', { name: 'Done' }).click();
  return page.getByRole('region', { name });
}

test('Quota: a line per agent with a subscription, coloured by use, "—" for one that cannot be read, nothing for pay as you go', async () => {
  const page = await fixture.open();
  const quota = await withWidget(page, 'Quota');
  await quota.getByText('Claude', { exact: true }).waitFor();
  assert.equal(await quota.getByText('Gemini').count(), 1);
  assert.equal(await quota.getByText('DeepSeek').count(), 0, 'an agent billed by use has no subscription to show');
  // The percent is the highest window; 74 % is amber, a full limit is red and says when it starts over instead of 100 %.
  await quota.getByText('74%').waitFor();
  assert.match((await quota.locator('[role=progressbar]').nth(0).locator('div').first().getAttribute('class')) ?? '', /bg-warning/);
  assert.match((await quota.locator('[role=progressbar]').nth(1).locator('div').first().getAttribute('class')) ?? '', /bg-destructive/);
  assert.equal(await quota.getByText('100%').count(), 0);
  await quota.getByLabel(/ChatGPT: Limit reached, resets/).waitFor();
  await quota.getByText('—').waitFor(); // Gemini: never 0 %

  // Hovering names the plan and every window with when it starts over.
  await quota.getByText('Claude', { exact: true }).hover();
  await page.getByText('Claude · Max').waitFor();
  await page.getByText('5-hour 74% used · resets 13:00').first().waitFor();
  await page.getByText(/Weekly 41% used · resets/).first().waitFor();
  await page.context().close();
});

test('Quota, taller: a block per agent with its plan, the next reset and each window on a bar', async () => {
  const page = await fixture.open();
  const quota = await withWidget(page, 'Quota');
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.locator('.db-card').filter({ has: quota }).focus();
  await page.keyboard.press('Shift+ArrowDown');
  await quota.getByText('Resets 13:00').waitFor();
  await quota.getByText('Weekly').first().waitFor();
  await quota.getByText('41%').waitFor();
  await page.context().close();
});

test('Stuck: the issues whose agent is stuck (its session failed), and none of the others', async () => {
  fixture.sessions['claude:broken'] = 'error';
  fixture.sessions['claude:fine'] = 'running';
  fixture.issues.add({ title: '备份脚本出错了', status: 'in_progress', agent: 'claude', session: 'claude:broken' });
  fixture.issues.add({ title: '一切正常的事', status: 'in_progress', agent: 'claude', session: 'claude:fine' });
  const page = await fixture.open();
  const stuck = await withWidget(page, 'Stuck');
  await stuck.getByRole('button', { name: /备份脚本出错了/ }).waitFor();
  assert.equal(await stuck.getByText('一切正常的事').count(), 0);
  await page.context().close();
});
