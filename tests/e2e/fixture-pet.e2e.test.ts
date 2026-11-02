// The pet's conversation window: pictures as tiles, the "+" menu (Image, Context, Compact), Context as a blue word in the box, and the model and
// reasoning-effort box. The real interface in a real browser, DSH-free (see fixture.mjs); the model directory is a small fake in fixture-entry.jsx.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startFixture } from './fixture.mjs';

let fixture: Awaited<ReturnType<typeof startFixture>>;
let compact: any = { outcome: 'success', compacted: true };
before(async () => { fixture = await startFixture({ handlers: {
  'assistant/conversation': () => ({ outcome: 'success', sessionId: 'dudu-assistant-fixture', cursor: 0 }),
  'assistant/compact': () => compact,
} }); });
after(async () => { await fixture?.stop(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const REPORT = Buffer.from('# 周报\n\n- 没做完的事\n');
const pictures = (...names: string[]) => names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG }));

async function opened(page: Page) {
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await dialog.waitFor();
  return dialog;
}

test('the header open button uses the close control style, opens the same session and keeps unsent text and attachments', async () => {
  fixture.opened.length = 0;
  const page = await fixture.open();
  const dialog = await opened(page);
  await dialog.locator('textarea').fill('尚未发送的草稿');
  await dialog.locator('input[type="file"]').setInputFiles([
    ...pictures('draft.png'), { name: 'notes.md', mimeType: 'text/markdown', buffer: REPORT },
  ]);
  const open = dialog.getByRole('button', { name: 'Open session', exact: true });
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const bounds = await dialog.boundingBox();
  for (const control of [open, close]) {
    const box = await control.boundingBox();
    assert.deepEqual([box!.width, box!.height], [32, 32]);
    assert.equal(await control.locator('svg').evaluate((node) => getComputedStyle(node).width), '16px');
  }
  await open.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(fixture.opened.at(-1)!.sessionId, 'dudu-assistant-fixture');
  assert.ok(bounds!.width > 0);
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  assert.equal(await dialog.locator('textarea').inputValue(), '尚未发送的草稿');
  assert.equal(await dialog.getByRole('img', { name: 'draft.png', exact: true }).count(), 1);
  assert.equal(await dialog.locator('.dudu-pet-file').filter({ hasText: 'notes.md' }).count(), 1);
  await page.context().close();
});

test('pictures wait in the box as round tiles, with a dark × that shows when the mouse is on one', async () => {
  const page = await fixture.open();
  const dialog = await opened(page);
  await dialog.locator('input[type="file"]').setInputFiles(pictures('one.png', 'two.png'));
  const tiles = dialog.locator('.dudu-pet-attachment');
  await tiles.nth(1).waitFor();
  assert.equal(await tiles.count(), 2);
  const box = await tiles.first().boundingBox();
  assert.deepEqual([box!.width, box!.height], [64, 64]);
  assert.equal(await tiles.first().locator('img').evaluate((node) => getComputedStyle(node).borderTopLeftRadius), '16px');
  const cross = tiles.nth(1).getByRole('button', { name: 'Remove: two.png', exact: true });
  assert.equal(await cross.evaluate((node) => getComputedStyle(node).opacity), '0', 'no × until the mouse is on the tile');
  await tiles.nth(1).hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelectorAll('.dudu-pet-attachment button')[1]).opacity === '1');
  const crossBox = await cross.boundingBox();
  const tileBox = await tiles.nth(1).boundingBox();
  assert.deepEqual([crossBox!.width, crossBox!.height], [20, 20]);
  assert.ok(crossBox!.x + 20 <= tileBox!.x + 64 && crossBox!.y >= tileBox!.y, 'the × sits inside the tile, at its top-right corner');
  await cross.click();
  assert.equal(await tiles.count(), 1);
  // A picture alone can be sent; the tiles go once it is.
  await dialog.locator('textarea').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.dudu-pet-attachment').length === 0);
  assert.deepEqual(fixture.sent.at(-1)!.attachments, [{ kind: 'image', mediaType: 'image/png', name: 'one.png' }]);
  await page.context().close();
});

