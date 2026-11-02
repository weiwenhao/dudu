// What the pet says by itself: an agent waiting, a due date gone by, a session that stopped. The real interface in a real browser, DSH-free
// (see fixture.mjs): the plugin's answer to `assistant/reminders` is scripted here, and the page's timers are moved with Playwright's clock.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';

const needs = { key: '1:needs_you:a1', kind: 'needs_you', id: 1, ref: 'APP-3', title: '迁移账单表', text: '迁移账单表用 Postgres 还是 MySQL？', agent: 'claude' };
const late = { key: '2:overdue:900', kind: 'overdue', id: 2, ref: 'DOC-4', title: '整理上季度报销', text: '整理上季度报销', agent: null, daysLate: 1 };
const stuck = { key: '3:stuck:z9', kind: 'stuck', id: 3, ref: 'APP-5', title: '重写 provider 插件', text: '重写 provider 插件', agent: 'codex' };

const script = { list: [] as any[], reads: 0 };
let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => { fixture = await startFixture({ handlers: {
  'assistant/reminders': () => { script.reads++; return { outcome: 'success', reminders: script.list }; },
  'assistant/conversation': () => ({ outcome: 'success', sessionId: 'dudu-assistant-fixture', cursor: 0 }),
} }); });
after(async () => { await fixture?.stop(); });

const pet = (page: Page) => page.getByRole('button', { name: 'Open conversation', exact: true });
const reminder = (page: Page) => page.locator('.dudu-pet-reminder');

/** The page with its clock under the test's control, and the first read (three seconds after the pet appears) already made. */
async function start(list: any[]) {
  script.list = list;
  script.reads = 0;
  const page = await fixture.open();
  await page.clock.install();
  await page.reload();
  await pet(page).waitFor();
  await read(page, 4_000);
  return page;
}
/** Move the clock and wait for the read it brings. */
async function read(page: Page, ms = 3 * 60_000 + 5_000) {
  const before = script.reads;
  await page.clock.fastForward(ms);
  for (let n = 0; n < 100 && script.reads === before; n++) await page.waitForTimeout(50);
  assert.ok(script.reads > before, 'the plugin was asked');
  await page.waitForTimeout(150);
}

test('each kind says why now, which issue and the words themselves, with the way in', async () => {
  for (const [item, word] of [[needs, 'In Review'], [late, '1 day overdue'], [stuck, 'Stuck']] as const) {
    const page = await start([item]);
    const bubble = reminder(page);
    await bubble.waitFor({ timeout: 8_000 });
    assert.equal(await bubble.getAttribute('data-reminder-kind'), item.kind);
    assert.equal(await bubble.getAttribute('role'), 'status');
    assert.equal(await bubble.getByText(word, { exact: true }).count(), 1);
    assert.equal(await bubble.getByText(item.ref, { exact: true }).count(), 1);
    assert.equal(await bubble.getByText(item.text, { exact: true }).count(), 1);
    assert.equal(await bubble.getByRole('button', { name: 'Open issue', exact: true }).count(), 1);
    assert.equal(await bubble.getByRole('button', { name: 'Close', exact: true }).count(), 1);
    assert.equal(await bubble.getByText(/^\+\d/).count(), 0, 'nothing waits behind a lone reminder');
    if (item.kind === 'overdue') {
      assert.equal(await bubble.locator('svg.lucide-calendar-days').count(), 1, 'a calendar for a due date');
      assert.equal(await bubble.locator('[data-agent]').count(), 0);
    } else {
      assert.equal(await bubble.locator(`[data-agent="${item.agent}"]`).count(), 1, 'the agent');
      assert.equal(await bubble.locator(`[data-agent="${item.agent}"] .bg-destructive`).count(), item.kind === 'stuck' ? 1 : 0);
      assert.equal(await bubble.locator(`[data-agent="${item.agent}"] .bg-warning`).count(), 0, 'In Review has no separate Needs you dot');
    }
    const box = await bubble.boundingBox();
    assert.equal(Math.round(box!.width), 296);
    await page.context().close();
  }
});

