// The three built-ins on fixed example data, at both declared sizes, in both themes, without starting DSH.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { BUILT_IN_WIDGETS } from '../../host/assistant/dashboard/widgets.mjs';
import { exampleData, inspectWidget, widgetCases } from '../../host/dudu-plugin/widget-testing.mjs';
import { startFixture } from './fixture.mjs';

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => {
  const data = exampleData(Date.now());
  fixture = await startFixture({ handlers: {
    'overview/usage': () => data.quota, 'dispatch/state': () => data.inputs, 'sessions/list': () => data.sessions,
  } });
  for (const { title, brief, status, priority, agent, ask, dueAt } of data.issues.items) fixture.issues.add({ title, brief, status, priority, agent, ask, dueAt, ...(agent ? { project: { name: 'demo', path: '/demo' } } : {}) });
});
after(async () => { await fixture?.stop(); });

for (const widget of BUILT_IN_WIDGETS) for (const scenario of widgetCases(widget)) test(`${widget.label} ${scenario.name} fits its declared size and labels its controls`, async () => {
  const page = await fixture.open({ widgetPreview: { id: widget.id, ...scenario.size }, theme: scenario.theme });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.getByRole('region', { name: widget.label, exact: true }).waitFor();
    if (widget.id === 'issues') await page.getByText('准备续费资料', { exact: true }).waitFor();
    if (widget.id === 'quota') await page.getByText('74%', { exact: true }).first().waitFor();
    if (widget.id === 'office') await page.locator('[data-office-stage][data-mode]').waitFor();
    const result = await page.locator('.dudu').evaluate(inspectWidget);
    assert.deepEqual(result, { fits: true, accessible: true });
    assert.deepEqual(errors, []);
    const palette = await page.locator('.dudu').evaluate((node) => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).getPropertyValue('--background') }));
    assert.ok(palette.color && palette.background);
    if (scenario.theme === 'dark') assert.match(palette.color, /238,\s*239,\s*242/);
  } finally { await page.context().close(); }
});

test('the Office canvas is clear, not black, until its first picture is drawn', async () => {
  const officeFixture = await startFixture();
  try {
    officeFixture.issues.add({ title: '一件事', agent: 'claude', project: { name: 'demo', path: '/demo' } });
    const page = await officeFixture.open({ widgetPreview: { id: 'office', cols: 12, rows: 6 } });
    await page.locator('[data-office-stage][data-mode="scene"]').waitFor({ timeout: 30000 });
    // A WebGL canvas without an alpha channel is black until something is drawn on it, and the first picture waits for the images to be
    // decoded (a second or more in a busy DSH window). This one has the channel: the widget's own colour shows through until then.
    const alpha = await page.evaluate(() => {
      const canvas = document.querySelector('[data-office-stage] canvas') as HTMLCanvasElement;
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
      return gl?.getContextAttributes()?.alpha;
    });
    assert.equal(alpha, true);
    await page.context().close();
  } finally { await officeFixture.stop(); }
});

test('an Office tag is the agent\'s logo, with a dot only for an issue that needs you or is stuck', async () => {
  const officeFixture = await startFixture();
  try {
    const make = (title: string, agent: string, session: string) => {
      const key = `${agent}:${title}`;
      officeFixture.sessions[key] = session;
      const { issue } = officeFixture.issues.add({ title, status: 'in_progress', agent, session: key, project: { name: 'app', path: '/work/app' } }, { actor: 'dudu' }) as { issue: { id: number } };
      return issue.id;
    };
    const ids = { working: make('w', 'claude', 'running'), needs: make('n', 'deepseek', 'waiting_owner'), stuck: make('s', 'codex', 'error'), idle: make('i', 'claude', 'finished') };
    const page = await officeFixture.open({ widgetPreview: { id: 'office', cols: 12, rows: 6 } });
    const office = page.getByRole('region', { name: 'Office', exact: true });
    await office.locator('[data-office-tag]').nth(3).waitFor();
    const logo = (id: number) => office.locator(`[data-office-tag="${id}"] [data-agent-logo]`).getAttribute('data-agent-logo');
    const dots = (id: number) => office.locator(`[data-office-tag="${id}"] i.rounded-full`).count();
    assert.deepEqual([await logo(ids.working), await logo(ids.needs), await logo(ids.stuck), await logo(ids.idle)], ['claude', 'deepseek', 'codex', 'claude'], 'the logo of its agent, whatever the state');
    assert.deepEqual([await dots(ids.working), await dots(ids.needs), await dots(ids.stuck), await dots(ids.idle)], [0, 1, 1, 0], 'a dot only for the two that want attention');
    assert.equal(await office.locator('[data-office-tag]').filter({ hasText: /^[·!×z]$/ }).count(), 0, 'no state symbol');
    await page.context().close();
  } finally { await officeFixture.stop(); }
});

test('Office counts all unassigned work and keeps its nine desks, however it is resized', async () => {
  const officeFixture = await startFixture();
  try {
    for (let n = 0; n < 205; n++) officeFixture.issues.add({ title: `待分配 ${n}`, priority: 'urgent' });
    for (let n = 0; n < 15; n++) officeFixture.issues.add({
      title: `已分配 ${n}`, agent: ['claude', 'codex', 'deepseek'][n % 3], project: { name: 'demo', path: '/demo' },
    });
    const preview = { id: 'office', cols: 12, rows: 8 }; // cells of 56px (a box, not the dashboard's grid)
    const page = await officeFixture.open({ widgetPreview: preview });
    const office = page.getByRole('region', { name: 'Office', exact: true });
    await office.locator('[data-office-tag]').nth(8).waitFor();
    // each name tag says which agent it is, with the logo the Issues list has
    const logos = await office.locator('[data-office-tag] [data-agent-logo]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-agent-logo')));
    assert.equal(logos.length, 9, 'a logo on every tag');
    assert.deepEqual([...new Set(logos)].sort(), ['claude', 'codex', 'deepseek']);
    assert.equal(await office.getAttribute('data-office-desks'), '9', 'nine desks, fixed');
    assert.equal(await office.getAttribute('data-office-unassigned'), '205', 'board totals are not the first page of issues');
    assert.equal(await office.locator('[data-office-tag]').count(), 9);
    await office.locator('[data-office-more]').getByText('+6', { exact: true }).waitFor();

    await page.locator('#root').evaluate((root) => { root.style.width = '430px'; root.style.height = '320px'; });
    assert.equal(await office.getAttribute('data-office-desks'), '9');
    assert.equal(await office.locator('[data-office-tag]').count(), 9, 'smaller containers scale the same plane');
    assert.equal(await office.getByRole('button', { name: 'Office settings' }).count(), 0, 'nothing to set: the desks are fixed');
    await page.context().close();
  } finally { await officeFixture.stop(); }
});
