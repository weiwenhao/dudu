// The session manager (docs/assistant.md 4.1): the list of sessions on the left, the one chosen on the right. The real interface in a
// real browser, with the plugin's answers about sessions scripted (see fixture.mjs); the issues are the real library.
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';

const MINUTE = 60_000;
const at = (minutes: number) => Date.now() - minutes * MINUTE;
const turns = {
  ci: [
    { role: 'user', text: 'CI 又超时了，帮我看看是哪一步慢。' },
    { role: 'assistant', text: '我先看了最近 10 次运行的耗时：\n\n- **安装依赖**：平均 6 分 40 秒\n- **单元测试**：稳定在 2 分钟左右\n\n变慢的是安装依赖这一步，缓存键里带着 `pnpm-lock.yaml` 的哈希。' },
    { role: 'user', text: '那把缓存键改成只看 lockfile 的内容。' },
    { role: 'assistant', text: '**注意：**已经改好。<b>raw html</b> 原样显示。\n\n![diagram](https://tracker.test/pixel.png)\n\n1. 第一步\n2. 第二步' },
  ],
  backup: [
    { role: 'user', text: '备份脚本昨晚又失败了，帮我看看原因。' },
    { role: 'assistant', text: '上传到对象存储的步骤超时，没有重试。' },
  ],
  contract: [{ role: 'user', text: '供应商发来合同修改意见。' }, { role: 'assistant', text: '一共 5 条，第 3 条要你定。' }],
  provider: [{ role: 'user', text: '重写 provider 插件。' }, { role: 'assistant', text: '好的。' }],
} as Record<string, Array<{ role: string; text: string }>>;

const calls = { read: [] as any[], load: [] as any[], takeover: [] as any[] };
let takeover: () => unknown = () => ({ outcome: 'error', code: 'takeover_failed' });
let takeoverDelay = 0; // milliseconds the scripted takeover takes
let reversed = false; // the list comes in the other order
let indexing = false; // the harness's conversations are still being read (the page asks again every two seconds)
let load: (body: any) => unknown = ({ id }) => ({ sessionId: `loaded-${id}`, workspaceId: 'ws' });
let managed: { key: string; id: number; ref: string } | null = null; // the issue that manages the session of that key

