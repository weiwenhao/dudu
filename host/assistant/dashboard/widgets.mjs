// The widgets that ship with 嘟嘟 and the rules a widget declaration must meet (docs/assistant.md 3.8 and the table in 4.1).
// Pure data and functions with no imports at all: the plugin process and the page's bundle read this one file.
//
// A declaration has the same shape for the three built-in widgets and for the widgets other DSH plugins bring:
//   { id, label, description, min: { w, h }, size: { w: number | 'fill', h: number | 'fill' }, needs: [...] }
// `min` is the smallest size (columns x rows) whose content still reads; `size` is the recommended size that "add" uses, never
// smaller than `min`; 'fill' as a width means every column of the dashboard and 'fill' as a height every row the window shows, which is
// how Issues starts in height, beside Inbox and Office. `needs` is what the widget reads (the data hooks of 3.8).
//
// The grid is fifteen columns, and as many rows as the window holds, each about as tall as a column is wide (2026-11-01: it was ten, which
// on a large window made every cell enormous, then twenty, which the owner found too dense). A size counts those cells: a widget has the
// size in pixels it had on the ten-column grid with a half more cells, and the size it had on the twenty-column grid with a quarter fewer.

export const FILL = 'fill';
export const MAX_ROWS = 18; // the tallest a widget can be (4.1)
export const COLUMNS = 15;
// The rows a widget that fills is given when the caller has not said how many rows the window shows (only the page knows: it sends `rows`).
export const FILL_ROWS = 9;
export const MIN_COLUMNS = COLUMNS;
// Sanity bounds for what a file or a request may say, not product rules: nothing real comes near them, but a damaged layout must not
// make the page build a grid of a million columns or rows. The real width limit is the window's column count, which only the page knows.
export const MAX_COLUMNS = COLUMNS;
export const MAX_Y = 1000;
export const NEEDS = ['issues', 'quota', 'inputs', 'sessions', 'network'];
export const WIDGET_API = 1;
// Quota left the dashboard on 2026-11-11 (owner: "我们自己的小组件里边的余额组件也可以删掉了"): it is an icon in the header now, and a saved layout that still has the widget loses it.
export const REMOVED_WIDGETS = Object.freeze(['overview', 'upcoming', 'stuck', 'inputs', 'sessions', 'quota']);

const declare = (id, label, description, min, size, needs) => Object.freeze({
  id, label, description, min: Object.freeze({ w: min[0], h: min[1] }), size: Object.freeze({ w: size[0], h: size[1] }), needs: Object.freeze(needs),
});

// The table in 4.1. The names are the doc's; the one-line descriptions are for the add list and are NEW wording for the owner to review.
export const BUILT_IN_WIDGETS = Object.freeze([
  declare('issues', 'Issues', 'Every issue, as a list or a board', [6, 3], [10, FILL], ['issues']), // NEW description
  declare('office', 'Office', 'Each active issue as someone at a desk', [5, 3], [5, 4], ['issues']), // NEW description
  declare('collector', 'Inbox', 'What the connectors collected, to forward to a conversation or make issues of', [4, 3], [5, 5], ['inputs']), // NEW description
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
  if ((size.w !== FILL && !whole(size.w, 1, MAX_COLUMNS)) || (size.h !== FILL && !whole(size.h, 1, MAX_ROWS))) return refuse(`Its recommended size must be whole columns and rows, up to ${MAX_ROWS} rows.`); // NEW
  if ((size.w !== FILL && size.w < min.w) || (size.h !== FILL && size.h < min.h)) return refuse('Its recommended size is smaller than its minimum size.'); // NEW
  if (declaration.needs !== undefined && !(Array.isArray(declaration.needs) && declaration.needs.every((need) => typeof need === 'string'))) return refuse('Its needs must be a list.'); // NEW
  if (declaration.description !== undefined && typeof declaration.description !== 'string') return refuse('Its description must be text.'); // NEW
  return { ok: true };
}

export function validatePluginWidget(declaration) {
  const checked = validateDeclaration(declaration);
  if (!checked.ok) return checked;
  if (!declaration.id.includes('.') || BUILT_IN_WIDGETS.some((widget) => widget.id === declaration.id)) return refuse('Use a plugin name followed by a dot and a widget name.');
  if (declaration.widgetApi !== WIDGET_API) return refuse('This widget needs a different version of 嘟嘟.');
  if (!(declaration.needs ?? []).every((need) => NEEDS.includes(need))) return refuse('This widget declares an unknown data source.');
  if (declaration.development !== undefined && typeof declaration.development !== 'boolean') return refuse('The development flag must be true or false.');
  return { ok: true };
}
