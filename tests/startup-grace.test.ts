import assert from 'node:assert/strict';
import test from 'node:test';
import { STARTUP_GRACE_MS, untilStarted } from '../host/dudu-plugin/ui/lib/startup-grace.js';
import { widgetReadStore } from '../host/dudu-plugin/ui/widgets/data-store.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));

// 2026-11-19: after a plugin update the Issues list sat on "could not load / Retry" while the plugin was still starting.
test('an issue list that has never worked stays loading while the plugin starts, asks every second, and is reported failed only after the grace', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-19T13:00:00Z') });
  let reads = 0;
  let up = false;
  const request = async () => { reads++; if (!up) throw new Error('Not found'); return { outcome: 'success', conversations: [] }; };
  const source = widgetReadStore(request, 'home/list', { tab: 'active' }, 5000);
  const stop = source.subscribe(() => {});
  try {
    await source.refresh();
    for (let second = 1; second < STARTUP_GRACE_MS / 1000; second++) {
      assert.equal(source.getSnapshot().status, 'loading', `second ${second - 1}: no failure is shown yet`);
      context.mock.timers.tick(1000);
      await source.refresh();
    }
    assert.equal(reads, STARTUP_GRACE_MS / 1000, 'it asked every second, not every poll');
    context.mock.timers.tick(1000);
    await source.refresh();
    assert.equal(source.getSnapshot().status, 'error', 'after the grace the failure is shown');

    // Retry starts the patience again; the plugin coming up ends it.
    const retry = source.refresh();
    assert.equal(source.getSnapshot().status, 'loading');
    await retry;
    assert.equal(source.getSnapshot().status, 'loading', 'a failed Retry goes back to loading, not to the failure');
    up = true;
    context.mock.timers.tick(1000);
    await source.refresh();
    assert.equal(source.getSnapshot().status, 'ready');
  } finally { stop(); }
});

test('a read other than the issue lists reports its first failure at once', async () => {
  const request = async () => { throw new Error('Unavailable'); };
  const source = widgetReadStore(request, 'quota/get', {}, 60_000);
  const stop = source.subscribe(() => {});
  try {
    await source.refresh();
    assert.equal(source.getSnapshot().status, 'error');
  } finally { stop(); }
});

test('untilStarted runs again until it works, gives up with the last failure when the time is up, and stops when aborted', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-19T13:00:00Z') });
  let calls = 0;
  const flaky = untilStarted(async () => { if (++calls < 4) throw new Error('starting'); return 'ready'; });
  for (let second = 0; second < 3; second++) { await settle(); context.mock.timers.tick(1000); }
  assert.equal(await flaky, 'ready');
  assert.equal(calls, 4);

  const hopeless = untilStarted(async () => { throw new Error('still down'); }, { graceMs: 5000 });
  const failed = assert.rejects(hopeless, /still down/);
  for (let second = 0; second < 5; second++) { await settle(); context.mock.timers.tick(1000); }
  await failed;

  const controller = new AbortController();
  let after = 0;
  const aborted = untilStarted(async () => { after++; throw new Error('down'); }, { signal: controller.signal });
  const stopped = assert.rejects(aborted, /down|abort/i);
  await settle();
  controller.abort();
  await stopped;
  assert.equal(after, 1, 'no further attempt after the abort');
});
