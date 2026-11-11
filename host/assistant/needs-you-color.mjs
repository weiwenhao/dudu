// The two palettes approved by the owner on 2026-11-10, plus the original gold. The first is the default: 青绿 since 2026-11-12
// (owner: "这个默认颜色改成这个绿色"; it was 雾蓝, now the second). A saved color of the old default stays valid.
// Shared by settings validation and the desktop UI; the phone receives the chosen hex.
export const NEEDS_YOU_COLORS = Object.freeze([
  ['teal', '#4f948e'], ['mist', '#6486b8'], ['indigo', '#6976c8'],
  ['mauve', '#9281b0'], ['rose-gray', '#b77d94'], ['slate', '#7e8999'],
  ['gold', '#bf9a4e'], ['blue', '#007aff'], ['violet', '#7c3aed'],
  ['orange', '#f97316'], ['rose', '#e11d48'], ['green', '#087f5b'],
  ['graphite', '#2f343b'],
].map(([id, color]) => Object.freeze({ id, color })));

export const DEFAULT_NEEDS_YOU_COLOR = NEEDS_YOU_COLORS[0].color;
export const isNeedsYouColor = (value) => typeof value === 'string' && NEEDS_YOU_COLORS.some(({ color }) => color === value.toLowerCase());