test('the first one is shown, the rest are counted, the words are cut to two lines', async () => {
  const long = { ...needs, text: '这是一个很长很长的问题，'.repeat(20) };
  const page = await start([long, late, stuck]);
  await reminder(page).waitFor({ timeout: 8_000 });
  assert.equal(await reminder(page).getAttribute('data-reminder-kind'), 'needs_you');
  await reminder(page).getByText('+2', { exact: true }).waitFor();
  const clamp = await reminder(page).locator('.dudu-pet-reminder-text').evaluate((node) => ({ lines: getComputedStyle(node).getPropertyValue('-webkit-line-clamp'), height: node.getBoundingClientRect().height }));
  assert.equal(clamp.lines, '2');
  assert.ok(clamp.height < 50, `two lines: ${clamp.height}`);
  await page.context().close();
});

test('closing one hides it until the next read, which brings the next; a closed one stays closed after reload until its key changes', async () => {
  const page = await start([needs, late]);
  await reminder(page).getByText('In Review', { exact: true }).waitFor({ timeout: 8_000 });
  await reminder(page).getByText('+1', { exact: true }).waitFor();
  await reminder(page).getByRole('button', { name: 'Close', exact: true }).click();
  await reminder(page).waitFor({ state: 'detached' });
  await page.waitForTimeout(400);
  assert.equal(await reminder(page).count(), 0, 'the next one waits for the next read');
  await read(page);
  await reminder(page).getByText('1 day overdue', { exact: true }).waitFor({ timeout: 8_000 });
  assert.equal(await reminder(page).getByText(/^\+\d/).count(), 0);
  await read(page);
  assert.equal(await reminder(page).getByText('1 day overdue', { exact: true }).count(), 1, 'still the same, not closed');
  await reminder(page).getByRole('button', { name: 'Close', exact: true }).click();
  await reminder(page).waitFor({ state: 'detached' });
  await read(page);
  assert.equal(await reminder(page).count(), 0, 'both are closed: the read brings nothing to show');
  // The same page again (storage stays): they are still closed.
  await page.reload();
  await pet(page).waitFor();
  await read(page, 4_000);
  assert.equal(await reminder(page).count(), 0, 'closed ones stay closed after a reload');
  // A new question is another reminder.
  script.list = [{ ...needs, key: '1:needs_you:b2', text: '改用哪个库？' }, late];
  await read(page);
  await reminder(page).getByText('改用哪个库？', { exact: true }).waitFor({ timeout: 8_000 });
  assert.equal(await reminder(page).getAttribute('data-reminder-kind'), 'needs_you');
  await page.context().close();
});

test('a reminder whose trouble is over is withdrawn at the next read', async () => {
  const page = await start([stuck]);
  await reminder(page).waitFor({ timeout: 8_000 });
  script.list = [];
  await read(page);
  await reminder(page).waitFor({ state: 'detached', timeout: 8_000 });
  await page.context().close();
});

test('"Open issue" opens that issue in the page and closes the reminder', async () => {
  const { issue } = fixture.issues.add({ title: 'Reminder target', agent: 'claude', status: 'in_progress', ask: '先做哪一步？', project: { name: 'app', path: '/work/app' } }, { actor: 'dudu' }) as { issue: { id: number; ref: string | null } };
  const page = await start([{ ...needs, id: issue.id, ref: issue.ref ?? 'APP-1', title: 'Reminder target', text: '先做哪一步？' }]);
  await reminder(page).waitFor({ timeout: 8_000 });
  await reminder(page).getByRole('button', { name: 'Open issue', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor({ timeout: 8_000 });
  // The page of that issue, once it has loaded.
  await page.getByText('Reminder target', { exact: false }).first().waitFor({ timeout: 8_000 });
  assert.equal(await reminder(page).count(), 0, 'opening it closes the reminder');
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).click();
  await read(page);
  assert.equal(await reminder(page).count(), 0, 'and it does not come back');
  await page.context().close();
});

test('it keeps quiet while the conversation is open and speaks when it closes; the hover hint gives way to it', async () => {
  const page = await start([]);
  await pet(page).hover();
  await page.getByText('Double Space to chat', { exact: true }).waitFor();
  await pet(page).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await dialog.waitFor();
  script.list = [needs];
  await read(page);
  assert.equal(await reminder(page).count(), 0, 'not over an open conversation');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await reminder(page).waitFor({ timeout: 8_000 });
  await pet(page).hover();
  assert.equal(await page.getByText('Double Space to chat', { exact: true }).count(), 0, 'the hint does not cover a reminder');
  await page.context().close();
});
