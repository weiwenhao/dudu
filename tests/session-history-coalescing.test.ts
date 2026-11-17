import assert from 'node:assert/strict';
import test from 'node:test';
import { installSessionHistoryCoalescing } from '../host/session-history-coalescing.mjs';

test('native opening and metadata reads share one cold preparation but retain their own current projections and leases', async () => {
  const pending = Promise.withResolvers<void>();
  let prepared = false;
  let coldReads = 0;
  let leases = 0;
  let cursor = 1;
  const query = {
    async observeSession(_id: string, options: any = {}) {
      assert.equal(this, query);
      if (!prepared) { coldReads++; await pending.promise; prepared = true; }
      leases++;
      const cut = cursor;
      return {
        cursor: cut, ...(options.projectionMode === 'all' ? { projections: { asOfSeq: cut } } : {}),
        [Symbol.dispose]() { leases--; },
      };
    },
  };
  const original = query.observeSession;
  const stop = installSessionHistoryCoalescing(query);
  try {
    const opening = query.observeSession('one', { projectionMode: 'all' });
    const metadata = query.observeSession('one', { projectionMode: 'none' });
    await Promise.resolve();
    assert.equal(coldReads, 1);
    cursor = 2;
    pending.resolve();
    const [page, facts] = await Promise.all([opening, metadata]);
    assert.equal(coldReads, 1);
    assert.deepEqual(page.projections, { asOfSeq: 2 });
    assert.equal(facts.projections, undefined);
    assert.equal(leases, 2, 'only the caller-owned leases remain');
    page[Symbol.dispose]();
    facts[Symbol.dispose]();
    assert.equal(leases, 0);
  } finally { pending.resolve(); stop(); }
  assert.equal(query.observeSession, original);
});

test('one cancelled reader cannot cancel another, and a late lease after all readers cancel is released', async () => {
  const warm = Promise.withResolvers<void>();
  let leases = 0;
  let signal: AbortSignal | undefined;
  let ready = false;
  const query = {
    async observeSession(_id: string, options: any) {
      if (!ready) {
        signal = options.signal;
        await warm.promise;
        ready = true;
      }
      leases++;
      return { [Symbol.dispose]() { leases--; } };
    },
  };
  let stop = installSessionHistoryCoalescing(query);
  try {
    const one = new AbortController();
    const two = new AbortController();
    const first = query.observeSession('one', { signal: one.signal });
    const second = query.observeSession('one', { signal: two.signal });
    await Promise.resolve();
    one.abort(new Error('closed one'));
    await assert.rejects(first, /closed one/);
    assert.equal(signal?.aborted, false);
    warm.resolve();
    const lease = await second;
    lease[Symbol.dispose]();
    assert.equal(leases, 0);
    stop();
    const late = Promise.withResolvers<any>();
    query.observeSession = async () => late.promise;
    stop = installSessionHistoryCoalescing(query);
    const abort = new AbortController();
    const waiting = query.observeSession('late', { signal: abort.signal });
    await Promise.resolve();
    abort.abort(new Error('closed all'));
    await assert.rejects(waiting, /closed all/);
    leases++;
    const disposed = Promise.withResolvers<void>();
    late.resolve({ [Symbol.dispose]() { leases--; disposed.resolve(); } });
    await disposed.promise;
    assert.equal(leases, 0);
  } finally { warm.resolve(); stop(); }
});

test('live reads stay on the original path, and failed preparations remain failures without retries', async () => {
  const failure = new Error('corrupt journal');
  let live = true;
  let calls = 0;
  const query = {
    async observeSession(_id: string, _options: any) { calls++; throw failure; },
  };
  const stop = installSessionHistoryCoalescing(query, { get: () => live });
  const options = { projectionMode: 'all', signal: new AbortController().signal };
  try {
    await assert.rejects(query.observeSession('one', options), (error) => error === failure);
    assert.equal(calls, 1);
    live = false;
    const reads = [query.observeSession('one', options), query.observeSession('one', options)];
    await Promise.all(reads.map((read) => assert.rejects(read, (error) => error === failure)));
    assert.equal(calls, 2, 'one failed underlying preparation is delivered to both readers');
  } finally { stop(); }
});

test('context-traced service methods restore their original prototype descriptor on plugin unload', async () => {
  let leases = 0;
  class Query {
    async observeSession() { leases++; return { [Symbol.dispose]() { leases--; } }; }
  }
  const target = new Query();
  const query = new Proxy(target, {
    get(object, key, receiver) {
      const value = Reflect.get(object, key, receiver);
      return typeof value === 'function' ? new Proxy(value, {}) : value;
    },
  });
  assert.notEqual(query.observeSession, query.observeSession, 'Cordis creates a fresh method proxy on each read');
  const stop = installSessionHistoryCoalescing(query);
  try {
    const lease = await query.observeSession();
    lease[Symbol.dispose]();
    assert.equal(leases, 0);
    assert.equal(Object.hasOwn(target, 'observeSession'), true);
  } finally { stop(); }
  assert.equal(Object.hasOwn(target, 'observeSession'), false);
  assert.equal(target.observeSession, Query.prototype.observeSession);
});