test('a file waits as a card among the pictures, in the order picked, and goes up with them in that order', async () => {
  fixture.sent.length = 0;
  const page = await fixture.open();
  const dialog = await opened(page);
  await dialog.locator('input[type="file"]').setInputFiles([
    { name: 'photo.png', mimeType: 'image/png', buffer: PNG },
    { name: 'weekly-report.md', mimeType: 'text/markdown', buffer: REPORT },
    { name: 'data.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(2048) },
  ]);
  const rail = dialog.locator('.dudu-pet-attachments');
  await rail.locator('.dudu-pet-file').nth(1).waitFor();
  assert.deepEqual(await rail.locator('.dudu-pet-attachment').evaluateAll((nodes) => nodes.map((node) => node.classList.contains('dudu-pet-file') ? 'file' : 'image')), ['image', 'file', 'file'], 'the order picked');
  const card = rail.locator('.dudu-pet-file').first();
  assert.deepEqual(await card.evaluate((node) => { const box = node.getBoundingClientRect(); return [box.width, box.height, getComputedStyle(node).borderTopLeftRadius]; }), [220, 64, '16px']);
  assert.equal((await card.innerText()).replace(/\s+/g, ' ').trim(), `weekly-report.md MD · ${REPORT.length} B`);
  assert.equal((await rail.locator('.dudu-pet-file').nth(1).innerText()).replace(/\s+/g, ' ').trim(), 'data.bin BIN · 2.0 KB');
  // The × of a file card is the same dark round one, shown when the mouse is on the card; taking one away keeps the rest.
  const cross = card.getByRole('button', { name: 'Remove: weekly-report.md', exact: true });
  assert.equal(await cross.evaluate((node) => getComputedStyle(node).opacity), '0');
  await card.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelectorAll('.dudu-pet-file button')[0]).opacity === '1');
  await rail.locator('.dudu-pet-file').nth(1).getByRole('button', { name: 'Remove: data.bin', exact: true }).click({ force: true });
  assert.equal(await rail.locator('.dudu-pet-attachment').count(), 2);
  await dialog.locator('textarea').fill('看看这份');
  await dialog.locator('textarea').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.dudu-pet-attachment').length === 0);
  assert.equal(fixture.sent.at(-1)!.text, '看看这份');
  assert.deepEqual(fixture.sent.at(-1)!.attachments, [{ kind: 'image', mediaType: 'image/png', name: 'photo.png' }, { kind: 'file', name: 'weekly-report.md', size: REPORT.length }]);
  await page.context().close();
});

test('a file in a sent message is a small card with its name and size', async () => {
  const page = await fixture.open();
  await page.evaluate(() => {
    (window as any).__records = [{ event: { seq: 1, time: Date.now(), type: 'user/message', data: { source: { kind: 'user' }, content: [
      { type: 'file', attachment: { attachmentId: 'f1', name: 'weekly-report.md', bytes: 18432 } }, { type: 'text', text: '按这份周报记事项' }] } } }];
  });
  const dialog = await opened(page);
  const card = dialog.locator('.dudu-pet-message-file');
  await card.waitFor();
  assert.equal((await card.innerText()).replace(/\s+/g, ' ').trim(), 'weekly-report.md 18 KB');
  // The words and the card are one message, the card first.
  const message = dialog.locator('.dudu-pet-message--owner').filter({ hasText: '按这份周报记事项' });
  await message.waitFor();
  assert.equal(await message.locator('.dudu-pet-message-file').count(), 1);
  await page.context().close();
});

