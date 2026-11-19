import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTypertPageRpc,
  PAGE_READ_METHODS,
  PAGE_STREAM_METHODS,
  PAGE_WRITE_METHODS,
} from '../host/native-page-rpc.mjs';

const ownerPeer = { principal: { kind: 'owner' } };
const createGateway = (overrides = {}) => ({
  async invoke() { return {}; },
  async stream() { return { async *[Symbol.asyncIterator]() {} }; },
  ...overrides,
});

test('publishes frozen read/write/stream inventories without anonymous execution routes', () => {
  assert.ok(Object.isFrozen(PAGE_READ_METHODS));
  assert.ok(Object.isFrozen(PAGE_WRITE_METHODS));
  assert.ok(Object.isFrozen(PAGE_STREAM_METHODS));
  assert.ok(PAGE_READ_METHODS.includes('session/page'));
  assert.ok(PAGE_READ_METHODS.includes('pluginManager/listPlugins'));
  assert.ok(PAGE_READ_METHODS.includes('dshMarket/registry'));
  assert.ok(PAGE_WRITE_METHODS.includes('settings/update'));
  assert.ok(PAGE_STREAM_METHODS.includes('session/follow'));
  assert.ok(PAGE_STREAM_METHODS.includes('toolResults/watch'));
  assert.ok(PAGE_STREAM_METHODS.includes('$events'));
  assert.ok(!PAGE_READ_METHODS.includes('commands/execute'));
  assert.ok(!PAGE_READ_METHODS.includes('userQuestions/answer'));
  assert.ok(!PAGE_WRITE_METHODS.includes('commands/execute'));
  assert.ok(!PAGE_STREAM_METHODS.includes('approval/follow'));
});

test('requires an owner-scoped gateway and dispatches only listed methods', async () => {
  assert.throws(() => createTypertPageRpc({
    gateway: createGateway(), peer: { principal: { kind: 'device' } },
  }), TypeError);
  assert.throws(() => createTypertPageRpc({
    gateway: { invoke() {} }, peer: ownerPeer,
  }), TypeError);

  const calls = [];
  const gateway = createGateway({
    async dispatchRpc(endpoint, request, signal, peer) {
      calls.push({ endpoint, request, signal, peer });
      return { ok: true, value: { accepted: true } };
    },
  });
  const rpc = createTypertPageRpc({ gateway, peer: ownerPeer });
  const controller = new AbortController();
  assert.deepEqual(await rpc.invoke('session/page', {
    request: { address: { kind: 'session', sessionId: 'session-1' }, throughSeq: 9 },
  }, controller.signal), { ok: true, value: { accepted: true } });
  assert.deepEqual(calls, [{
    endpoint: 'session/page',
    request: {
      args: { request: { address: { kind: 'session', sessionId: 'session-1' }, throughSeq: 9 } },
    },
    signal: controller.signal,
    peer: ownerPeer,
  }]);
  await assert.rejects(rpc.invoke('commands/execute', { line: 'unsafe' }), /Unsupported embedded method/);
});

test('restores attachment paths before serializing bytes to the frontend bridge', async () => {
  const bytes = Uint8Array.of(0, 7, 128, 255);
  const gateway = createGateway({
    async dispatchRpc() {
      return {
        ok: true,
        value: { result: { attachment: null } },
        attachments: [{ path: ['result', 'attachment'], bytes }],
      };
    },
  });
  const rpc = createTypertPageRpc({ gateway, peer: ownerPeer });
  assert.deepEqual(await rpc.invoke('session/page', {}), {
    ok: true,
    value: { result: { attachment: { $duduBytes: Buffer.from(bytes).toString('base64') } } },
  });
});

test('fallback invocation preserves its argument envelope and encodes typed bytes', async () => {
  const bytes = Uint8Array.of(4, 5, 6);
  const calls = [];
  const gateway = createGateway({
    async invoke(request) {
      calls.push(request);
      return { payload: bytes };
    },
  });
  const rpc = createTypertPageRpc({ gateway, peer: ownerPeer });
  const signal = new AbortController().signal;
  assert.deepEqual(await rpc.invoke('account/getBalance', { client: 'mobile' }, signal), {
    ok: true,
    value: { payload: { $duduBytes: Buffer.from(bytes).toString('base64') } },
  });
  assert.deepEqual(calls, [{
    namespace: 'account',
    method: 'getBalance',
    args: { client: 'mobile' },
    peer: ownerPeer,
    signal,
  }]);
});

test('normalizes RPC failures and omits upstream error details', async () => {
  const rpc = createTypertPageRpc({
    gateway: createGateway({
      async dispatchRpc() {
        return {
          ok: false,
          error: { code: 'settings/conflict', message: 'private upstream message', details: { token: 'secret' } },
        };
      },
    }),
    peer: ownerPeer,
  });
  const result = await rpc.invoke('settings/describe', {});
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'settings/conflict', message: '电脑暂时无法完成请求。', details: {} },
  });
  assert.doesNotMatch(JSON.stringify(result), /private upstream message|secret/);
});

