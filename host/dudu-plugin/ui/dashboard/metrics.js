// Fifteen columns scale with the content width, and the rows are as many as the window's height holds, so a widget that fills the window
// (the default Issues) is exactly one screen and nothing scrolls, and nothing is left blank under it: the columns are as wide as the width
// makes them, and the rows are as tall as it takes to fill the height with a whole number of them. Opening the sidebar never changes the
// saved layout.
import { COLUMNS } from '../../../assistant/dashboard/widgets.mjs';
export const GAP = 12;
// The narrowest a cell gets (a board then is 15 x 40 + 14 x 12 = 768px wide; a window narrower than that scrolls sideways).
export const MIN_CELL = 40;

/**
 * Columns, cell width, the rows that fit and their height, for a usable area of `width` x `height`. A row is as tall as a column is wide
 * when the height happens to hold a whole number of them, and otherwise a little more or less: the nearest whole number of rows is taken
 * and they share what is left, so that no strip stays under the board (a few percent of a cell; with fewer than ten rows, at most a tenth).
 */
export function metrics({ width, height = 0 }) {
  const cell = Math.max(MIN_CELL, (width - GAP * (COLUMNS - 1)) / COLUMNS);
  const ideal = (height + GAP) / (cell + GAP);
  // Less than a row of room: one row of the cell's own height, which the page scrolls (as it always has).
  if (ideal < 1) return { cols: COLUMNS, rows: 1, cell, row: cell };
  const rows = Math.round(ideal);
  // `rows` rows are `rows * (row + GAP) - GAP` tall; the hundredth that rounding down leaves keeps a row that fits to the pixel from tipping a
  // scrollbar in.
  const row = Math.floor(((height + GAP) / rows - GAP) * 100) / 100;
  return { cols: COLUMNS, rows, cell, row };
}

/** The length of `count` cells of one edge with the gaps between them. */
export const span = (count, cell) => count * cell + (count - 1) * GAP;

/** The columns and rows a layout needs: at least what the window holds, more when a widget sits further right or lower. */
export function extent(items, { cols, rows = 1 }) {
  const bottom = Math.max(0, ...items.map((item) => item.y + item.h));
  return { columns: cols, rows: Math.max(rows, bottom) };
}