test('"+" offers File, Context and Compact, with DSH\'s own icons; File opens the picker', async () => {
  const page = await fixture.open();
  const dialog = await opened(page);
  const plus = dialog.getByRole('button', { name: 'Add', exact: true });
  const plusBox = await plus.boundingBox();
  assert.deepEqual([plusBox!.width, plusBox!.height], [30, 30]);
  assert.ok(await plus.evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius) >= 15), 'a round button');
  await plus.click();
  const menu = page.getByRole('menu', { name: 'Add', exact: true });
  await menu.waitFor();
  assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), ['File', 'Compact\nCompact the conversation above']);
  // DSH's icons: 16px with one-pixel strokes, not the 24px set of the rest of the page.
  for (const item of await menu.getByRole('menuitem').all()) assert.equal(await item.locator('svg').first().getAttribute('viewBox'), '0 0 16 16');
  assert.equal(await menu.getByRole('menuitemcheckbox', { name: /^Context/ }).locator('svg').first().getAttribute('viewBox'), '0 0 16 16');
  await menu.getByRole('menuitemcheckbox', { name: /^Context/ }).waitFor();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu.getByRole('menuitem', { name: 'File', exact: true }).click()]);
  await chooser.setFiles(pictures('picked.png'));
  await dialog.locator('.dudu-pet-attachment').waitFor();
  await menu.waitFor({ state: 'hidden' });
  await page.context().close();
});

test('Context is a blue word at the start of the box, with the page after it, that goes with each message until it is taken off', async () => {
  fixture.contexts.length = 0;
  fixture.sent.length = 0;
  const { issue } = fixture.issues.add({ title: '修复图标对齐', status: 'in_progress', project: { name: 'dudu', path: '/work/dudu' } }, { actor: 'dudu' }) as { issue: { id: number } };
  const page = await fixture.open();
  const dialog = await opened(page);
  const box = dialog.locator('textarea');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /^Context/ }).click();
  const token = dialog.locator('.dudu-pet-token');
  await token.waitFor();
  assert.equal(await token.innerText(), 'Context');
  assert.equal(await token.evaluate((node) => getComputedStyle(node).color), 'rgb(47, 95, 208)');
  assert.equal(await dialog.locator('.dudu-pet-where').innerText(), 'Dudu', 'on the dashboard, the page is the dashboard');
  assert.equal(await box.getAttribute('placeholder'), '');
  // The word has room before the first line, and the grey words give way to what is typed.
  const indent = await box.evaluate((node) => parseFloat(getComputedStyle(node).textIndent));
  assert.ok(indent >= (await token.boundingBox())!.width, 'the typed text starts after the word');
  await box.fill('这个怎么样');
  assert.equal(await dialog.locator('.dudu-pet-where').count(), 0);
  await box.press('Enter');
  await page.waitForFunction(() => (document.querySelector('.dudu-pet-input textarea') as HTMLTextAreaElement).value === '');
  assert.deepEqual(fixture.contexts.at(-1), { page: 'dashboard' });
  assert.equal(fixture.sent.at(-1)!.text, '这个怎么样');
  assert.equal(await token.count(), 1, 'still on for the next message');
  // On an issue's page the page is that issue, by name.
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByText('修复图标对齐', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await dialog.locator('.dudu-pet-where').filter({ hasText: '修复图标对齐' }).waitFor();
  await box.fill('进展如何');
  await box.press('Enter');
  await page.waitForFunction(() => (document.querySelector('.dudu-pet-input textarea') as HTMLTextAreaElement).value === '');
  assert.deepEqual(fixture.contexts.at(-1), { page: 'issue', id: issue.id });
  // Backspace at the start takes the word off, and the next message carries no page.
  await box.focus();
  await box.press('Backspace');
  assert.equal(await token.count(), 0);
  assert.equal(await box.getAttribute('placeholder'), 'Message');
  await box.fill('随便说说');
  await box.press('Enter');
  await page.waitForFunction(() => (document.querySelector('.dudu-pet-input textarea') as HTMLTextAreaElement).value === '');
  assert.equal(fixture.contexts.at(-1), null);
  await page.context().close();
});

