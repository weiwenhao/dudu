import assert from 'node:assert/strict';
import test from 'node:test';
import { installSessionHistoryCache } from '../host/dudu-plugin/ui/lib/session-history-cache.js';

function controller() {
  const listeners = new Set<() => void>();
  const byId: Record<string, { id: string; retainedBy: Record<string, number> }> = {};
  const acquired: string[] = [];
  const released: string[] = [];
  const bindings = new Map<string, { session: { getSnapshot: () => { openState: string } } }>();
  const binding = (id: string) => {
    if (!bindings.has(id)) bindings.set(id, { session: { getSnapshot: () => ({ openState: 'open' }) } });
    return bindings.get(id)!;
  };
  const notify = () => { for (const listener of listeners) listener(); };
  const row = (id: string) => byId[id] ??= { id, retainedBy: {} };
  const sessions = {
    list: {
      getSnapshot: () => ({ byId, ids: Object.keys(byId) }),
      subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    binding,
    retain(id: string, { source }: { source: string }) {
      acquired.push(id);
      row(id).retainedBy[source] = (row(id).retainedBy[source] ?? 0) + 1;
      notify();
      let live = true;
      return {
        sessionId: id, binding: binding(id), ready: Promise.resolve(),
        release() {
          assert.ok(live, 'a reference is released once');
          live = false;
          released.push(id);
          if (byId[id]) {
            const count = byId[id].retainedBy[source] - 1;
            if (count > 0) byId[id].retainedBy[source] = count;
            else delete byId[id].retainedBy[source];
          }
          notify();
        },
      };
    },
  };
  return {
    sessions, acquired, released, notify, bindings,
    list(id: string) { row(id); notify(); },
    show(id: string, source = 'mainView') { row(id).retainedBy[source] = 1; notify(); },
    hide(id: string, source = 'mainView') { delete row(id).retainedBy[source]; notify(); },
    remove(id: string) { delete byId[id]; notify(); },
  };
}

test('only opening a conversation retains its shared history; closing it and metadata updates keep the same reference', () => {
  const host = controller();
  host.list('listed');
  const dispose = installSessionHistoryCache(host.sessions)!;
  assert.deepEqual(host.acquired, []);
  host.show('a');
  host.hide('a');
  host.notify();
  host.show('a', 'duduIssuePreview');
  host.show('a');
  host.hide('a', 'duduIssuePreview');
  assert.deepEqual(host.acquired, ['a'], 'preview and main view share one cached generation');
  assert.deepEqual(host.released, []);
  assert.equal(host.sessions.list.getSnapshot().byId.a.retainedBy.duduHistoryCache, 1);
  dispose();
  assert.deepEqual(host.released, ['a']);
});

test('a restored warm target is acquired synchronously only while its exact history and live archive state allow it', async () => {
  const host = controller();
  const workspace = { phase: 'ready', state: 'idle', archivedSessionIds: [] as string[] };
  const dispose = installSessionHistoryCache(host.sessions, { workspaces: { list: { getSnapshot: () => workspace } } })!;
  const issue = { id: 4, agent: 'claude', session: 'claude:native' };
  host.show('loaded', 'duduIssuePreview');
  host.hide('loaded', 'duduIssuePreview');
  dispose.remember(issue, { sessionId: 'loaded' });
  try {
    assert.equal(dispose.retain(issue), undefined, 'an in-flight initial history is not a cache hit');
    await Promise.resolve();
    const reference = dispose.retain({ ...issue, session: 'dsh:loaded' });
    assert.equal(reference?.sessionId, 'loaded', 'the persisted native import alias shares the ready generation');
    assert.equal(reference?.binding, host.sessions.binding('loaded'));
    reference!.release();
    for (const patch of [
      { archivedSessionIds: ['loaded'] },
      { phase: 'pending' },
      { state: 'loading' },
      { state: 'error' },
    ]) {
      Object.assign(workspace, { phase: 'ready', state: 'idle', archivedSessionIds: [] }, patch);
      assert.equal(dispose.retain(issue), undefined, 'unknown, disconnected or archived state must await restore');
    }
    Object.assign(workspace, { phase: 'ready', state: 'idle', archivedSessionIds: [] });
    assert.equal(dispose.retain({ ...issue, session: 'dsh:another' }), undefined, 'reassignment cannot borrow old history');
    host.bindings.delete('loaded');
    assert.equal(dispose.retain(issue), undefined, 'a replacement host generation cannot use the old readiness');
  } finally { dispose(); }
  assert.equal(dispose.retain(issue), undefined);
});

test('a target evicted from the history cache has no synchronous reopening path', async () => {
  const host = controller();
  const workspaces = { list: { getSnapshot: () => ({ phase: 'ready', state: 'idle', archivedSessionIds: [] }) } };
  const dispose = installSessionHistoryCache(host.sessions, { limit: 1, workspaces })!;
  const issue = { id: 4, session: 'dsh:a' };
  try {
    host.show('a'); host.hide('a');
    dispose.remember(issue, { sessionId: 'a' });
    await Promise.resolve();
    host.show('b'); host.hide('b');
    assert.equal(dispose.retain(issue), undefined);
    host.show('a'); host.hide('a');
    await Promise.resolve();
    assert.equal(dispose.retain(issue), undefined, 'reloaded history alone is not proof of a successful issue restore');
  } finally { dispose(); }
});

test('Dudu can reopen its cached conversation even though the shell hides its id from the host sidebar', async () => {
  const host = controller();
  const original = host.sessions.list.getSnapshot;
  host.sessions.list.getSnapshot = () => ({ ...original(), ids: [] });
  const workspaces = { list: { getSnapshot: () => ({ phase: 'ready', state: 'idle', archivedSessionIds: [] }) } };
  const dispose = installSessionHistoryCache(host.sessions, { workspaces })!;
  const issue = { id: 'assistant', agent: 'dudu', session: 'assistant' };
  try {
    host.show('dudu-assistant-one', 'duduIssuePreview');
    host.hide('dudu-assistant-one', 'duduIssuePreview');
    dispose.remember(issue, { sessionId: 'dudu-assistant-one' });
    await Promise.resolve();
    const reference = dispose.retain(issue);
    assert.equal(reference?.sessionId, 'dudu-assistant-one');
    reference!.release();
  } finally { dispose(); }
});

test('the cache evicts the least recently opened conversation and disposal releases every remaining reference', () => {
  const host = controller();
  const dispose = installSessionHistoryCache(host.sessions, { limit: 2 })!;
  for (const id of ['a', 'b', 'a', 'c']) { host.show(id); host.hide(id); }
  assert.deepEqual(host.acquired, ['a', 'b', 'c']);
  assert.deepEqual(host.released, ['b'], 'reopening a makes b the oldest');
  host.show('b');
  assert.deepEqual(host.acquired, ['a', 'b', 'c', 'b']);
  assert.deepEqual(host.released, ['b', 'a']);
  dispose();
  assert.deepEqual(host.released, ['b', 'a', 'c', 'b']);
  host.show('never-opened-before-disposal');
  assert.equal(host.acquired.length, 4);
});

test('removed conversations leave no retained history and listing a replacement does not preload it', () => {
  const host = controller();
  const dispose = installSessionHistoryCache(host.sessions)!;
  host.show('removed');
  host.hide('removed');
  host.remove('removed');
  host.list('replacement');
  assert.deepEqual(host.acquired, ['removed']);
  assert.deepEqual(host.released, ['removed']);
  dispose();
  assert.deepEqual(host.released, ['removed']);
});
