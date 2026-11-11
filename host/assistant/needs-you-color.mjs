// The two palettes approved by the owner on 2026-11-10, plus the original gold.
// Shared by settings validation and the desktop UI; the phone receives the chosen hex.
export const NEEDS_YOU_COLORS = Object.freeze([
  ['mist', '#6486b8'], ['indigo', '#6976c8'], ['teal', '#4f948e'],
  ['mauve', '#9281b0'], ['rose-gray', '#b77d94'], ['slate', '#7e8999'],
  ['gold', '#bf9a4e'], ['blue', '#007aff'], ['violet', '#7c3aed'],
  ['orange', '#f97316'], ['rose', '#e11d48'], ['green', '#087f5b'],
  ['graphite', '#2f343b'],
].map(([id, color]) => Object.freeze({ id, color })));

export const DEFAULT_NEEDS_YOU_COLOR = NEEDS_YOU_COLORS[0].color;
export const isNeedsYouColor = (value) => typeof value === 'string' && NEEDS_YOU_COLORS.some(({ color }) => color === value.toLowerCase());
