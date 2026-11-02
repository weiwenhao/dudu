// Session management and Office in the real DSH, reading real plugin data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { panelAction, startDudu } from './harness.mjs';

const DAY = 86400000;
const noon = (days = 0) => { const date = new Date(); date.setHours(12, 0, 0, 0); return date.getTime() + days * DAY; };
const hasClaude = (() => { try { execFileSync('which', ['claude'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// A Claude Code transcript as it writes one: the first thing said, and an answer.
const session = (id: string, prompt: string) => [
  { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: prompt }, uuid: 'u1', timestamp: '2026-10-30T10:00:00.000Z', entrypoint: 'cli', cwd: process.cwd(), sessionId: id, gitBranch: 'main' },
  { parentUuid: 'u1', isSidechain: false, type: 'assistant', uuid: 'a1', timestamp: '2026-10-30T10:00:05.000Z', cwd: process.cwd(), message: { role: 'assistant', id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '好的，先看超时的日志。' }] } },
].map((record) => `${JSON.stringify(record)}\n`).join('');
const longId = '33333333-3333-4333-8333-333333333333';
const longSession = Array.from({ length: 12 }, (_, n) => [
  { parentUuid: n ? `a${n - 1}` : null, type: 'user', uuid: `u${n}`, sessionId: longId, cwd: process.cwd(), timestamp: `2026-10-30T10:${String(n).padStart(2, '0')}:00.000Z`, message: { role: 'user', content: n ? `第 ${n + 1} 轮提问` : '长会话预览验收' } },
  { parentUuid: `u${n}`, type: 'assistant', uuid: `a${n}`, sessionId: longId, timestamp: `2026-10-30T10:${String(n).padStart(2, '0')}:05.000Z`, message: { role: 'assistant', content: [{ type: 'text', text: `第 ${n + 1} 轮回答` }] } },
]).flat().map((record) => `${JSON.stringify(record)}\n`).join('');

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => {
  dudu = await startDudu({ model: { replies: [
    { when: (context: any) => context.system.includes('You are dudu taking over'), say: JSON.stringify({ brief: '排查 CI 超时的原因。智能体已开始查看超时日志，尚未确认根因。', status: 'in_progress', ask: '' }) },
  ] }, files: {
    '.claude/projects/-work-app/11111111-1111-4111-8111-111111111111.jsonl': session('11111111-1111-4111-8111-111111111111', '排查 CI 超时的原因'),
    '.claude/projects/-work-app/22222222-2222-4222-8222-222222222222.jsonl': session('22222222-2222-4222-8222-222222222222', '接管 CI 超时排查'),
    [`.claude/projects/-work-app/${longId}.jsonl`]: longSession,
  } });
  const add = (fields: Record<string, unknown>) => dudu.api('issues/add', { fields });
  await add({ title: '昨天到期的事', status: 'todo', priority: 'high', dueAt: noon(-1) });
  await add({ title: '三天后到期的事', status: 'todo', priority: 'low', dueAt: noon(3) });
  await add({ title: '没有日期的事', status: 'todo', priority: 'low' });
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

/** Makes room: Issues is pulled to the left, to nine of the fifteen columns (Shift + ← from the keyboard), so the others have somewhere to go. */
async function room(page: Page) {
  await panelAction(page, 'Edit layout');
  await page.locator('.db-card').first().focus();
  for (let n = 0; n < 6; n++) await page.keyboard.press('Shift+ArrowLeft');
}
async function addWidget(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await page.getByRole('button', { name: `Add ${name}` }).click();
  await page.getByRole('region', { name }).waitFor();
}

test('Sessions previews without importing or taking over, shows coloured logos and the take-over hint, and imports only when chosen', { skip: !hasClaude && 'the claude command is not installed' }, async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await panelAction(page, 'Sessions');
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  const open = dialog.getByRole('option', { name: /排查 CI 超时的原因/ });
  await open.waitFor();
  assert.equal(await dialog.getByRole('button', { name: /Let Dudu manage:/ }).count(), 0, 'no row carries its own take-over icon: the session chosen has its buttons');
  const searchBox = await dialog.getByRole('searchbox').boundingBox();
  const bounds = await dialog.boundingBox();
  assert.ok(searchBox && bounds && searchBox.y - bounds.y >= 15, 'search has deliberate space above it');
  await dialog.getByRole('searchbox', { name: 'Search sessions' }).fill('超时的日志'); // a word the answer holds, not the title
  await open.waitFor();
  await dialog.getByRole('searchbox', { name: 'Search sessions' }).fill('没有这个词');
  await dialog.getByText('No sessions').waitFor();
  await dialog.getByRole('searchbox', { name: 'Search sessions' }).fill('超时');
  const issuesBefore = (await dudu.api('issues/counts')).total;
  await open.click();
  const history = dialog.getByRole('region', { name: 'Conversation history', exact: true });
  await history.getByText('好的，先看超时的日志。', { exact: true }).waitFor();
  assert.equal((await dudu.api('dashboard/get')).layout.widgets.some((item: any) => item.type === 'sessions'), false);
  assert.equal((await dudu.api('issues/counts')).total, issuesBefore, 'a preview does not create an issue');
  const native = (await dudu.api('sessions/list', { query: '排查 CI 超时的原因' })).sessions.find((row: any) => row.id === '11111111-1111-4111-8111-111111111111');
  assert.equal(native.dshSessionId, undefined, 'preview does not import into DSH');
  assert.equal(await open.locator('[data-agent-logo]').evaluate((node) => getComputedStyle(node).color), 'rgb(217, 119, 87)');
  await dialog.getByRole('button', { name: 'Take over', exact: true }).hover();
  await page.getByRole('tooltip').filter({ hasText: 'Let Dudu manage this task' }).waitFor();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('region', { name: 'Dashboard' }).waitFor({ state: 'detached', timeout: 30_000 });
  await page.getByText('排查 CI 超时的原因').first().waitFor();
  assert.equal((await dudu.api('issues/counts')).total, issuesBefore, 'import alone does not take over');
  await page.close();
});

test('Sessions previews earlier messages beside the list and rejects invalid read targets', { skip: !hasClaude && 'the claude command is not installed' }, async () => {
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await panelAction(page, 'Sessions');
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  await dialog.getByRole('searchbox').fill('长会话预览验收');
  await dialog.getByRole('option', { name: /长会话预览验收/ }).click();
  const history = dialog.getByRole('region', { name: 'Conversation history', exact: true });
  await history.getByText('第 12 轮回答', { exact: true }).waitFor();
  assert.equal(await history.getByText('第 1 轮回答', { exact: true }).count(), 0);
  await history.getByRole('button', { name: 'Load earlier', exact: true }).click();
  await history.getByText('第 1 轮回答', { exact: true }).waitFor();
  await history.getByText('第 12 轮回答', { exact: true }).waitFor();
  assert.equal(await history.getByRole('button', { name: 'Load earlier', exact: true }).count(), 0);
  for (const fields of [
    { provider: 'other', id: longId }, { provider: 'dsh', id: 'dudu-assistant-hidden' },
    { provider: 'claude', id: longId, before: -1 },
  ]) assert.equal((await dudu.api('sessions/read', fields)).outcome, 'error');
  await page.close();
});

test('Sessions includes existing DSH conversations with no redundant title and opens the same conversation', async () => {
  const { issue } = await dudu.api('issues/add', { fields: {
    title: '会话管理检查', brief: 'Reply ok.', agent: 'deepseek', project: { name: 'checks', path: dudu.folder },
  } });
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await panelAction(page, 'Sessions');
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  assert.equal(await dialog.getByRole('heading', { name: 'Sessions', exact: true }).count(), 1, 'the dialog names itself once');
  const search = dialog.getByRole('searchbox', { name: 'Search sessions' });
  await search.fill('会话管理检查');
  await dialog.getByRole('option', { name: /会话管理检查/ }).click();
  await dialog.getByRole('region', { name: 'Conversation history', exact: true }).getByText('会话管理检查\n\nReply ok.', { exact: true }).waitFor();
  assert.equal(await dialog.locator('[data-agent-logo="deepseek"]').first().evaluate((node) => getComputedStyle(node).color), 'rgb(77, 107, 254)');
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await page.getByRole('region', { name: 'Dashboard' }).waitFor({ state: 'detached' });
  await page.getByText('会话管理检查 Reply ok.', { exact: true }).first().waitFor();
  const result = await dudu.api('sessions/list', { query: '会话管理检查' });
  const current = (await dudu.api('issues/get', { id: issue.id })).issue;
  assert.ok(result.sessions.some((row: any) => row.dshSessionId === current.session?.slice(4)));
  await page.close();
});

test('Sessions takes over an existing native conversation once, preserves its task and opens it in the current DSH', { skip: !hasClaude && 'the claude command is not installed' }, async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  const already = (await dudu.api('sessions/list', { query: '接管 CI 超时排查' })).sessions.find((row: any) => row.id === id);
  assert.ok(already);
  assert.equal(already.dshSessionId, undefined, 'this conversation has not been loaded into the current DSH');
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel();
  await panelAction(page, 'Sessions');
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  await dialog.getByRole('searchbox').fill('接管 CI 超时排查');
  const workersBefore = dudu.model.requests.filter((request: any) => request.tools.length).length;
  await dialog.getByRole('option', { name: /接管 CI 超时排查/ }).click();
  await dialog.getByRole('region', { name: 'Conversation history', exact: true }).getByText('好的，先看超时的日志。', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Take over', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText('排查 CI 超时的原因。智能体已开始查看超时日志，尚未确认根因。', { exact: true }).waitFor();
  const result = await dudu.api('issues/search', { q: '接管 CI 超时排查' });
  const issue = result.items.find((issue: any) => issue.sourceRef === `claude:${id}`);
  assert.ok(issue);
  assert.equal(issue.agent, 'claude');
  assert.equal(issue.title, already.title);
  assert.equal(issue.project.path, already.cwd);
  const loaded = (await dudu.api('sessions/list', { query: '接管 CI 超时排查' })).sessions.find((row: any) => row.id === id);
  assert.ok(loaded.dshSessionId, 'takeover imports the existing history into the current DSH');
  assert.equal(issue.session, `dsh:${loaded.dshSessionId}`);
  assert.equal(issue.status, 'in_progress');
  const repeated = await dudu.api('sessions/takeover', { provider: 'claude', id });
  assert.equal(repeated.outcome, 'no_op');
  assert.equal(repeated.issue.id, issue.id);
  assert.equal(dudu.model.requests.filter((request: any) => request.tools.length).length, workersBefore, 'takeover never starts a worker turn');
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).click();
  await panelAction(page, 'Sessions');
  await dialog.getByRole('searchbox').fill('接管 CI 超时排查');
  // The session has its issue now, so Take over has become Open issue (nothing is made a second time).
  await dialog.getByRole('button', { name: 'Open issue', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open session', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor({ state: 'hidden' });
  await page.getByText('接管 CI 超时排查', { exact: true }).first().waitFor();
  const opened = (await dudu.api('issues/get', { id: issue.id })).issue;
  assert.match(opened.session, /^dsh:/);
  assert.equal((await dudu.api('issues/list', { tab: 'all' })).items.filter((candidate: any) => candidate.sourceRef === issue.sourceRef).length, 1);
  await page.close();
});

test('Office puts people only on assigned Active issues, in real WebGL, and a name tag opens its issue', async () => {
  await dudu.api('issues/add', { fields: {
    title: '已分配的办公室事项', agent: 'claude', session: 'claude:11111111-1111-4111-8111-111111111111',
    project: { name: 'checks', path: dudu.folder },
  } });
  await dudu.api('dashboard/reset');
  const page = await dudu.openPanel({ viewport: { width: 1600, height: 960 } });
  await room(page);
  await addWidget(page, 'Office');
  await page.getByRole('button', { name: 'Done' }).click();
  const office = page.getByRole('region', { name: 'Office' });
  const active = (await dudu.api('issues/list', { tab: 'active', limit: 200 })).items as Array<{ id: number; title: string; agent: string | null }>;
  const assigned = active.filter((issue) => issue.agent);
  await office.locator('[data-office-stage][data-mode="scene"]').waitFor({ timeout: 30_000 });
  await office.locator('[data-office-tag]').first().waitFor();
  assert.equal(await office.locator('[data-office-tag]').count(), assigned.length, 'one name tag for each assigned Active issue');
  assert.equal(await office.getAttribute('data-office-unassigned'), String(active.length - assigned.length));
  assert.equal(await office.locator('header [data-agent-logo]').count(), 0, 'agent legend does not consume header space');
  assert.equal(await office.getByText(/unassigned/).count(), 0, 'the unassigned count is an attribute of the section, not text in the widget');
  await office.getByRole('img', { name: new RegExp(`^Office: ${assigned.length} issues?`) }).waitFor();
  await office.locator('[data-office-tag]').first().click();
  await page.getByRole('button', { name: 'Back to Issues' }).waitFor();
  await page.close();
});
