// The issue page and the way into and out of it: what Activity looks like when a lot has been written, @ completion with Tab, and the
// sidebar's own row taking the person back to the dashboard. The real interface in a real browser, DSH-free (see fixture.mjs).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';

let fixture: Awaited<ReturnType<typeof startFixture>>;
let lateIdentity = 0;
let identityReads = 0;
before(async () => { fixture = await startFixture({ handlers: {
  'issues/session': ({ id }: { id: number }) => id !== lateIdentity ? { outcome: 'success' } : ++identityReads === 1
    ? { outcome: 'success', provider: 'dsh', sessionId: 'late-dsh-id', command: null }
    : { outcome: 'success', provider: 'claude', sessionId: 'native-late-id', command: 'claude --resume native-late-id' },
} }); });
after(async () => { await fixture?.stop(); });

const LONG = '会话列表交互已实现：点击会话行在列表内展开预览（只读读取记录、可翻阅更早记录），展开区提供“导入”和“接管”按钮；右侧保留接管图标并加悬停说明；左侧 Agent 图标改为彩色。已用隔离的真实 DSH 验证：预览不产生副作用、单独导入不创建 issue。'.repeat(2);

function seed() {
  const { issue } = fixture.issues.add({
    title: 'Continue prior Orca work', brief: '继续做仪表盘。', status: 'in_review', agent: 'codex', session: 'codex:abc',
    source: 'session', sourceRef: 'codex:abc', project: { name: 'Dudu', path: '/work/dudu' },
  }, { actor: 'dudu' }) as { issue: { id: number } };
  fixture.issues.log(issue.id, { kind: 'progress', actor: 'dudu', text: LONG });
  fixture.issues.update(issue.id, { ask: `第一个问题：${LONG}` }, { actor: 'dudu' });
  fixture.issues.update(issue.id, { ask: '' }, { actor: 'dudu' });
  fixture.issues.update(issue.id, { ask: `现在的问题：用哪个图标？${LONG}` }, { actor: 'dudu' });
  fixture.sessions['codex:abc'] = 'waiting_owner';
  return issue.id;
}

