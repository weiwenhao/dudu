// A separately installed DSH plugin, using the published widget helper and the real native slot.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { buildWidget } from '../../examples/dudu-widget/build.mjs';
import { panelAction, startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
let folder: string;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dudu-widget-plugin-'));
  const template = resolve('examples/dudu-widget');
  for (const file of ['package.json', 'index.mjs', 'cordis.patch.yml']) await copyFile(join(template, file), join(folder, file));
  await mkdir(join(folder, 'dist'));
  const entryPoint = join(folder, 'client.mjs');
  await writeFile(entryPoint, `
import { createElement as h, useState } from 'react';
import { defineWidget } from ${JSON.stringify(resolve('host/dudu-plugin/widget.mjs'))};
import { Frame } from ${JSON.stringify(resolve('host/dudu-plugin/widget-ui.mjs'))};
const revision = 'one';
const declaration = { widgetApi: 1, min: { w: 4, h: 4 }, size: { w: 6, h: 4 }, needs: ['issues'], description: 'Reads the issue count', development: true, preview: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E' };
const Count = defineWidget({ ...declaration, id: 'dudu-example-widget.count', label: 'Example widget' }, function Count(props) {
  const { value } = props.useIssues({ tab: 'active', limit: 1 });
  return h(Frame, { title: 'Example widget' }, h('p', { 'data-example-count': true }, String(value?.total ?? 'loading')),
    h('p', { 'data-example-revision': true }, revision),
    h('output', { 'data-has-context': true }, String('ctx' in props || 'request' in props)));
});
const Crash = defineWidget({ ...declaration, id: 'dudu-example-widget.crash', label: 'Crash widget' }, function Crash() {
  const [failed, fail] = useState(false);
  if (failed) throw new Error('An expected widget failure');
  return h(Frame, { title: 'Crash widget' }, h('button', { type: 'button', onClick: () => fail(true) }, 'Crash this widget'));
});
const Bad = defineWidget({ ...declaration, id: 'dudu-example-widget.invalid', label: 'Invalid widget', min: undefined }, () => null);
const Future = defineWidget({ ...declaration, id: 'dudu-example-widget.future', label: 'Future widget', widgetApi: 99 }, () => null);
const Mirror = defineWidget({ ...declaration, id: 'dudu-example-widget.mirror', label: 'Issue mirror', min: { w: 8, h: 4 }, size: { w: 8, h: 8 } }, function Mirror({ renderIssues }) {
  return h('div', { 'data-issue-mirror': true, style: { height: '100%' } }, renderIssues());
});
window.__ModuleLoader__.load({ id: 'dudu-example-widget', factory() { return { name: 'dudu-example-widget', inject: ['slots'], apply(ctx) {
  ctx.slots.inject('dudu.widget', () => {
    const stops = [Count, Crash, Bad, Future, Mirror].map((Widget) => ctx.slots.register({ name: 'dudu.widget', id: Widget.duduWidget.id }, Widget));
    return () => stops.forEach((stop) => stop());
  });
} }; } });
`);
  // React is kept external exactly as in the published template.
  await buildWidget({ entryPoint, outdir: join(folder, 'dist'), development: true });
  dudu = await startDudu({ plugins: [folder] });
});
after(async () => { await dudu?.stop(); if (folder) await rm(folder, { recursive: true, force: true }); });
afterEach(async (context) => { await dudu?.settle(context.name, context.passed === false); });

