// The widgets that ship with 嘟嘟 and the rules a widget declaration must meet (docs/assistant.md 3.8 and the table in 4.1).
// Pure data and functions with no imports at all: the plugin process and the page's bundle read this one file.
//
// A declaration has the same shape for the eight built-in widgets and for the widgets other DSH plugins bring:
//   { id, label, description, min: { w, h }, size: { w: number | 'fill', h }, needs: [...] }
// `min` is the smallest size (columns x rows) whose content still reads; `size` is the recommended size that "add" uses, never
// smaller than `min`; 'fill' as a width means every column of the dashboard, which is how Issues starts. `needs` is what the
// widget reads (the data hooks of 3.8).

export const FILL = 'fill';
export const MAX_ROWS = 12; // the tallest a widget can be (4.1)
export const MIN_COLUMNS = 4; // the dashboard never shows fewer columns than this (4.1, the grid)
// Sanity bounds for what a file or a request may say, not product rules: nothing real comes near them, but a damaged layout must not
// make the page build a grid of a million columns or rows. The real width limit is the window's column count, which only the page knows.
export const MAX_COLUMNS = 64;
export const MAX_Y = 1000;
export const NEEDS = ['issues', 'quota', 'inputs', 'sessions', 'network'];

const declare = (id, label, description, min, size, needs) => Object.freeze({
  id, label, description, min: Object.freeze({ w: min[0], h: min[1] }), size: Object.freeze({ w: size[0], h: size[1] }), needs: Object.freeze(needs),
});

// The table in 4.1. The names are the doc's; the one-line descriptions are for the add list and are NEW wording for the owner to review.
export const BUILT_IN_WIDGETS = Object.freeze([
  declare('issues', 'Issues', 'Every issue, as a list or a board', [4, 2], [FILL, 6], ['issues']), // NEW description
  declare('overview', 'Overview', 'Overdue, due this week and in progress', [2, 2], [4, 2], ['issues']), // NEW description
  declare('upcoming', 'Upcoming', 'Issues with a due date, soonest first', [2, 2], [4, 4], ['issues']), // NEW description
  declare('stuck', 'Stuck', 'Issues an agent is stuck on', [2, 2], [4, 2], ['issues']), // NEW description
  declare('inputs', 'Inputs', 'Whether each connector works and what it read today', [2, 2], [4, 2], ['inputs']), // NEW description
  declare('quota', 'Quota', 'Subscription usage, one line per agent', [2, 1], [2, 1], ['quota']), // NEW description
  declare('sessions', 'Sessions', 'Search and open sessions', [3, 2], [4, 4], ['sessions']), // NEW description
  declare('office', 'Office', 'Each active issue as someone at a desk', [4, 3], [6, 4], ['issues']), // NEW description
]);

const refuse = (reason) => ({ ok: false, reason });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

/**
 * Whether a widget declaration (from a plugin, 3.8) may be offered: { ok: true } or { ok: false, reason }. A declaration without a
 * name, without a minimum size, or whose recommended size is smaller than the minimum is refused, so the add list never holds it.
 * The reasons are shown in the settings page (4.1) and are NEW wording for the owner to review.
 */
export function validateDeclaration(declaration) {
  if (!isObject(declaration)) return refuse('It is not a widget declaration.'); // NEW
  if (typeof declaration.id !== 'string' || !declaration.id.trim()) return refuse('It has no id.'); // NEW
  if (typeof declaration.label !== 'string' || !declaration.label.trim()) return refuse('It has no name.'); // NEW
  const { min, size } = declaration;
  if (!isObject(min)) return refuse('It has no minimum size.'); // NEW
  if (!whole(min.w, 1, MAX_COLUMNS) || !whole(min.h, 1, MAX_ROWS)) return refuse(`Its minimum size must be whole columns and rows, up to ${MAX_ROWS} rows.`); // NEW
  if (!isObject(size)) return refuse('It has no recommended size.'); // NEW
  if ((size.w !== FILL && !whole(size.w, 1, MAX_COLUMNS)) || !whole(size.h, 1, MAX_ROWS)) return refuse(`Its recommended size must be whole columns and rows, up to ${MAX_ROWS} rows.`); // NEW
  if ((size.w !== FILL && size.w < min.w) || size.h < min.h) return refuse('Its recommended size is smaller than its minimum size.'); // NEW
  if (declaration.needs !== undefined && !(Array.isArray(declaration.needs) && declaration.needs.every((need) => typeof need === 'string'))) return refuse('Its needs must be a list.'); // NEW
  if (declaration.description !== undefined && typeof declaration.description !== 'string') return refuse('Its description must be text.'); // NEW
  return { ok: true };
}
