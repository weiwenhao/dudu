import assert from 'node:assert/strict';
import test from 'node:test';
import { canReadSessionHistory, readSessionHistory } from '../host/dsh-session-history.mjs';

const header = { id: 'session-1', cwd: '/work', createdAt: 1000 };
const events = [{ seq: 0, type: 'session/title', data: { title: 'Saved work' }, time: 1000 }];

test('session history uses the new query service with its receiver and normalizes its header', async () => {
  const query = {
    async readSession(...args: unknown[]) {
      assert.equal(this, query);
      assert.deepEqual(args, ['session-1'], 'the new API does not accept a signal');
      return { session: header, inheritedEventCount: 0, events };
    },
  };
  const services = { query, controller: { inspect() { assert.fail('the legacy reader must not run'); } } };
  assert.equal(canReadSessionHistory(services), true);
  const result = await readSessionHistory(services, 'session-1', new AbortController().signal);
  assert.equal(result.header, header);
  assert.equal(result.meta, header);
  assert.equal(result.session, header);
  assert.equal(result.events, events);
  assert.equal(result.inheritedEventCount, 0);
});

for (const field of ['meta', 'header']) test(`session history falls back to legacy inspect and preserves its ${field} header`, async () => {
  const signal = new AbortController().signal;
  const controller = {
    async inspect(id: string, received: AbortSignal) {
      assert.equal(this, controller);
      assert.equal(id, 'session-1');
      assert.equal(received, signal);
      return { [field]: header, events };
    },
  };
  const services = { controller, query: {} };
  assert.equal(canReadSessionHistory(services), true);
  const result = await readSessionHistory(services, 'session-1', signal);
  assert.equal(result.header, header);
  assert.equal(result.meta, header);
  assert.equal(result.events, events);
});

test('new session-query failures propagate without falling back to another observation', async () => {
  const error = Object.assign(new Error('unreadable session'), { code: 'SESSION_QUERY_CORRUPT_SESSION' });
  await assert.rejects(readSessionHistory({
    query: { async readSession() { throw error; } },
    controller: { inspect() { assert.fail('an operational error must not select the legacy API'); } },
  }, 'session-1'), (received) => received === error);
});

test('missing history capabilities report unsupported instead of silently dropping history', async () => {
  assert.equal(canReadSessionHistory(), false);
  assert.equal(canReadSessionHistory({ query: {}, controller: { inspect: true } }), false);
  await assert.rejects(readSessionHistory({}, 'session-1'), { code: 'UNSUPPORTED' });
});

test('an already cancelled session read does not start querying history', async () => {
  const abort = new AbortController();
  const reason = new Error('cancelled before read');
  abort.abort(reason);
  await assert.rejects(readSessionHistory({
    query: { readSession() { assert.fail('a cancelled caller must not start the read'); } },
  }, 'session-1', abort.signal), (received) => received === reason);
});

test('cancelling a pending query settles the caller even though readSession has no signal parameter', async () => {
  const pending = Promise.withResolvers<unknown>();
  const abort = new AbortController();
  const reason = new Error('cancelled during read');
  const reading = readSessionHistory({ query: { readSession: () => pending.promise } }, 'session-1', abort.signal);
  abort.abort(reason);
  await assert.rejects(reading, (received) => received === reason);
  pending.reject(new Error('the underlying cold read failed later'));
  await pending.promise.catch(() => {});
});
