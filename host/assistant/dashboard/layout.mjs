// The layout of the 嘟嘟 dashboard as pure functions (docs/assistant.md 4.1 "存放、谁能改"). No imports but widgets.mjs, no file system.
//
//   layout = { v: 1, widgets: [{ id, type, x, y, w, h }] }
//
// x and y count columns and rows from 0, w and h count cells. `w` is the string "fill" while Issues has never been resized: it then
// takes every column, whatever the window. There is one widget per type and `id` is that type. Widgets are kept in reading order
// (row, then column). The functions below take a layout that normalize() produced and return a new one; nothing is changed in place.
//
// The grid rules are gridstack's and are not written again here. Every push is done by its engine (the GridStackEngine class passed
// in, see engine.mjs), driven the way GridStack itself drives it, so the plugin process puts widgets where the page does. Two things
// belong to the page alone: the half-overlap rule (a gesture: a drag must cover half of a widget to push it) and the number of
// columns (the window's), so here a position the caller names that lands on a widget pushes it, and `w` has no upper bound but
// MAX_COLUMNS.
//
// Results are { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', layout, change?, corrections?, message?, next? };
// wrong input never throws. `change` says what was done, { kind: 'add' | 'remove' | 'move' | 'resize' | 'reset' | 'many', type, w?, h? },
// and `corrections` lists what had to be fixed on the way, { type, reason: 'size' | 'position' | 'overlap' | 'duplicate' | 'unusable', from?, to? }.
import { BUILT_IN_WIDGETS, FILL, MAX_COLUMNS, MAX_ROWS, MAX_Y, MIN_COLUMNS } from './widgets.mjs';

export const VERSION = 1;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const whole = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);
const plain = (value) => (['number', 'string', 'boolean'].includes(typeof value) ? value : null);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entry = (type, x, y, w, h) => ({ id: type, type, x, y, w, h });
const inReadingOrder = (a, b) => a.y - b.y || a.x - b.x;
const declarationsOf = (known) => new Map((known ?? BUILT_IN_WIDGETS).map((declaration) => [declaration.id, declaration]));
const nameOf = (declarations, type) => declarations.get(type)?.label ?? type;
const fillsOf = (items) => new Set(items.filter((item) => item.w === FILL).map((item) => item.type));
// How many columns the widgets themselves need; a widget that fills has no edge of its own, it adapts.
const extentOf = (items) => items.reduce((edge, item) => Math.max(edge, item.w === FILL ? 0 : item.x + item.w), 0);
const has = (layout, type) => layout.widgets.some((item) => item.type === type);

export function defaultLayout() {
  const { id, size } = BUILT_IN_WIDGETS.find((widget) => widget.id === 'issues');
  return { v: VERSION, widgets: [entry(id, 0, 0, size.w, size.h)] };
}

const sameLayout = (a, b) => JSON.stringify(a.widgets) === JSON.stringify(b.widgets);

// --- the engine
function needEngine(Engine) {
  if (typeof Engine !== 'function') throw new TypeError('The GridStackEngine class is needed: pass it as `engine` (see engine.mjs).');
}

const nodeOf = (item, declaration) => ({
  id: item.type, x: item.x, y: item.y, w: item.w === FILL ? MAX_COLUMNS : item.w, h: item.h,
  minW: declaration?.min.w, minH: declaration?.min.h, maxH: MAX_ROWS,
});

// A grid filled the way GridStack.load() fills a blank one: nodes in reading order, and `_loading` (the flag load() sets), which makes a
// node that lands on an earlier one go below it instead of pushing it away. float is the dashboard's mode: nothing falls upward.
function gridOf(Engine, items, declarations) {
  needEngine(Engine);
  const grid = new Engine({ column: MAX_COLUMNS, mode: 'float' });
  const nodes = items.map((item) => nodeOf(item, declarations.get(item.type))).sort(inReadingOrder);
  grid.batchUpdate();
  grid._loading = true;
  try {
    for (const node of nodes) grid.addNode(node);
  } finally {
    delete grid._loading;
  }
  grid.batchUpdate(false);
  return grid;
}

const itemsOf = (grid, fills) => grid.nodes
  .map((node) => entry(node.id, node.x, node.y, fills.has(node.id) && node.x === 0 && node.w === MAX_COLUMNS ? FILL : node.w, node.h))
  .sort(inReadingOrder);

