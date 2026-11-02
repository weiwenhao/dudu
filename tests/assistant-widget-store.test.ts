import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadStore, widgetReadStore } from '../host/dudu-plugin/ui/widgets/data-store.mjs';

test('widgets share one snapshot source for the same read and keep different queries apart', () => {
  const request = async () => ({ outcome: 'success' });
  assert.equal(widgetReadStore(request, 'issues/list', { tab: 'active' }, 10000), widgetReadStore(request, 'issues/list', { tab: 'active' }, 10000));
  assert.notEqual(widgetReadStore(request, 'issues/list', { tab: 'active' }, 10000), widgetReadStore(request, 'issues/list', { tab: 'backlog' }, 10000));
});

test('read subscriptions share an in-flight query, resume after visibility changes and release their observer', async () => {
  const visibility = new EventTarget() as EventTarget & { visibilityState: string };
  visibility.visibilityState = 'visible';
  let resolve: (value: any) => void;
  let queries = 0;
  let updates = 0;
  const source = createReadStore(() => {
    queries++;
    return new Promise((done) => { resolve = done; });
  }, 'issues/list', {}, { every: 100000, visibility });
  const one = source.subscribe(() => { updates++; });
  const two = source.subscribe(() => { updates++; });
  try {
    await new Promise(setImmediate);
    assert.equal(queries, 1);
    visibility.dispatchEvent(new Event('visibilitychange'));
    assert.equal(queries, 1);
    resolve!({ outcome: 'success', total: 7 });
    await new Promise(setImmediate);
    assert.equal(updates, 2);
    assert.deepEqual(source.getSnapshot(), { status: 'ready', value: { outcome: 'success', total: 7 } });
    const stable = source.getSnapshot();
    assert.equal(source.getSnapshot(), stable);
    visibility.visibilityState = 'hidden';
    visibility.dispatchEvent(new Event('visibilitychange'));
    assert.equal(queries, 1);
    visibility.visibilityState = 'visible';
    visibility.dispatchEvent(new Event('visibilitychange'));
    await new Promise(setImmediate);
    assert.equal(queries, 2);
    resolve!({ outcome: 'error', message: 'Not readable' });
    await new Promise(setImmediate);
    assert.equal(source.getSnapshot(), stable);
  } finally { one(); two(); }
  assert.equal(source.active, false);
  visibility.dispatchEvent(new Event('visibilitychange'));
  await new Promise(setImmediate);
  assert.equal(queries, 2);
});
