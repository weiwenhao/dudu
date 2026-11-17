/** Reuse DSH's pushed catalog state without retaining or opening any conversation. */
export function installSessionActivityUpdates(sessions, notify = () => {
  if (document.visibilityState !== 'hidden') window.dispatchEvent(new Event('dudu:home-changed'));
}) {
  const source = sessions?.list;
  if (!source?.subscribe || !source.getSnapshot) return () => {};
  const stamp = () => {
    const snapshot = source.getSnapshot();
    return JSON.stringify(snapshot.ids.map((id) => {
      const row = snapshot.byId[id];
      return [id, row.running, row.updatedAt];
    }).sort(([a], [b]) => a.localeCompare(b)));
  };
  let previous = stamp();
  let scheduled = false;
  let closed = false;
  const stop = source.subscribe(() => {
    const next = stamp();
    if (next === previous) return;
    previous = next;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!closed) notify(); });
  });
  return () => { closed = true; stop(); };
}
