// Which rows are ticked for a bulk change: plain functions over a Set of issue ids.

/**
 * A click on a row's box: it toggles that row; with Shift held it ticks (or unticks, like the row clicked) everything between the
 * row clicked last and this one, in the order the rows are on screen. `ids` is that order.
 */
export function selectRow(selected, id, { shift = false, anchor = null, ids = [] } = {}) {
  const next = new Set(selected);
  const from = shift && anchor != null ? ids.indexOf(anchor) : -1;
  const to = ids.indexOf(id);
  if (from >= 0 && to >= 0) {
    const on = !selected.has(id);
    for (const between of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) { if (on) next.add(between); else next.delete(between); }
  } else if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Drops ids that are no longer in the list (finished, filtered out, gone), so "3 selected" never counts what cannot be seen. */
export function keepVisible(selected, ids) {
  const visible = new Set(ids);
  const kept = [...selected].filter((id) => visible.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}
