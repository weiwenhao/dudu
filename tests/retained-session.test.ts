import assert from 'node:assert/strict';
import test from 'node:test';
import { watchRetainedSession } from '../host/dudu-plugin/ui/issues/use-retained-session.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function reference(sessionId: string) {
  let releases = 0;
  return { sessionId, ready: Promise.resolve(), release() { releases++; }, get releases() { return releases; } };
}

test('switching to warm history publishes before resume settles and does not reacquire the same conversation', async () => {
  const cached = reference('a');
  const resumed = Promise.withResolvers<{ sessionId: string }>();
  const changes: any[] = [];
  const issue = { id: 4, session: 'dsh:a' };
  let resumes = 0;
  const stop = watchRetainedSession(issue, async (target: unknown) => {
    assert.equal(target, issue); resumes++; return resumed.promise;
  }, {
    retainCachedSession: () => cached,
    retainSession: () => { throw new Error('A warm generation must not be opened a second time'); },
  }, (value: unknown) => changes.push(value));
  try {
    assert.equal(changes[0]?.reference, cached, 'cached content is available in the layout effect, without waiting for HTTP');
    assert.equal(resumes, 1, 'opening still records a touch through the existing resume hook');
    resumed.resolve({ sessionId: 'a' });
    await flush();
    assert.equal(changes.length, 1);
    assert.equal(cached.releases, 0);
  } finally { stop(); }
  assert.equal(cached.releases, 1);
});

test('background resume failure revokes the cached reference, and switching away cancels late answers', async () => {
  for (const closeFirst of [false, true]) {
    const cached = reference('a');
    const resumed = Promise.withResolvers<{ sessionId: string }>();
    const changes: any[] = [];
    const stop = watchRetainedSession({ id: 4 }, () => resumed.promise, {
      retainCachedSession: () => cached,
      retainSession: () => { throw new Error('Must not reopen after a refused/cancelled restore'); },
    }, (value: unknown) => changes.push(value));
    if (closeFirst) stop();
    resumed.reject(new Error('Restore refused'));
    await flush();
    assert.equal(cached.releases, 1);
    assert.equal(changes.length, closeFirst ? 1 : 2);
    if (!closeFirst) assert.deepEqual(changes[1], { reference: null, failed: true });
    stop();
    assert.equal(cached.releases, 1, 'the preview releases once and never releases the history cache owner');
  }
});

test('cold opens and explicit retries await restore; changed assignments replace warm history and late retains are released', async () => {
  for (const mode of ['cold', 'retry', 'reassigned', 'closed']) {
    const cached = reference('old');
    const opened = reference('new');
    const resumed = Promise.withResolvers<{ sessionId: string }>();
    const acquired = Promise.withResolvers<typeof opened>();
    const changes: any[] = [];
    const stop = watchRetainedSession({ id: 4, session: 'dsh:old' }, () => resumed.promise, {
      retainCachedSession: () => mode === 'cold' ? undefined : cached,
      retainSession: () => acquired.promise,
    }, (value: unknown) => changes.push(value), { cached: mode !== 'retry' });
    assert.equal(changes.length, ['cold', 'retry'].includes(mode) ? 0 : 1);
    resumed.resolve({ sessionId: 'new' });
    await flush();
    if (mode === 'closed') stop();
    acquired.resolve(opened);
    await flush();
    if (mode !== 'closed') assert.equal(changes.at(-1).reference, opened);
    stop();
    assert.equal(cached.releases, ['cold', 'retry'].includes(mode) ? 0 : 1);
    assert.equal(opened.releases, 1);
  }
});

test('a cold startup that takes longer than fifteen seconds stays pending and publishes the eventual conversation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const waitingFor of ['resume', 'history']) {
    const resumed = Promise.withResolvers<{ sessionId: string }>();
    const acquired = Promise.withResolvers<ReturnType<typeof reference>>();
    const changes: any[] = [];
    let signal: AbortSignal | undefined;
    const opened = reference('large');
    const stop = watchRetainedSession({ id: 8, session: 'dsh:large' }, (_issue: unknown, options: any) => {
      signal = options.signal;
      return resumed.promise;
    }, { retainSession: () => acquired.promise }, (value: unknown) => changes.push(value));
    try {
      if (waitingFor === 'history') {
        resumed.resolve({ sessionId: 'large' });
        await flush();
      }
      t.mock.timers.tick(30_000);
      await flush();
      assert.equal(signal?.aborted, false, 'elapsed time is not a failed DSH opening');
      assert.deepEqual(changes, []);
      resumed.resolve({ sessionId: 'large' });
      acquired.resolve(opened);
      await flush();
      assert.equal(changes.at(-1)?.reference, opened);
      assert.equal(changes.at(-1)?.failed, false);
    } finally { stop(); }
    assert.equal(opened.releases, 1);
  }
});

test('real opening failures report only their stage and timing; a cancelled opening never reports a failure', async () => {
  for (const closeFirst of [false, true]) {
    const acquired = Promise.withResolvers<ReturnType<typeof reference>>();
    const failures: any[] = [];
    const changes: any[] = [];
    const stop = watchRetainedSession({ id: 8, title: 'private words', session: 'dsh:large' }, async () => ({ sessionId: 'large' }), {
      retainSession: (_target: unknown, { onStage }: any) => { onStage?.('catalog'); return acquired.promise; },
      sessionOpenFailed: (failure: unknown) => failures.push(failure),
    }, (value: unknown) => changes.push(value));
    await flush();
    if (closeFirst) stop();
    acquired.reject(new Error('private words; Bearer credential; /private/path'));
    await flush();
    if (closeFirst) assert.deepEqual(failures, []);
    else {
      assert.deepEqual(changes, [{ reference: null, failed: true }]);
      assert.equal(failures.length, 1);
      assert.deepEqual({ ...failures[0], elapsedMs: 0 }, { stage: 'catalog', issueId: 8, sessionId: 'large', reason: 'open_failed', elapsedMs: 0 });
      assert.ok(failures[0].elapsedMs >= 0);
      assert.doesNotMatch(JSON.stringify(failures), /private|credential|Bearer/);
    }
    stop();
  }
});
