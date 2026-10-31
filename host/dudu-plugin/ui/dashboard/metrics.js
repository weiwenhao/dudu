// The grid's size rules (docs/assistant.md 4.1, "网格" and "窗口大小、缩放、换屏幕"). Cells are square; six rows fill one screen; the
// columns follow the width. Only two numbers matter: the usable width and height in CSS pixels, so a big screen, a Retina one and
// the browser's zoom all go through the same rule.
export const GAP = 12;
export const MIN_CELL = 100;
export const MIN_COLUMNS = 4;
export const SCREEN_ROWS = 6;

/** Columns and cell edge for a usable area of `width` x `height`. */
export function metrics({ width, height }) {
  const wanted = Math.max(MIN_CELL, (height - GAP * (SCREEN_ROWS - 1)) / SCREEN_ROWS);
  const fit = (columns) => Math.floor(Math.min(wanted, (width - GAP * (columns - 1)) / columns));
  let cols = Math.max(MIN_COLUMNS, Math.round((width + GAP) / (wanted + GAP)));
  while (cols > MIN_COLUMNS && fit(cols) < MIN_CELL) cols -= 1;
  return { cols, cell: Math.max(MIN_CELL, fit(cols)) };
}

/** The length of `count` cells with the gaps between them. */
export const span = (count, cell) => count * cell + (count - 1) * GAP;

/** The columns and rows a layout needs: at least what the window holds, more when a widget sits further right or lower. */
export function extent(items, { cols, rows = SCREEN_ROWS }) {
  const right = Math.max(0, ...items.map((item) => item.x + item.w));
  const bottom = Math.max(0, ...items.map((item) => item.y + item.h));
  return { columns: Math.max(cols, right), rows: Math.max(rows, bottom) };
}
