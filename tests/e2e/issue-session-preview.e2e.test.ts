import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, test } from 'node:test';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => { dudu = await startDudu({ model: {
  models: [
    { id: 'mock-1', name: 'Mock', contextWindow: 100000, input: ['text', 'image'] },
    { id: 'mock-2', name: 'Mock Vision', contextWindow: 100000, input: ['text', 'image'],
      reasoningEfforts: { low: 'low', high: 'high' }, compat: { supportsReasoningEffort: true } },
  ],
  replies: [{ say: 'Preview conversation ready.' }],
} }); });
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

test('an agent logo opens a smaller native conversation and expansion preserves its session, draft and composer style', async () => {
  const { issue } = await dudu.api('issues/add', { fields: {
    title: 'Embedded conversation check', brief: 'Preview fixture task',
    project: { name: 'Preview', path: dudu.folder }, agent: 'deepseek',
  } });
  const page = await dudu.openPanel();
  const row = page.locator(`[data-issue-row="${issue.id}"]`);
  const agent = row.getByRole('button', { name: 'DeepSeek · Open session', exact: true });
  await agent.waitFor();
  await page.mouse.move(0, 0);
  const resting = await agent.evaluate(node => getComputedStyle(node).backgroundColor);
  await agent.hover();
  await page.getByRole('tooltip', { name: 'DeepSeek · Open session', exact: true }).waitFor();
  assert.notEqual(await agent.evaluate(node => getComputedStyle(node).backgroundColor), resting);
  await agent.click();
  const dialog = page.getByRole('dialog', { name: new RegExp(issue.title) });
  await dialog.getByText('Preview conversation ready.', { exact: true }).waitFor();
  const stored = (await dudu.api('issues/get', { id: issue.id })).issue;
  const sessionId = stored.session.slice('dsh:'.length);
  const content = dialog.locator('[data-conversation-content]');
  assert.equal(await content.getAttribute('data-conversation-session'), sessionId);
  assert.equal(await page.getByRole('button', { name: 'Back to Issues', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: 'Select model, current Mock', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Model/ }).click();
  await page.getByRole('menuitemradio', { name: 'Mock Vision', exact: true }).click();
  await dialog.getByRole('button', { name: /^Select model, current Mock Vision/ }).click();
  await page.getByRole('menuitem', { name: /^Effort/ }).click();
  await page.getByRole('menuitemradio', { name: 'High', exact: true }).click();
  await dialog.getByRole('button', { name: /^Select model, current Mock Vision/ }).click();
  await page.getByRole('menu', { name: 'Model and reasoning effort' }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor();
  const png = await readFile(new URL('../../host/dudu-plugin/ui/pet/pet.png', import.meta.url));
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Remove image preview.png', exact: true }).waitFor();
  const input = dialog.locator('[contenteditable="true"][role="textbox"]');
  await input.fill('A draft kept when opening the full conversation.');
  const card = dialog.locator('[data-composer-card]');
  const geometry = await card.evaluate(node => {
    const style = getComputedStyle(node);
    return { radius: style.borderRadius, padding: style.padding, background: style.backgroundColor, font: style.fontSize };
  });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.width < 1100 && bounds.height < 850);
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const full = page.locator(`[data-conversation-content][data-conversation-session="${sessionId}"]`);
  await full.getByText('Preview conversation ready.', { exact: true }).waitFor();
  assert.equal(await full.locator('[contenteditable="true"][role="textbox"]').innerText(), 'A draft kept when opening the full conversation.');
  await full.getByRole('button', { name: 'Remove image preview.png', exact: true }).waitFor();
  await full.getByRole('button', { name: /Select model, current Mock Vision.*High/ }).waitFor();
  assert.deepEqual(await full.locator('[data-composer-card]').evaluate(node => {
    const style = getComputedStyle(node);
    return { radius: style.borderRadius, padding: style.padding, background: style.backgroundColor, font: style.fontSize };
  }), geometry);
});

test('a compact conversation closes outside and returns focus to the agent logo', async () => {
  const { issue } = await dudu.api('issues/add', { fields: {
    title: 'Close the compact conversation', project: { name: 'Preview', path: dudu.folder }, agent: 'deepseek',
  } });
  const page = await dudu.openPanel();
  const agent = page.locator(`[data-issue-row="${issue.id}"]`).getByRole('button', { name: 'DeepSeek · Open session', exact: true });
  await agent.click();
  const dialog = page.getByRole('dialog', { name: new RegExp(issue.title) });
  await dialog.locator('[data-conversation-content]').waitFor();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 10, y: 10 } });
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction((id) => document.querySelector(`[data-issue-row="${id}"] button[aria-label="DeepSeek · Open session"]`) === document.activeElement, issue.id);
  assert.equal(await agent.evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Enter');
  await dialog.locator('[data-conversation-content]').waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction((id) => document.querySelector(`[data-issue-row="${id}"] button[aria-label="DeepSeek · Open session"]`) === document.activeElement, issue.id);
  assert.equal(await agent.evaluate(node => node === document.activeElement), true);
});