test('a plugin widget is offered but not auto-added; invalid declarations and API mismatches are shown in Settings', async () => {
  const page = await dudu.openPanel();
  await page.getByRole('region', { name: 'Issues', exact: true }).waitFor();
  const initial = await dudu.api('dashboard/get');
  assert.deepEqual(initial.layout.widgets.map((item: any) => item.type), ['issues']);
  assert.ok(initial.widgets.some((widget: any) => widget.id === 'dudu-example-widget.count'));
  await panelAction(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Dudu settings', exact: true });
  await settings.getByRole('button', { name: 'Widgets', exact: true }).click();
  await settings.getByText('It has no minimum size.', { exact: true }).waitFor();
  await settings.getByText('This widget needs a different version of Dudu.', { exact: true }).waitFor();
  await settings.getByText('In development', { exact: true }).first().waitFor();
  await settings.getByRole('switch', { name: 'Developer mode', exact: true }).click();
  await settings.getByRole('switch', { name: 'Put Example widget on the dashboard', exact: true }).click();
  await page.keyboard.press('Escape');
  const widget = page.getByRole('region', { name: 'Example widget', exact: true });
  await widget.locator('[data-example-count]').getByText('0', { exact: true }).waitFor();
  assert.equal(await widget.locator('[data-has-context]').textContent(), 'false');
  const add = await dudu.api('dashboard/resize', { type: 'dudu-example-widget.count', w: 1, h: 1 });
  assert.equal(add.outcome, 'success');
  const placed = add.layout.widgets.find((item: any) => item.type === 'dudu-example-widget.count');
  assert.deepEqual([placed.w, placed.h], [4, 4], 'the plugin process enforces the third-party minimum');
  await page.close();
});

test('the local inspector changes minimum/recommended size, theme and example data through the same slot', async () => {
  const page = await dudu.openPanel();
  await panelAction(page, 'Edit layout');
  const card = page.locator('.db-card[aria-label="Example widget"]');
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Recommended size' }).click();
  await page.waitForFunction(() => document.querySelector('.db-card[aria-label="Example widget"]')?.closest('.grid-stack-item')?.getAttribute('gs-w') === '6');
  await card.getByRole('button', { name: 'Minimum size', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.db-card[aria-label="Example widget"]')?.closest('.grid-stack-item')?.getAttribute('gs-w') === '4');
  await card.getByLabel('Theme', { exact: true }).selectOption('dark');
  assert.equal(await card.locator('[data-theme]').getAttribute('data-theme'), 'dark');
  await card.getByLabel('Data', { exact: true }).selectOption('example');
  await card.locator('[data-example-count]').getByText('2', { exact: true }).waitFor();
  await card.getByLabel('Data', { exact: true }).selectOption('mine');
  await card.locator('[data-example-count]').getByText('0', { exact: true }).waitFor();
  await page.close();
});

test('a crashing plugin widget leaves the dashboard and its other widgets working; reloading recovers the component', async () => {
  await dudu.api('dashboard/add', { type: 'dudu-example-widget.crash' });
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Crash this widget', exact: true }).click();
  const card = page.locator('.db-card[aria-label="Crash widget"]');
  await card.getByText('This widget could not be shown', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'Example widget', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Issues', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Crash this widget', exact: true }).waitFor();
  await page.close();
});

test('third-party and built-in widgets share the hosted Issues interface without receiving a write helper', async () => {
  await dudu.api('dashboard/add', { type: 'dudu-example-widget.mirror' });
  const page = await dudu.openPanel();
  const mirror = page.locator('[data-issue-mirror]');
  await mirror.getByRole('button', { name: 'New issue', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
  await dialog.getByRole('textbox', { name: 'Issue title', exact: true }).fill('Made through the shared Issues view');
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click();
  await mirror.getByText('Made through the shared Issues view', { exact: true }).waitFor();
  assert.equal((await dudu.api('issues/search', { q: 'Made through the shared Issues view' })).total, 1);
  await dudu.api('dashboard/remove', { type: 'dudu-example-widget.mirror' });
  await page.close();
});

test('a local plugin rebuild is hot-reloaded without restarting DSH or losing the layout', async () => {
  const page = await dudu.openPanel();
  const widget = page.getByRole('region', { name: 'Example widget', exact: true });
  await widget.locator('[data-example-revision]').getByText('one', { exact: true }).waitFor();
  const before = (await dudu.api('dashboard/get')).layout;
  const installed = await realpath(join(dudu.home, 'profiles', 'web', 'node_modules', 'dudu-example-widget'));
  assert.equal(installed, await realpath(folder), 'pnpm links a local directory into the isolated profile');
  const entryPoint = join(folder, 'client.mjs');
  await writeFile(entryPoint, (await readFile(entryPoint, 'utf8')).replace("const revision = 'one'", "const revision = 'two'"));
  await buildWidget({ entryPoint, outdir: join(folder, 'dist'), development: true });
  await widget.locator('[data-example-revision]').getByText('two', { exact: true }).waitFor({ timeout: 15_000 });
  assert.deepEqual((await dudu.api('dashboard/get')).layout, before);
  await page.close();
});

test('removing the source plugin preserves its saved layout and reports the missing source', async () => {
  const before = (await dudu.api('dashboard/get')).layout;
  await dudu.removePlugin('dudu-example-widget');
  await dudu.restart();
  const page = await dudu.openPanel();
  await page.getByText('This widget comes from dudu-example-widget, which is not installed.', { exact: true }).first().waitFor();
  assert.deepEqual((await dudu.api('dashboard/get')).layout, before);
  await page.close();
});
