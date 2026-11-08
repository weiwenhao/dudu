// The real DSH loop, scoped tools, durable session and built Pet interface. Only the model is scripted.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { panelAction, startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let createSystem = '';
before(async () => {
  dudu = await startDudu({ patch: '- id: agent-preset-registry\n  config:\n    default: ptc', model: {
    models: [
      { id: 'mock-1', name: 'Mock', contextWindow: 100000, input: ['text', 'image'] },
      { id: 'mock-2', name: 'Mock Vision', contextWindow: 100000, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high', max: 'max' }, compat: { supportsReasoningEffort: true } },
    ],
    replies: [
    { when: (context: any) => !context.prompt.includes('CHAT-VISION') && Array.isArray(context.current?.content) && context.current.content.some((part: any) => part.type === 'image_url'), say: '收到图片。' },
    { when: 'CHAT-VISION', say: '图片和模型设置都收到了。' },
    { when: 'CHAT-EXPAND', say: '展开后仍是这段对话。' },
    { when: (context: any) => {
      if (!context.prompt.includes('CHAT-CREATE')) return false;
      createSystem = context.system;
      return true;
    }, calls: [
      { name: 'rules_read', arguments: { name: 'TRIAGE.md' } },
      { name: 'issues_add', arguments: { fields: { title: '合同续费', brief: '周四前处理' } } },
    ], then: () => '已加到 Issues。' },
    { when: 'CHAT-MEMORY', calls: [{ name: 'memory_remember', arguments: { text: '合同先抄送法务' } }], then: () => '记下了。' },
    { when: 'CHAT-DASH', calls: [{ name: 'dashboard_add', arguments: { type: 'quota' } }], then: () => '已加 Quota。' },
    { when: 'CHAT-RECALL', calls: [{ name: 'memory_recall', arguments: { query: '合同先抄送法务' } }], then: (results: string[]) => `找到了：${results.at(-1)}` },
    { when: 'CHAT-FORBIDDEN', calls: [{ name: 'terminal_open', arguments: { command: 'touch forbidden.txt' }, force: true }], then: () => '没有执行。' },
    { when: 'CHAT-SLOW', say: '这个回复应该被停止。', delay: 8000 },
    { when: 'CHAT-AFTER-STOP', say: '可以继续。' },
    { when: 'CHAT-OUTSIDE', say: '收起后仍会收到。', delay: 1500 },
    { when: 'CHAT-BUBBLE-DISMISS', say: '可以关闭这条回复气泡。', delay: 1500 },
    { when: 'CHAT-PRIVATE', calls: [{ name: 'memory_remember', arguments: { text: '海棠专用代码是 AX8129' } }], then: () => '已记下这条。' },
    { when: 'CHAT-FORGOTTEN', calls: [{ name: 'memory_recall', arguments: { query: 'AX8129' } }], then: (results: string[]) => `召回结果：${results.at(-1)}` },
    { when: (context: any) => context.system.includes('assignment step'), say: '{"agent":null,"reason":"没有匹配的规则"}' },
    { when: (context: any) => context.tools.length === 0, say: '{"changes":[]}' },
  ] } });
});

test('pet composer sends images through DSH, selects model and effort in place, and restores both after reload', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  // The model and its effort are one box: the button's name is the model, then the effort; a row of the box opens its list.
  await dialog.getByRole('button', { name: /^Mock$/ }).click();
  await page.getByRole('menuitem', { name: /^Model/ }).click();
  await page.getByRole('menuitemradio', { name: 'Mock Vision', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: /^Mock Vision/ }).click();
  await page.getByRole('menuitem', { name: /^Reasoning effort/ }).click();
  assert.equal(await page.getByRole('menuitemradio', { name: 'Low', exact: true }).count(), 1);
  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click();
  await dialog.getByRole('button', { name: /^Mock Vision\s*High$/ }).waitFor();
  const png = await readFile(new URL('../../host/dudu-plugin/ui/pet/pet.png', import.meta.url));
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'vision.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('img', { name: 'vision.png', exact: true }).waitFor();
  await chat(page, 'CHAT-VISION', '图片和模型设置都收到了。');
  const received = dudu.model.requests.find((request: any) => request.messages.some((message: any) => message.role === 'user' && message.text.includes('CHAT-VISION') && message.images.length));
  assert.ok(received, JSON.stringify(dudu.model.requests.map(({ model, prompt, reasoningEffort, tools, messages }: any) => ({
    model, prompt, reasoningEffort, tools: tools.length, messages: messages.map((message: any) => ({ role: message.role, text: message.text, images: message.images.length })),
  }))));
  assert.equal(received.model, 'mock-2');
  assert.equal(received.reasoningEffort, 'high');
  assert.ok(received.messages.some((message: any) => message.role === 'user' && message.images.some((url: string) => url.startsWith('data:image/'))));
  await page.reload();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await dialog.getByRole('button', { name: /^Mock Vision\s*High$/ }).waitFor();
  await dialog.getByRole('img', { name: 'vision.png', exact: true }).waitFor();
  assert.ok(await dialog.getByRole('img', { name: 'vision.png', exact: true }).evaluate((node) => (node as HTMLImageElement).naturalWidth > 0));
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'only-image.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByText('收到图片。', { exact: true }).waitFor({ timeout: 30_000 });
  await dialog.getByRole('button', { name: /^Mock Vision/ }).click();
  await page.getByRole('menuitem', { name: /^Model/ }).click();
  await page.getByRole('menuitemradio', { name: 'Mock', exact: true }).click();
  await dialog.getByRole('button', { name: /^Mock$/ }).waitFor();
  await page.close();
});

