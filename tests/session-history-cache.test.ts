import assert from 'node:assert/strict';
import test from 'node:test';
import { installSessionHistoryCache } from '../host/dudu-plugin/ui/lib/session-history-cache.js';

function controller() {
  const listeners = new Set<() => void>();
  const byId: Record<string, { id: string; retainedBy: Record<string, number> }> = {};
  const acquired: string[] = [];
  const released: string[] = [];
  const notify = () => { for (const listener of listeners) listener(); };
  const row = (id: string) => byId[id] ??= { id, retainedBy: {} };
  const sessions = {
    list: {
      getSnapshot: () => ({ byId }),
      subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    retain(id: string, { source }: { source: string }) {
      acquired.push(id);
      row(id).retainedBy[source] = (row(id).retainedBy[source] ?? 0) + 1;
      notify();
      let live = true;
      return {
        ready: Promise.resolve(),
        release() {
          assert.ok(live, 'a reference is released once');
          live = false;
          released.push(id);
          if (byId[id]) delete byId[id].retainedBy[source];
          notify();
        },
      };
    },
  };
  return {
    sessions, acquired, released, notify,
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
