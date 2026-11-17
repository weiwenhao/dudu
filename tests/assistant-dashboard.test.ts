import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createDashboard } from '../host/assistant/dashboard/index.mjs';
import { createDashboardApi, DASHBOARD_ACTIONS } from '../host/assistant/dashboard/api.mjs';
import { defaultLayout, migrate, normalize } from '../host/assistant/dashboard/layout.mjs';
import { BUILT_IN_WIDGETS, COLUMNS, FILL_ROWS, MAX_COLUMNS, MAX_ROWS, MAX_Y, NEEDS, validateDeclaration } from '../host/assistant/dashboard/widgets.mjs';

// gridstack's engine file cannot be imported by Node as it stands (its relative imports have no extension), so the one file that names
// the package (engine.mjs) is bundled the way the packaging script bundles it, into a temp folder, and that bundle is imported.
const scratch = mkdtempSync(join(tmpdir(), 'dudu-dashboard-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
await build({
  entryPoints: [new URL('../host/assistant/dashboard/engine.mjs', import.meta.url).pathname], outfile: join(scratch, 'engine.mjs'),
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { GridStackEngine } = await import(pathToFileURL(join(scratch, 'engine.mjs')).href);

const T0 = 1_800_000_000_000;
const fullIssuesLayout = () => ({ v: 3, widgets: [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 'fill' }] });
type Item = { id: string; type: string; x: number; y: number; w: number | 'fill'; h: number | 'fill' };
// The test widgets are the ones of the ten-column grid with every cell count a half more (rounded up), so the cases below are the same cases on fifteen columns.
const gridWidgets = [
  ['test.summary', 'Summary', 3, 3, 6, 3], ['test.history', 'History', 5, 3, 6, 6],
  ['test.future', 'Future', 3, 3, 6, 6], ['test.blocked', 'Blocked', 3, 3, 6, 3], ['test.source', 'Source', 3, 3, 6, 3], ['test.small', 'Small', 3, 2, 3, 2],
].map(([id, label, mw, mh, w, h]) => ({
  id, label, min: { w: mw, h: mh }, size: { w, h }, needs: [], widgetApi: 1,
}));
const known = [...BUILT_IN_WIDGETS, ...gridWidgets] as any[];
const declared = (type: string) => known.find((declaration) => declaration.id === type);
const box = (layout: { widgets: Item[] }, type: string) => {
  const { x, y, w, h } = layout.widgets.find((item) => item.type === type) as Item;
  return [x, y, w, h];
};
const generator = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

// A dashboard on a real file in its own folder, served through the real API handler, with a clock the test moves.
function session(t: { after: (cleanup: () => void) => void }, options: { file?: string; plugins?: boolean } = {}) {
  const dir = mkdtempSync(join(scratch, 'case-'));
  const file = options.file ?? join(dir, 'state', 'dashboard.json');
  const clock = { now: T0 };
  const open = () => {
    const dashboard = createDashboard({ file, engine: GridStackEngine, now: () => clock.now++ });
    if (options.plugins) assert.equal(dashboard.catalog(gridWidgets).outcome, 'success');
    return dashboard;
  };
  let api: ReturnType<typeof createDashboardApi>;
  const call = async (action: string, body: unknown = {}, raw = false) => {
    api ??= createDashboardApi({ dashboard: open() });
    const response = await api.handle(action, new Request('http://dsh.test/api/dudu/dashboard/x', { method: 'POST', body: raw ? String(body) : JSON.stringify(body) }));
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  const ok = async (action: string, body: unknown = {}) => {
    const { status, body: result } = await call(action, body);
    assert.equal(status, 200, `${action} ${JSON.stringify(body)}`);
    assert.equal(result.outcome, 'success', `${action} ${JSON.stringify(body)}: ${JSON.stringify(result)}`);
    return result;
  };
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file, open, call, ok, onDisk: () => JSON.parse(readFileSync(file, 'utf8')) };
}

// The cells a widget takes: a width that fills is every column, a height that fills is every row the window shows (`rows`, FILL_ROWS unless said),
// and never fewer than the widget's minimum.
const cellsOf = (item: Item, rows = FILL_ROWS) => ({
  w: item.w === 'fill' ? MAX_COLUMNS : item.w,
  h: item.h === 'fill' ? Math.max(declared(item.type)?.min.h ?? 1, rows) : item.h,
});

// What every layout the dashboard hands out must satisfy, however it got there.
function assertSound(layout: { v: number; widgets: Item[] }, rows = FILL_ROWS) {
  assert.equal(layout.v, 3);
  const types = new Set<string>();
  layout.widgets.forEach((a, i) => {
    assert.ok(!types.has(a.type), `one widget per type: ${a.type}`);
    types.add(a.type);
    assert.equal(a.id, a.type);
    const min = declared(a.type)?.min ?? { w: 1, h: 1 };
    const { w, h } = cellsOf(a, rows);
    for (const value of [a.x, a.y, ...(a.h === 'fill' ? [] : [a.h]), ...(a.w === 'fill' ? [] : [a.w])]) assert.ok(Number.isInteger(value), JSON.stringify(a));
    assert.ok(w >= min.w && h >= min.h && (a.h === 'fill' || a.h <= MAX_ROWS), `size of ${JSON.stringify(a)}`);
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + w <= MAX_COLUMNS, `inside the grid: ${JSON.stringify(a)}`);
    if (a.w === 'fill') assert.equal(a.x, 0);
    if (a.h === 'fill') assert.equal(a.y, 0);
    for (const b of layout.widgets.slice(i + 1)) {
      const other = cellsOf(b, rows);
      assert.ok(a.y >= b.y + other.h || a.y + h <= b.y || a.x + w <= b.x || a.x >= b.x + other.w, `no overlap: ${JSON.stringify([a, b])}`);
    }
  });
  const order = layout.widgets.map((item) => [item.y, item.x]);
  assert.deepEqual(order, [...order].sort((p, q) => p[0] - q[0] || p[1] - q[1]), 'reading order');
}

test('the built-in widgets are the table of the design doc, and a declaration that breaks the rules is refused with a reason', () => {
  assert.deepEqual(BUILT_IN_WIDGETS.map((widget) => [widget.id, widget.label, `${widget.min.w}x${widget.min.h}`, `${widget.size.w}x${widget.size.h}`]), [
    ['issues', 'Issues', '6x3', '10xfill'], ['office', 'Office', '5x3', '5x4'], ['collector', 'Inbox', '4x3', '5x5'],
  ]);
  for (const widget of BUILT_IN_WIDGETS) {
    assert.deepEqual(validateDeclaration(widget), { ok: true }, widget.id);
    assert.match(widget.description, /^[A-Z][^.\n]*$/, 'a short phrase on one line, without a full stop');
    assert.ok(widget.needs.length && widget.needs.every((need: string) => NEEDS.includes(need)), widget.id);
  }
  assert.deepEqual([COLUMNS, MAX_ROWS, FILL_ROWS], [15, 18, 9], 'fifteen columns, at most 18 rows, and nine rows for what fills when the window does not say');

  const fine = { id: 'acme.weather', label: 'Weather', description: 'Rain or shine.', min: { w: 2, h: 2 }, size: { w: 3, h: 2 }, needs: ['network'] };
  assert.deepEqual(validateDeclaration(fine), { ok: true });
  assert.deepEqual(validateDeclaration({ ...fine, size: { w: 'fill', h: 4 } }), { ok: true }, 'a width of fill is never smaller than the minimum');
  assert.deepEqual(validateDeclaration({ ...fine, size: { w: 3, h: 'fill' } }), { ok: true }, 'a height of fill is never smaller than the minimum either');
  assert.deepEqual(validateDeclaration({ ...fine, size: { w: 'fill', h: 'fill' } }), { ok: true });
  assert.equal((validateDeclaration({ ...fine, min: { w: 2, h: 'fill' } }) as any).ok, false, 'a minimum is always a number of cells');
  const refused: [unknown, RegExp][] = [
    [{ ...fine, label: '' }, /no name/], [{ ...fine, label: undefined }, /no name/], [{ ...fine, id: ' ' }, /no id/],
    [{ ...fine, min: undefined }, /no minimum size/], [{ ...fine, min: { w: 0, h: 2 } }, /minimum size/], [{ ...fine, min: { w: 2, h: 2.5 } }, /minimum size/],
    [{ ...fine, size: undefined }, /no recommended size/], [{ ...fine, size: { w: 1, h: 2 } }, /smaller than its minimum/], [{ ...fine, size: { w: 3, h: 1 } }, /smaller than its minimum/],
    [{ ...fine, min: { w: 2, h: 25 }, size: { w: 3, h: 25 } }, /minimum size/], [{ ...fine, size: { w: 3, h: 25 } }, /recommended size/], [{ ...fine, size: { w: 3, h: 'tall' } }, /recommended size/],
    [{ ...fine, needs: 'network' }, /needs/], [{ ...fine, description: 5 }, /description/], [null, /not a widget declaration/], ['test.small', /not a widget declaration/], [[], /not a widget declaration/],
  ];
  for (const [declaration, reason] of refused) {
    const result: any = validateDeclaration(declaration);
    assert.equal(result.ok, false, JSON.stringify(declaration));
    assert.match(result.reason, reason, JSON.stringify(declaration));
  }
});

test('the owner arranges the dashboard through the page and through 嘟嘟, over the HTTP handler on a real file, and takes changes back', async (t) => {
  const s = session(t, { plugins: true });

  // First open and reset use the new composition; opening alone never saves over a custom layout.
  const first = await s.ok('get');
  assert.deepEqual(first.layout, defaultLayout());
  assertSound(first.layout);
  assert.equal(first.widgets.length, 9);
  assert.equal(first.undo, null);
  assert.equal(first.recovered, null);
  assert.equal(existsSync(s.file), false, 'nothing is written before the first change');
  // The owner can still explicitly arrange one full-width Issues; resizing and fill semantics are independent of the default.
  await s.ok('set', { layout: fullIssuesLayout() });

  // Issues fills until it is given a size: a height alone keeps the width filling, it cannot go sideways, a width alone keeps the height
  // filling, and "fill" gives either back.
  const shorter = await s.ok('resize', { type: 'issues', h: 8 });
  assert.deepEqual(shorter.layout.widgets, [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 8 }]);
  assert.equal(shorter.undo.label, '「Issues」resized to full width × 8');
  assert.equal((await s.call('move', { type: 'issues', x: 3 })).body.outcome, 'no_op');
  assert.deepEqual(box((await s.ok('resize', { type: 'issues', w: 10 })).layout, 'issues'), [0, 0, 10, 8]);
  assert.deepEqual(box((await s.ok('resize', { type: 'issues', w: 'fill' })).layout, 'issues'), [0, 0, 'fill', 8]);
  assert.deepEqual(box((await s.ok('resize', { type: 'issues', h: 'fill' })).layout, 'issues'), [0, 0, 'fill', 'fill']);
  const narrower = await s.ok('resize', { type: 'issues', w: 10 });
  assert.deepEqual(box(narrower.layout, 'issues'), [0, 0, 10, 'fill'], 'a width alone leaves the height filling');
  assert.equal(narrower.undo.label, '「Issues」resized to 10 × full height');
  assert.equal((await s.call('resize', { type: 'issues', h: 'fill' })).body.outcome, 'no_op', 'it fills the height already');
  assert.deepEqual((await s.ok('reset')).layout, defaultLayout());
  await s.ok('set', { layout: fullIssuesLayout() });

  // No room beside a filling Issues, so a new widget goes below everything, at its recommended size; the file is then written whole.
  // How far down "below" is depends on the rows the window shows, which the page says (nine when nobody does).
  const quota = await s.ok('add', { type: 'test.small', columns: 9 });
  assert.deepEqual(box(quota.layout, 'test.small'), [0, FILL_ROWS, 3, 2]);
  assert.equal(quota.undo.label, 'Added「Small」');
  assert.deepEqual(s.onDisk(), quota.layout);
  assert.deepEqual(readdirSync(join(s.dir, 'state')), ['dashboard.json'], 'the temporary file is gone');
  assert.match(readFileSync(s.file, 'utf8'), /^\{\n {2}"v": 3,\n {2}"widgets": \[\n {4}\{"id":"issues"/, 'one widget per line');
  assert.deepEqual(box((await s.ok('undo')).layout, 'issues'), [0, 0, 'fill', 'fill']);
  assert.deepEqual(box((await s.ok('add', { type: 'test.small', rows: 15 })).layout, 'test.small'), [0, 15, 3, 2], 'below the fifteen rows this window shows');
  await s.ok('undo');
  for (const rows of [0, -3, 2.5, 'ten', null, 5000]) {
    assert.deepEqual(box((await s.ok('add', { type: 'test.small', rows })).layout, 'test.small'), [0, FILL_ROWS, 3, 2], `rows ${JSON.stringify(rows)} is not said`);
    await s.ok('undo');
  }
  await s.ok('add', { type: 'test.small' });

  // The owner drags Issues smaller: the page sends the whole layout and says which widget it was.
  const dragged = await s.ok('set', { layout: { v: 3, widgets: [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 8, h: 9 }, ...quota.layout.widgets.slice(1)] }, type: 'issues' });
  assert.equal(dragged.undo.label, '「Issues」resized to 8×9');
  assert.deepEqual(dragged.corrections, []);
  assert.equal((await s.ok('get')).undo.label, '「Issues」resized to 8×9', 'the page can ask what undo would do');

  // Adding scans each row left to right and top to bottom, never pushing; the room beside Issues is used first.
  assert.deepEqual(box((await s.ok('add', { type: 'test.summary', columns: 9 })).layout, 'test.summary'), [8, 0, 6, 3]);
  assert.deepEqual(box((await s.ok('add', { type: 'test.history', columns: 9 })).layout, 'test.history'), [8, 3, 6, 6]);
  const full = await s.ok('add', { type: 'office', columns: 9 });
  assert.deepEqual(box(full.layout, 'office'), [3, 9, 5, 4], 'no room in the first nine rows: the first slot below, beside Quota');
  assert.deepEqual(box(full.layout, 'test.small'), [0, 9, 3, 2], 'nothing else moved');
  const again = await s.call('add', { type: 'office' });
  assert.equal(again.body.outcome, 'no_op', 'one widget per type');
  assert.equal(again.body.undo.label, 'Added「Office」', 'a call that changes nothing leaves the undo entry alone');

  // 嘟嘟 moves Quota onto Summary: what it lands on is pushed down, and what that lands on, and so on; the rest stays.
  const pushed = await s.ok('move', { type: 'test.small', x: 8, y: 2 });
  assert.equal(pushed.undo.label, 'Moved「Small」');
  assert.deepEqual(['issues', 'test.small', 'test.summary', 'test.history', 'office'].map((type) => box(pushed.layout, type)), [[0, 0, 8, 9], [8, 2, 3, 2], [8, 4, 6, 3], [8, 7, 6, 6], [3, 9, 5, 4]]);
  assertSound(pushed.layout);

  // Undo takes back the last change, once (the one before it stays); the layout it restores is the one on disk.
  const undone = await s.ok('undo');
  assert.deepEqual(undone.layout, full.layout);
  assert.deepEqual(undone.undone, { label: 'Moved「Small」' });
  assert.equal(undone.undo, null);
  assert.deepEqual(s.onDisk(), full.layout);
  const twice = await s.call('undo');
  assert.equal(twice.body.outcome, 'no_op');
  assert.deepEqual(twice.body.layout, full.layout);

  // A size below the minimum or above 18 rows is clamped and says so; whatever it grows over is pushed down.
  const resized = await s.ok('resize', { type: 'test.summary', w: 1, h: 99 });
  assert.deepEqual(resized.corrections, [{ type: 'test.summary', reason: 'size', from: { w: 1, h: 99 }, to: { w: 3, h: 18 } }]);
  assert.equal(resized.undo.label, '「Summary」resized to 3×18');
  assert.deepEqual(box(resized.layout, 'test.summary'), [8, 0, 3, 18]);
  assert.deepEqual([box(resized.layout, 'office'), box(resized.layout, 'test.history')], [[3, 9, 5, 4], [8, 18, 6, 6]], 'History goes below it; Office, five wide, is beside it (columns 3 to 7, it is on 8 to 10) and stays');
  assertSound(resized.layout);
  assert.equal((await s.call('resize', { type: 'test.summary', w: 3, h: 18 })).body.outcome, 'no_op');

  // Removing leaves the space empty (nothing falls upward).
  const removed = await s.ok('remove', { type: 'test.history' });
  assert.equal(removed.undo.label, 'Removed「History」');
  assert.deepEqual(box(removed.layout, 'office'), [3, 9, 5, 4], 'nothing falls upward, and Office was not moved');
  assert.equal((await s.call('remove', { type: 'test.history' })).body.outcome, 'no_op');

  // A widget from a plugin the dashboard has never heard of is kept like any other, and its size has to be told.
  const unknown = await s.call('add', { type: '@acme/weather.forecast' });
  assert.equal(unknown.body.outcome, 'needs_clarification');
  assert.match(unknown.body.message, /size is needed/);
  const weather = await s.ok('add', { type: '@acme/weather.forecast', w: 4, h: 4, columns: 12, name: 'Weather' });
  assert.equal(weather.undo.label, 'Added「Weather」', 'the page tells the name of a widget this build has no declaration for');
  assert.deepEqual(box(weather.layout, '@acme/weather.forecast'), [11, 0, 4, 4]);
  assert.equal((await s.ok('move', { type: '@acme/weather.forecast', y: 30 })).undo.label, 'Moved「@acme/weather.forecast」', 'without a name it is the id');
  assert.deepEqual((await s.ok('undo')).layout, weather.layout);
  const kept = await s.ok('set', { layout: { v: 3, widgets: weather.layout.widgets.filter((item: Item) => item.type !== 'office') }, type: 'office' });
  assert.equal(kept.undo.label, 'Removed「Office」');
  assert.ok(kept.layout.widgets.some((item: Item) => item.type === '@acme/weather.forecast'));
  assert.equal((await s.call('set', { layout: kept.layout })).body.outcome, 'no_op', 'the same layout again changes nothing');

  // When several widgets moved and the page does not say which was dragged, the change is named for what it is.
  const many = await s.ok('set', { layout: { v: 3, widgets: kept.layout.widgets.map((item: Item) => ({ ...item, y: item.y + 20 })) } });
  assert.equal(many.undo.label, 'Changed layout');

  // Every kind of change can be taken back, and only the last one: each is undone to exactly the layout before it, in memory and on disk.
  const roundTrip = async (action: string, body: object, label: string) => {
    const base = (await s.ok('get')).layout;
    const changed = await s.ok(action, body);
    assert.equal(changed.undo.label, label, action);
    assert.notDeepEqual(changed.layout, base, action);
    assert.deepEqual(s.onDisk(), changed.layout, action);
    const back = await s.ok('undo');
    assert.deepEqual(back.layout, base, action);
    assert.deepEqual(s.onDisk(), base, action);
    assert.equal((await s.call('undo')).body.outcome, 'no_op', action);
  };
  const base = (await s.ok('get')).layout;
  await roundTrip('add', { type: 'test.future', columns: 12 }, 'Added「Future」');
  await roundTrip('move', { type: 'test.small', x: 3, y: 40 }, 'Moved「Small」');
  await roundTrip('resize', { type: 'issues', w: 12, h: 6 }, '「Issues」resized to 12×6');
  await roundTrip('remove', { type: 'test.small' }, 'Removed「Small」');
  await roundTrip('reset', {}, 'Restored default');
  await roundTrip('set', { layout: { v: 3, widgets: base.widgets.map((item: Item) => (item.type === 'issues' ? { ...item, y: 60 } : item)) }, type: 'issues' }, 'Moved「Issues」');
  await s.ok('move', { type: 'test.small', y: 41 });
  await s.ok('remove', { type: 'test.small' });
  assert.equal((await s.ok('undo')).undone.label, 'Removed「Small」');
  assert.equal((await s.call('undo')).body.outcome, 'no_op', 'the move before it cannot be undone any more');

  // Wrong values are answers, not failures; a widget that is not there is an error.
  for (const [action, body, mentions] of [
    ['move', { type: 'issues' }, /x \(column\)/], ['move', { type: 'issues', x: -1 }, /x must be/], ['move', { type: 'issues', y: 2.5 }, /y must be/], ['move', { x: 1 }, /type/],
    ['resize', { type: 'issues' }, /w \(columns\)/], ['resize', { type: 'issues', w: 0 }, /w must be/], ['resize', { type: 'issues', h: 'tall' }, /h must be/],
    ['add', { type: 'test.future', x: 1 }, /x and y go together/], ['add', { type: 5 }, /type/], ['add', { type: 'test.future', w: 2.5 }, /w must be/],
    ['set', { layout: [] }, /layout must be/], ['set', {}, /layout must be/], ['set', { layout: { v: 4, widgets: [] } }, /layout must be/],
  ] as [string, unknown, RegExp][]) {
    const wrong = await s.call(action, body);
    assert.equal(wrong.status, 200, `${action} ${JSON.stringify(body)}`);
    assert.equal(wrong.body.outcome, 'needs_clarification', `${action} ${JSON.stringify(body)}`);
    assert.match(wrong.body.message, mentions);
    assert.equal(typeof wrong.body.next, 'string');
    assert.equal(wrong.body.layout.v, 3, 'the answer still carries the layout');
  }
  const missing = await s.call('move', { type: 'test.blocked', x: 1 });
  assert.equal(missing.body.outcome, 'error');
  assert.match(missing.body.message, /no Blocked/);

  // A restart: the layout is on disk and comes back as it was; the undo entry is only in memory.
  const before = (await s.ok('get')).layout;
  const restarted = createDashboardApi({ dashboard: s.open() });
  const reopened: any = await (await restarted.handle('get', new Request('http://dsh.test/x', { method: 'POST', body: '{}' }))).json();
  assert.deepEqual(reopened.layout, before);
  assert.equal(reopened.undo, null);
  assert.equal(reopened.recovered, null);

  // The HTTP envelope is the issues one: unknown actions are 404 (never looked up on the prototype), bodies that are no JSON object are 400.
  assert.deepEqual([...DASHBOARD_ACTIONS].sort(), ['add', 'catalog', 'get', 'move', 'remove', 'reset', 'resize', 'set', 'undo']);
  for (const action of ['nope', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal((await s.call(action, {})).status, 404, action);
  for (const raw of ['not json', '[1,2]', 'null', '"text"', '']) {
    const bad = await s.call('get', raw, true);
    assert.equal(bad.status, 400, JSON.stringify(raw));
    assert.equal(typeof bad.body.error, 'string');
  }
  assert.equal((await s.call('get')).headers.get('cache-control'), 'no-store');
});

test('a dashboard.json written by something else is corrected when read, and the correction is written with the next change', async (t) => {
  const s = session(t, { plugins: true });
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const written = JSON.stringify({ v: 3, widgets: [
    { id: 'issues', type: 'issues', x: 0, y: 0, w: 8, h: 9 },
    { id: 'test.summary', type: 'test.summary', x: 4, y: 2, w: 6, h: 3 }, // lands on Issues: the later one in reading order goes below it
    { id: 'test.small', type: 'test.small', x: 8, y: 0, w: 1, h: 1 }, // below the minimum of 3 × 2
    { id: 'test.blocked', type: 'test.blocked', x: 15, y: 0, w: 2, h: 50 }, // taller than 18 rows, and past the right edge
    { id: 'acme.weather', type: 'acme.weather', x: 11, y: 0, w: 4, h: 3 }, // a plugin that is not installed: kept as it is
    { id: 'again', type: 'test.small', x: 0, y: 30, w: 3, h: 2 }, // a second Quota
    'garbage', null, 7, [], { x: 1 }, { type: 5 }, { id: 'test.history', x: -4, y: 1.4, w: 'wide', h: null }, // not widgets, or half of one
  ] });
  writeFileSync(s.file, written);

  const view = await s.ok('get');
  assertSound(view.layout);
  assert.deepEqual(view.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [
    ['issues', 0, 0, 8, 9], ['test.small', 8, 0, 3, 2], ['acme.weather', 11, 0, 4, 3], ['test.blocked', 12, 3, 3, 18],
    ['test.history', 0, 9, 6, 6], // half a widget: its type from the id, the recommended size, a column and a row that exist, and then below Issues
    ['test.summary', 4, 15, 6, 3], // below Issues, and then below History, which took the place first
  ]);
  assert.equal(readFileSync(s.file, 'utf8'), written, 'reading never writes');
  assert.equal(readdirSync(join(s.dir, 'state')).length, 1);

  const next = await s.ok('add', { type: 'office', columns: 12 });
  assertSound(next.layout);
  assert.deepEqual(s.onDisk(), next.layout, 'the corrected layout, with the change, is what is saved');
  assert.deepEqual((await s.ok('undo')).layout, view.layout, 'undo goes back to the corrected layout');

  // The page's own layout is corrected the same way, and says what it changed.
  const sent = await s.ok('set', { layout: { v: 3, widgets: [
    { id: 'issues', type: 'issues', x: 0, y: 0, w: 8, h: 9 }, { id: 'test.small', type: 'test.small', x: 4, y: 2, w: 1, h: 1 }, 7, { id: 'test.small', type: 'test.small', x: 14, y: 18, w: 3, h: 2 },
  ] } });
  assert.deepEqual(sent.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [['issues', 0, 0, 8, 9], ['test.small', 4, 9, 3, 2]]);
  assert.deepEqual(sent.corrections, [
    { type: 'test.small', reason: 'size', from: { w: 1, h: 1 }, to: { w: 3, h: 2 } }, { type: null, reason: 'unusable' }, { type: 'test.small', reason: 'position', from: { x: 14, y: 18 }, to: { x: 12, y: 18 } }, { type: 'test.small', reason: 'duplicate' },
    { type: 'test.small', reason: 'overlap', from: { x: 4, y: 2 }, to: { x: 4, y: 9 } },
  ]);

  // A plugin whose declaration is known is held to its minimum like the built-in widgets.
  const installed = { id: 'acme.weather', label: 'Weather', description: 'Rain or shine.', min: { w: 3, h: 2 }, size: { w: 3, h: 2 }, needs: ['network'] };
  const held = normalize({ v: 3, widgets: [{ type: 'acme.weather', x: 0, y: 0, w: 1, h: 1 }] }, { known: [...known, installed], engine: GridStackEngine });
  assert.deepEqual(held.layout.widgets.map((item: Item) => [item.type, item.w, item.h]), [['acme.weather', 3, 2]]);

  // Whatever is thrown at the rules, the answer is a layout that holds them, and giving it back changes nothing.
  const random = generator(7);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  const types = [...known.map((widget) => widget.id), 'acme.weather', 'acme.clock', 'constructor', '__proto__', '', undefined];
  const odd = [undefined, null, NaN, Infinity, -Infinity, -3, 0, 0.4, 2.5, 12, 25, 1e9, -1e9, '3', 'fill', 'fill', 'x', true, {}, [], [1]];
  let corrected = 0;
  for (let round = 0; round < 1500; round++) {
    const widgets = Array.from({ length: Math.floor(random() * 10) }, () => (random() < 0.1 ? pick(odd) : {
      type: pick(types), id: random() < 0.3 ? pick(types) : undefined,
      x: random() < 0.5 ? Math.floor(random() * 24) : pick(odd), y: random() < 0.5 ? Math.floor(random() * 20) : pick(odd),
      w: random() < 0.5 ? 1 + Math.floor(random() * 16) : pick(odd), h: random() < 0.5 ? 1 + Math.floor(random() * 16) : pick(odd),
    }));
    const rows = pick([undefined, 1, 8, 12, 15, 40]);
    const { layout, corrections } = normalize(random() < 0.05 ? pick(odd) : { v: 3, widgets }, { known, engine: GridStackEngine, rows });
    assertSound(layout, rows);
    assert.deepEqual(normalize(layout, { known, engine: GridStackEngine, rows }).layout, layout);
    assert.ok(layout.widgets.every((item: Item) => item.y <= MAX_Y + MAX_ROWS * 10), 'what is read is bounded, and pushes add only a few rows to that');
    if (corrections.length) corrected++;
  }
  assert.ok(corrected > 1000, 'most of the random input did need correcting');
  // ...even if the engine itself fails: every widget keeps a place of its own.
  const broken = class { constructor() { throw new Error('the engine broke'); } };
  const stacked = normalize({ v: 3, widgets: [{ type: 'test.small', x: 0, y: 0, w: 3, h: 2 }, { type: 'test.blocked', x: 0, y: 0, w: 3, h: 3 }] }, { known, engine: broken }).layout;
  assert.deepEqual(stacked.widgets.map((item: Item) => [item.type, item.y]), [['test.small', 0], ['test.blocked', 2]]);
  const stackedFill = normalize({ v: 3, widgets: [{ type: 'issues', w: 'fill', h: 'fill' }, { type: 'test.small', x: 0, y: 0, w: 3, h: 2 }] }, { known, engine: broken, rows: 15 }).layout;
  assert.deepEqual(stackedFill.widgets.map((item: Item) => [item.type, item.y]), [['issues', 0], ['test.small', 15]], 'a height that fills counts the rows the window shows even when the engine fails');
});

test('old extra built-ins disappear from saved layouts, cannot be re-added, and Undo preserves the migration', async (t) => {
  const s = session(t);
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const retained = [
    { id: 'issues', type: 'issues', x: 0, y: 0, w: 8, h: 9 },
    { id: 'office', type: 'office', x: 0, y: 9, w: 9, h: 6 },
    { id: 'acme.weather', type: 'acme.weather', x: 9, y: 9, w: 4, h: 3 },
  ];
  const retired = ['overview', 'upcoming', 'stuck', 'inputs', 'sessions', 'quota'];
  const old = { v: 3, widgets: [
    ...retained, ...retired.map((type, n) => ({ id: type, type, x: 0, y: 15 + n * 6, w: 6, h: 6 })),
  ] };
  const text = JSON.stringify(old);
  writeFileSync(s.file, text);
  const view = await s.ok('get');
  assert.deepEqual(view.layout.widgets, retained, 'designed widgets and third-party widgets keep their cells');
  assert.deepEqual(view.widgets.map((widget: any) => widget.id), ['issues', 'office', 'collector']);
  assert.equal(readFileSync(s.file, 'utf8'), text, 'reading does not rewrite the file');
  for (const type of retired) {
    assert.equal((await s.call('add', { type, w: 6, h: 6 })).body.outcome, 'needs_clarification', type);
  }
  const change = await s.ok('move', { type: 'acme.weather', y: 14 });
  assert.deepEqual(s.onDisk(), change.layout, 'the next edit saves the migrated layout');
  assert.deepEqual((await s.ok('undo')).layout.widgets, retained);
  assert.deepEqual(s.onDisk().widgets, retained, 'Undo does not resurrect removed built-ins');
  assert.deepEqual((await s.call('set', { layout: old })).body.layout.widgets, retained, 'older clients cannot restore retired widgets');
});

test('a layout of the ten-column grid is read on fifteen: every cell count is a half more, the old default fills the height too, and nothing is written until a change', async (t) => {
  const s = session(t, { plugins: true });
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const v1 = { v: 1, widgets: [
    { id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 6 },
    { id: 'test.small', type: 'test.small', x: 0, y: 6, w: 2, h: 1 },
    { id: 'office', type: 'office', x: 2, y: 6, w: 6, h: 4 },
    { id: 'test.history', type: 'test.history', x: 6, y: 10, w: 4, h: 4 },
    { id: 'acme.weather', type: 'acme.weather', x: 7, y: 0, w: 3, h: 2 }, // a plugin that is not installed keeps what it asked for, scaled
    { id: 'overview', type: 'overview', x: 0, y: 12, w: 4, h: 4 }, // retired
  ] };
  const text = JSON.stringify(v1);
  writeFileSync(s.file, text);
  const view = await s.ok('get');
  assertSound(view.layout);
  assert.deepEqual(view.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [
    ['issues', 0, 0, 'fill', 'fill'], ['test.small', 0, 9, 3, 2], ['acme.weather', 11, 9, 4, 3], ['office', 3, 12, 9, 6], ['test.history', 9, 18, 6, 6],
  ]);
  assert.equal(readFileSync(s.file, 'utf8'), text, 'reading does not rewrite the file');
  // The next change writes it as version 3.
  const moved = await s.ok('move', { type: 'test.small', y: 40 });
  assert.equal(s.onDisk().v, 3);
  assert.deepEqual(s.onDisk(), moved.layout);
  assert.deepEqual((await s.ok('undo')).layout, view.layout, 'undo goes back to the migrated layout, not the ten-column one');
  assert.equal(s.onDisk().v, 3);

  // The default Issues of the old grid is the one that filled the width at six rows; any other height is scaled by a half more and stays a number.
  assert.deepEqual(migrate({ v: 1, widgets: [{ type: 'issues', x: 0, y: 0, w: 'fill', h: 6 }] }).widgets, [{ type: 'issues', x: 0, y: 0, w: 'fill', h: 'fill' }]);
  assert.deepEqual(migrate({ v: 1, widgets: [{ type: 'issues', x: 0, y: 0, w: 'fill', h: 4 }] }).widgets, [{ type: 'issues', x: 0, y: 0, w: 'fill', h: 6 }]);
  assert.deepEqual(migrate({ v: 1, widgets: [{ type: 'issues', x: 0, y: 0, w: 5, h: 6 }] }).widgets, [{ type: 'issues', x: 0, y: 0, w: 8, h: 9 }]);
  assert.deepEqual(migrate({ v: 1, widgets: [{ type: 'test.small', x: 0, y: 0, w: 'fill', h: 6 }] }).widgets, [{ type: 'test.small', x: 0, y: 0, w: 'fill', h: 9 }], 'only Issues has a default');
  // Damaged values are not numbers to scale; they are left for the rules to correct, and nothing throws.
  const damaged = migrate({ v: 1, widgets: ['x', null, { type: 'test.small', x: 'a', y: null, w: {}, h: NaN }, { x: 1.5, type: 'test.small', w: 1, h: 1 }] }) as any;
  assert.equal(damaged.v, 3);
  assert.deepEqual(damaged.widgets.slice(0, 2), ['x', null]);
  assert.deepEqual(damaged.widgets[3], { x: 2, type: 'test.small', w: 2, h: 2 });
  assert.doesNotThrow(() => normalize({ v: 1, widgets: [1, 'x', null, [], { type: 'test.small', x: 'a', y: null, w: {}, h: NaN }] }, { known, engine: GridStackEngine }));
  // A version 3 layout and anything else is returned as it is.
  const current = { v: 3, widgets: [{ type: 'test.small', x: 1, y: 1, w: 3, h: 2 }] };
  assert.equal(migrate(current), current);
  assert.equal(migrate(null as any), null);
  assert.equal(migrate({ v: 1, widgets: 'no' } as any).v, 1);
  assert.equal(migrate({ v: 2, widgets: 'no' } as any).v, 2);

  // A page of an older build still sends version 1 with its own cell counts: they are read the same way.
  const t2 = session(t);
  assert.deepEqual((await t2.ok('get')).layout, defaultLayout());
  const sent = await t2.ok('set', { layout: { v: 1, widgets: [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 5, h: 6 }, { id: 'test.small', type: 'test.small', x: 5, y: 0, w: 2, h: 1 }] }, type: 'issues' });
  assert.deepEqual(sent.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [['issues', 0, 0, 8, 9], ['test.small', 8, 0, 3, 2]]);
  assert.equal(sent.layout.v, 3);
  assert.equal(t2.onDisk().v, 3);
});

test('a layout of the twenty-column grid is read on fifteen: every cell count is a quarter fewer, in one step, and what touched still touches', async (t) => {
  const s = session(t, { plugins: true });
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const v2 = { v: 2, widgets: [
    { id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 'fill' },
    { id: 'test.small', type: 'test.small', x: 0, y: 12, w: 4, h: 2 },
    { id: 'office', type: 'office', x: 4, y: 12, w: 8, h: 6 },
    { id: 'test.history', type: 'test.history', x: 12, y: 12, w: 8, h: 8 },
    { id: 'acme.weather', type: 'acme.weather', x: 16, y: 2, w: 4, h: 4 }, // a plugin that is not installed keeps what it asked for, scaled
  ] };
  const text = JSON.stringify(v2);
  writeFileSync(s.file, text);
  const view = await s.ok('get');
  assertSound(view.layout);
  assert.deepEqual(view.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [
    // The weather (row 2 of the old grid) is read before History (row 12): it lands below Issues first, and History, which then overlaps it, goes below.
    ['issues', 0, 0, 'fill', 'fill'], ['test.small', 0, 9, 3, 2], ['office', 3, 9, 6, 5], ['acme.weather', 12, 9, 3, 3], ['test.history', 9, 12, 6, 6],
  ]);
  assert.equal(readFileSync(s.file, 'utf8'), text, 'reading does not rewrite the file');
  await s.ok('move', { type: 'test.small', y: 30 });
  assert.equal(s.onDisk().v, 3, 'the next change writes version 3');
  assert.deepEqual((await s.ok('undo')).layout, view.layout, 'undo goes back to the migrated layout');

  // The edges scale, not the sizes: two widgets side by side stay side by side, whatever the rounding does to each.
  const next = (widgets: any[]) => (migrate({ v: 2, widgets }) as any).widgets.map((item: any) => [item.x, item.w]);
  assert.deepEqual(next([{ x: 0, w: 5 }, { x: 5, w: 5 }, { x: 10, w: 5 }, { x: 15, w: 5 }]), [[0, 4], [4, 4], [8, 3], [11, 4]]);
  assert.deepEqual(next([{ x: 0, w: 6 }, { x: 6, w: 7 }, { x: 13, w: 7 }]), [[0, 5], [5, 5], [10, 5]]);
  assert.deepEqual(next([{ x: 16, w: 4 }]), [[12, 3]], 'the right edge of the grid is the right edge');
  // Whatever is not a number is left for the rules, as for the ten-column file; "fill" stays "fill".
  assert.deepEqual(migrate({ v: 2, widgets: [{ type: 'issues', x: 0, y: 0, w: 'fill', h: 'fill' }, 'x', { type: 'test.small', x: 'a', y: null, w: {}, h: NaN }, { x: 6, type: 'test.small', w: 1 }] }).widgets,
    [{ type: 'issues', x: 0, y: 0, w: 'fill', h: 'fill' }, 'x', { type: 'test.small', x: 'a', y: null, w: {}, h: NaN }, { x: 5, type: 'test.small', w: 1 }]);

  // A widget scaled below its minimum is held to it, and what that then overlaps is pushed down, never the others rearranged.
  const crowded = normalize({ v: 2, widgets: [
    { type: 'test.small', x: 0, y: 0, w: 2, h: 1 },
    { type: 'test.summary', x: 2, y: 0, w: 8, h: 4 },
    { type: 'test.future', x: 10, y: 0, w: 8, h: 8 },
  ] }, { known, engine: GridStackEngine });
  assertSound(crowded.layout);
  assert.deepEqual(crowded.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [
    ['test.small', 0, 0, 3, 2], ['test.future', 8, 0, 6, 6], ['test.summary', 2, 2, 6, 3],
  ], 'Quota grew to its minimum and Summary, which it now overlaps, goes below it; Future stays beside');
  assert.ok(crowded.corrections.some((entry: any) => entry.type === 'test.summary' && entry.reason === 'overlap'));
  assert.doesNotThrow(() => normalize({ v: 2, widgets: [1, 'x', null, [], { type: 'test.small', x: 'a', y: null, w: {}, h: NaN }] }, { known, engine: GridStackEngine }));

  // A page of the build before this one still sends version 2: it is read the same way.
  const t2 = session(t);
  const sent = await t2.ok('set', { layout: { v: 2, widgets: [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 10, h: 12 }, { id: 'test.small', type: 'test.small', x: 10, y: 0, w: 4, h: 2 }] }, type: 'issues' });
  assert.deepEqual(sent.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [['issues', 0, 0, 8, 9], ['test.small', 8, 0, 3, 2]]);
  assert.equal(sent.layout.v, 3);
  assert.equal(t2.onDisk().v, 3);
});

test('a height that fills counts the rows the window shows: the page says them, the plugin keeps "fill", and what gets in the way is pushed down', async (t) => {
  const s = session(t, { plugins: true });
  const resetFull = async () => {
    await s.ok('reset');
    return s.ok('set', { layout: fullIssuesLayout() });
  };
  const fillAndQuota = (y: number) => ({ v: 3, widgets: [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 'fill' }, { id: 'test.small', type: 'test.small', x: 0, y, w: 3, h: 2 }] });

  // Issues fills fifteen rows in this window: a Quota the page put at row 12 is in the way and goes below it; the fill is still "fill".
  const tall = await s.ok('set', { layout: fillAndQuota(12), type: 'test.small', rows: 15 });
  assert.deepEqual(tall.layout.widgets.map((item: Item) => [item.type, item.y, item.h]), [['issues', 0, 'fill'], ['test.small', 15, 2]]);
  assert.deepEqual(tall.corrections, [{ type: 'test.small', reason: 'overlap', from: { x: 0, y: 12 }, to: { x: 0, y: 15 } }]);
  assertSound(tall.layout, 15);
  // In a window of eight rows (a small one) Issues is shorter than Quota's row and nothing moves; the minimum of Issues is three rows.
  const small = await s.ok('set', { layout: fillAndQuota(12), type: 'test.small', rows: 8 });
  assert.deepEqual(small.layout.widgets.map((item: Item) => [item.type, item.y, item.h]), [['issues', 0, 'fill'], ['test.small', 12, 2]]);
  // `get` with the rows of a window shows the layout as that window sees it, and stores nothing: a window of fifteen rows sees Quota below
  // the fifteen rows of Issues, while the file still says row 12 (undo and reset answer the same way).
  assert.deepEqual((await s.ok('get', { rows: 15 })).layout.widgets.map((item: Item) => item.y), [0, 15]);
  assert.deepEqual((await s.ok('get')).layout.widgets.map((item: Item) => item.y), [0, 12], 'what is kept is unchanged');
  assert.deepEqual(s.onDisk().widgets.map((item: Item) => item.y), [0, 12]);
  const tiny = await s.ok('set', { layout: fillAndQuota(2), type: 'test.small', rows: 1 });
  assert.deepEqual(tiny.layout.widgets.map((item: Item) => [item.type, item.y, item.h]), [['issues', 0, 'fill'], ['test.small', 3, 2]], 'a window too small for the minimum counts the minimum: three rows');

  // Rows nobody can use are not said: the default counts.
  for (const rows of [undefined, 0, -1, 1.5, 'ten', 5000]) {
    await resetFull();
    const said = await s.ok('set', { layout: fillAndQuota(8), type: 'test.small', ...(rows === undefined ? {} : { rows }) });
    assert.deepEqual(said.layout.widgets.map((item: Item) => item.y), [0, FILL_ROWS], `rows ${JSON.stringify(rows)}`);
  }

  // Moved down, Issues has no "fill" height any more: it has the rows it had, up to MAX_ROWS; sideways it still fills.
  await resetFull();
  const lowered = await s.ok('move', { type: 'issues', y: 3, rows: 15 });
  assert.deepEqual(box(lowered.layout, 'issues'), [0, 3, 'fill', 15]);
  assert.deepEqual(box((await resetFull()).layout, 'issues'), [0, 0, 'fill', 'fill']);
  const huge = await s.ok('move', { type: 'issues', y: 3, rows: 40 });
  assert.deepEqual(box(huge.layout, 'issues'), [0, 3, 'fill', MAX_ROWS], 'a window taller than 18 rows still gives a widget 18 at most');
  await resetFull();

  // A widget that is put on Issues' rows from row 0 pushes Issues down; Issues then has a number of rows of its own.
  const landed = await s.ok('add', { type: 'test.small', x: 0, y: 0, rows: 15 });
  assert.deepEqual(landed.layout.widgets.map((item: Item) => [item.type, item.y, item.h]), [['test.small', 0, 2], ['issues', 2, 15]]);
  await resetFull();

  // Only the one that is at row 0 and has every row fills: given a height of "fill" at another row it has the rows a window gives it.
  const lower = await s.ok('add', { type: 'test.history', x: 9, y: 4, h: 'fill', rows: 10 });
  assert.deepEqual(box(lower.layout, 'test.history'), [9, 4, 6, 10]);
  await resetFull();

  // Heights are asked for by name too, and the words of the undo bar say what they are.
  assert.deepEqual(box((await s.ok('resize', { type: 'issues', h: 6 })).layout, 'issues'), [0, 0, 'fill', 6]);
  assert.deepEqual(box((await s.ok('resize', { type: 'issues', h: 'fill', rows: 14 })).layout, 'issues'), [0, 0, 'fill', 'fill']);
  await s.ok('resize', { type: 'issues', w: 12, h: 8 });
  const both = await s.ok('resize', { type: 'issues', w: 'fill', h: 'fill' });
  assert.equal(both.undo.label, '「Issues」resized to full width × full height');
  assert.deepEqual(both.layout, fullIssuesLayout());
  assert.equal((await s.call('resize', { type: 'issues', h: 'tall' })).body.outcome, 'needs_clarification');

  // A plugin may recommend a height of fill: the declaration is kept as it is, a widget added from it fills from row 0, and below row 0
  // (where the owner put it) it has the rows the window shows.
  const tallWidget = { id: 'test.column', label: 'Column', description: 'A tall one', min: { w: 3, h: 3 }, size: { w: 6, h: 'fill' }, needs: [], widgetApi: 1 };
  const catalog = await s.ok('catalog', { widgets: [...gridWidgets, tallWidget] });
  assert.ok(catalog.outcome === 'success');
  const empty = await s.ok('remove', { type: 'issues' });
  assert.deepEqual(empty.layout.widgets, []);
  const column = await s.ok('add', { type: 'test.column', rows: 9 });
  assert.deepEqual(box(column.layout, 'test.column'), [0, 0, 6, 'fill']);
  assert.equal((await s.ok('get')).widgets.find((widget: any) => widget.id === 'test.column').size.h, 'fill');
  // Another widget at the same row is pushed below it when Issues returns; the column keeps filling.
  assert.deepEqual(box((await s.ok('add', { type: 'test.small', x: 0, y: 0, rows: 9 })).layout, 'test.column'), [0, 2, 6, 9], 'pushed by something put on it, it has numbers');
});

test('a dashboard.json that cannot be used is set aside, not lost, and a failed save changes nothing', async (t) => {
  for (const [content, reason] of [
    ['', /not valid JSON/], ['not json {', /not valid JSON/], ['null', /version 1, 2 or 3/], ['[]', /version 1, 2 or 3/], ['{"v":4,"widgets":[]}', /version 1, 2 or 3/],
    ['{"v":1}', /version 1, 2 or 3/], ['{"v":3,"widgets":{}}', /version 1, 2 or 3/], ['{"widgets":[]}', /version 1, 2 or 3/],
  ] as [string, RegExp][]) {
    const s = session(t);
    mkdirSync(join(s.dir, 'state'), { recursive: true });
    writeFileSync(s.file, content);
    const view = await s.ok('get');
    assert.deepEqual(view.layout, defaultLayout(), JSON.stringify(content));
    assert.match(view.recovered.reason, reason);
    assert.equal(view.recovered.file, `${s.file}.bad-${T0}`, 'named by the time it was set aside');
    assert.equal(readFileSync(view.recovered.file, 'utf8'), content, 'what the owner had is kept, byte for byte');
    assert.equal(existsSync(s.file), false);
    // The next change writes a good file; the set-aside one stays.
    await s.ok('remove', { type: 'office' });
    assert.deepEqual(s.onDisk().widgets.map((item: Item) => item.type), ['issues', 'collector']);
    assert.equal(readFileSync(view.recovered.file, 'utf8'), content);
  }

  // An empty list of widgets is a dashboard the owner emptied, not a damaged one.
  const emptied = session(t);
  mkdirSync(join(emptied.dir, 'state'), { recursive: true });
  writeFileSync(emptied.file, '{"v":3,"widgets":[]}');
  const none = await emptied.ok('get');
  assert.deepEqual(none.layout, { v: 3, widgets: [] });
  assert.equal(none.recovered, null);

  // Two files set aside in the same millisecond do not overwrite each other.
  const s = session(t);
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const frozen = () => createDashboard({ file: s.file, engine: GridStackEngine, now: () => T0 });
  writeFileSync(s.file, 'first');
  assert.equal(frozen().get().recovered.file, `${s.file}.bad-${T0}`);
  writeFileSync(s.file, 'second');
  assert.equal(frozen().get().recovered.file, `${s.file}.bad-${T0}-1`);
  assert.deepEqual([readFileSync(`${s.file}.bad-${T0}`, 'utf8'), readFileSync(`${s.file}.bad-${T0}-1`, 'utf8')], ['first', 'second']);

  // A folder that cannot be written: the change is an error, the layout and the undo entry stay as they were, nothing is left behind.
  const blocked = session(t, { file: join(s.dir, 'a-file-not-a-folder', 'dashboard.json') });
  writeFileSync(join(s.dir, 'a-file-not-a-folder'), 'x');
  const failed = await blocked.call('remove', { type: 'office' });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.outcome, 'error');
  assert.match(failed.body.message, /could not be saved/);
  assert.deepEqual(failed.body.layout, defaultLayout());
  assert.equal(failed.body.undo, null);
  assert.deepEqual((await blocked.ok('get')).layout, defaultLayout());
  assert.equal((await blocked.call('undo')).body.outcome, 'no_op');
});

// What GridStack itself does with a layout, a move or a resize, and an added widget (GridStack.load() into a blank grid, GridStack.update(),
// addWidget()), written out against the bare engine, so the dashboard's answers can be held to it. The same cases were run on the real
// GridStack 14.0.0 in Chromium once (see the report of this package), and agreed.
const bare = {
  load(items: Item[]) {
    const grid = new GridStackEngine({ column: MAX_COLUMNS, mode: 'float' });
    const nodes = items.map((item) => ({ id: item.type, x: item.x, y: item.y, ...cellsOf(item), minW: declared(item.type)?.min.w, minH: declared(item.type)?.min.h, maxH: MAX_ROWS }));
    for (const node of nodes) node.x = Math.min(node.x, MAX_COLUMNS - node.w);
    nodes.sort((a, b) => a.y - b.y || a.x - b.x);
    grid.batchUpdate();
    grid._loading = true;
    for (const node of nodes) grid.addNode(node);
    delete grid._loading;
    grid.batchUpdate(false);
    return grid;
  },
  update(items: Item[], type: string, patch: Record<string, number>) {
    const grid = bare.load(items);
    const node = grid.nodes.find((n: any) => n.id === type);
    const w = { x: node.x, y: node.y, w: node.w, h: node.h, ...patch };
    grid.nodeBoundFix(w);
    grid.cleanNodes().beginUpdate(node);
    grid.moveNodeCheck(node, { x: w.x, y: w.y, w: w.w, h: w.h });
    grid.endUpdate();
    return grid;
  },
  add(items: Item[], widget: Record<string, unknown>) {
    const grid = bare.load(items);
    grid.saveInitial(); // GridStack's change event, after every load and every change, saves where everything stands
    grid.addNode(widget);
    return grid;
  },
  positions: (grid: any) => grid.nodes.map((n: any) => `${n.id}@${n.x},${n.y} ${n.w}x${n.h}`).sort(),
};
const positions = (layout: { widgets: Item[] }) => layout.widgets.map((item) => `${item.type}@${item.x},${item.y} ${cellsOf(item).w}x${cellsOf(item).h}`).sort();

test('moves, resizes, adds and overlapping files give the positions the bare gridstack engine gives', (t) => {
  const random = generator(42);
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const s = session(t, { plugins: true });
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const open = s.open;
  let checked = 0;

  for (let round = 0; round < 400; round++) {
    // A layout of up to six widgets in random places, overlapping on purpose: the file is read the way GridStack.load() reads it.
    const pool: string[] = known.map((widget) => widget.id).sort(() => random() - 0.5).slice(0, between(1, 6));
    const raw: Item[] = pool.map((type) => {
      const { min } = declared(type);
      const fill = type === 'issues' && random() < 0.3; // a filling widget starts at column 0, as the page writes it
      const tall = type === 'issues' && random() < 0.4; // and one that fills its height at row 0
      return {
        id: type, type, x: fill ? 0 : between(0, 14), y: tall ? 0 : between(0, 15),
        w: fill ? 'fill' : between(min.w, min.w + 7), h: tall ? 'fill' : between(min.h, min.h + 6),
      };
    });
    writeFileSync(s.file, JSON.stringify({ v: 3, widgets: raw }));
    const dashboard = open();
    const start = dashboard.get().layout;
    assertSound(start);
    assert.deepEqual(positions(start), bare.positions(bare.load(raw)), `load ${JSON.stringify(raw)}`);

    // One random change by name, against the same change done on the bare engine.
    const type = pool[between(0, pool.length - 1)];
    const kind = ['move', 'resize', 'add'][between(0, 2)];
    let expected: string[];
    let result: any;
    if (kind === 'move') {
      const to = { x: between(0, MAX_COLUMNS - 1), y: between(0, 20) };
      result = dashboard.move({ type, ...to });
      expected = bare.positions(bare.update(start.widgets, type, to));
    } else if (kind === 'resize') {
      const size = { w: between(1, 15), h: between(1, 21) };
      result = dashboard.resize({ type, ...size });
      expected = bare.positions(bare.update(start.widgets, type, size));
    } else {
      const free: string[] = known.map((widget) => widget.id).filter((id) => !pool.includes(id));
      if (!free.length) continue;
      const added = free[between(0, free.length - 1)];
      const to = { x: between(0, 14), y: between(0, 19) };
      const { size, min } = declared(added);
      result = dashboard.add({ type: added, ...to });
      expected = bare.positions(bare.add(start.widgets, { id: added, ...to, w: size.w === 'fill' ? MAX_COLUMNS : size.w, h: size.h === 'fill' ? Math.max(min.h, FILL_ROWS) : size.h, minW: min.w, minH: min.h, maxH: MAX_ROWS }));
    }
    assert.ok(['success', 'no_op'].includes(result.outcome), JSON.stringify(result));
    assertSound(result.layout);
    assert.deepEqual(positions(result.layout), expected, `${kind} ${type} on ${JSON.stringify(start)}`);
    assert.equal(result.outcome === 'success', JSON.stringify(result.layout) !== JSON.stringify(start), 'a no_op is exactly a change that changed nothing');
    checked++;
  }
  assert.ok(checked > 300);

  // Pushes can chain, and a widget that was pushed away and is no longer in the way goes back to where it was: only what has to move
  // moves. This is a case the real GridStack gave in Chromium. Issues lands on Source and Office, which go below it and onto each other;
  // History is pushed first by Office and is freed when Office moves on, so it ends where it started.
  writeFileSync(s.file, JSON.stringify({ v: 3, widgets: [
    { type: 'test.source', x: 8, y: 2, w: 4, h: 4 }, { type: 'test.small', x: 1, y: 3, w: 5, h: 3 }, { type: 'office', x: 4, y: 6, w: 7, h: 6 },
    { type: 'test.history', x: 2, y: 9, w: 6, h: 5 }, { type: 'test.blocked', x: 4, y: 14, w: 4, h: 4 }, { type: 'test.future', x: 1, y: 17, w: 6, h: 6 },
  ] }));
  const chained = open();
  const chainStart = chained.get().layout;
  assertSound(chainStart);
  const landed = chained.add({ type: 'issues', x: 0, y: 6 });
  assertSound(landed.layout);
  assert.deepEqual(positions(landed.layout), bare.positions(bare.add(chainStart.widgets, {
    id: 'issues', x: 0, y: 6, w: declared('issues').size.w, h: FILL_ROWS, minW: declared('issues').min.w, minH: declared('issues').min.h, maxH: MAX_ROWS,
  })));
  assert.equal(landed.layout.widgets.find((item: Item) => item.type === 'issues')?.h, FILL_ROWS, 'it fills from row 0 only: put lower down it has the rows it would have had');

  // Adding without a position takes the first free slot, scanning left to right, top to bottom: checked against a plain search of the cells.
  for (let round = 0; round < 100; round++) {
    const pool: string[] = known.map((widget) => widget.id).filter((id) => id !== 'issues' && id !== 'test.small').sort(() => random() - 0.5).slice(0, between(1, 4));
    const raw: Item[] = pool.map((type) => {
      const { min } = declared(type);
      return { id: type, type, x: between(0, 12), y: between(0, 16), w: between(min.w, min.w + 5), h: between(min.h, min.h + 6) };
    });
    writeFileSync(s.file, JSON.stringify({ v: 3, widgets: raw }));
    const dashboard = open();
    const start = dashboard.get().layout;
    const columns = between(4, 14);
    const added = dashboard.add({ type: 'test.small', columns });
    assert.equal(added.outcome, 'success');
    assert.deepEqual(added.layout.widgets.filter((item: Item) => item.type !== 'test.small'), start.widgets, 'it never pushes anything');
    const width = MAX_COLUMNS;
    const free = (x: number, y: number) => start.widgets.every((item: Item) => y >= item.y + (item.h as number) || y + 2 <= item.y || x + 3 <= item.x || x >= item.x + (item.w as number));
    let first: number[] | null = null;
    for (let y = 0; first === null; y++) for (let x = 0; x + 3 <= width && first === null; x++) if (free(x, y)) first = [x, y];
    assert.deepEqual(box(added.layout, 'test.small').slice(0, 2), first, `${JSON.stringify(start.widgets)} in ${columns} columns`);
  }
});