test('pet Max effort survives closing, reload and host restart and reaches the actual model request', async context => {
  let page = await dudu.openPanel();
  context.after(async () => { if (!page.isClosed()) await page.close(); });
  const open = async () => {
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    return page.getByRole('dialog', { name: 'Dudu', exact: true });
  };
  let dialog = await open();
  await dialog.getByRole('button', { name: /^Mock$/ }).click();
  await page.getByRole('menuitem', { name: /^Model/ }).click();
  await page.getByRole('menuitemradio', { name: 'Mock Vision', exact: true }).click();
  await dialog.getByRole('button', { name: /^Mock Vision/ }).click();
  await page.getByRole('menuitem', { name: /^Reasoning effort/ }).click();
  await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click();
  const selected = () => dialog.getByRole('button', { name: /^Mock Vision\s*Max$/ });
  await selected().waitFor();
  // Reselecting the current model must retain the explicit effort, rather than applying its default again.
  await selected().click();
  await page.getByRole('menuitem', { name: /^Model/ }).click();
  await page.getByRole('menuitemradio', { name: 'Mock Vision', exact: true }).click();
  await selected().waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  dialog = await open();
  await selected().waitFor();
  await page.reload();
  dialog = await open();
  await selected().waitFor();
  await page.close();
  await dudu.restart();
  page = await dudu.openPanel();
  dialog = await open();
  await selected().waitFor();
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill('CHAT-MAX-PERSISTENCE');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByText('ok', { exact: true }).waitFor();
  const received = dudu.model.requests.find((request: any) => request.prompt === 'CHAT-MAX-PERSISTENCE' && request.tools.length);
  assert.ok(received);
  assert.equal(received.model, 'mock-2');
  assert.equal(received.reasoningEffort, 'max');
  await selected().waitFor();
  await page.reload();
  dialog = await open();
  await selected().waitFor();
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

async function chat(page: Page, text: string, answer: string | RegExp) {
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByText(answer, { exact: true }).waitFor({ timeout: 30_000 });
}

test('scoped tools use native execution under a PTC preset and their conversation survives host restart', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await chat(page, 'CHAT-MEMORY：记住合同先抄送法务', '记下了。');
  const requested = dudu.model.requests.find((request: any) => request.prompt.startsWith('CHAT-MEMORY'));
  assert.ok(requested.tools.includes('memory_remember'));
  assert.ok(!requested.tools.includes('run_code'), 'Dudu uses the host native executor in its own scope');
  const sessionId = (await dudu.api('assistant/state')).conversation.sessionId;
  assert.ok((await dudu.api('memory/records')).records.some((record: any) => record.text === '合同先抄送法务'));
  await dudu.restart();
  await page.reload();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Dudu', exact: true }).getByText('记下了。', { exact: true }).waitFor();
  assert.equal((await dudu.api('assistant/state')).conversation.sessionId, sessionId);
});

test('the header opens the same complete DSH conversation without another prompt, and keeps the floating draft', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await chat(page, 'CHAT-EXPAND', '展开后仍是这段对话。');
  const target = (await dudu.api('assistant/state')).conversation.sessionId;
  const requests = () => dudu.model.requests.filter((request: any) => request.prompt === 'CHAT-EXPAND' && request.tools.length);
  const count = requests().length;
  await dialog.locator('textarea').fill('展开前未发送的文字');
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Select model, current/ }).waitFor();
  await page.getByText('展开后仍是这段对话。', { exact: true }).waitFor();
  assert.equal((await dudu.api('assistant/state')).conversation.sessionId, target);
  assert.equal(requests().length, count, 'opening the complete view starts no work');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  assert.equal(await dialog.locator('textarea').inputValue(), '展开前未发送的文字');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('展开后仍是这段对话。', { exact: true }).waitFor();
  await page.close();
});

