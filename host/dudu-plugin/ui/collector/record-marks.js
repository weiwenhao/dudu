// Keep the owner's marks over list reads until a read started after the save has returned.
// A poll already on its way must not put a just-handled row back under the pointer.
const SPAN = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };
const tabOf = (record) => record.deleted ? null : record.issue || record.done ? 'done' : record.ignored ? 'ignored' : 'todo';
const newest = (a, b) => b.at - a.at || b.id - a.id;

function marked(record, action) {
  if (record.issue) return record;
  switch (action) {
    case 'inbox/done': return { ...record, done: true, ignored: false };
    case 'inbox/ignore': return { ...record, ignored: true };
    case 'inbox/delete': return { ...record, deleted: true };
    case 'inbox/restore': {
      if (!record.deleted) return { ...record, done: false, ignored: false };
      const restored = { ...record };
      delete restored.deleted;
      return restored;
    }
    default: throw new Error('Unknown inbox mark');
  }
}

export function createRecordMarks() {
  let entries = new Map();
  const listeners = new Set();
  const publish = (next) => { entries = next; for (const listener of listeners) listener(); };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => entries,
    begin(action, records) {
      // A row may already be visible in its destination tab. Do not send a second mark before its first save settles.
      if (!records.length || records.some((record) => entries.get(record.id)?.pending)) return null;
      const next = new Map(entries);
      const changes = records.map((record) => {
        const before = entries.get(record.id)?.record ?? record;
        const change = { before, record: marked(before, action), pending: true };
        next.set(record.id, change);
        return change;
      });
      publish(next);
      return {
        records: changes.map((change) => change.record),
        settle(success, saved) {
          const next = new Map(entries);
          for (const change of changes) {
            if (entries.get(change.record.id) !== change) continue;
            // On failure, restore only these rows, not a whole list snapshot that would discard other clicks or new records.
            const record = success ? { ...change.record, ...(saved?.id === change.record.id ? saved : {}) } : change.before;
            next.set(record.id, { record, pending: false });
          }
          publish(next);
        },
      };
    },
    // Only a read that starts after a mutation settles can reconcile it. Identity also protects newer marks and Undo.
    beforeRead: () => new Map([...entries].filter(([, change]) => !change.pending)),
    acceptRead(read) {
      const next = new Map(entries);
      let changed = false;
      for (const [id, change] of read) if (entries.get(id) === change) { next.delete(id); changed = true; }
      if (changed) publish(next);
    },
  };
}

/** Apply local marks to whichever tab/filter is visible, preserving source order and the loaded page's boundary. */
export function applyRecordMarks(value, entries, { tab, filter = {} }, now = Date.now()) {
  if (!value || !entries.size) return value;
  const span = SPAN[filter.date?.[0]];
  const since = span ? Math.floor(now / 3_600_000) * 3_600_000 - span : -Infinity;
  const includes = (record) => tabOf(record) === tab && (!filter.connector?.length || filter.connector.includes(record.connector)) && record.at >= since;
  const rows = new Map(value.items.map((record) => [record.id, record]));
  const edge = value.nextCursor == null ? null : value.items.at(-1);
  for (const [id, change] of entries) {
    const before = rows.get(id);
    const after = change.record;
    rows.delete(id);
    if (includes(after) && (!edge || before || newest(after, edge) <= 0)) rows.set(id, after);
  }
  return { ...value, items: [...rows.values()].sort(newest) };
}
