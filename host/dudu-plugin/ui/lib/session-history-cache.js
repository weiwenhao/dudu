const visible = (row) => row.retainedBy?.mainView > 0 || row.retainedBy?.duduIssuePreview > 0;
const identity = (issue) => JSON.stringify([issue.id, issue.session, issue.agent ?? null]);

/** Keep DSH's own history, projections and follow stream for recently opened conversations. */
export function installSessionHistoryCache(sessions, { limit = 12, workspaces } = {}) {
  if (!sessions.list?.subscribe || !sessions.retain) return undefined;
  const recent = new Map();
  const targets = new Map();
  let opened = new Set();
  let reconciling = false;
  let closed = false;
  const release = (id) => {
    const entry = recent.get(id);
    recent.delete(id);
    for (const [key, sessionId] of targets) if (sessionId === id) targets.delete(key);
    entry?.reference.release();
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
        let entry = recent.get(id);
        if (entry) recent.delete(id);
        else {
          try {
            entry = { reference: sessions.retain(id, { source: 'duduHistoryCache' }), ready: false };
          } catch { continue; }
          const retained = entry;
          void entry.reference.ready.then(() => { retained.ready = true; }, () => {
            if (recent.get(id) === retained) release(id);
          });
        }
        recent.set(id, entry);
      }
      opened = next;
      while (recent.size > limit) release(recent.keys().next().value);
    } finally { reconciling = false; }
  };
  const unsubscribe = sessions.list.subscribe(changed);
  changed();
  const dispose = () => {
    closed = true;
    unsubscribe();
    for (const id of recent.keys()) release(id);
  };
  // Remember only successfully restored targets, tied to the bounded host-history cache.
  dispose.remember = (issue, target) => {
    if (!issue || !recent.has(target.sessionId)) return;
    targets.set(identity(issue), target.sessionId);
    if (issue.id !== 'assistant') targets.set(identity({ ...issue, session: `dsh:${target.sessionId}` }), target.sessionId);
  };
  // A listed/cached id alone says nothing about DSH's archived-session send gate.
  dispose.retain = (issue) => {
    const id = targets.get(identity(issue));
    const entry = recent.get(id);
    const workspace = workspaces?.list?.getSnapshot();
    if (closed || !entry?.ready || workspace?.phase !== 'ready' || workspace.state !== 'idle'
      || !Array.isArray(workspace.archivedSessionIds) || workspace.archivedSessionIds.includes(id)
      || !sessions.list.getSnapshot().byId[id]) return undefined;
    const binding = sessions.binding(id);
    if (binding !== entry.reference.binding) return undefined;
    const snapshot = binding.session.getSnapshot();
    if (snapshot.openState !== 'open' || snapshot.removed) return undefined;
    return sessions.retain(id, { source: 'duduIssuePreview' });
  };
  return dispose;
}
