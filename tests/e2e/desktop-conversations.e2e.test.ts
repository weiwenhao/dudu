// The approved Desktop conversation layout, in an isolated real DSH and Chrome. Only model output is scripted.
import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { startDudu } from './harness.mjs';

test('Desktop layouts share pins and completed reply order while retained conversations keep their drafts', { timeout: 180_000 }, async context => {
  let finishStream: () => void = () => {};
  const stream = new Promise<void>(done => { finishStream = done; });
  const dudu = await startDudu({
    viewport: { width: 1600, height: 1000 },
    model: { replies: [
      { when: 'DESKTOP-STREAM', stream: [{ text: '正在核对第一部分。' }, { text: '\n\n本轮流式检查已完成。', waitFor: stream }] },
      { say: '第一段说明。\n\n本轮修改已完成，检查通过。' },
    ] },
  });
  const shots = process.env.DUDU_E2E_SHOTS;
  const report: Record<string, unknown> = { runtime: process.env.DUDU_E2E_DSH ?? 'dsh', checks: [] };
  const checked = (text: string) => (report.checks as string[]).push(text);
  context.after(async () => {
    finishStream();
    try {
      if (shots) {
        await mkdir(shots, { recursive: true });
        await writeFile(resolve(shots, 'result.json'), JSON.stringify({
          ...report, status: context.passed ? 'passed' : 'failed', diagnostics: dudu.diagnostics(),
        }, null, 2));
      }
      await dudu.settle(context.name, !context.passed);
    } finally { await dudu.stop(); }
  });
  const project = { name: 'Dudu 检查', path: await realpath(dudu.folder) };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
  const titles = ['iOS 开发', 'Desktop 插件', 'UI 设计', '会话同步', '入口限流排查', 'AI Builder 版本发布', '跨设备的会话缓存与消息同步', '记忆系统调研'];
  const work: any[] = [];
  for (const title of titles) {
    const { issue } = await dudu.api('issues/add', { fields: { title, project, status: 'in_progress', brief: '只需回复检查结果。' } });
    assert.equal((await dudu.api('issues/assign', { id: issue.id, agent: 'deepseek' })).outcome, 'success');
    work.push((await dudu.api('issues/get', { id: issue.id })).issue);
  }
  const { issue: unassigned } = await dudu.api('issues/add', { fields: { title: '尚未分配的事项', project } });
  const { issue: child } = await dudu.api('issues/add', { fields: { title: '检查消息缓存', parent: work[0].id, project, agent: 'deepseek', status: 'todo' } });
  await dudu.api('issues/add', { fields: { title: '已完成的子事项', parent: work[0].id, project, status: 'done' } });
  await dudu.api('issues/add', { fields: { title: '待规划检查', project, status: 'backlog' } });
  const page = await dudu.openPanel();
  let stage = 'initial list';
  const errors: { stage: string; message: string; stack?: string }[] = [];
  const calls: string[] = [];
  page.on('pageerror', error => {
    errors.push({ stage, message: error.message, stack: error.stack?.replace(/https?:\/\/\S+/g, '[URL redacted]') });
    context.diagnostic(`${stage}: ${error.message}`);
  });
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/dudu/')) calls.push(path);
  });
  const widget = page.getByRole('region', { name: 'Issues', exact: true });
  const row = (title: string) => page.locator('.dudu-conversation-row').and(page.getByTitle(title, { exact: true }));
  const pane = page.locator('.dudu-conversation-pane');
  const composer = pane.locator('[contenteditable="true"][role="textbox"]');
  const shot = async (name: string) => {
    if (!shots) return;
    await mkdir(shots, { recursive: true });
    await page.mouse.move(285, 25);
    await page.screenshot({ path: resolve(shots, `${name}.png`) });
  };
  const layout = async (name: string) => {
    stage = `layout ${name}`;
    await widget.getByRole('button', { name: 'Display options', exact: true }).click();
    await page.getByRole('dialog', { name: 'Display options', exact: true }).getByRole('button', { name, exact: true }).click();
    await widget.getByRole('button', { name: 'Display options', exact: true }).click();
  };
  const select = async (issue: any) => {
    stage = `select ${issue.title}`;
    await row(issue.title).click();
    await pane.getByRole('heading', { name: `${issue.ref} ${issue.title}`, exact: true }).waitFor();
    await composer.waitFor();
  };
  await widget.locator(`[data-issue-row="${work[0].id}"]`).waitFor();
  await widget.getByRole('button', { name: 'Collapse In Progress', exact: true }).waitFor();
  await shot('01-list');
  await layout('Board');
  await page.locator(`[data-issue-card="${work[0].id}"]`).waitFor();
  await shot('02-board');
  await layout('Sessions');
  await page.locator('[data-issues-layout="chat"]').waitFor();
  await row(work[7].title).getByText('本轮修改已完成，检查通过。', { exact: true }).waitFor();
  const untouched = await dudu.api('home/list');
  const initial = untouched.conversations.find((entry: any) => entry.issue ? Boolean(entry.issue.session) : Boolean(entry.sessionId));
  assert.ok(initial?.issue, 'the latest available fixture conversation belongs to an assigned issue');
  await pane.getByRole('heading', { name: `${initial.issue.ref} ${initial.issue.title}`, exact: true }).waitFor();
  assert.equal(untouched.conversations.find((entry: any) => entry.issue?.id === work[0].id).unread, true);
  await row(unassigned.title).click();
  await pane.getByRole('heading', { name: `${initial.issue.ref} ${initial.issue.title}`, exact: true }).waitFor();
  assert.equal(Boolean((await dudu.api('issues/get', { id: unassigned.id })).issue.session), false, 'unassigned conversations wait for explicit assignment');
  await select(work[0]);
  await pane.getByText('本轮修改已完成，检查通过。', { exact: true }).waitFor();
  const originalComposer = await composer.elementHandle();
  await composer.fill('会话 A 尚未发送的草稿');
  stage = 'pin menus';
  const resumes = () => calls.filter(path => path === '/api/dudu/issues/resume').length;
  const resumeCount = resumes();
  for (const issue of work) {
    await row(issue.title).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  }
  await page.locator('.dudu-conversation-pins').getByRole('button', { name: new RegExp(work[7].title) }).waitFor();
  const pins = (await dudu.api('home/list')).pins;
  assert.equal(pins.length, 9);
  assert.equal(await composer.innerText(), '会话 A 尚未发送的草稿');
  assert.equal(resumes(), resumeCount, 'menu clicks and home refreshes never reopen the selected session');
  assert.equal(await composer.evaluate((node, original) => node === original, originalComposer), true, 'the composer DOM remains mounted');
  assert.equal(await page.locator('.dudu-conversation-pins').getByRole('button').count(), pins.length, 'all pinned conversations are available without expanding');
  await shot('03-chat-pins-all');
  await row(work[7].title).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();
  assert.equal((await dudu.api('home/list')).pins.includes(`issue:${work[7].id}`), false);
  await row(work[7].title).waitFor();
  await row(work[7].title).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await select(work[1]);
  await composer.fill('会话 B 的独立草稿');
  await select(work[0]);
  assert.equal(await composer.innerText(), '会话 A 尚未发送的草稿');
  checked('List / Board / Sessions, newest conversation on entry, all pins and unpin, portal clicks, and per-session drafts');

  // A real DSH streaming turn, held at the model boundary. No synthetic application events or sleeps.
  const before = await dudu.api('home/list');
  stage = 'streaming turn';
  const previous = before.conversations.find((entry: any) => entry.issue?.id === work[0].id);
  await composer.fill('DESKTOP-STREAM');
  await pane.getByRole('button', { name: 'Send message', exact: true }).click();
  await pane.getByText('正在核对第一部分。', { exact: true }).waitFor();
  const during = await dudu.api('home/list');
  const pending = during.conversations.find((entry: any) => entry.id === previous.id);
  assert.equal(pending.sessionState, 'processing');
  assert.equal(pending.receivedAt, previous.receivedAt);
  assert.equal(pending.preview, previous.preview);
  assert.deepEqual(during.conversations.map((entry: any) => entry.id), before.conversations.map((entry: any) => entry.id));
  await shot('05-stream-working');
  await select(work[1]);
  assert.equal(await composer.innerText(), '会话 B 的独立草稿');
  finishStream();
  await row(work[0].title).getByText('本轮流式检查已完成。', { exact: true }).waitFor();
  const after = await dudu.api('home/list');
  assert.equal(after.conversations[0].id, previous.id);
  assert.ok(after.conversations[0].receivedAt > previous.receivedAt);
  assert.equal(after.conversations[0].unread, true, 'completion offscreen produces unread');
  await shot('06-stream-completed');
  checked('Partial replies render live and retain old order/time/preview; completion publishes new order and unread');

  await select(work[0]);
  await row(work[0].title).getByRole('button', { name: 'Sub-issues', exact: true }).click();
  stage = 'open sub-issue';
  await page.getByRole('option').filter({ hasText: child.title }).click();
  await pane.getByRole('heading', { name: `${child.ref} ${child.title}`, exact: true }).waitFor();
  await composer.waitFor();
  await select(work[0]);
  await row(work[0].title).click({ button: 'right' });
  stage = 'rename';
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename', exact: true });
  await rename.getByRole('textbox').fill('iOS 开发检查');
  await rename.getByRole('button', { name: 'Save', exact: true }).click();
  work[0] = { ...work[0], title: 'iOS 开发检查' };
  await pane.getByRole('heading', { name: `${work[0].ref} ${work[0].title}`, exact: true }).waitFor();
  await row(work[0].title).click({ button: 'right' });
  stage = 'details and browser Back';
  await page.getByRole('menuitem', { name: 'Open issue', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  await page.goBack();
  await page.locator('[data-issues-layout="chat"]').waitFor();
  await row(work[0].title).waitFor();
  checked('Sub-issue opens its own conversation, Rename syncs the inline header, Details and browser Back remain separate');

  await layout('List');
  const pinnedList = widget.locator(`[data-issue-row="${work[0].id}"]`);
  await pinnedList.waitFor();
  assert.equal((await dudu.api('issues/get', { id: work[0].id })).issue.pinned, true);
  await pinnedList.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();
  await page.waitForFunction(({ ids, last }) => {
    const order = [...document.querySelectorAll('[data-issue-row]')].map(node => Number(node.getAttribute('data-issue-row'))).filter(id => ids.includes(id));
    return order.length === ids.length && order.at(-1) === last;
  }, { ids: work.map(issue => issue.id), last: work[0].id });
  assert.equal(await page.locator('[data-dudu-conversation-dialog]').count(), 0, 'list menu actions do not open a conversation');
  await pinnedList.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await page.waitForFunction(({ ids, first }) => {
    const order = [...document.querySelectorAll('[data-issue-row]')].map(node => Number(node.getAttribute('data-issue-row'))).filter(id => ids.includes(id));
    return order.length === ids.length && order[0] === first;
  }, { ids: work.map(issue => issue.id), first: work[0].id });
  const listPins = await dudu.api('home/list');
  assert.equal(listPins.pins.includes(`issue:${work[0].id}`), true);
  await shot('10-list-pinned');
  checked('Normal list menu pin/unpin shares the home store and keeps pinned issues first within their workflow group');
  await layout('Sessions');
  const scopes = widget.getByRole('tablist', { name: 'Issues', exact: true });
  const pinnedConversation = page.locator('.dudu-conversation-pins').getByRole('button', { name: new RegExp(work[7].title) });
  await scopes.getByRole('tab', { name: 'Backlog', exact: true }).click();
  await row('待规划检查').waitFor();
  assert.equal(await row('Dudu').count(), 0);
  await pinnedConversation.waitFor();
  await scopes.getByRole('tab', { name: 'Active', exact: true }).click();
  await row(work[0].title).waitFor();
  // Persistence is a cold reopen check. Live reconnect during host shutdown is investigated separately from this feature.
  await page.goto('about:blank');
  stage = 'host restart';
  await dudu.restart();
  stage = 'open after restart';
  await page.goto(dudu.base);
  await page.getByRole('button', { name: 'Dudu', exact: true }).first().click();
  await page.locator('[data-issues-layout="chat"]').waitFor();
  await page.locator('.dudu-conversation-pins').getByRole('button', { name: new RegExp(work[7].title) }).waitFor();
  const persistedPins = (await dudu.api('home/list')).pins;
  assert.deepEqual([...persistedPins].sort(), [...pins].sort());
  const anonymous = await fetch(`${dudu.base}/api/dudu/home/pin`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'assistant', pinned: false }),
  });
  assert.equal(anonymous.status, 401, 'pin writes require DSH authentication');
  checked('Layout and shared pins survive a host restart, planning scopes ordinary rows without changing pins, and pin writes require authentication');
  await shot('07-chat-restored');
  await widget.getByRole('button', { name: 'Display options', exact: true }).click();
  await shot('08-display-menu');
  await widget.getByRole('button', { name: 'Display options', exact: true }).click();
  await row(work[0].title).click({ button: 'right' });
  await shot('09-context-menu');
  await page.keyboard.press('Escape');
  report.pageErrors = errors;
  report.modelRequests = dudu.model.requests.length;
  report.savedPins = persistedPins;
  assert.deepEqual(errors, [], 'the real page has no uncaught script errors');
});