test('dudu forwards the current reply as the exact work message, without role or management labels', async () => {
  const project = { name: 'Reply checks', path: await realpath(dudu.folder) };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
  const made = await dudu.api('issues/add', { fields: { title: 'Todo 组件', project } });
  await dudu.api('issues/assign', { id: made.issue.id, agent: 'deepseek' });
  const issue = (await dudu.api('issues/get', { id: made.issue.id })).issue;
  assert.ok(issue.session);
  const text = 'Todo 做成独立组件，不与 issue 打通，不需要双向同步。';
  const before = dudu.model.replies;
  dudu.model.replies = [{
    when: (context: any) => context.prompt === text && context.tools.includes('sessions_forward'),
    calls: [
      { name: 'sessions_send', arguments: { session: issue.session, text: '所有者的答复：' + text } },
      { name: 'sessions_forward', arguments: { session: issue.session } },
    ], then: () => '已转发原话。',
  }, ...before];
  try {
    const page = await dudu.openPanel();
    await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
    await chat(page, text, '已转发原话。');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Dudu"] button[aria-label="Stop"]'));
    const worker = dudu.model.requests.find((request: any) => request.prompt === text && request.tools.length && !request.tools.includes('sessions_forward'));
    assert.ok(worker, 'the real worker received the exact original words');
    assert.ok(!dudu.model.requests.some((request: any) => request.prompt.startsWith('所有者的答复：') && request.tools.length), 'the reported generated wrapper is refused before delivery');
    assert.ok(!worker.tools.some((name: string) => name.startsWith('issues_')));
    await page.close();
  } finally { dudu.model.replies = before; }
});


test('DSH opens on the dashboard; chat changes issues, memory and layout through its scoped tools, and survives restart', async () => {
  const page = await dudu.openPanel({ selectPanel: false });
  await page.getByRole('region', { name: 'Issues', exact: true }).waitFor({ timeout: 60_000 });
  const initialized = await dudu.api('assistant/conversation');
  assert.equal(initialized.outcome, 'success', initialized.message);
  assert.equal(initialized.model.model, 'mock-1');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await chat(page, 'CHAT-CREATE：合同续费', '已加到 Issues。');
  await page.getByRole('dialog', { name: 'Dudu', exact: true }).getByText('Issue added', { exact: true }).waitFor();
  const created = await dudu.api('issues/search', { q: '合同续费' });
  assert.equal(created.total, 1);
  assert.equal(created.items[0].ask, '交给谁处理？');
  await chat(page, 'CHAT-MEMORY：记住合同先抄送法务', '记下了。');
  await page.getByRole('dialog', { name: 'Dudu', exact: true }).getByText('Remembered', { exact: true }).waitFor();
  await chat(page, 'CHAT-DASH：加 Quota', '已加 Quota。');
  await page.getByRole('region', { name: 'Quota', exact: true }).waitFor({ timeout: 10_000 });
  const state = await dudu.api('assistant/state');
  assert.match(state.conversation.sessionId, /^dudu-assistant-/);
  assert.equal((await dudu.api('memory/records')).records[0].text, '合同先抄送法务');
  const requested = dudu.model.requests.find((request: any) => request.prompt.includes('CHAT-CREATE') && request.tools.includes('issues_add'));
  assert.ok(requested);
  assert.match(createSystem, /Your English name is Dudu/);
  assert.match(createSystem, /call them 你 when you write Chinese and "you" when you write English/);
  assert.ok(!requested.tools.some((name: string) => ['bash', 'write', 'read', 'connector_enable'].includes(name)));
  const hidden = await page.getByRole('tree', { name: 'Sessions' }).innerText();
  assert.ok(!hidden.includes(state.conversation.sessionId) && !hidden.includes('合同续费'));

  await dudu.restart();
  await page.reload();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('dialog', { name: 'Dudu', exact: true }).getByText('记下了。', { exact: true }).waitFor();
  const restored = await dudu.api('assistant/state');
  assert.equal(restored.conversation.sessionId, state.conversation.sessionId);
  await chat(page, 'CHAT-RECALL：合同先抄送谁？', /找到了：.*合同先抄送法务/s);
  await page.close();
});