test('context detail uses its fixed plugin reader instead of a generic gateway method', async () => {
  let gatewayCalls = 0;
  let pluginReads = 0;
  const rpc = createTypertPageRpc({
    gateway: createGateway({ async dispatchRpc() { gatewayCalls += 1; } }),
    peer: ownerPeer,
    connection: {
      createSharedFetchHandler() {
        return {
          async fetch(request, peer) {
            assert.equal(peer, ownerPeer);
            assert.equal(new URL(request.url).pathname, '/api/dsh-context/detail');
            assert.deepEqual(await request.json(), { sessionId: 'selected-session' });
            pluginReads += 1;
            return Response.json({ ok: true, value: { rev: 2, requests: [] } });
          },
        };
      },
    },
  });
  assert.deepEqual(await rpc.invoke('dshContext/detail', { sessionId: 'selected-session' }), {
    ok: true, value: { rev: 2, requests: [] },
  });
  assert.equal(pluginReads, 1);
  assert.equal(gatewayCalls, 0);
});

test('third-party market reads keep credentials in the host and bypass generic gateway dispatch', async () => {
  let gatewayCalls = 0;
  const rpc = createTypertPageRpc({
    gateway: createGateway({ async dispatchRpc() { gatewayCalls += 1; } }),
    peer: ownerPeer,
    connection: {
      authenticatedUrl(base) { return `${base}?token=owner-token`; },
      authorizeIndex(req, res) {
        res.writeHead(303, { 'set-cookie': 'owner=private-cookie; HttpOnly' });
        res.end();
      },
      admit(req) {
        assert.equal(req.headers.cookie, 'owner=private-cookie');
        return { peer: ownerPeer };
      },
    },
    webServer: {
      getOrigin() { return 'http://127.0.0.1:3080'; },
      match(path) {
        return { kind: 'exact', path, handler(req, res) {
          assert.equal(req.url, '/dsh-market/registry');
          res.end(JSON.stringify({ registry: { updated: 'today', count: 0, categories: {}, plugins: [] } }));
        } };
      },
    },
  });
  assert.deepEqual(await rpc.invoke('dshMarket/registry', {}), {
    ok: true, value: { status: 200, body: { hostVersion: null, registry: {
      updated: 'today', count: 0, categories: {}, plugins: [],
    } } },
  });
  assert.equal(gatewayCalls, 0);
});

test('$events uses bounded listeners rather than the gateway stream and disposes without polling', async () => {
  const listeners = new Map();
  const releases = [];
  let gatewayStreamCalls = 0;
  const events = {
    on(name, callback) {
      const callbacks = listeners.get(name) ?? new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        releases.push(name);
        callbacks.delete(callback);
        if (callbacks.size === 0) listeners.delete(name);
      };
      return release;
    },
  };
  const rpc = createTypertPageRpc({
    gateway: createGateway({
      async stream() { gatewayStreamCalls += 1; throw new Error('must not join a gateway waterfall'); },
    }),
    peer: ownerPeer,
    events,
  });
  const controller = new AbortController();
  const source = await rpc.open('$events', {}, controller.signal);
  const subscribed = [...listeners.keys()];
  assert.ok(subscribed.length > 0);
  assert.ok(subscribed.every((name) => !name.toLowerCase().includes('approval')));
  assert.equal(gatewayStreamCalls, 0);
  assert.equal(releases.length, 0);

  // Abort before creating or advancing an iterator: cleanup must not depend on polling.
  controller.abort();
  await source.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(releases.length, subscribed.length);
  assert.equal(gatewayStreamCalls, 0);
});

test('$events yields allowlisted notifications and ends cleanly on cancellation', async () => {
  const listeners = new Map();
  let gatewayStreamCalls = 0;
  const events = {
    on(name, callback) {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
  };
  const rpc = createTypertPageRpc({
    gateway: createGateway({ async stream() { gatewayStreamCalls += 1; } }),
    peer: ownerPeer,
    events,
  });
  const controller = new AbortController();
  const source = await rpc.open('$events', {}, controller.signal);
  const iterator = source[Symbol.asyncIterator]();
  const ready = await iterator.next();
  assert.equal(ready.value.type, 'ready');

  const notify = listeners.get('settings/document-updated');
  assert.equal(typeof notify, 'function');
  notify({ revision: 3 });
  const update = await iterator.next();
  assert.deepEqual(update.value, {
    type: 'emit',
    event: 'settings/document-updated',
    args: [{ revision: 3 }],
  });

  controller.abort();
  assert.equal((await iterator.next()).done, true);
  assert.equal(listeners.size, 0);
  assert.equal(gatewayStreamCalls, 0);
});