const base = [
  { key: 'claude:ci', id: 'ci', provider: 'claude', title: '排查 CI 超时', cwd: '/work/app', project: { name: 'app', path: '/work/app' }, updatedAt: at(27) },
  { key: 'dsh:provider', id: 'provider', provider: 'dsh', dshSessionId: 'provider', workspaceId: 'ws', agent: 'codex', title: '重写 provider 插件', cwd: '/work/app', project: { name: 'app', path: '/work/app' }, updatedAt: at(120) },
  { key: 'claude:contract', id: 'contract', provider: 'claude', dshSessionId: 'contract', title: '回复供应商合同的修改意见', cwd: '/work/docs', project: { name: 'docs', path: '/work/docs' }, updatedAt: at(300) },
  { key: 'claude:backup', id: 'backup', provider: 'claude', title: '备份脚本出错了', cwd: '/work/scripts', updatedAt: at(1500) },
] as Array<Record<string, any>>;
const rows = () => base.map((row) => (managed?.key === row.key ? { ...row, issue: { id: managed.id, ref: managed.ref } } : row));

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => {
  fixture = await startFixture({
    handlers: {
      'sessions/list': ({ query = '' }: { query?: string }) => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const sessions = rows().flatMap((row) => {
          if (!terms.length) return [row];
          const hit = turns[row.id]?.find((turn) => terms.every((term) => turn.text.toLowerCase().includes(term)));
          return hit || terms.every((term) => row.title.toLowerCase().includes(term)) ? [{ ...row, ...(hit ? { evidence: { role: hit.role, text: hit.text.replace(/[\n*`]/g, ' ').slice(0, 60) } } : {}) }] : [];
        });
        return { outcome: 'success', sessions: reversed ? [...sessions].reverse() : sessions, total: sessions.length, providers: [], indexing: { running: indexing } };
      },
      'sessions/read': (body: { id: string; before?: number }) => {
        calls.read.push(body);
        const all = turns[body.id] ?? [];
        // The newest two turns first; the cursor asks for the ones before.
        return body.before ? { outcome: 'success', messages: all.slice(0, -2), nextCursor: null }
          : { outcome: 'success', messages: all.length > 2 ? all.slice(-2) : all, nextCursor: all.length > 2 ? 2 : null };
      },
      'sessions/load': (body: any) => { calls.load.push(body); return load(body); },
      'sessions/takeover': async (body: any) => { calls.takeover.push(body); if (takeoverDelay) await new Promise((resolve) => setTimeout(resolve, takeoverDelay)); return takeover(); },
    },
  });
});
after(async () => { await fixture?.stop(); });
beforeEach(() => {
  calls.read.length = 0; calls.load.length = 0; calls.takeover.length = 0;
  takeover = () => ({ outcome: 'error', code: 'takeover_failed' });
  load = ({ id }) => ({ sessionId: `loaded-${id}`, workspaceId: 'ws' });
  managed = null;
  fixture.opened.length = 0;
  fixture.added.length = 0;
  reversed = false;
  indexing = false;
  takeoverDelay = 0;
});

async function openSessions(page: Page) {
  const entry = page.getByRole('toolbar', { name: 'Dudu menu', exact: true });
  await entry.getByRole('button', { name: 'Sessions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  await dialog.getByRole('option').first().waitFor();
  return dialog;
}
const option = (dialog: ReturnType<Page['locator']>, title: string) => dialog.getByRole('option', { name: new RegExp(title) });
/** The list answers a search a moment after the typing stops, so a count is waited for, not read. */
const optionCount = (page: Page, count: number) => page.waitForFunction((expected) => document.querySelectorAll('[role="dialog"] [role="option"]').length === expected, count);

test('the list is on the left and the chosen session is on the right; choosing only reads', async () => {
  const page = await fixture.open();
  const seen: string[] = [];
  page.on('request', (request) => seen.push(request.url()));
  const dialog = await openSessions(page);
  assert.equal(await option(dialog, '排查 CI 超时').getAttribute('aria-selected'), 'true', 'the newest session is the one shown');
  const [list, detail] = [await dialog.getByRole('listbox').boundingBox(), await dialog.getByRole('heading', { name: '排查 CI 超时' }).boundingBox()];
  assert.ok(list && detail && list.x + list.width <= detail.x, 'the list is left of the session');
  const history = dialog.getByRole('region', { name: 'Conversation history', exact: true });
  await history.getByText('已经改好。', { exact: false }).waitFor();

  // What an agent said is shown as the markdown it is; what it contains stays inert.
  assert.equal(await history.locator('strong', { hasText: '注意：' }).count(), 1, 'bold shows even before a full-width colon (CJK-friendly emphasis)');
  assert.equal(await history.locator('ol > li').count(), 2);
  await history.getByText('<b>raw html</b>', { exact: false }).waitFor();
  assert.equal(await history.locator('b, img, script').count(), 0, 'raw html is text and an image is not fetched');
  await history.getByText('diagram', { exact: true }).waitFor();
  assert.equal(seen.some((url) => url.includes('tracker.test')), false, 'no request is made for what a conversation mentions');
  // What the person said stays as written, in a bubble on the right.
  const bubble = await history.getByText('那把缓存键改成只看 lockfile 的内容。', { exact: true }).boundingBox();
  const region = await history.boundingBox();
  assert.ok(bubble && region && region.x + region.width - (bubble.x + bubble.width) < 40, 'the person\'s words sit on the right');

  await option(dialog, '重写 provider 插件').click();
  await dialog.getByRole('heading', { name: '重写 provider 插件' }).waitFor();
  await history.getByText('好的。', { exact: true }).waitFor();
  assert.deepEqual(calls.read.map((body) => body.id), ['ci', 'provider'], 'one read for each session chosen');
  assert.deepEqual([calls.load.length, calls.takeover.length], [0, 0], 'choosing neither imports nor takes over');
  await page.context().close();
});

test('a row says which agent and project it is, and which issue manages it', async () => {
  managed = { key: 'claude:contract', id: 1, ref: 'DOC-1' };
  const page = await fixture.open();
  const dialog = await openSessions(page);
  assert.deepEqual(await dialog.getByRole('option').evaluateAll((options) => options.map((item) => item.querySelector('[data-agent-logo]')?.getAttribute('data-agent-logo'))), ['claude', 'codex', 'claude', 'claude']);
  await option(dialog, '回复供应商合同的修改意见').getByText('DOC-1', { exact: true }).waitFor();
  assert.equal(await option(dialog, '排查 CI 超时').getByText('app', { exact: false }).count(), 1);
  // The header of the session chosen: its name, the agent as the interface names it, the project and when.
  await option(dialog, '重写 provider 插件').click();
  const header = dialog.getByRole('heading', { name: '重写 provider 插件' }).locator('xpath=../..');
  await header.getByText('ChatGPT', { exact: true }).waitFor();
  await header.getByText('app', { exact: true }).waitFor();
  await header.getByText('2h ago', { exact: true }).waitFor();
  await page.context().close();
});

test('searching marks the words where they were found, in the list and in the conversation', async () => {
  const page = await fixture.open();
  const dialog = await openSessions(page);
  await dialog.getByRole('searchbox', { name: 'Search sessions', exact: true }).fill('超时');
  await optionCount(page, 2); // the title of one and the contents of the other hold the word
  assert.ok(await option(dialog, '排查 CI 超时').locator('mark', { hasText: '超时' }).count() >= 1, 'the title is marked');
  await option(dialog, '备份脚本出错了').locator('mark', { hasText: '超时' }).waitFor();
  await option(dialog, '备份脚本出错了').click();
  await dialog.getByRole('region', { name: 'Conversation history', exact: true }).locator('mark', { hasText: '超时' }).waitFor();
  await dialog.getByRole('searchbox').fill('没有这个词');
  await dialog.getByText('No sessions', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
  await optionCount(page, 4);
  assert.equal(await dialog.locator('mark').count(), 0, 'nothing is marked without a search');
  await page.context().close();
});

test('the buttons follow the session: Import, Open session, Open issue', async () => {
  managed = { key: 'claude:contract', id: 1, ref: 'DOC-1' };
  const page = await fixture.open();
  const dialog = await openSessions(page);
  const buttons = async () => (await dialog.getByRole('button').allInnerTexts()).filter((text) => ['Import', 'Open session', 'Take over', 'Open issue'].includes(text.trim())).map((text) => text.trim());
  assert.deepEqual(await buttons(), ['Import', 'Take over'], 'a harness session that DSH does not have');
  await option(dialog, '重写 provider 插件').click();
  await dialog.getByRole('button', { name: 'Open session', exact: true }).waitFor();
  assert.deepEqual(await buttons(), ['Open session', 'Take over'], 'a session DSH already has');
  await option(dialog, '回复供应商合同的修改意见').click();
  await dialog.getByRole('button', { name: 'Open issue', exact: true }).waitFor();
  assert.deepEqual(await buttons(), ['Open session', 'Open issue'], 'a session an issue manages');
  await dialog.getByRole('button', { name: 'Take over', exact: true }).waitFor({ state: 'detached' });
  await page.context().close();
});

test('a session an issue manages is opened, not imported, even before DSH has it', async () => {
  managed = { key: 'claude:ci', id: 3, ref: 'APP-3' };
  const page = await fixture.open();
  const dialog = await openSessions(page);
  await option(dialog, '排查 CI 超时').getByText('APP-3', { exact: true }).waitFor();
  assert.deepEqual((await dialog.getByRole('button').allInnerTexts()).map((text) => text.trim()).filter((text) => ['Import', 'Open session', 'Take over', 'Open issue'].includes(text)), ['Open session', 'Open issue']);
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(calls.load.map((body) => body.id), ['ci'], 'opening it loads it into DSH on the way');
  await page.context().close();
});

test('what is shown stays shown while the list changes under it: no jumping to another session, no reading it again', async () => {
  indexing = true; // the page asks for the list again every two seconds while the conversations are being read
  const page = await fixture.open();
  const dialog = await openSessions(page);
  await dialog.getByRole('heading', { name: '排查 CI 超时' }).waitFor();
  while (calls.read.length < 1) await page.waitForTimeout(50); // the conversation is read a moment after the session is chosen
  await dialog.getByText('已经改好。', { exact: false }).waitFor();
  const reads = calls.read.length;
  reversed = true;
  await page.waitForTimeout(2600); // one more answer of the list, in the other order
  assert.ok(!/排查 CI 超时/.test(await dialog.getByRole('option').first().innerText()), 'the list did change: it is last in it now');
  await dialog.getByRole('heading', { name: '排查 CI 超时' }).waitFor();
  assert.equal(await option(dialog, '排查 CI 超时').getAttribute('aria-selected'), 'true');
  assert.equal(calls.read.length, reads, 'its conversation was not read again');
  await page.context().close();
});

test('Import loads the session into DSH and opens it; a session DSH has is only opened; a failure is said at the foot', async () => {
  const page = await fixture.open();
  let dialog = await openSessions(page);
  load = () => { throw new Error('no'); };
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Could not open this session.' }).waitFor();
  assert.deepEqual(fixture.opened, [], 'nothing was opened');
  assert.equal(await dialog.getByRole('button', { name: 'Import', exact: true }).isEnabled(), true, 'it can be tried again');
  load = ({ id }) => ({ sessionId: `loaded-${id}`, workspaceId: 'ws' });
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(fixture.opened, [{ sessionId: 'loaded-ci', workspaceId: 'ws' }]);
  assert.deepEqual(calls.load.map((body) => [body.provider, body.id]), [['claude', 'ci'], ['claude', 'ci']]);

  fixture.opened.length = 0;
  dialog = await openSessions(page);
  await option(dialog, '重写 provider 插件').click();
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(fixture.opened, [{ sessionId: 'provider', workspaceId: 'ws' }]);
  assert.equal(calls.load.length, 2, 'a session DSH has is not loaded again');
  await page.context().close();
});

test('Take over says why when it fails, opens the issue it makes, and Open issue opens the one that exists', async () => {
  const page = await fixture.open();
  let dialog = await openSessions(page);
  await dialog.getByRole('button', { name: 'Take over', exact: true }).hover();
  await page.getByRole('tooltip').filter({ hasText: 'Let Dudu manage this task' }).waitFor();
  await dialog.getByRole('button', { name: 'Take over', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Could not take over this session.' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Take over', exact: true }).isEnabled(), true, 'it can be tried again');
  await option(dialog, '重写 provider 插件').click();
  assert.equal(await dialog.getByRole('alert').count(), 0, 'the message belongs to the session it was said about');

  const { issue } = fixture.issues.add({ title: '排查 CI 超时', status: 'in_progress', project: { name: 'app', path: '/work/app' } }, { actor: 'dudu' }) as { issue: { id: number; ref: string } };
  takeover = () => ({ outcome: 'success', issue, session: { sessionId: 'loaded-ci', workspaceId: 'ws' } });
  takeoverDelay = 600;
  await option(dialog, '排查 CI 超时').click();
  await dialog.getByRole('button', { name: 'Take over', exact: true }).click();
  // While it works the dialog says so, and the buttons wait.
  await dialog.getByRole('status').filter({ hasText: 'Working…' }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Import', exact: true }).isDisabled(), true);
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(fixture.added, [{ sessionId: 'loaded-ci', workspaceId: 'ws' }], 'the session is listed in DSH\'s sidebar without being opened');
  assert.deepEqual(fixture.opened, []);
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  assert.deepEqual(calls.takeover.map((body) => [body.provider, body.id]), [['claude', 'ci'], ['claude', 'ci']]);
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).click();

  managed = { key: 'claude:ci', id: issue.id, ref: issue.ref };
  dialog = await openSessions(page);
  await option(dialog, '排查 CI 超时').getByText(issue.ref, { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Open issue', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  assert.equal(calls.takeover.length, 2, 'an issue that exists is opened, not made again');
  await page.context().close();
});

test('Load earlier reads the turns before and keeps the place; the keyboard moves through the list', async () => {
  const page = await fixture.open();
  const dialog = await openSessions(page);
  const history = dialog.getByRole('region', { name: 'Conversation history', exact: true });
  await history.getByText('已经改好。', { exact: false }).waitFor();
  assert.equal(await history.getByText('CI 又超时了，帮我看看是哪一步慢。', { exact: true }).count(), 0, 'it opens on the newest turns');
  await history.getByRole('button', { name: 'Load earlier', exact: true }).click();
  await history.getByText('CI 又超时了，帮我看看是哪一步慢。', { exact: true }).waitFor();
  assert.equal(await history.getByRole('button', { name: 'Load earlier', exact: true }).count(), 0, 'nothing older is left');
  assert.deepEqual(calls.read.map((body) => body.before ?? null), [null, 2]);

  await dialog.getByRole('searchbox').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await option(dialog, '排查 CI 超时').evaluate((node) => node === document.activeElement), true, 'ArrowDown from the search goes to the list');
  await page.keyboard.press('ArrowDown');
  assert.equal(await option(dialog, '重写 provider 插件').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await option(dialog, '备份脚本出错了').getAttribute('aria-selected'), 'true');
  await dialog.getByRole('heading', { name: '备份脚本出错了' }).waitFor();
  await page.context().close();
});

test('it fits a small window and the session list stays reachable', async () => {
  const page = await fixture.open({ size: { width: 430, height: 740 } });
  const dialog = await openSessions(page);
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 430 && bounds.y + bounds.height <= 740, JSON.stringify(bounds));
  const content = await dialog.evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, height: node.clientHeight, bottom: node.scrollHeight }));
  assert.ok(content.scroll <= content.width + 1 && content.bottom <= content.height + 1, JSON.stringify(content));
  await dialog.getByRole('button', { name: 'Take over', exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Take over', exact: true }).isVisible(), true);
  await page.context().close();
});