// What GridStack.update() does for a move or a resize, call for call, so the same things are pushed.
function update(grid, type, patch) {
  const node = grid.nodes.find((candidate) => candidate.id === type);
  const wanted = { x: node.x, y: node.y, w: node.w, h: node.h, ...patch };
  grid.nodeBoundFix(wanted);
  grid.cleanNodes().beginUpdate(node);
  grid.moveNodeCheck(node, { x: wanted.x, y: wanted.y, w: wanted.w, h: wanted.h });
  grid.endUpdate();
}

// Only if the engine itself fails on a layout (it should not): every widget still gets a place of its own.
function stacked(items) {
  let y = 0;
  return [...items].sort(inReadingOrder).map((item) => {
    const placed = { ...item, x: 0, y };
    y += item.h;
    return placed;
  });
}

// --- reading a layout that somebody else wrote (the file, the page)
function read(value, declarations, corrections) {
  const unusable = () => {
    corrections.push({ type: null, reason: 'unusable' });
    return null;
  };
  if (!isObject(value)) return unusable();
  const type = [value.type, value.id].find((name) => typeof name === 'string' && name.length > 0 && name.length <= 200);
  if (!type) return unusable();
  // A type this build has never heard of (a plugin that is not installed) has no minimum to hold it to: it keeps what it asked for.
  const declaration = declarations.get(type);
  const min = declaration?.min ?? { w: 1, h: 1 };
  const recommended = declaration?.size ?? min;
  const asked = { w: value.w === FILL ? FILL : whole(value.w), h: whole(value.h) };
  const wide = asked.w ?? recommended.w;
  const w = wide === FILL ? FILL : clamp(wide, min.w, MAX_COLUMNS);
  const h = clamp(asked.h ?? recommended.h, min.h, MAX_ROWS);
  const x = w === FILL ? 0 : clamp(whole(value.x) ?? 0, 0, MAX_COLUMNS - w);
  const y = clamp(whole(value.y) ?? 0, 0, MAX_Y);
  if (w !== value.w || h !== value.h) corrections.push({ type, reason: 'size', from: { w: plain(value.w), h: plain(value.h) }, to: { w, h } });
  if (x !== value.x || y !== value.y) corrections.push({ type, reason: 'position', from: { x: plain(value.x), y: plain(value.y) }, to: { x, y } });
  return entry(type, x, y, w, h);
}

/**
 * Makes any value into a layout that holds the rules, and says what it had to change: { layout, corrections }. It never throws for
 * its input (only for a missing engine, which is a programming mistake). Unknown types are kept (they come from plugins that are not
 * installed); sizes are clamped to the minimum of the widget and to MAX_ROWS rows; a second widget of one type is dropped; widgets that
 * overlap are separated by pushing the later one (in reading order) down, like GridStack.load(). Input that is no layout at all gives
 * the default one. `known` is the list of declarations to hold widgets to (the built-in ones by default).
 */
export function normalize(input, { known, engine } = {}) {
  needEngine(engine);
  if (!isObject(input) || !Array.isArray(input.widgets)) return { layout: defaultLayout(), corrections: [{ type: null, reason: 'unusable' }] };
  const declarations = declarationsOf(known);
  const corrections = [];
  const items = [];
  const seen = new Set();
  for (const value of input.widgets) {
    const item = read(value, declarations, corrections);
    if (!item) continue;
    if (seen.has(item.type)) {
      corrections.push({ type: item.type, reason: 'duplicate' });
      continue;
    }
    seen.add(item.type);
    items.push(item);
  }
  let placed;
  try {
    placed = itemsOf(gridOf(engine, items, declarations), fillsOf(items));
  } catch {
    placed = stacked(items);
  }
  const asked = new Map(items.map((item) => [item.type, item]));
  for (const item of placed) {
    const was = asked.get(item.type);
    if (was.x !== item.x || was.y !== item.y) corrections.push({ type: item.type, reason: 'overlap', from: { x: was.x, y: was.y }, to: { x: item.x, y: item.y } });
  }
  return { layout: { v: VERSION, widgets: placed }, corrections };
}

// --- changes by name: the page's buttons and 嘟嘟's tools (dashboard_add, _move, _resize, _remove, _reset)
class Invalid extends Error {
  constructor(message, next = 'Correct the value and call again.') {
    super(message);
    this.next = next;
  }
}

const guarded = (operation) => (layout, request, context = {}) => {
  try {
    return operation(layout, isObject(request) ? request : {}, context);
  } catch (error) {
    if (error instanceof Invalid) return { outcome: 'needs_clarification', layout, message: error.message, next: error.next };
    throw error;
  }
};