async function openIssue(page: Page) {
  await page.getByText('Continue prior Orca work', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  await page.locator('[data-issue-discussion]').waitFor(); // the page's top bar is there before the issue has been read
}

test('discussion keeps chronological messages and the waiting question once, with boss as the comment author', async () => {
  seed();
  const page = await fixture.open();
  await openIssue(page);
  const activity = page.locator('[data-issue-discussion]');
  assert.equal(await activity.getByRole('heading', { name: 'Activity', exact: true }).count(), 1);
  assert.equal(await activity.getByText('created the issue from a session', { exact: false }).count(), 0);
  assert.equal(await activity.getByText('assigned the issue', { exact: false }).count(), 0);
  // Activity entries stay unboxed; long text still expands in place.
  const comment = activity.locator('li').filter({ hasText: '会话列表交互已实现' }).first();
  await comment.waitFor();
  assert.equal(await comment.evaluate((node) => getComputedStyle(node).borderTopWidth), '0px');
  assert.equal(await comment.locator('p').evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-line-clamp')), '6');
  await comment.getByRole('button', { name: 'Show more', exact: true }).click();
  assert.equal(await comment.locator('p').evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-line-clamp')), 'none');
  await comment.getByRole('button', { name: 'Show less', exact: true }).waitFor();
  const asked = activity.locator('li').filter({ hasText: '第一个问题' });
  await asked.waitFor();
  assert.equal(await asked.evaluate((node) => getComputedStyle(node).borderTopWidth), '0px');
  assert.equal(await asked.locator('p').evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-line-clamp')), '6');
  // The waiting question keeps its original position when boss leaves a newer comment.
  assert.equal(await page.getByText('现在的问题：用哪个图标？', { exact: false }).count(), 1);
  const waiting = activity.getByRole('region', { name: 'In Review', exact: true });
  await waiting.getByText('现在的问题：用哪个图标？', { exact: false }).waitFor();
  assert.equal(await waiting.evaluate((node) => getComputedStyle(node).borderTopWidth), '0px');
  await activity.getByRole('textbox', { name: 'Leave a comment…', exact: true }).fill('This is the newest comment.');
  await activity.getByRole('button', { name: 'Send', exact: true }).click();
  const newest = activity.locator('li').filter({ hasText: 'This is the newest comment.' });
  await newest.waitFor();
  await newest.getByText('boss', { exact: true }).waitFor();
  const entries = await activity.locator('ul > li').allTextContents();
  assert.ok(entries.at(-2)?.includes('现在的问题：用哪个图标？'));
  assert.ok(entries.at(-1)?.includes('This is the newest comment.'));
  assert.equal(await activity.getByText('现在的问题：用哪个图标？', { exact: false }).count(), 1);
  assert.equal(await activity.getByText('You', { exact: true }).count(), 0);
  await activity.getByText('Dudu', { exact: true }).first().waitFor();
  await page.context().close();
});

test('an older active question keeps its time position across discussion pagination without duplication', async () => {
  const { issue } = fixture.issues.add({
    title: 'Paginated discussion', status: 'in_review', agent: 'codex', session: 'codex:chronology',
    project: { name: 'work', path: '/work' },
  });
  fixture.sessions['codex:chronology'] = 'waiting_owner';
  fixture.issues.update(issue.id, { ask: 'A question before the newer comments.' }, { actor: 'dudu' });
  for (let n = 1; n <= 55; n++) fixture.issues.log(issue.id, { kind: 'note', actor: 'owner', text: `Later comment ${n}.` });
  const page = await fixture.open();
  await page.getByRole('button', { name: 'Paginated discussion', exact: true }).click();
  const activity = page.locator('[data-issue-discussion]');
  await activity.getByRole('region', { name: 'In Review', exact: true }).waitFor();
  let entries = await activity.locator('ul > li').allTextContents();
  assert.ok(entries[1].includes('A question before the newer comments.'));
  assert.ok(entries.at(-1)?.includes('Later comment 55.'));
  await activity.getByRole('button', { name: 'Load earlier', exact: true }).click();
  await activity.getByText('Later comment 1.', { exact: true }).waitFor();
  entries = await activity.locator('ul > li').allTextContents();
  assert.equal(entries.length, 56);
  assert.ok(entries[0].includes('A question before the newer comments.'));
  assert.ok(entries[1].includes('Later comment 1.'));
  assert.ok(entries.at(-1)?.includes('Later comment 55.'));
  assert.equal(await activity.getByText('A question before the newer comments.', { exact: true }).count(), 1);
  await page.context().close();
});

test('Tab takes the @ suggestion the way Enter does', async () => {
  const page = await fixture.open();
  await openIssue(page);
  const box = page.getByRole('textbox', { name: 'Leave a comment…', exact: true });
  await box.click();
  await box.pressSequentially('@co');
  await page.getByRole('option', { name: '@ChatGPT', exact: true }).waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await box.inputValue(), '@ChatGPT ');
  assert.equal(await box.evaluate((node) => node === document.activeElement), true, 'the keyboard stays in the box');
  await box.pressSequentially('Fast next words.');
  assert.equal(await box.inputValue(), '@ChatGPT Fast next words.', 'fast typing after choosing a mention keeps its order');
  await page.context().close();
});

test('mention names, completion by display name, hint and colour match the assigned agent', async () => {
  for (const [agent, label, query] of [
    ['codex', 'ChatGPT', '@cha'],
    ['claude', 'Claude', '@cl'],
    ['deepseek', 'DeepSeek', '@de'],
  ] as const) {
    const { issue } = fixture.issues.add({
      title: `Mention ${label}`, agent, project: { name: 'work', path: '/work' },
    });
    const page = await fixture.open();
    await page.getByRole('button', { name: issue.title, exact: true }).click();
    await page.getByText(`Mention @${label} to send a message. Otherwise, leave a comment.`, { exact: true }).waitFor();
    const box = page.getByRole('textbox', { name: 'Leave a comment…', exact: true });
    await box.fill(query);
    await page.getByRole('option', { name: `@${label}`, exact: true }).click();
    assert.equal(await box.inputValue(), `@${label} `);
    const token = box.locator('..').locator('[aria-hidden="true"] span').first();
    assert.equal(await token.innerText(), `@${label}`);
    assert.equal(await token.evaluate((node) => getComputedStyle(node).color), 'rgb(50, 107, 255)');
    await box.fill('@');
    await page.getByRole('option', { name: '@Dudu', exact: true }).waitFor();
    assert.equal(await page.getByRole('listbox', { name: 'Mention', exact: true }).getByRole('option').count(), 2);
    await page.context().close();
  }
});

test('Properties updates a new harness session from the DSH id to its late native resume identity', async () => {
  const { issue } = fixture.issues.add({
    title: 'Native identity arrives later', agent: 'claude', project: { name: 'work', path: '/work' }, session: 'dsh:late-dsh-id',
  });
  lateIdentity = issue.id;
  identityReads = 0;
  const page = await fixture.open();
  await page.getByRole('button', { name: 'Native identity arrives later', exact: true }).click();
  const properties = page.getByRole('complementary', { name: 'Properties' });
  await properties.getByRole('button', { name: 'late-dsh-id', exact: true }).waitFor();
  const command = properties.getByRole('button', { name: 'claude --resume native-late-id', exact: true });
  await command.waitFor({ timeout: 10_000 });
  assert.equal(await command.innerText(), 'native-late-id');
  assert.equal(await command.isDisabled(), false);
  assert.equal(identityReads, 2);
  await page.context().close();
});

test('Properties agent marks share the 16px slot and text alignment of the other property icons', async () => {
  for (const agent of ['codex', 'claude', 'deepseek', null]) {
    const { issue } = fixture.issues.add({
      title: `Property icon alignment ${agent ?? 'unassigned'}`, agent, project: { name: 'work', path: '/work' },
    });
    const page = await fixture.open();
    await page.getByRole('button', { name: issue.title, exact: true }).click();
    const properties = page.getByRole('complementary', { name: 'Properties' });
    const rows = properties.locator('> div').first().getByRole('button');
    await rows.nth(3).waitFor();
    const bounds = await rows.evaluateAll((buttons) => buttons.map((button) => {
      const icon = button.firstElementChild!.getBoundingClientRect();
      const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const range = document.createRange();
      range.selectNode(text!);
      const rect = range.getBoundingClientRect();
      return { x: icon.x, width: icon.width, height: icon.height, textX: rect.x };
    }));
    assert.equal(bounds.length, 4);
    for (const rect of bounds) {
      assert.equal(rect.width, 16);
      assert.equal(rect.height, 16);
      assert.equal(rect.x, bounds[0].x);
      assert.equal(rect.textX, bounds[0].textX);
    }
    if (agent) {
      const logo = properties.locator(`[data-agent-logo="${agent}"]`);
      assert.equal(await logo.evaluate((node) => node.getBoundingClientRect().width), 16);
      if (agent === 'codex') {
        await mkdir('.local/issue-properties-nov02', { recursive: true });
        await properties.screenshot({ path: '.local/issue-properties-nov02/properties.png' });
      }
    }
    await page.context().close();
  }
});

test('the sidebar\'s own row takes the person from an issue back to the dashboard', async () => {
  const page = await fixture.open();
  await openIssue(page);
  // DSH's sidebar is not in this page: its row for the page is a button named as the page and marked as the current one.
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="row" aria-current="page" aria-label="Dudu" style="position:fixed;left:0;top:0">Dudu</button>'));
  await page.locator('#row').click();
  await page.getByRole('region', { name: 'Issues', exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Back to Issues', exact: true }).count(), 0, 'the dashboard is back');
  await page.context().close();
});

test('opening a session prevents duplicate clicks, reports failure and allows the same session to be retried', async () => {
  const { issue } = fixture.issues.add({ title: 'Retry opening the stored session', session: 'dsh:stored-conversation' });
  const page = await fixture.open();
  await page.getByRole('button', { name: issue.title, exact: true }).click();
  await page.evaluate(() => {
    const target = window as any;
    target.__originalOpen = target.__opened;
    target.__opened = () => new Promise((_resolve, reject) => { target.__rejectOpen = reject; });
  });
  const open = page.getByRole('button', { name: 'Open session', exact: true });
  await open.click();
  assert.equal(await open.isDisabled(), true);
  await page.evaluate(() => (window as any).__rejectOpen(new Error('Test transport failure')));
  await page.getByText('Could not open this session.', { exact: true }).waitFor();
  assert.equal(await open.isDisabled(), false);
  await page.evaluate(() => { (window as any).__opened = (window as any).__originalOpen; });
  await open.click();
  assert.deepEqual(fixture.opened.at(-1), { sessionId: 'stored-conversation' });
  await page.context().close();
});
