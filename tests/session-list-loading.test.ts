import assert from 'node:assert/strict';
import test from 'node:test';
import { widgetReadStore } from '../host/dudu-plugin/ui/widgets/data-store.mjs';

test('session list retries a transient first failure and retains its last successful list during a failed refresh', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-08T08:00:00Z') });
  let reads = 0;
  let fail = true;
  const value = { sessions: [{ key: 'claude:one' }] };
  const request = async () => { reads++; if (fail) throw new Error('Temporary failure'); return value; };
  const source = widgetReadStore(request, 'sessions/list', { query: '' }, 15_000);
  const stop = source.subscribe(() => {});
  try {
    await source.refresh();
    assert.equal(source.getSnapshot().status, 'loading');
    assert.equal(reads, 1);
    fail = false;
    context.mock.timers.tick(1000);
    await source.refresh();
    assert.deepEqual(source.getSnapshot(), { status: 'ready', value, refreshing: false, updatedAt: Date.now() });
    assert.equal(reads, 2);
    const firstUpdate = source.getSnapshot().updatedAt;
    context.mock.timers.tick(15_000);
    assert.equal(source.getSnapshot().status, 'ready', 'a background refresh keeps the cached list readable');
    assert.equal(source.getSnapshot().refreshing, true);
    assert.equal(source.getSnapshot().updatedAt, firstUpdate, 'starting a read cannot advance its successful-update time');
    await source.refresh();
    const successful = source.getSnapshot();
    assert.ok(successful.updatedAt > firstUpdate);
    assert.equal(successful.refreshing, false);
    fail = true;
    context.mock.timers.tick(15_000);
    assert.equal(source.getSnapshot().refreshing, true);
    await source.refresh();
    assert.deepEqual(source.getSnapshot(), successful, 'a failed refresh retains both the useful list and its last successful-update time');
  } finally { stop(); }
  const stoppedAt = reads;
  context.mock.timers.tick(60_000);
  assert.equal(reads, stoppedAt, 'closing the window stops scheduled retries');
});

test('session list reports a persistent initial failure after bounded retries and manual retry starts immediately', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let fail = true;
  const request = async () => { if (fail) throw new Error('Unavailable'); return { sessions: [] }; };
  const source = widgetReadStore(request, 'sessions/list', { query: '' }, 15_000);
  const stop = source.subscribe(() => {});
  try {
    await source.refresh();
    for (let retry = 0; retry < 2; retry++) {
      assert.equal(source.getSnapshot().status, 'loading');
      context.mock.timers.tick(1000);
      await source.refresh();
    }
    assert.equal(source.getSnapshot().status, 'error');
    fail = false;
    const retry = source.refresh();
    assert.equal(source.getSnapshot().status, 'loading');
    await retry;
    assert.equal(source.getSnapshot().status, 'ready');
  } finally { stop(); }
});