const success = (items, change, corrections = []) => ({ outcome: 'success', layout: { v: VERSION, widgets: items }, change, corrections });
const noOp = (layout, message, next) => ({ outcome: 'no_op', layout, message, ...(next ? { next } : {}) });
// The result of a change that may have changed nothing: pushes that end where they began are no change.
const settled = (layout, items, change, message, corrections) => (JSON.stringify(items) === JSON.stringify(layout.widgets) ? noOp(layout, message) : success(items, change, corrections));

function typeOf(request) {
  const { type } = request;
  if (typeof type !== 'string' || !type || type.length > 200) throw new Invalid('type must be the id of a widget, such as "quota".', 'Call dashboard_get to see the ids.');
  return type;
}

function number(name, value, low, high) {
  if (!Number.isInteger(value) || value < low || value > high) throw new Invalid(`${name} must be a whole number from ${low} to ${high}.`);
  return value;
}

// A width is a whole number of columns, or "fill"; heights, and widths and heights past their bounds, are clamped by the caller.
const width = (value) => (value === FILL ? FILL : number('w', value, 1, Number.MAX_SAFE_INTEGER));
const height = (value) => number('h', value, 1, Number.MAX_SAFE_INTEGER);

const absent = (layout, type, declarations) => ({
  outcome: 'error', layout, message: `There is no ${nameOf(declarations, type)} on the dashboard.`, next: 'Call dashboard_get to see what is on it, or dashboard_add to put it there.',
});

/**
 * add: { type, w?, h?, x?, y?, columns? }. Without x and y the widget goes to the first free slot, scanning each row left to right,
 * top to bottom, and never pushes anything; when no slot is free it ends up below everything. `columns` is the number of columns the page
 * shows (at least MIN_COLUMNS), which decides what fits in a row; without it only the columns the widgets already use count, so a
 * lone Issues (which fills) never has room beside it. With x and y it lands there and pushes what is under it down. The size is the
 * recommended one unless w and h are given; a type this build does not know needs both. A type already on the dashboard is a no_op.
 */
export const add = guarded((layout, request, { known, engine }) => {
  const type = typeOf(request);
  const declarations = declarationsOf(known);
  if (has(layout, type)) return noOp(layout, `${nameOf(declarations, type)} is already on the dashboard.`, 'Use dashboard_move or dashboard_resize to change it.');
  const declaration = declarations.get(type);
  if (!declaration && (request.w === undefined || request.h === undefined)) {
    throw new Invalid(`"${type}" is not a built-in widget, so its size is needed.`, 'Call again with w and h: the recommended size the widget declares.');
  }
  const min = declaration?.min ?? { w: 1, h: 1 };
  const asked = { w: request.w === undefined ? declaration.size.w : width(request.w), h: request.h === undefined ? declaration.size.h : height(request.h) };
  const w = asked.w === FILL ? FILL : clamp(asked.w, min.w, MAX_COLUMNS);
  const h = clamp(asked.h, min.h, MAX_ROWS);
  const corrections = w === asked.w && h === asked.h ? [] : [{ type, reason: 'size', from: asked, to: { w, h } }];
  if ((request.x === undefined) !== (request.y === undefined)) throw new Invalid('x and y go together: give both or neither.', 'Leave both out to use the first free slot.');
  const columns = request.columns === undefined ? 0 : number('columns', request.columns, 1, MAX_COLUMNS);
  const at = request.x === undefined ? null : { x: number('x', request.x, 0, MAX_COLUMNS - 1), y: number('y', request.y, 0, MAX_Y) };

  const fills = fillsOf(layout.widgets);
  if (w === FILL) fills.add(type);
  const grid = gridOf(engine, layout.widgets, declarations);
  if (at) {
    // GridStack has just saved where everything stands when it is asked to add (its change event does that), and a widget that was
    // pushed away and is no longer in the way goes back toward that place: only what has to move moves.
    grid.saveInitial();
    grid.addNode(nodeOf(entry(type, at.x, at.y, w, h), declaration));
    return success(itemsOf(grid, fills), { kind: 'add', type }, corrections);
  }
  const scan = Math.max(MIN_COLUMNS, columns, extentOf(layout.widgets), w === FILL ? 0 : w);
  const node = nodeOf(entry(type, 0, 0, w, h), declaration);
  if (w === FILL) node.w = scan;
  grid.findEmptyPosition(node, grid.nodes, scan);
  const items = [...itemsOf(grid, fills), entry(type, node.x, node.y, w, h)].sort(inReadingOrder);
  return success(items, { kind: 'add', type }, corrections);
});