test('a model cannot bypass Dudu’s scoped tools by fabricating an unoffered terminal call', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await chat(page, 'CHAT-FORBIDDEN：试图运行 shell', '没有执行。');
  const state = await dudu.api('assistant/state');
  assert.equal(await access(join(state.projectFolder, 'forbidden.txt')).then(() => true, () => false), false);
  const result = dudu.model.requests.find((request: any) => request.prompt.includes('CHAT-FORBIDDEN') && request.toolResults.length);
  assert.ok(result?.toolResults.some((text: string) => /not available|unknown|not found|not allowed|restrict/i.test(text)));
  const identity = JSON.parse(await readFile(join(state.stateFolder, 'conversation.json'), 'utf8'));
  assert.equal(identity.sessionId, state.conversation.sessionId);
  await page.close();
});

test('Stop cancels the working turn and the same conversation accepts another message', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill('CHAT-SLOW');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  // While it works the window shows DSH's own running line, counted from the message just sent (the host's own times).
  const running = dialog.locator('[data-pet-running] .dudu-shimmer-content').first();
  await running.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(2500);
  const seconds = Number((await running.innerText()).match(/^Deep diving for (\d+)s ···$/)?.[1]);
  assert.ok(seconds >= 2 && seconds <= 12, `the clock counts from the message just sent: ${await running.innerText()}`);
  await mkdir('.local/pet-running-nov04', { recursive: true });
  await dialog.screenshot({ path: '.local/pet-running-nov04/real-dsh.png' });
  await dialog.getByRole('button', { name: 'Stop', exact: true }).click({ timeout: 5000 });
  await dialog.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 5000 });
  await dialog.locator('[data-pet-running]').waitFor({ state: 'detached', timeout: 5000 });
  await chat(page, 'CHAT-AFTER-STOP', '可以继续。');
  assert.equal(await dialog.getByText('这个回复应该被停止。', { exact: true }).count(), 0);
  assert.equal((await dudu.api('assistant/state')).conversation.running, false);
  await page.close();
});

