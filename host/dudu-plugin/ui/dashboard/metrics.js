// A fixed grid: fifteen columns and nine rows, whatever the window (owner, 2026-11-06, after a move from a 27" monitor to a 13.3" laptop left two blank
// rows under widgets that had been sized there: "keep the number of cells the same over a range of screens, and think about fewer cells only for smaller
// ones"). The cells are rectangles: as wide as the width makes them (a fifteenth of it), as tall as the height makes them (a ninth of it), so a window of any
// shape, from a laptop up, is exactly one screen of the same cells and a widget that is 9 rows tall is as tall as the window. Only a window too small for the
// smallest cell keeps that cell and scrolls (sideways below 768px of width, up and down below 9 rows of 40px); no cell is dropped.
import { COLUMNS, FILL_ROWS } from '../../../assistant/dashboard/widgets.mjs';
export const GAP = 12;
// The narrowest and the lowest a cell gets (a board then is 15 x 40 + 14 x 12 = 768px wide and 9 x 40 + 8 x 12 = 456px tall).
export const MIN_CELL = 40;
export const MIN_ROW = 40;
export const ROWS = FILL_ROWS;

/**
 * Columns, rows, cell width and row height, for a usable area of `width` x `height`. The count of both is fixed; the width of a cell is a fifteenth of the
 * width less the gaps, the height of a row a ninth of the height less the gaps (cut to the hundredth, so that a board that fits to the pixel does not tip a
 * scrollbar in). A window too small for the smallest cell keeps it, and the page scrolls.
 */
export function metrics({ width, height = 0 }) {
  const cell = Math.max(MIN_CELL, (width - GAP * (COLUMNS - 1)) / COLUMNS);
  const row = Math.max(MIN_ROW, Math.floor(((height + GAP) / ROWS - GAP) * 100) / 100);
  return { cols: COLUMNS, rows: ROWS, cell, row };
}

/** The length of `count` cells of one edge with the gaps between them. */
export const span = (count, cell) => count * cell + (count - 1) * GAP;

/** The columns and rows a layout needs: at least what the window holds, more when a widget sits further right or lower. */
export function extent(items, { cols, rows = 1 }) {
  const bottom = Math.max(0, ...items.map((item) => item.y + item.h));
  return { columns: cols, rows: Math.max(rows, bottom) };
}
