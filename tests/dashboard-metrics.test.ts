// The page's grid arithmetic (host/dudu-plugin/ui/dashboard/metrics.js): fifteen columns that scale with the width, and a whole number of rows that
// share the height, so that a widget which fills the window is one screen, never scrolls, and leaves no strip blank under it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COLUMNS } from '../host/assistant/dashboard/widgets.mjs';
import { extent, GAP, metrics, MIN_CELL, span } from '../host/dudu-plugin/ui/dashboard/metrics.js';

const widths = [768, 800, 900, 1100, 1377, 1440, 1920, 2497, 3200];
const heights = [300, 520, 660, 860, 1000, 1260, 1500, 2000];

test('the rows fill the height exactly: a board of them is as tall as the window, never taller, so nothing is left blank under it and nothing scrolls', () => {
  for (const width of widths) for (const height of heights) {
    const { cols, rows, row } = metrics({ width, height });
    assert.equal(cols, COLUMNS);
    assert.equal(COLUMNS, 15, 'fifteen columns');
    const board = span(rows, row);
    assert.ok(board <= height, `${rows} rows of ${row}px are ${board}px, taller than ${height} (${width} × ${height})`);
    assert.ok(height - board < 0.01 * rows + 1e-6, `${board}px leaves ${height - board}px blank in ${width} × ${height}`);
  }
});

test('a row is within a few percent of a column: the nearest whole number of rows is taken (at most a tenth off from six rows up)', () => {
  for (const width of widths) for (const height of heights) {
    const { rows, cell, row } = metrics({ width, height });
    if (rows < 6) continue;
    assert.ok(Math.abs(row - cell) / (cell + GAP) <= 0.5 / rows + 0.001, `${width} × ${height}: ${rows} rows of ${row}px against a cell of ${cell}px`);
    assert.ok(Math.abs(row / cell - 1) <= 0.1, `${width} × ${height}: a row is ${row / cell} of a cell`);
  }
});

test('the rows are the nearest whole number to what the height holds in cells', () => {
  for (const width of widths) for (const height of heights) {
    const { rows, cell } = metrics({ width, height });
    if ((height + GAP) / (cell + GAP) < 1) continue;
    assert.equal(rows, Math.round((height + GAP) / (cell + GAP)), `${width} × ${height}`);
  }
  // 1700 × 1000 measured in the owner's screenshot: eleven rows of square cells left a strip of 65px; nine rows of fifteen columns fill it.
  const { rows, row } = metrics({ width: 1700 - 48, height: 1000 - 40 });
  assert.deepEqual([rows, Math.round(span(rows, row))], [9, 960]);
});

test('the columns use the whole width, down to the smallest cell; a narrower window keeps that cell and scrolls sideways', () => {
  for (const width of widths) {
    const { cell } = metrics({ width, height: 800 });
    if (width >= span(COLUMNS, MIN_CELL)) assert.ok(Math.abs(span(COLUMNS, cell) - width) < 1e-6, `${COLUMNS} columns fill ${width}`);
  }
  assert.equal(metrics({ width: 600, height: 800 }).cell, MIN_CELL);
  assert.equal(span(COLUMNS, MIN_CELL), 768);
});

test('there is always at least one row, whatever the height; less than a row of room gives a row as tall as a cell, which the page scrolls', () => {
  for (const height of [undefined, 0, 20]) {
    const { rows, cell, row } = metrics(height === undefined ? { width: 1440 } : { width: 1440, height });
    assert.deepEqual([rows, row], [1, cell], `height ${height}`);
  }
});

test('a widget keeps its size in pixels with a quarter fewer cells: 6 × 3 of the fifteen columns is 8 × 4 of the twenty there were, and with a half more than the ten', () => {
  for (const width of widths.filter((value) => value >= 1000)) {
    const coarse = metrics({ width }).cell;
    const twenty = (width - GAP * 19) / 20;
    const ten = (width - GAP * 9) / 10;
    assert.ok(Math.abs(span(6, coarse) - span(8, twenty)) < 1e-6, `${width}: 6 of 15 is 8 of 20 (${span(6, coarse)} against ${span(8, twenty)})`);
    assert.ok(Math.abs(span(6, coarse) - span(4, ten)) < 1e-6, `${width}: 6 of 15 is 4 of 10`);
  }
});

test('the board has at least the window\'s rows and more when a widget is lower', () => {
  assert.deepEqual(extent([{ y: 0, h: 9 }], { cols: COLUMNS, rows: 9 }), { columns: COLUMNS, rows: 9 });
  assert.deepEqual(extent([{ y: 0, h: 4 }], { cols: COLUMNS, rows: 9 }), { columns: COLUMNS, rows: 9 });
  assert.deepEqual(extent([{ y: 0, h: 9 }, { y: 9, h: 2 }], { cols: COLUMNS, rows: 9 }), { columns: COLUMNS, rows: 11 });
  assert.deepEqual(extent([], { cols: COLUMNS }), { columns: COLUMNS, rows: 1 });
});