test('General opens the model menu; the same pet and shortcuts work across DSH panels without intercepting typing', async () => {
  const page = await dudu.openPanel();
  await panelAction(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Dudu settings', exact: true });
  await settings.getByText('mock-1', { exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Change in DSH' }).click();
  await settings.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Select model, current Mock', exact: true }).click();
  await page.getByRole('menu', { name: 'Model and reasoning effort' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('记下了。', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const chat = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await chat.getByText('记下了。', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dudu', exact: true }).first().click();
  await chat.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await chat.waitFor();
  await chat.getByRole('textbox', { name: 'Message', exact: true }).fill('word');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  assert.equal(await chat.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), 'word  ');
  await chat.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await chat.waitFor();
  await page.keyboard.press('Escape');
  await chat.waitFor({ state: 'hidden' });
  await page.close();
});

test('clicking outside the pet conversation closes it, keeps the draft and lets a running reply finish', async () => {
  const page = await dudu.openPanel();
  const open = page.locator('button.dudu-pet');
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await open.click();
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill('收起时保留这条草稿');
  await dialog.locator('header').click();
  await dialog.waitFor();
  await page.getByRole('button', { name: 'Dudu', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await open.click();
  assert.equal(await dialog.getByRole('textbox', { name: 'Message', exact: true }).inputValue(), '收起时保留这条草稿');
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill('CHAT-OUTSIDE');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await dialog.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Dudu', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('status').getByText('收起后仍会收到。', { exact: true }).waitFor({ timeout: 15_000 });
  assert.equal((await dudu.api('assistant/state')).conversation.running, false);
  await open.click();
  await dialog.getByText('收起后仍会收到。', { exact: true }).waitFor();
  await page.close();
});

test('reply bubbles close with the existing reminder cross, Escape and an outside click without losing the reply', async () => {
  await mkdir('.local/pet-completions-nov03', { recursive: true });
  const page = await dudu.openPanel();
  const pet = page.locator('button.dudu-pet');
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  const bubble = page.locator('.dudu-pet-bubble');
  for (const dismiss of ['cross', 'escape', 'outside']) {
    await pet.click();
    await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill(`CHAT-BUBBLE-DISMISS ${dismiss}`);
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await dialog.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await bubble.getByText('可以关闭这条回复气泡。', { exact: true }).waitFor({ timeout: 15_000 });
    if (dismiss === 'cross') {
      const close = bubble.getByRole('button', { name: 'Close', exact: true });
      assert.deepEqual(await close.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.width, rect.height, getComputedStyle(node).borderRadius];
      }), [20, 20, '5px'], 'reuse the current reminder close control');
      await page.screenshot({ path: '.local/pet-completions-nov03/reply-bubble-close.png' });
      await close.click();
    } else if (dismiss === 'escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: 'Dudu', exact: true }).click();
    await bubble.waitFor({ state: 'hidden' });
    assert.equal(await dialog.isVisible(), false);
  }
  await pet.click();
  assert.equal(await dialog.getByText('可以关闭这条回复气泡。', { exact: true }).count(), 3);
  await page.close();
});

test('forget previews and deletes the indexed source; restarting cannot restore that memory from DSH history', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await chat(page, 'CHAT-PRIVATE：记一下海棠专用代码是 AX8129', '已记下这条。');
  await page.getByRole('dialog', { name: 'Dudu', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await panelAction(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Dudu settings', exact: true });
  await settings.getByRole('button', { name: 'Memory', exact: true }).click();
  await settings.getByRole('button', { name: 'Forget: 海棠专用代码是 AX8129', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'This will be deleted', exact: true });
  await preview.getByText('1 conversation turns', { exact: true }).waitFor();
  assert.ok((await dudu.api('memory/records')).records.some((record: any) => record.text.includes('AX8129')));
  await preview.getByRole('button', { name: 'Delete', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  assert.ok(!(await dudu.api('memory/records')).records.some((record: any) => record.text.includes('AX8129')));
  await dudu.restart();
  await page.reload();
  const recovered = await dudu.api('assistant/conversation');
  assert.equal(recovered.outcome, 'success', `${recovered.message}\n${dudu.diagnostics()}`);
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await chat(page, 'CHAT-FORGOTTEN：搜一下记录', /召回结果：.*"hits":\[\]/s);
  await chat(page, 'CHAT-FORBIDDEN：重启后试图运行 shell', '没有执行。');
  const state = await dudu.api('assistant/state');
  assert.equal(await access(join(state.projectFolder, 'forbidden.txt')).then(() => true, () => false), false);
  await page.close();
});

test('the conversation cannot apply its forget preview until the owner replies in another turn', async () => {
  const record = (await dudu.api('memory/records')).records.find((item: any) => item.text === '合同先抄送法务');
  assert.ok(record);
  const source = `record:${record.id}`;
  const remove = { name: 'memory_forget', arguments: { source, preview: false } };
  dudu.model.replies = [
    { when: 'CHAT-FORGET-REQUEST', calls: [{ name: 'memory_forget', arguments: { source } }, remove], then: (results: string[]) => `等待确认：${results.at(-1)}` },
    { when: 'CHAT-FORGET-CONFIRM', calls: [remove], then: (results: string[]) => `删除结果：${results.at(-1)}` },
    ...dudu.model.replies,
  ];
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await chat(page, 'CHAT-FORGET-REQUEST：忘掉合同抄送这条', /等待确认：.*"outcome":"needs_clarification"/s);
  assert.ok((await dudu.api('memory/records')).records.some((item: any) => item.id === record.id));
  await chat(page, 'CHAT-FORGET-CONFIRM：确认删除刚才预览的记录', /删除结果：.*"preview":false/s);
  assert.ok(!(await dudu.api('memory/records')).records.some((item: any) => item.id === record.id));
  await page.close();
});

test('the two keyboard settings are saved independently; disabled pet removes the entry point', async () => {
  const page = await dudu.openPanel();
  await panelAction(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Dudu settings', exact: true });
  const double = dialog.getByRole('switch', { name: 'Double Space to open conversation' });
  await double.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Double Space to open conversation"]')?.getAttribute('aria-checked') === 'false');
  const settings = (await dudu.api('assistant/settings')).settings.pet;
  assert.equal(settings.doubleSpace, false);
  assert.equal(settings.voice, true);
  await dialog.getByRole('switch', { name: 'Show pet' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).waitFor({ state: 'hidden' });
  await dudu.api('assistant/settings', { patch: { pet: { enabled: true, doubleSpace: true } } });
  await page.close();
});
