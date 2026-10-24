import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeQuestions } from '../host/native-questions.mjs';

function harness(attachWait) {
  let listener;
  let removed = false;
  const bridge = createNativeQuestions({
    events: { on(name, callback, options) {
      assert.equal(name, 'user-questions/request');
      assert.deepEqual(options, { global: true, prepend: true });
      listener = callback;
      return () => { removed = true; };
    } },
    attachWait,
  });
  return { bridge, invoke: (request, next) => listener(request, next), removed: () => removed };
}

const question = (signal) => ({
  agent: { session: { id: 'session' } }, signal,
  wait: { callId: 'call', timed: true },
  questions: [{ id: 'name', question: 'Name?' }],
});
const answer = [{ id: 'name', selected: [], custom: 'Mobile' }];

test('foreground answers race the desktop without aborting the parent task', async () => {
  const { bridge, invoke } = harness();
  const parent = new AbortController();
  const request = question(parent.signal);
  const release = bridge.watch('session');
  let desktopAborted = false;
  const result = invoke(request, () => new Promise((_, reject) => {
    request.signal.addEventListener('abort', () => { desktopAborted = true; reject(request.signal.reason); }, { once: true });
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bridge.answer('wrong', 'call', answer), false);
  assert.throws(() => bridge.answer('session', 'call', [{ id: 'bad', selected: [] }]), { code: 'BAD_REQUEST' });
  assert.equal(bridge.answer('session', 'call', answer), true);
  await assert.deepEqual(await result, { answers: answer });
  assert.equal(parent.signal.aborted, false);
  assert.equal(desktopAborted, true);
  assert.equal(request.signal, parent.signal);
  assert.equal(bridge.answer('session', 'call', answer), false);
  release();
  bridge.close();
});

test('desktop answers win normally and a phone can join an already open question', async () => {
  const { bridge, invoke } = harness();
  let finish;
  const pending = invoke(question(), () => new Promise((resolve) => { finish = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const release = bridge.watch('session');
  finish({ answers: [{ id: 'name', selected: [], custom: 'Desktop' }] });
  assert.equal((await pending).answers[0].custom, 'Desktop');
  assert.equal(bridge.answer('session', 'call', answer), false);
  release();
  bridge.close();
});

test('mobile-only questions stay answerable and disconnect releases the foreground claim', async () => {
  let claimAborted = false;
  const { bridge, invoke } = harness((_request, signal) => (async function* () {
    yield { remainingMs: 1000 };
    await new Promise((resolve) => signal.addEventListener('abort', () => { claimAborted = true; resolve(); }, { once: true }));
  })());
  const release = bridge.watch('session');
  const failure = Object.assign(new Error('no desktop'), { code: 'NO_PROVIDER' });
  const pending = invoke(question(), () => Promise.reject(failure));
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await assert.rejects(pending, { code: 'NO_PROVIDER' });
  assert.equal(claimAborted, true);
  bridge.close();
});

test('parent cancellation and plugin disposal cannot submit an obsolete answer or interrupt desktop work', async () => {
  const { bridge, invoke, removed } = harness();
  const parent = new AbortController();
  const pending = invoke(question(parent.signal), () => new Promise(() => {}));
  parent.abort(new Error('stopped'));
  await assert.rejects(pending, /stopped/);
  assert.equal(bridge.answer('session', 'call', answer), false);
  let finish;
  const request = question();
  const desktop = invoke(request, () => new Promise((resolve) => { finish = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  const signal = request.signal;
  bridge.close();
  assert.equal(removed(), true);
  assert.equal(signal.aborted, false);
  finish({ answers: answer });
  assert.deepEqual(await desktop, { answers: answer });
});

test('failed foreground claims notify the watched phone while desktop answers remain available', async () => {
  for (const mode of ['throw', 'missing', 'stream']) {
    const failure = new Error('wait claim failed');
    const { bridge, invoke } = harness(() => {
      if (mode === 'throw') throw failure;
      if (mode === 'missing') return undefined;
      return (async function* () { yield {}; throw failure; })();
    });
    const failures = [];
    const parent = new AbortController();
    const release = bridge.watch('session', (error) => failures.push(error));
    let finish;
    const pending = invoke(question(parent.signal), () => new Promise((resolve) => { finish = resolve; }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(failures.length, 1);
    assert.throws(() => bridge.answer('session', 'call', answer), { code: 'UPSTREAM_UNAVAILABLE' });
    assert.equal(parent.signal.aborted, false);
    finish({ answers: [{ id: 'name', selected: [], custom: 'Desktop' }] });
    assert.equal((await pending).answers[0].custom, 'Desktop');
    release();
    bridge.close();
  }
});
