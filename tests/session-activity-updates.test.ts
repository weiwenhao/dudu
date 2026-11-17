import assert from 'node:assert/strict';
import test from 'node:test';
import { installSessionActivityUpdates } from '../host/dudu-plugin/ui/lib/session-activity-updates.js';
import { createReadStore } from '../host/dudu-plugin/ui/widgets/data-store.mjs';

test('pushed DSH state refreshes unopened conversations without reacting to retain-only changes', async () => {
  let snapshot = { ids: ['a'], byId: { a: { running: true, updatedAt: 1000, retainedBy: {} } } };
  const listeners = new Set<() => void>();
  let notices = 0;
  const stop = installSessionActivityUpdates({ list: {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
  } }, () => notices++);
  const change = () => { for (const listener of listeners) listener(); };
  snapshot = { ...snapshot, byId: { a: { ...snapshot.byId.a, retainedBy: { mainView: 1 } } } };
  change();
  await Promise.resolve();
  assert.equal(notices, 0);
  snapshot = { ...snapshot, byId: { a: { ...snapshot.byId.a, running: false } } };
  change();
  snapshot = { ...snapshot, byId: { a: { ...snapshot.byId.a, updatedAt: 2000 } } };
  change();
  await Promise.resolve();
  assert.equal(notices, 1, 'status and activity in the same batch coalesce');
  snapshot = { ...snapshot, byId: { a: { ...snapshot.byId.a, running: true } } };
  change();
  stop();
  await Promise.resolve();
  assert.equal(notices, 1, 'disposal cancels a pending notice');
  assert.equal(listeners.size, 0);
});

test('a completion arriving during an older home read is not lost or delayed until a polling timer', async () => {
  const older = Promise.withResolvers<any>();
  let calls = 0;
  const source = createReadStore(async () => {
    calls++;
    return calls === 1 ? older.promise : { outcome: 'success', sessionState: 'unread' };
  }, 'home/list', {}, { visibility: null });
  const stop = source.subscribe(() => {});
  try {
    await Promise.resolve();
    const refreshed = source.invalidate();
    assert.equal(source.invalidate(), refreshed, 'concurrent invalidations share one follow-up read');
    older.resolve({ outcome: 'success', sessionState: 'processing' });
    await refreshed;
    assert.equal(calls, 2);
    assert.equal(source.getSnapshot().value.sessionState, 'unread');
  } finally { stop(); }
});
