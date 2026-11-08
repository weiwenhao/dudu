import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createNativeServer, probeNativeAddress } from '../host/native-server.mjs';
import { createPairingStore } from '../host/pairing-devices.mjs';
import { createNativeBridge } from '../host/native-bridge.mjs';
import { createNativePages } from '../host/native-pages.mjs';

const API = '/dsbot/api/v1';

async function directory(prefix = 'dsbot-native-http-') {
  return mkdtemp(join(tmpdir(), prefix));
}

async function setup(t, options = {}) {
  const folder = await directory();
  const pairingStore = await createPairingStore({ folder });
  const server = await createNativeServer({
    host: '127.0.0.1', port: 0, computer: { id: 'private-id', name: 'Private Host' },
    pairingStore, dispatch: async () => ({}), ...options,
  });
  t.after(async () => {
    await server.close();
    await pairingStore.close();
    await rm(folder, { recursive: true, force: true });
  });
  return { pairingStore, server };
}

function tokenFrom(code) {
  return new URL(code.url).searchParams.get('pair');
}

function headers(token, extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function post(server, path, token, body) {
  return fetch(`${server.address}${path}`, {
    method: 'POST',
    headers: headers(token, { 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function connect(server, token) {
  const response = await post(server, `${API}/connect`, token);
  assert.equal(response.status, 200);
  return response.json();
}

async function rpc(server, token, method, params = {}) {
  const response = await post(server, `${API}/request`, token, {
    id: randomUUID(), method, params,
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('native API uses authenticated HTTP only and limits the public probe to a metadata-free proof', async (t) => {
  let dispatchCount = 0;
  const { pairingStore, server } = await setup(t, {
    dispatch: async () => { dispatchCount++; return { sessions: [] }; },
  });

  for (const path of ['/', '/dsbot', '/api/remote.mux', '/.well-known/dsbot']) {
    const response = await fetch(`${server.address}${path}`);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  for (const path of [`${API}/connect`, `${API}/request`, `${API}/events`, `${API}/disconnect`]) {
    const response = await post(server, path);
    assert.equal(response.status, 401, path);
  }

  const nonce = '0123456789abcdefghijk';
  const probe = await post(server, `${API}/probe`, undefined, { nonce });
  assert.equal(probe.status, 200);
  const proof = await probe.json();
  assert.deepEqual(Object.keys(proof).sort(), ['proof', 'protocol']);
  assert.equal(proof.protocol, 1);
  assert.equal(proof.proof, pairingStore.proof(nonce));
  assert.equal(await probeNativeAddress(`${server.address}/dsbot`, nonce), proof.proof);
  assert.equal(await probeNativeAddress(server.address, nonce), proof.proof);

  const code = await pairingStore.issue({ address: `${server.address}/dsbot`, name: 'Office Mac' });
  const token = tokenFrom(code);
  const anonymous = await post(server, `${API}/request`, 'x'.repeat(43), {
    id: randomUUID(), method: 'session.list', params: {},
  });
  assert.equal(anonymous.status, 401);
  assert.equal(dispatchCount, 0);

  const ready = await connect(server, token);
  assert.equal(ready.type, 'ready');
  assert.equal(ready.protocol, 1);
  assert.equal(ready.computer.id, 'private-id');
  assert.equal(ready.capabilities.includes('session.watch'), true);
  const response = await rpc(server, token, 'session.list');
  assert.equal(response.ok, true);
  assert.deepEqual(response.result, { sessions: [] });
  const forbidden = await rpc(server, token, 'arbitrary.rpc');
  assert.equal(forbidden.error.code, 'METHOD_NOT_ALLOWED');
  assert.equal(dispatchCount, 1);

  assert.equal((await fetch(`${server.address}${API}/request?token=${token}`)).status, 405);
  assert.equal(await pairingStore.revoke(code.id), true);
  assert.equal(pairingStore.list().length, 0);
  assert.equal((await post(server, `${API}/request`, token, {
    id: randomUUID(), method: 'session.list', params: {},
  })).status, 401);
});

test('authenticated long polling delivers watch events and disconnect cancels the watch', async (t) => {
  let releaseWatch;
  let watchCancelled;
  const cancelled = new Promise((resolve) => { watchCancelled = resolve; });
  const { pairingStore, server } = await setup(t, {
    dispatch: async (method, _params, connection, { watchGeneration } = {}) => {
      if (method === 'session.watch') {
        const cancel = async () => { releaseWatch?.(); watchCancelled(); };
        connection.setWatch(cancel, watchGeneration);
        setTimeout(() => connection.sendEvent('session.snapshot', { session: { id: 's1' } }), 10);
        return { session: { id: 's1' } };
      }
      if (method === 'session.unwatch') {
        await connection.stopWatch();
        return {};
      }
      return {};
    },
  });
  const code = await pairingStore.issue({ address: `${server.address}/dsbot` });
  const token = tokenFrom(code);
  await connect(server, token);
  const watch = await rpc(server, token, 'session.watch', { id: 's1' });
  assert.equal(watch.ok, true);

  const eventsResponse = await post(server, `${API}/events`, token, { cursor: 0, waitMs: 1_000 });
  assert.equal(eventsResponse.status, 200);
  const events = await eventsResponse.json();
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].topic, 'session.snapshot');
  assert.equal(events.events[0].params.session.id, 's1');
  assert.equal(events.cursor, events.events[0].id);

  await rpc(server, token, 'session.unwatch');
  await cancelled;

  releaseWatch = () => {};
  const closed = await post(server, `${API}/disconnect`, token);
  assert.equal(closed.status, 200);
  assert.equal((await post(server, `${API}/events`, token, { cursor: 0, waitMs: 0 })).status, 409);
});

test('authenticated HTTP disconnect disposes embedded page streams', { timeout: 5000 }, async (t) => {
  const folder = await directory('dsbot-page-disconnect-http-');
  const pairingStore = await createPairingStore({ folder });
  let releaseDisposed;
  const disposed = new Promise((resolve) => { releaseDisposed = resolve; });
  const pages = createNativePages({
    frontend: {
      async document() {
        return {
          html: '<!doctype html><html lang="zh-Hans"></html>',
          async resource() { return undefined; },
        };
      },
    },
    pageRpc: {
      async invoke() { return { ok: true, value: {} }; },
      async open(endpoint, args) {
        assert.equal(endpoint, 'session/follow');
        assert.deepEqual(args, {
          request: {
            address: { kind: 'session', sessionId: 'review-session' },
            assistantStream: true,
          },
        });
        return {
          [Symbol.asyncIterator]() {
            return { async next() { return { done: true }; }, async return() { return { done: true }; } };
          },
          async dispose() { releaseDisposed(); },
        };
      },
    },
  });
  const bridge = createNativeBridge({
    rpc: {
      async call() { throw new Error('unexpected RPC'); },
      async open() { throw new Error('unexpected native stream'); },
    },
    pages,
  });
  const server = await createNativeServer({
    host: '127.0.0.1', port: 0, computer: { id: 'host', name: 'Mac' },
    pairingStore, dispatch: bridge.dispatch, onDisconnect: bridge.closeConnection,
  });
  t.after(async () => {
    await server.close();
    await pairingStore.close();
    await rm(folder, { recursive: true, force: true });
  });
  const credential = await pairingStore.issue({ address: `${server.address}/dsbot` });
  const token = tokenFrom(credential);
  await connect(server, token);
  const request = async (method, params) => {
    const response = await rpc(server, token, method, params);
    assert.equal(response.ok, true, response.error?.code);
    return response.result;
  };
  const page = await request('web.open', { page: 'trace', sessionId: 'review-session' });
  await request('web.stream.open', {
    id: page.id, endpoint: 'session/follow',
    args: {
      request: {
        address: { kind: 'session', sessionId: 'review-session' },
        assistantStream: true,
      },
    },
  });
  assert.equal((await post(server, `${API}/disconnect`, token)).status, 200);
  await disposed;
});