test('Compact answers in a line of the thread: compacted, nothing to compact, or could not', async () => {
  const page = await fixture.open();
  const dialog = await opened(page);
  for (const [answer, words] of [
    [{ outcome: 'success', compacted: true }, 'Compacted'],
    [{ outcome: 'success', compacted: false }, 'Nothing to compact yet'],
    [{ outcome: 'error', message: 'busy' }, 'Could not compact'],
  ] as const) {
    compact = answer;
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Compact/ }).click();
    await dialog.getByText(words, { exact: true }).waitFor();
  }
  await page.context().close();
});

test('the model and its effort are one box at the right of the toolbar: two rows, each with its list beside it', async () => {
  const page = await fixture.open();
  const dialog = await opened(page);
  const trigger = dialog.getByRole('button', { name: /DeepSeek-V4\.1-Flash/ });
  await trigger.waitFor();
  assert.equal((await trigger.innerText()).replace(/\s+/g, ' '), 'DeepSeek-V4.1-Flash High');
  const [plus, model, send] = await Promise.all([dialog.getByRole('button', { name: 'Add', exact: true }), trigger, dialog.getByRole('button', { name: 'Send', exact: true })].map((locator) => locator.boundingBox()));
  assert.ok(plus!.x < model!.x && model!.x + model!.width <= send!.x, 'the "+" is at the left, the model is at the right, before send');

  await trigger.click();
  const box = page.getByRole('menu', { name: 'Model, Reasoning effort', exact: true });
  await box.waitFor();
  assert.deepEqual((await box.getByRole('menuitem').allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')), ['Model DeepSeek-V4.1-Flash', 'Reasoning effort High']);
  await box.getByRole('menuitem', { name: /^Model/ }).click();
  const models = page.getByRole('menu', { name: 'Model', exact: true });
  await models.waitFor();
  assert.deepEqual(await models.getByRole('group').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label'))), ['DeepSeek', 'OpenAI']);
  assert.equal(await models.getByRole('menuitemradio', { name: 'DeepSeek-V4.1-Flash', exact: true }).getAttribute('aria-checked'), 'true');
  const listBox = await models.boundingBox();
  const boxBox = await box.boundingBox();
  assert.ok(listBox!.x + listBox!.width <= boxBox!.x + 1, 'the list is beside the box, on its left');
  await models.getByRole('menuitemradio', { name: 'DeepSeek-V4.1-Pro', exact: true }).click();
  await box.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => (window as any).__selected.at(-1)), { provider: 'deepseek', model: 'pro', reasoningEffort: 'high' });
  await dialog.getByRole('button', { name: /DeepSeek-V4\.1-Pro/ }).click();

  await box.getByRole('menuitem', { name: /^Reasoning effort/ }).click();
  const levels = page.getByRole('menu', { name: 'Reasoning effort', exact: true });
  assert.deepEqual(await levels.getByRole('menuitemradio').allInnerTexts(), ['Low', 'Medium', 'High', 'Max']);
  assert.equal(await levels.getByRole('menuitemradio', { name: 'High', exact: true }).getAttribute('aria-checked'), 'true');
  await levels.getByRole('menuitemradio', { name: 'Max', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).__selected.at(-1)), { provider: 'deepseek', model: 'pro', reasoningEffort: 'max' });
  assert.equal((await dialog.getByRole('button', { name: /DeepSeek-V4\.1-Pro/ }).innerText()).replace(/\s+/g, ' '), 'DeepSeek-V4.1-Pro Max');

  // A model with no levels has no Reasoning effort row and no level beside its name.
  await dialog.getByRole('button', { name: /DeepSeek-V4\.1-Pro/ }).click();
  await box.getByRole('menuitem', { name: /^Model/ }).click();
  await models.getByRole('menuitemradio', { name: 'GPT-6.1 Sol', exact: true }).click();
  const sol = dialog.getByRole('button', { name: /GPT-6\.1 Sol/ });
  assert.equal((await sol.innerText()).trim(), 'GPT-6.1 Sol');
  await sol.click();
  assert.equal(await box.getByRole('menuitem').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 1, 'Escape closed the box, not the conversation');
  await page.context().close();
});
