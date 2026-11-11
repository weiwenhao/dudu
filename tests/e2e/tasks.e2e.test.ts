// One real DSH flow for the task manager. Only the model is scripted; the package, API, workspace and task store are real.
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { test } from 'node:test';
import { startDudu, panelAction } from './harness.mjs';

test('scheduled tasks can be created from presets, edited, paused and reopened without losing their saved rules', async (context) => {
  const dudu = await startDudu({ model: true });
  context.after(async () => {
    try { await dudu.settle(context.name, context.passed === false); }
    finally { await dudu.stop(); }
  });
  const page = await dudu.openPanel();
  const path = await realpath(dudu.folder);
  assert.equal((await dudu.api('projects/create', { name: 'Task workspace', path })).outcome, 'success');
  const response = (action: string) => page.waitForResponse((value) => new URL(value.url()).pathname === `/api/dudu/tasks/${action}` && value.request().method() === 'POST');
  const optionsRead = response('options');
  await panelAction(page, 'Tasks');
  const options = await (await optionsRead).json();
  assert.equal(options.outcome, 'success');
  const dialog = page.getByRole('dialog', { name: 'Tasks', exact: true });
  await dialog.getByRole('button', { name: 'New task', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Automation task name', exact: true }).fill('Daily project digest');
  await dialog.getByRole('textbox', { name: 'Automation task content', exact: true }).fill('Summarize the changes in this workspace.');
  await dialog.getByRole('combobox', { name: 'Provider', exact: true }).click();
  await page.getByRole('option', { name: 'DeepSeek', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Rules', exact: true }).click();
  await page.getByRole('option', { name: 'Monday to Friday', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Run time', exact: true }).click();
  await page.getByPlaceholder('Run time', { exact: true }).fill('09:30');
  await page.getByRole('option', { name: '09:30', exact: true }).click();
  const created = response('create');
  await dialog.locator('footer').getByRole('button', { name: 'New task', exact: true }).click();
  const saved = (await (await created).json()).task;
  assert.equal(saved.agent, 'deepseek');
  assert.equal(saved.prompt, 'Summarize the changes in this workspace.');
  assert.deepEqual(saved.schedule, { kind: 'workdays', timezone: options.timezone, time: '09:30' });
  assert.equal(saved.project.path, path);
  const paused = response('pause');
  await dialog.getByRole('button', { name: 'Pause task', exact: true }).click();
  assert.equal((await (await paused).json()).task.status, 'paused');
  await dialog.locator('aside').getByRole('button', { name: /^Paused \d+$/ }).click(); // a tab says how many tasks it holds
  await dialog.locator('aside button').filter({ hasText: 'Daily project digest' }).waitFor();
  await dialog.getByRole('textbox', { name: 'Automation task name', exact: true }).fill('Updated project digest');
  const updated = response('update');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  assert.equal((await (await updated).json()).task.title, 'Updated project digest');
  await page.reload();
  await page.getByRole('button', { name: 'Dudu', exact: true }).first().click();
  await panelAction(page, 'Tasks');
  const reopened = page.getByRole('dialog', { name: 'Tasks', exact: true });
  assert.equal(await reopened.getByRole('textbox', { name: 'Automation task name', exact: true }).inputValue(), 'Updated project digest');
  const persisted = (await dudu.api('tasks/get', { id: saved.id })).task;
  assert.equal(persisted.status, 'paused');
  assert.deepEqual(persisted.schedule, saved.schedule);
  await reopened.getByRole('button', { name: 'More', exact: true }).last().click();
  await page.getByRole('option', { name: 'Delete task', exact: true }).click();
  const deleted = response('delete');
  await page.getByRole('dialog', { name: 'Delete task', exact: true }).getByRole('button', { name: 'Delete task', exact: true }).click();
  assert.equal((await (await deleted).json()).outcome, 'success');
  assert.deepEqual((await dudu.api('tasks/list')).tasks, []);
});