/** move: { type, x?, y? } (at least one; the other stays). Whatever it lands on is pushed down. */
export const move = guarded((layout, request, { known, engine }) => {
  const type = typeOf(request);
  const declarations = declarationsOf(known);
  if (!has(layout, type)) return absent(layout, type, declarations);
  const patch = {};
  if (request.x !== undefined) patch.x = number('x', request.x, 0, MAX_COLUMNS - 1);
  if (request.y !== undefined) patch.y = number('y', request.y, 0, MAX_Y);
  if (!Object.keys(patch).length) throw new Invalid('Say where to put it: x (column) and/or y (row), counted from 0.');
  const grid = gridOf(engine, layout.widgets, declarations);
  update(grid, type, patch);
  return settled(layout, itemsOf(grid, fillsOf(layout.widgets)), { kind: 'move', type }, 'It is already there.');
});

/**
 * resize: { type, w?, h? } (at least one; the other stays, and a widget that fills keeps filling unless w is given). w may be "fill".
 * A size below the widget's minimum or above MAX_ROWS rows is clamped, and says so in `corrections`. Whatever it grows over is pushed down.
 */
export const resize = guarded((layout, request, { known, engine }) => {
  const type = typeOf(request);
  const declarations = declarationsOf(known);
  if (!has(layout, type)) return absent(layout, type, declarations);
  const patch = {};
  const wide = request.w === undefined ? undefined : width(request.w);
  if (wide !== undefined) patch.w = wide === FILL ? MAX_COLUMNS : wide;
  if (request.h !== undefined) patch.h = height(request.h);
  if (!Object.keys(patch).length) throw new Invalid('Say the size: w (columns) and/or h (rows).');
  const fills = fillsOf(layout.widgets);
  if (wide !== undefined) fills[wide === FILL ? 'add' : 'delete'](type);
  const grid = gridOf(engine, layout.widgets, declarations);
  update(grid, type, patch);
  const items = itemsOf(grid, fills);
  const { w, h } = items.find((item) => item.type === type);
  const was = layout.widgets.find((item) => item.type === type);
  const asked = { w: request.w ?? was.w, h: request.h ?? was.h };
  const corrections = w === asked.w && h === asked.h ? [] : [{ type, reason: 'size', from: asked, to: { w, h } }];
  return settled(layout, items, { kind: 'resize', type, w, h }, 'It already has that size.', corrections);
});

/** remove: { type }. Nothing else moves: what was beside it stays where it is and the space stays empty. */
export const remove = guarded((layout, request, { known }) => {
  const type = typeOf(request);
  if (!has(layout, type)) return noOp(layout, `There is no ${nameOf(declarationsOf(known), type)} on the dashboard.`, 'Call dashboard_get to see what is on it.');
  return success(layout.widgets.filter((item) => item.type !== type).map((item) => ({ ...item })), { kind: 'remove', type });
});

/** reset: back to the default layout, a lone Issues that fills. */
export function reset(layout) {
  const fresh = defaultLayout();
  return sameLayout(layout, fresh) ? noOp(layout, 'The dashboard is already the default.') : success(fresh.widgets, { kind: 'reset' });
}

/**
 * What a whole new layout (the page's `set`) did to the one before it, as a `change`, or null when nothing differs. The widget that was
 * dragged, resized, added or removed is `hint` when the caller knows it; otherwise it is the only widget that differs, or the only one
 * whose size changed. When it cannot be told (several differ and none is the hint) the change is { kind: 'many' }.
 */
export function changeBetween(before, after, hint) {
  const was = new Map(before.widgets.map((item) => [item.type, item]));
  const now = new Map(after.widgets.map((item) => [item.type, item]));
  const added = [...now.keys()].filter((type) => !was.has(type));
  const removed = [...was.keys()].filter((type) => !now.has(type));
  const changed = [...now.keys()].filter((type) => was.has(type) && JSON.stringify(was.get(type)) !== JSON.stringify(now.get(type)));
  const differing = [...added, ...removed, ...changed];
  if (!differing.length) return null;
  const resized = changed.filter((type) => was.get(type).w !== now.get(type).w || was.get(type).h !== now.get(type).h);
  let actor = null;
  if (differing.includes(hint)) actor = hint;
  else if (differing.length === 1) actor = differing[0];
  else if (!added.length && !removed.length && resized.length === 1) actor = resized[0];
  if (actor === null) return { kind: 'many' };
  if (added.includes(actor)) return { kind: 'add', type: actor };
  if (removed.includes(actor)) return { kind: 'remove', type: actor };
  const { w, h } = now.get(actor);
  return resized.includes(actor) ? { kind: 'resize', type: actor, w, h } : { kind: 'move', type: actor };
}
