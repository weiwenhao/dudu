const visible = (row) => row.retainedBy?.mainView > 0 || row.retainedBy?.duduIssuePreview > 0;

/** Keep DSH's own history, projections and follow stream for recently opened conversations. */
export function installSessionHistoryCache(sessions, { limit = 12 } = {}) {
  if (!sessions.list?.subscribe || !sessions.retain) return undefined;
  const recent = new Map();
  let opened = new Set();
  let reconciling = false;
  let closed = false;
  const release = (id) => {
    const reference = recent.get(id);
    recent.delete(id);
    reference?.release();
  };
  const changed = () => {
    // retain/release publish the source counts synchronously.
    if (closed || reconciling) return;
    reconciling = true;
    try {
      const { byId } = sessions.list.getSnapshot();
      const next = new Set(Object.values(byId).filter(visible).map((row) => row.id));
      for (const id of recent.keys()) if (!byId[id]) release(id);
      for (const id of next) {
        if (opened.has(id)) continue;
        let reference = recent.get(id);
        if (reference) recent.delete(id);
        else {
          try {
            reference = sessions.retain(id, { source: 'duduHistoryCache' });
          } catch { continue; }
        }
        recent.set(id, reference);
        const retained = reference;
        void reference.ready.catch(() => {
          if (recent.get(id) === retained) release(id);
        });
      }
      opened = next;
      while (recent.size > limit) release(recent.keys().next().value);
    } finally { reconciling = false; }
  };
  const unsubscribe = sessions.list.subscribe(changed);
  changed();
  return () => {
    closed = true;
    unsubscribe();
    for (const id of recent.keys()) release(id);
  };
}
