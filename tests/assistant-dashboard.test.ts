import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createDashboard } from '../host/assistant/dashboard/index.mjs';
import { createDashboardApi, DASHBOARD_ACTIONS } from '../host/assistant/dashboard/api.mjs';
import { defaultLayout, normalize } from '../host/assistant/dashboard/layout.mjs';
import { BUILT_IN_WIDGETS, MAX_COLUMNS, MAX_ROWS, MAX_Y, NEEDS, validateDeclaration } from '../host/assistant/dashboard/widgets.mjs';

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
type Item = { id: string; type: string; x: number; y: number; w: number | 'fill'; h: number };
const known = BUILT_IN_WIDGETS as any[];
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
function session(t: { after: (cleanup: () => void) => void }, options: { file?: string } = {}) {
  const dir = mkdtempSync(join(scratch, 'case-'));
  const file = options.file ?? join(dir, 'state', 'dashboard.json');
  const clock = { now: T0 };
  const open = () => createDashboard({ file, engine: GridStackEngine, now: () => clock.now++ });
  const api = createDashboardApi({ dashboard: open() });
  const call = async (action: string, body: unknown = {}, raw = false) => {
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

// What every layout the dashboard hands out must satisfy, however it got there.
function assertSound(layout: { v: number; widgets: Item[] }) {
  assert.equal(layout.v, 1);
  const types = new Set<string>();
  layout.widgets.forEach((a, i) => {
    assert.ok(!types.has(a.type), `one widget per type: ${a.type}`);
    types.add(a.type);
    assert.equal(a.id, a.type);
    const min = declared(a.type)?.min ?? { w: 1, h: 1 };
    const w = a.w === 'fill' ? MAX_COLUMNS : a.w;
    for (const value of [a.x, a.y, a.h, ...(a.w === 'fill' ? [] : [a.w])]) assert.ok(Number.isInteger(value), JSON.stringify(a));
    assert.ok(w >= min.w && a.h >= min.h && a.h <= MAX_ROWS, `size of ${JSON.stringify(a)}`);
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + w <= MAX_COLUMNS, `inside the grid: ${JSON.stringify(a)}`);
    if (a.w === 'fill') assert.equal(a.x, 0);
    for (const b of layout.widgets.slice(i + 1)) {
      const wb = b.w === 'fill' ? MAX_COLUMNS : b.w;
      assert.ok(a.y >= b.y + b.h || a.y + a.h <= b.y || a.x + w <= b.x || a.x >= b.x + wb, `no overlap: ${JSON.stringify([a, b])}`);
    }
  });
  const order = layout.widgets.map((item) => [item.y, item.x]);
  assert.deepEqual(order, [...order].sort((p, q) => p[0] - q[0] || p[1] - q[1]), 'reading order');
}

test('the built-in widgets are the table of the design doc, and a declaration that breaks the rules is refused with a reason', () => {
  assert.deepEqual(known.map((widget) => [widget.id, widget.label, `${widget.min.w}x${widget.min.h}`, `${widget.size.w}x${widget.size.h}`]), [
    ['issues', 'Issues', '4x2', 'fillx6'], ['overview', 'Overview', '2x2', '4x2'], ['upcoming', 'Upcoming', '2x2', '4x4'], ['stuck', 'Stuck', '2x2', '4x2'],
    ['inputs', 'Inputs', '2x2', '4x2'], ['quota', 'Quota', '2x1', '2x1'], ['sessions', 'Sessions', '3x2', '4x4'], ['office', 'Office', '4x3', '6x4'],
  ]);
  for (const widget of known) {
    assert.deepEqual(validateDeclaration(widget), { ok: true }, widget.id);
    assert.match(widget.description, /^[A-Z].*\.$/, 'a one-line sentence');
    assert.ok(widget.needs.length && widget.needs.every((need: string) => NEEDS.includes(need)), widget.id);
  }
  assert.equal(MAX_ROWS, 12);

  const fine = { id: 'acme.weather', label: 'Weather', description: 'Rain or shine.', min: { w: 2, h: 2 }, size: { w: 3, h: 2 }, needs: ['network'] };
  assert.deepEqual(validateDeclaration(fine), { ok: true });
  assert.deepEqual(validateDeclaration({ ...fine, size: { w: 'fill', h: 4 } }), { ok: true }, 'a width of fill is never smaller than the minimum');
  const refused: [unknown, RegExp][] = [
    [{ ...fine, label: '' }, /no name/], [{ ...fine, label: undefined }, /no name/], [{ ...fine, id: ' ' }, /no id/],
    [{ ...fine, min: undefined }, /no minimum size/], [{ ...fine, min: { w: 0, h: 2 } }, /minimum size/], [{ ...fine, min: { w: 2, h: 2.5 } }, /minimum size/],
    [{ ...fine, size: undefined }, /no recommended size/], [{ ...fine, size: { w: 1, h: 2 } }, /smaller than its minimum/], [{ ...fine, size: { w: 3, h: 1 } }, /smaller than its minimum/],
    [{ ...fine, min: { w: 2, h: 13 }, size: { w: 3, h: 13 } }, /minimum size/], [{ ...fine, size: { w: 3, h: 13 } }, /recommended size/],
    [{ ...fine, needs: 'network' }, /needs/], [{ ...fine, description: 5 }, /description/], [null, /not a widget declaration/], ['quota', /not a widget declaration/], [[], /not a widget declaration/],
  ];
  for (const [declaration, reason] of refused) {
    const result: any = validateDeclaration(declaration);
    assert.equal(result.ok, false, JSON.stringify(declaration));
    assert.match(result.reason, reason, JSON.stringify(declaration));
  }
});

test('the owner arranges the dashboard through the page and through 嘟嘟, over the HTTP handler on a real file, and takes changes back', async (t) => {
  const s = session(t);

  // First open: a lone Issues that fills the width, six rows tall, and nothing is written yet.
  const first = await s.ok('get');
  assert.deepEqual(first.layout, { v: 1, widgets: [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 6 }] });
  assert.deepEqual(first.layout, defaultLayout());
  assert.equal(first.widgets.length, 8);
  assert.equal(first.undo, null);
  assert.equal(first.recovered, null);
  assert.equal(existsSync(s.file), false, 'nothing is written before the first change');

  // Issues fills until it is given a width: a height alone keeps it filling, it cannot go sideways, and "fill" gives the width back.
  const shorter = await s.ok('resize', { type: 'issues', h: 4 });
  assert.deepEqual(shorter.layout.widgets, [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 'fill', h: 4 }]);
  assert.equal(shorter.undo.label, '“Issues” resized to full width × 4');
  assert.equal((await s.call('move', { type: 'issues', x: 3 })).body.outcome, 'no_op');
  assert.deepEqual(box((await s.ok('resize', { type: 'issues', w: 5 })).layout, 'issues'), [0, 0, 5, 4]);
  assert.deepEqual(box((await s.ok('resize', { type: 'issues', w: 'fill' })).layout, 'issues'), [0, 0, 'fill', 4]);
  assert.deepEqual((await s.ok('reset')).layout, defaultLayout());

  // No room beside a filling Issues, so a new widget goes below everything, at its recommended size; the file is then written whole.
  const quota = await s.ok('add', { type: 'quota', columns: 9 });
  assert.deepEqual(box(quota.layout, 'quota'), [0, 6, 2, 1]);
  assert.equal(quota.undo.label, 'Added “Quota”');
  assert.deepEqual(s.onDisk(), quota.layout);
  assert.deepEqual(readdirSync(join(s.dir, 'state')), ['dashboard.json'], 'the temporary file is gone');
  assert.match(readFileSync(s.file, 'utf8'), /^\{\n {2}"v": 1,\n {2}"widgets": \[\n {4}\{"id":"issues"/, 'one widget per line');

  // The owner drags Issues smaller: the page sends the whole layout and says which widget it was.
  const dragged = await s.ok('set', { layout: { v: 1, widgets: [{ id: 'issues', type: 'issues', x: 0, y: 0, w: 5, h: 6 }, ...quota.layout.widgets.slice(1)] }, type: 'issues' });
  assert.equal(dragged.undo.label, '“Issues” resized to 5×6');
  assert.deepEqual(dragged.corrections, []);
  assert.equal((await s.ok('get')).undo.label, '“Issues” resized to 5×6', 'the page can ask what undo would do');

  // Adding scans each row left to right and top to bottom, never pushing; the room beside Issues is used first.
  assert.deepEqual(box((await s.ok('add', { type: 'overview', columns: 9 })).layout, 'overview'), [5, 0, 4, 2]);
  assert.deepEqual(box((await s.ok('add', { type: 'sessions', columns: 9 })).layout, 'sessions'), [5, 2, 4, 4]);
  const full = await s.ok('add', { type: 'office', columns: 9 });
  assert.deepEqual(box(full.layout, 'office'), [2, 6, 6, 4], 'no room in the first six rows: the first slot below, beside Quota');
  assert.deepEqual(box(full.layout, 'quota'), [0, 6, 2, 1], 'nothing else moved');
  const again = await s.call('add', { type: 'office' });
  assert.equal(again.body.outcome, 'no_op', 'one widget per type');
  assert.equal(again.body.undo.label, 'Added “Office”', 'a call that changes nothing leaves the undo entry alone');

  // 嘟嘟 moves Quota onto Overview: what it lands on is pushed down, and what that lands on, and so on; the rest stays.
  const pushed = await s.ok('move', { type: 'quota', x: 5, y: 1 });
  assert.equal(pushed.undo.label, 'Moved “Quota”');
  assert.deepEqual(['issues', 'quota', 'overview', 'sessions', 'office'].map((type) => box(pushed.layout, type)), [[0, 0, 5, 6], [5, 1, 2, 1], [5, 2, 4, 2], [5, 4, 4, 4], [2, 8, 6, 4]]);
  assertSound(pushed.layout);

  // Undo takes back the last change, once (the one before it stays); the layout it restores is the one on disk.
  const undone = await s.ok('undo');
  assert.deepEqual(undone.layout, full.layout);
  assert.deepEqual(undone.undone, { label: 'Moved “Quota”' });
  assert.equal(undone.undo, null);
  assert.deepEqual(s.onDisk(), full.layout);
  const twice = await s.call('undo');
  assert.equal(twice.body.outcome, 'no_op');
  assert.deepEqual(twice.body.layout, full.layout);

  // A size below the minimum or above twelve rows is clamped and says so; whatever it grows over is pushed down.
  const resized = await s.ok('resize', { type: 'overview', w: 1, h: 99 });
  assert.deepEqual(resized.corrections, [{ type: 'overview', reason: 'size', from: { w: 1, h: 99 }, to: { w: 2, h: 12 } }]);
  assert.equal(resized.undo.label, '“Overview” resized to 2×12');
  assert.deepEqual(box(resized.layout, 'overview'), [5, 0, 2, 12]);
  assert.deepEqual([box(resized.layout, 'office'), box(resized.layout, 'sessions')], [[2, 12, 6, 4], [5, 16, 4, 4]], 'Sessions and Office both go below it, and Office, the later push, takes the row first');
  assertSound(resized.layout);
  assert.equal((await s.call('resize', { type: 'overview', w: 2, h: 12 })).body.outcome, 'no_op');

  // Removing leaves the space empty (nothing falls upward).
  const removed = await s.ok('remove', { type: 'sessions' });
  assert.equal(removed.undo.label, 'Removed “Sessions”');
  assert.deepEqual(box(removed.layout, 'office'), [2, 12, 6, 4]);
  assert.equal((await s.call('remove', { type: 'sessions' })).body.outcome, 'no_op');

  // A widget from a plugin the dashboard has never heard of is kept like any other, and its size has to be told.
  const unknown = await s.call('add', { type: '@acme/weather.forecast' });
  assert.equal(unknown.body.outcome, 'needs_clarification');
  assert.match(unknown.body.message, /size is needed/);
  const weather = await s.ok('add', { type: '@acme/weather.forecast', w: 3, h: 2, columns: 12, name: 'Weather' });
  assert.equal(weather.undo.label, 'Added “Weather”', 'the page tells the name of a widget this build has no declaration for');
  assert.deepEqual(box(weather.layout, '@acme/weather.forecast'), [7, 0, 3, 2]);
  assert.equal((await s.ok('move', { type: '@acme/weather.forecast', y: 30 })).undo.label, 'Moved “@acme/weather.forecast”', 'without a name it is the id');
  assert.deepEqual((await s.ok('undo')).layout, weather.layout);
  const kept = await s.ok('set', { layout: { v: 1, widgets: weather.layout.widgets.filter((item: Item) => item.type !== 'office') }, type: 'office' });
  assert.equal(kept.undo.label, 'Removed “Office”');
  assert.ok(kept.layout.widgets.some((item: Item) => item.type === '@acme/weather.forecast'));
  assert.equal((await s.call('set', { layout: kept.layout })).body.outcome, 'no_op', 'the same layout again changes nothing');

  // When several widgets moved and the page does not say which was dragged, the change is named for what it is.
  const many = await s.ok('set', { layout: { v: 1, widgets: kept.layout.widgets.map((item: Item) => ({ ...item, y: item.y + 20 })) } });
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
  await roundTrip('add', { type: 'upcoming', columns: 12 }, 'Added “Upcoming”');
  await roundTrip('move', { type: 'quota', x: 3, y: 40 }, 'Moved “Quota”');
  await roundTrip('resize', { type: 'issues', w: 4, h: 3 }, '“Issues” resized to 4×3');
  await roundTrip('remove', { type: 'quota' }, 'Removed “Quota”');
  await roundTrip('reset', {}, 'Restored default');
  await roundTrip('set', { layout: { v: 1, widgets: base.widgets.map((item: Item) => (item.type === 'issues' ? { ...item, y: 60 } : item)) }, type: 'issues' }, 'Moved “Issues”');
  await s.ok('move', { type: 'quota', y: 41 });
  await s.ok('remove', { type: 'quota' });
  assert.equal((await s.ok('undo')).undone.label, 'Removed “Quota”');
  assert.equal((await s.call('undo')).body.outcome, 'no_op', 'the move before it cannot be undone any more');

  // Wrong values are answers, not failures; a widget that is not there is an error.
  for (const [action, body, mentions] of [
    ['move', { type: 'issues' }, /x \(column\)/], ['move', { type: 'issues', x: -1 }, /x must be/], ['move', { type: 'issues', y: 2.5 }, /y must be/], ['move', { x: 1 }, /type/],
    ['resize', { type: 'issues' }, /w \(columns\)/], ['resize', { type: 'issues', w: 0 }, /w must be/], ['resize', { type: 'issues', h: 'tall' }, /h must be/],
    ['add', { type: 'upcoming', x: 1 }, /x and y go together/], ['add', { type: 5 }, /type/], ['add', { type: 'upcoming', columns: 0 }, /columns must be/], ['add', { type: 'upcoming', w: 2.5 }, /w must be/],
    ['set', { layout: [] }, /layout must be/], ['set', {}, /layout must be/], ['set', { layout: { v: 2, widgets: [] } }, /layout must be/],
  ] as [string, unknown, RegExp][]) {
    const wrong = await s.call(action, body);
    assert.equal(wrong.status, 200, `${action} ${JSON.stringify(body)}`);
    assert.equal(wrong.body.outcome, 'needs_clarification', `${action} ${JSON.stringify(body)}`);
    assert.match(wrong.body.message, mentions);
    assert.equal(typeof wrong.body.next, 'string');
    assert.equal(wrong.body.layout.v, 1, 'the answer still carries the layout');
  }
  const missing = await s.call('move', { type: 'stuck', x: 1 });
  assert.equal(missing.body.outcome, 'error');
  assert.match(missing.body.message, /no Stuck/);

  // A restart: the layout is on disk and comes back as it was; the undo entry is only in memory.
  const before = (await s.ok('get')).layout;
  const restarted = createDashboardApi({ dashboard: s.open() });
  const reopened: any = await (await restarted.handle('get', new Request('http://dsh.test/x', { method: 'POST', body: '{}' }))).json();
  assert.deepEqual(reopened.layout, before);
  assert.equal(reopened.undo, null);
  assert.equal(reopened.recovered, null);

  // The HTTP envelope is the issues one: unknown actions are 404 (never looked up on the prototype), bodies that are no JSON object are 400.
  assert.deepEqual([...DASHBOARD_ACTIONS].sort(), ['add', 'get', 'move', 'remove', 'reset', 'resize', 'set', 'undo']);
  for (const action of ['nope', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal((await s.call(action, {})).status, 404, action);
  for (const raw of ['not json', '[1,2]', 'null', '"text"', '']) {
    const bad = await s.call('get', raw, true);
    assert.equal(bad.status, 400, JSON.stringify(raw));
    assert.equal(typeof bad.body.error, 'string');
  }
  assert.equal((await s.call('get')).headers.get('cache-control'), 'no-store');
});

test('a dashboard.json written by something else is corrected when read, and the correction is written with the next change', async (t) => {
  const s = session(t);
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const written = JSON.stringify({ v: 1, widgets: [
    { id: 'issues', type: 'issues', x: 0, y: 0, w: 5, h: 6 },
    { id: 'overview', type: 'overview', x: 3, y: 1, w: 4, h: 2 }, // lands on Issues: the later one in reading order goes below it
    { id: 'quota', type: 'quota', x: 5, y: 0, w: 1, h: 1 }, // below the minimum of 2 × 1
    { id: 'stuck', type: 'stuck', x: 10, y: 0, w: 2, h: 50 }, // taller than twelve rows
    { id: 'acme.weather', type: 'acme.weather', x: 7, y: 0, w: 3, h: 2 }, // a plugin that is not installed: kept as it is
    { id: 'again', type: 'quota', x: 0, y: 20, w: 2, h: 1 }, // a second Quota
    'garbage', null, 7, [], { x: 1 }, { type: 5 }, { id: 'sessions', x: -4, y: 1.4, w: 'wide', h: null }, // not widgets, or half of one
  ] });
  writeFileSync(s.file, written);

  const view = await s.ok('get');
  assertSound(view.layout);
  assert.deepEqual(view.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [
    ['issues', 0, 0, 5, 6], ['quota', 5, 0, 2, 1], ['acme.weather', 7, 0, 3, 2], ['stuck', 10, 0, 2, 12],
    ['sessions', 0, 6, 4, 4], // half a widget: its type from the id, the recommended size, a column and a row that exist, and then below Issues
    ['overview', 3, 10, 4, 2], // below Issues, and then below Sessions, which took the place first
  ]);
  assert.equal(readFileSync(s.file, 'utf8'), written, 'reading never writes');
  assert.equal(readdirSync(join(s.dir, 'state')).length, 1);

  const next = await s.ok('add', { type: 'office', columns: 12 });
  assertSound(next.layout);
  assert.deepEqual(s.onDisk(), next.layout, 'the corrected layout, with the change, is what is saved');
  assert.deepEqual((await s.ok('undo')).layout, view.layout, 'undo goes back to the corrected layout');

  // The page's own layout is corrected the same way, and says what it changed.
  const sent = await s.ok('set', { layout: { v: 1, widgets: [
    { id: 'issues', type: 'issues', x: 0, y: 0, w: 5, h: 6 }, { id: 'quota', type: 'quota', x: 2, y: 1, w: 1, h: 1 }, 7, { id: 'quota', type: 'quota', x: 9, y: 9, w: 2, h: 1 },
  ] } });
  assert.deepEqual(sent.layout.widgets.map((item: Item) => [item.type, item.x, item.y, item.w, item.h]), [['issues', 0, 0, 5, 6], ['quota', 2, 6, 2, 1]]);
  assert.deepEqual(sent.corrections, [
    { type: 'quota', reason: 'size', from: { w: 1, h: 1 }, to: { w: 2, h: 1 } }, { type: null, reason: 'unusable' }, { type: 'quota', reason: 'duplicate' },
    { type: 'quota', reason: 'overlap', from: { x: 2, y: 1 }, to: { x: 2, y: 6 } },
  ]);

  // A plugin whose declaration is known is held to its minimum like the built-in widgets.
  const installed = { id: 'acme.weather', label: 'Weather', description: 'Rain or shine.', min: { w: 3, h: 2 }, size: { w: 3, h: 2 }, needs: ['network'] };
  const held = normalize({ v: 1, widgets: [{ type: 'acme.weather', x: 0, y: 0, w: 1, h: 1 }] }, { known: [...known, installed], engine: GridStackEngine });
  assert.deepEqual(held.layout.widgets.map((item: Item) => [item.type, item.w, item.h]), [['acme.weather', 3, 2]]);

  // Whatever is thrown at the rules, the answer is a layout that holds them, and giving it back changes nothing.
  const random = generator(7);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  const types = [...known.map((widget) => widget.id), 'acme.weather', 'acme.clock', 'constructor', '__proto__', '', undefined];
  const odd = [undefined, null, NaN, Infinity, -Infinity, -3, 0, 0.4, 2.5, 12, 13, 1e9, -1e9, '3', 'fill', 'x', true, {}, [], [1]];
  let corrected = 0;
  for (let round = 0; round < 1500; round++) {
    const widgets = Array.from({ length: Math.floor(random() * 10) }, () => (random() < 0.1 ? pick(odd) : {
      type: pick(types), id: random() < 0.3 ? pick(types) : undefined,
      x: random() < 0.5 ? Math.floor(random() * 12) : pick(odd), y: random() < 0.5 ? Math.floor(random() * 10) : pick(odd),
      w: random() < 0.5 ? 1 + Math.floor(random() * 8) : pick(odd), h: random() < 0.5 ? 1 + Math.floor(random() * 8) : pick(odd),
    }));
    const { layout, corrections } = normalize(random() < 0.05 ? pick(odd) : { v: 1, widgets }, { known, engine: GridStackEngine });
    assertSound(layout);
    assert.deepEqual(normalize(layout, { known, engine: GridStackEngine }).layout, layout);
    assert.ok(layout.widgets.every((item: Item) => item.y <= MAX_Y + MAX_ROWS * 10), 'what is read is bounded, and pushes add only a few rows to that');
    if (corrections.length) corrected++;
  }
  assert.ok(corrected > 1000, 'most of the random input did need correcting');
  // ...even if the engine itself fails: every widget keeps a place of its own.
  const broken = class { constructor() { throw new Error('the engine broke'); } };
  const stacked = normalize({ v: 1, widgets: [{ type: 'quota', x: 0, y: 0, w: 2, h: 1 }, { type: 'stuck', x: 0, y: 0, w: 2, h: 2 }] }, { known, engine: broken }).layout;
  assert.deepEqual(stacked.widgets.map((item: Item) => [item.type, item.y]), [['quota', 0], ['stuck', 1]]);
});

test('a dashboard.json that cannot be used is set aside, not lost, and a failed save changes nothing', async (t) => {
  for (const [content, reason] of [
    ['', /not valid JSON/], ['not json {', /not valid JSON/], ['null', /version 1/], ['[]', /version 1/], ['{"v":2,"widgets":[]}', /version 1/],
    ['{"v":1}', /version 1/], ['{"v":1,"widgets":{}}', /version 1/], ['{"widgets":[]}', /version 1/],
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
    await s.ok('add', { type: 'quota' });
    assert.deepEqual(s.onDisk().widgets.map((item: Item) => item.type), ['issues', 'quota']);
    assert.equal(readFileSync(view.recovered.file, 'utf8'), content);
  }

  // An empty list of widgets is a dashboard the owner emptied, not a damaged one.
  const emptied = session(t);
  mkdirSync(join(emptied.dir, 'state'), { recursive: true });
  writeFileSync(emptied.file, '{"v":1,"widgets":[]}');
  const none = await emptied.ok('get');
  assert.deepEqual(none.layout, { v: 1, widgets: [] });
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
  const failed = await blocked.call('add', { type: 'quota' });
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
    const nodes = items.map((item) => ({ id: item.type, x: item.x, y: item.y, w: item.w === 'fill' ? MAX_COLUMNS : item.w, h: item.h, minW: declared(item.type)?.min.w, minH: declared(item.type)?.min.h, maxH: MAX_ROWS }));
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
  positions: (grid: any) => grid.nodes.map((n: any) => `${n.id}@${n.x},${n.y} ${n.w === MAX_COLUMNS ? 'fill' : n.w}x${n.h}`).sort(),
};
const positions = (layout: { widgets: Item[] }) => layout.widgets.map((item) => `${item.type}@${item.x},${item.y} ${item.w}x${item.h}`).sort();

test('moves, resizes, adds and overlapping files give the positions the bare gridstack engine gives', (t) => {
  const random = generator(42);
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const s = session(t);
  mkdirSync(join(s.dir, 'state'), { recursive: true });
  const open = () => createDashboard({ file: s.file, engine: GridStackEngine, now: () => T0 });
  let checked = 0;

  for (let round = 0; round < 400; round++) {
    // A layout of up to six widgets in random places, overlapping on purpose: the file is read the way GridStack.load() reads it.
    const pool: string[] = known.map((widget) => widget.id).sort(() => random() - 0.5).slice(0, between(1, 6));
    const raw: Item[] = pool.map((type) => {
      const { min } = declared(type);
      const fill = type === 'issues' && random() < 0.3; // a filling widget starts at column 0, as the page writes it
      return { id: type, type, x: fill ? 0 : between(0, 9), y: between(0, 7), w: fill ? 'fill' : between(min.w, min.w + 5), h: between(min.h, min.h + 4) };
    });
    writeFileSync(s.file, JSON.stringify({ v: 1, widgets: raw }));
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
      const to = { x: between(0, 12), y: between(0, 10) };
      result = dashboard.move({ type, ...to });
      expected = bare.positions(bare.update(start.widgets, type, to));
    } else if (kind === 'resize') {
      const size = { w: between(1, 10), h: between(1, 14) };
      result = dashboard.resize({ type, ...size });
      expected = bare.positions(bare.update(start.widgets, type, size));
    } else {
      const free: string[] = known.map((widget) => widget.id).filter((id) => !pool.includes(id));
      if (!free.length) continue;
      const added = free[between(0, free.length - 1)];
      const to = { x: between(0, 9), y: between(0, 9) };
      const { size, min } = declared(added);
      result = dashboard.add({ type: added, ...to });
      expected = bare.positions(bare.add(start.widgets, { id: added, ...to, w: size.w === 'fill' ? MAX_COLUMNS : size.w, h: size.h, minW: min.w, minH: min.h, maxH: MAX_ROWS }));
    }
    assert.ok(['success', 'no_op'].includes(result.outcome), JSON.stringify(result));
    assertSound(result.layout);
    assert.deepEqual(positions(result.layout), expected, `${kind} ${type} on ${JSON.stringify(start)}`);
    assert.equal(result.outcome === 'success', JSON.stringify(result.layout) !== JSON.stringify(start), 'a no_op is exactly a change that changed nothing');
    checked++;
  }
  assert.ok(checked > 300);

  // Pushes can chain, and a widget that was pushed away and is no longer in the way goes back to where it was: only what has to move
  // moves. This is a case the real GridStack gave in Chromium. Issues lands on Inputs and Office, which go below it and onto each other;
  // Sessions is pushed first by Office and is freed when Office moves on, so it ends where it started.
  writeFileSync(s.file, JSON.stringify({ v: 1, widgets: [
    { type: 'inputs', x: 11, y: 2, w: 6, h: 6 }, { type: 'quota', x: 1, y: 4, w: 7, h: 1 }, { type: 'office', x: 5, y: 8, w: 9, h: 4 },
    { type: 'sessions', x: 3, y: 12, w: 5, h: 6 }, { type: 'stuck', x: 6, y: 18, w: 3, h: 5 }, { type: 'upcoming', x: 2, y: 23, w: 8, h: 4 },
  ] }));
  const chained = open();
  assertSound(chained.get().layout);
  const landed = chained.add({ type: 'issues', x: 0, y: 6 });
  assert.deepEqual(['issues', 'quota', 'inputs', 'office', 'sessions', 'stuck', 'upcoming'].map((type) => box(landed.layout, type)), [
    [0, 6, 'fill', 6], [1, 4, 7, 1], [11, 12, 6, 6], [5, 18, 9, 4], [3, 12, 5, 6], [6, 22, 3, 5], [2, 27, 8, 4],
  ]);

  // Adding without a position takes the first free slot, scanning left to right, top to bottom: checked against a plain search of the cells.
  for (let round = 0; round < 100; round++) {
    const pool: string[] = known.map((widget) => widget.id).filter((id) => id !== 'issues' && id !== 'quota').sort(() => random() - 0.5).slice(0, between(1, 4));
    const raw: Item[] = pool.map((type) => {
      const { min } = declared(type);
      return { id: type, type, x: between(0, 8), y: between(0, 8), w: between(min.w, min.w + 3), h: between(min.h, min.h + 3) };
    });
    writeFileSync(s.file, JSON.stringify({ v: 1, widgets: raw }));
    const dashboard = open();
    const start = dashboard.get().layout;
    const columns = between(4, 14);
    const added = dashboard.add({ type: 'quota', columns });
    assert.equal(added.outcome, 'success');
    assert.deepEqual(added.layout.widgets.filter((item: Item) => item.type !== 'quota'), start.widgets, 'it never pushes anything');
    const width = Math.max(columns, ...start.widgets.map((item: Item) => item.x + (item.w as number)));
    const free = (x: number, y: number) => start.widgets.every((item: Item) => y >= item.y + item.h || y + 1 <= item.y || x + 2 <= item.x || x >= item.x + (item.w as number));
    let first: number[] | null = null;
    for (let y = 0; first === null; y++) for (let x = 0; x + 2 <= width && first === null; x++) if (free(x, y)) first = [x, y];
    assert.deepEqual(box(added.layout, 'quota').slice(0, 2), first, `${JSON.stringify(start.widgets)} in ${columns} columns`);
  }
});
