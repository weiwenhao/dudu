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

/** Home entries already use the shared newest-completed-reply order. Choose once; polls never steal an open conversation. */
export function chooseConversation(entries, current = null) {
  return current ?? entries.find((entry) => entry.issue ? Boolean(entry.issue.session) : Boolean(entry.sessionId))?.id ?? null;
}

/** The conversation the person had open when the panel was left (the expand button opens DSH's own page, which closes the panel), if it is still in the list and can be opened; else the usual choice. */
export function pickConversation(entries, remembered = null) {
  const kept = remembered == null ? undefined : entries.find((entry) => entry.id === remembered);
  return kept && (kept.issue ? Boolean(kept.issue.session) : Boolean(kept.sessionId)) ? kept.id : chooseConversation(entries);
}

const REMEMBERED = 'dudu.conversations.open';
export function rememberedConversation(scope) {
  try { return JSON.parse(localStorage.getItem(REMEMBERED) ?? '{}')[scope] ?? null; } catch { return null; }
}
export function rememberConversation(scope, id) {
  try {
    const all = JSON.parse(localStorage.getItem(REMEMBERED) ?? '{}');
    if (all[scope] === id) return;
    localStorage.setItem(REMEMBERED, JSON.stringify({ ...all, [scope]: id }));
  } catch { /* private window or blocked storage: it just is not remembered */ }
}
