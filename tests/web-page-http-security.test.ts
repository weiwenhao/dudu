import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createNativeServer } from '../host/native-server.mjs';
import { createPairingStore } from '../host/pairing-devices.mjs';
import { createWebPageHttp } from '../host/web-page-http.mjs';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function postJSON(
  address: string,
  path: string,
  headers: Record<string, string>,
  value: unknown,
  options: { contentLength?: boolean } = {},
) {
  const body = Buffer.from(JSON.stringify(value));
  const requestHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...headers,
  };
  if (options.contentLength !== false) {
    requestHeaders['content-length'] = String(body.byteLength);
  } else {
    requestHeaders['transfer-encoding'] = 'chunked';
  }

  return new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
    const request = http.request(new URL(path, address), {
      method: 'POST',
      headers: requestHeaders,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function fixture(
  t: test.TestContext,
  options: Record<string, unknown> = {},
  hooks: {
    openHttp?: (params: Record<string, unknown>, connection: Record<string, any>) => Promise<{ id: string }>;
    dispatch?: (method: string, params: Record<string, any>, connection: Record<string, any>) => Promise<unknown>;
  } = {},
) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-http-security-'));
  const pairingStore = await createPairingStore({ folder });
  const disposed = new Map<object, number>();
  const pages = {
    async openHttp(params: Record<string, unknown>, connection: Record<string, any>) {
      return hooks.openHttp
        ? hooks.openHttp(params, connection)
        : { id: randomUUID() };
    },
    async documentHttp() {
      return '<!doctype html><html><body>page</body></html>';
    },
    async resourceHttp() {
      return { mimeType: 'text/plain; charset=utf-8', data: Buffer.from('asset') };
    },
    async dispatch(method: string, params: Record<string, any>, connection: Record<string, any>) {
      return hooks.dispatch
        ? hooks.dispatch(method, params, connection)
        : { ok: true, value: {} };
    },
    async closeConnection(connection: object) {
      disposed.set(connection, (disposed.get(connection) ?? 0) + 1);
    },
  };
  const handler = createWebPageHttp({ pages, pairingStore, ...options });
  const server = await createNativeServer({
    host: '127.0.0.1',
    port: 0,
    computer: { id: pairingStore.id, name: 'Security Test Desktop' },
    pairingStore,
    dispatch: async () => ({}),
    httpHandler: handler.handle,
  });

  t.after(async () => {
    await handler.close().catch(() => {});
    await server.close().catch(() => {});
    await pairingStore.close().catch(() => {});
    await rm(folder, { recursive: true, force: true });
  });

  async function pair() {
    const code = await pairingStore.issue({ address: server.address, name: 'Security Test Device' });
    return { id: code.id, token: new URL(code.url).searchParams.get('pair')! };
  }

  async function openPage(token: string) {
    const result = await postJSON(server.address, '/web/open', {
      authorization: `Bearer ${token}`,
    }, { page: 'settings' });
    assert.equal(result.status, 200);
    return result.body as { id: string; path: string; cookie: string };
  }

  function invoke(page: { path: string; cookie: string }, endpoint: string, contentLength = true) {
    return postJSON(server.address, `${page.path}rpc`, {
      'x-dudu-page': '1',
      cookie: `dudu_ui=${page.cookie}`,
    }, {
      method: 'web.invoke',
      params: { endpoint, args: {} },
    }, { contentLength });
  }

  return { server, handler, pairingStore, disposed, pair, openPage, invoke };
}

test('per-device RPC body budget spans pages, covers dispatch, and releases for retry', async (t) => {
  const enteredDispatch = deferred();
  const releaseDispatch = deferred();
  let dispatchCount = 0;
  const f = await fixture(t, {
    maxBodyBytesInFlight: 8192,
    maxBodyBytesPerDevice: 4096,
  }, {
    async dispatch(_method, params) {
      dispatchCount++;
      if (params.endpoint === 'hold') {
        enteredDispatch.resolve();
        await releaseDispatch.promise;
      }
      return { ok: true, value: {} };
    },
  });
  t.after(() => releaseDispatch.resolve());

  const device = await f.pair();
  const firstPage = await f.openPage(device.token);
  const secondPage = await f.openPage(device.token);

  const unknownLength = await f.invoke(firstPage, 'small', false);
  assert.equal(unknownLength.status, 429, 'unknown-length requests reserve the full 1 MiB allowance');

  const heldResponse = f.invoke(firstPage, 'hold');
  await enteredDispatch.promise;

  const rejected = await f.invoke(secondPage, 'small');
  assert.equal(rejected.status, 429, 'one device cannot exceed its byte budget across page sessions');
  assert.equal(rejected.body.error.code, 'LIMIT_EXCEEDED');
  assert.equal(dispatchCount, 1, 'the request rejected by the budget never reaches dispatch');

  releaseDispatch.resolve();
  assert.equal((await heldResponse).status, 200);
  assert.equal((await f.invoke(secondPage, 'small')).status, 200, 'completed dispatch releases its reservation');
  assert.equal(dispatchCount, 2);
});

test('global RPC body budget spans devices and releases after dispatch', async (t) => {
  const enteredDispatch = deferred();
  const releaseDispatch = deferred();
  const f = await fixture(t, {
    maxBodyBytesInFlight: 4096,
    maxBodyBytesPerDevice: 8192,
  }, {
    async dispatch(_method, params) {
      if (params.endpoint === 'hold') {
        enteredDispatch.resolve();
        await releaseDispatch.promise;
      }
      return { ok: true, value: {} };
    },
  });
  t.after(() => releaseDispatch.resolve());

  const firstDevice = await f.pair();
  const secondDevice = await f.pair();
  const firstPage = await f.openPage(firstDevice.token);
  const secondPage = await f.openPage(secondDevice.token);
  const heldResponse = f.invoke(firstPage, 'hold');
  await enteredDispatch.promise;

  const rejected = await f.invoke(secondPage, 'small');
  assert.equal(rejected.status, 429);
  assert.equal(rejected.body.error.code, 'LIMIT_EXCEEDED');

  releaseDispatch.resolve();
  assert.equal((await heldResponse).status, 200);
  assert.equal((await f.invoke(secondPage, 'small')).status, 200);
});

test('revoking a device cancels a pending open without publishing page credentials', async (t) => {
  const enteredOpen = deferred<Record<string, any>>();
  const releaseOpen = deferred<{ id: string }>();
  const f = await fixture(t, {}, {
    openHttp(_params, connection) {
      enteredOpen.resolve(connection);
      return releaseOpen.promise;
    },
  });
  t.after(() => releaseOpen.resolve({ id: randomUUID() }));

  const device = await f.pair();
  const pendingOpen = postJSON(f.server.address, '/web/open', {
    authorization: `Bearer ${device.token}`,
  }, { page: 'settings' });
  const connection = await enteredOpen.promise;

  assert.equal(await f.pairingStore.revoke(device.id), true);
  const result = await pendingOpen;
  assert.equal(result.status, 401);
  assert.deepEqual(Object.keys(result.body), ['error']);
  assert.equal(result.body.cookie, undefined);
  assert.equal(result.body.id, undefined);
  assert.equal(f.disposed.get(connection), 1, 'revoke and open cleanup share one connection close');

  releaseOpen.resolve({ id: randomUUID() });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.disposed.get(connection), 1);
});

test('closing the HTTP page service cancels a pending open without publishing credentials', async (t) => {
  const enteredOpen = deferred<Record<string, any>>();
  const releaseOpen = deferred<{ id: string }>();
  const f = await fixture(t, {}, {
    openHttp(_params, connection) {
      enteredOpen.resolve(connection);
      return releaseOpen.promise;
    },
  });
  t.after(() => releaseOpen.resolve({ id: randomUUID() }));

  const device = await f.pair();
  const pendingOpen = postJSON(f.server.address, '/web/open', {
    authorization: `Bearer ${device.token}`,
  }, { page: 'settings' });
  const connection = await enteredOpen.promise;

  await f.handler.close();
  const result = await pendingOpen;
  assert.equal(result.status, 503);
  assert.deepEqual(Object.keys(result.body), ['error']);
  assert.equal(result.body.cookie, undefined);
  assert.equal(result.body.id, undefined);
  assert.equal(f.disposed.get(connection), 1, 'close and open cleanup share one connection close');

  releaseOpen.resolve({ id: randomUUID() });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.disposed.get(connection), 1);
});
