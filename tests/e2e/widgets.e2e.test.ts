// The small widgets in the real thing: each is added from the Add widget list, reads the plugin, and shows what it reads.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

const DAY = 86400000;
const noon = (days = 0) => { const date = new Date(); date.setHours(12, 0, 0, 0); return date.getTime() + days * DAY; };
const hasClaude = (() => { try { execFileSync('which', ['claude'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// A Claude Code transcript as it writes one: the first thing said, and an answer.
const session = (id: string, prompt: string) => [
  { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: prompt }, uuid: 'u1', timestamp: '2026-10-30T10:00:00.000Z', entrypoint: 'cli', cwd: process.cwd(), sessionId: id, gitBranch: 'main' },
  { parentUuid: 'u1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-10-30T10:00:05.000Z', cwd: process.cwd(), message: { role: 'assistant', id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '好的，先看超时的日志。' }] } },
].map((record) => `${JSON.stringify(record)}\n`).join('');

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => {
  dudu = await startDudu({ files: { '.claude/projects/-work-app/11111111-1111-4111-8111-111111111111.jsonl': session('11111111-1111-4111-8111-111111111111', '排查 CI 超时的原因') } });
  const add = (fields: Record<string, unknown>) => dudu.api('issues/add', { fields });
  await add({ title: '昨天到期的事', status: 'todo', priority: 'high', dueAt: noon(-1) });
  await add({ title: '三天后到期的事', status: 'todo', priority: 'low', dueAt: noon(3) });
  await add({ title: '没有日期的事', status: 'todo', priority: 'low' });
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

/** Makes room: Issues is pulled to the left half (Shift + ← from the keyboard), so the others have somewhere to go. */
async function room(page: Page) {
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await page.locator('.db-card').first().focus();
  for (let n = 0; n < 4; n++) await page.keyboard.press('Shift+ArrowLeft');
}
async function addWidget(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('button', { name: `Add ${name}` }).click();
  await page.getByRole('region', { name }).waitFor();
}

test('Overview counts what is overdue and due this week; Upcoming lists what has a date, soonest first; Stuck says when nothing is', async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await room(page);
  await addWidget(page, 'Overview');
  await addWidget(page, 'Upcoming');
  await addWidget(page, 'Stuck');
  const overview = page.getByRole('region', { name: 'Overview' });
  await overview.getByText('Overdue').waitFor();
  // One overdue; two due within a week (the overdue one is before today, the one in three days is in the week).
  await overview.locator('span.text-3xl\\/9').first().filter({ hasText: '1' }).waitFor();
  const upcoming = page.getByRole('region', { name: 'Upcoming' });
  const lines = upcoming.getByRole('button');
  await lines.first().waitFor();
  assert.deepEqual(await lines.evaluateAll((nodes) => nodes.map((node) => node.textContent ?? '').map((text) => (/昨天到期的事|三天后到期的事/.exec(text) ?? [''])[0])), ['昨天到期的事', '三天后到期的事'], 'only issues with a due date, soonest first');
  await page.getByRole('region', { name: 'Stuck' }).getByText('Nothing is stuck').waitFor();
  await page.close();
});

test('a line of Upcoming opens that issue', async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await room(page);
  await addWidget(page, 'Upcoming');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('region', { name: 'Upcoming' }).getByRole('button', { name: /三天后到期的事/ }).click();
  await page.getByRole('button', { name: 'Back to Issues' }).waitFor();
  await page.getByText('三天后到期的事').first().waitFor();
  await page.close();
});

test('Sessions lists what Claude Code already has, finds words inside, and opens one in DSH', { skip: !hasClaude && 'the claude command is not installed' }, async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await room(page);
  await addWidget(page, 'Sessions');
  await page.getByRole('button', { name: 'Done' }).click();
  const widget = page.getByRole('region', { name: 'Sessions' });
  await widget.getByRole('button', { name: /排查 CI 超时的原因/ }).waitFor();
  await widget.getByRole('searchbox', { name: 'Search sessions' }).fill('超时的日志'); // a word the answer holds, not the title
  await widget.getByRole('button', { name: /排查 CI 超时的原因/ }).waitFor();
  await widget.getByRole('searchbox', { name: 'Search sessions' }).fill('没有这个词');
  await widget.getByText('No sessions').waitFor();
  await widget.getByRole('searchbox', { name: 'Search sessions' }).fill('超时');
  await widget.getByRole('button', { name: /排查 CI 超时的原因/ }).click();
  // The session is written into DSH and opened: the panel gives way to it and its first message is on the page.
  await page.getByRole('region', { name: 'Dashboard' }).waitFor({ state: 'detached', timeout: 30_000 });
  await page.getByText('排查 CI 超时的原因').first().waitFor();
  await page.close();
});
