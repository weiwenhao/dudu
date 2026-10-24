import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createNativeServer } from '../host/native-server.mjs';
import { createNativePages } from '../host/native-pages.mjs';
import { createPairingStore } from '../host/pairing-devices.mjs';
import { createWebPageHttp } from '../host/web-page-http.mjs';

async function fixture(t, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-http-pages-'));
  const pairingStore = await createPairingStore({ folder });
  const calls = [];
  const documents = [];
  let disposed = 0;
  let releaseReading;
  const reading = new Promise((resolve) => { releaseReading = resolve; });
  const pages = createNativePages({
    frontend: {
      async document(params) {
        documents.push(params);
        return {
          html: '<!doctype html><html lang="zh-CN"><body>mobile page</body></html>',
          async resource(path) {
            if (path === '/assets/app.js') {
              return { mimeType: 'text/javascript; charset=utf-8', data: Buffer.from('const context = "resource";\n'.repeat(2000)) };
            }
            if (path === '/assets/image.png') {
              return { mimeType: 'image/png', data: Buffer.alloc(4096, 127) };
            }
            if (path !== '/assets/site.css') throw new Error('private resource path');
            return { mimeType: 'text/css; charset=utf-8', data: Buffer.from('body{width:100%}') };
          },
        };
      },
    },
    pageRpc: {
      async invoke(endpoint, args) {
        calls.push({ endpoint, args });
        if (endpoint === 'settings/describe') {
          return { ok: true, value: { namespaces: [{ ns: 'general' }] } };
        }
        return { ok: true, value: { saved: true } };
      },
      async open() {
        let release;
        const stopped = new Promise((resolve) => { release = resolve; });
        return {
          async dispose() { disposed++; release(); },
          async *[Symbol.asyncIterator]() { releaseReading(); await stopped; },
        };
      },
    },
  });
  const handler = createWebPageHttp({ pages, pairingStore, ...options });
  const server = await createNativeServer({
    host: '127.0.0.1', port: 0, computer: { id: pairingStore.id, name: 'Test Desktop' },
    pairingStore, dispatch() { throw new Error('HTTP page called the native carrier'); },
    httpHandler: handler.handle,
  });
  t.after(async () => {
    await handler.close();
    await server.close();
    await pairingStore.close();
    await rm(folder, { recursive: true, force: true });
  });
  const issue = async () => {
    const code = await pairingStore.issue({ address: server.address, name: 'Test Desktop' });
    return { code, token: new URL(code.url).searchParams.get('pair') };
  };
  const credential = await issue();
  const open = async (body = { page: 'settings' }, token = credential.token) => {
    const response = await fetch(`${server.address}/dsbot/web/open`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, value: await response.json() };
  };
  const invoke = (page, method, params = {}, extraHeaders = {}) => fetch(`${server.address}${page.path}rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-dsbot-page': '1', cookie: `dsbot_ui=${page.cookie}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ method, params }),
  });
  return {
    server, handler, pages, pairingStore, credential, issue, open, invoke, calls, documents, reading,
    get disposed() { return disposed; },
  };
}

test('HTTP pages exchange pairing auth for a page-scoped session and serve real bytes directly', async (t) => {
  const f = await fixture(t);
  const opened = await f.open();
  assert.equal(opened.response.status, 200);
  const page = opened.value;
  assert.equal(page.computerId, f.pairingStore.id);
  assert.match(page.id, /^[0-9a-f-]{36}$/u);
  assert.equal(page.path, `/dsbot/ui/${page.id}/`);
  assert.match(page.cookie, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(page.cookie, f.credential.token);
  assert.deepEqual(Object.keys(page).sort(), ['computerId', 'cookie', 'id', 'path']);
  assert.equal(JSON.stringify(page).includes(f.credential.token), false);
  assert.equal(f.documents[0].transport, 'http');
  assert.equal(f.documents[0].basePath, page.path);

  const headers = { cookie: `dsbot_ui=${page.cookie}` };
  const document = await fetch(`${f.server.address}${page.path}`, { headers });
  assert.equal(document.status, 200);
  assert.match(await document.text(), /mobile page/u);
  assert.equal(document.headers.get('cache-control'), 'no-store');
  const resource = await fetch(`${f.server.address}${page.path}assets/site.css`, { headers });
  assert.equal(resource.status, 200);
  assert.match(resource.headers.get('content-type'), /^text\/css/u);
  assert.equal(await resource.text(), 'body{width:100%}');

  for (const path of ['/', '/dsbot', '/api', '/assets/site.css', '/dsbot/pages']) {
    assert.equal((await fetch(`${f.server.address}${path}`)).status, 404, path);
  }
});

test('HTTP page assets use negotiated gzip while retaining scoped authentication and no-store', async (t) => {
  const fixtureData = await fixture(t);
  const page = (await fixtureData.open()).value;
  const resourceURL = `${fixtureData.server.address}${page.path}assets/app.js`;
  const read = (url, headers) => new Promise((resolve, reject) => {
    http.get(url, { headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ code: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    }).on('error', reject);
  });
  const headers = { cookie: `dsbot_ui=${page.cookie}`, 'accept-encoding': 'gzip, deflate, br' };
  const zipped = await read(resourceURL, headers);
  assert.equal(zipped.code, 200);
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers['cache-control'], 'no-store');
  assert.equal(zipped.headers.vary, 'Accept-Encoding');
  assert.equal(Number(zipped.headers['content-length']), zipped.body.byteLength);
  const source = gunzipSync(zipped.body);
  assert.equal(source.toString(), 'const context = "resource";\n'.repeat(2000));
  assert.ok(zipped.body.byteLength < source.byteLength / 10);
  for (const encoding of ['identity', 'gzip;q=0, *;q=1', 'gzip;q=invalid']) {
    const plain = await read(resourceURL, { ...headers, 'accept-encoding': encoding });
    assert.equal(plain.headers['content-encoding'], undefined, encoding);
    assert.deepEqual(plain.body, source);
  }
  const wildcard = await read(resourceURL, { ...headers, 'accept-encoding': '*;q=0.5' });
  assert.equal(wildcard.headers['content-encoding'], 'gzip');
  const image = await read(resourceURL.replace('app.js', 'image.png'), headers);
  assert.equal(image.headers['content-encoding'], undefined);
  assert.equal(image.body.byteLength, 4096);
  const rejected = await read(resourceURL, { 'accept-encoding': 'gzip' });
  assert.equal(rejected.code, 401);
  assert.equal(rejected.headers['content-encoding'], undefined);
});

test('documents, assets and RPC all require their own page cookie; pair credentials never work in URLs', async (t) => {
  const f = await fixture(t);
  const page = (await f.open()).value;
  for (const path of [page.path, `${page.path}assets/site.css`]) {
    assert.equal((await fetch(`${f.server.address}${path}`)).status, 401);
    assert.equal((await fetch(`${f.server.address}${path}`, {
      headers: { cookie: `dsbot_ui=${'x'.repeat(43)}` },
    })).status, 401);
  }
  assert.equal((await fetch(`${f.server.address}${page.path}?pair=${f.credential.token}`)).status, 401);
  const other = (await f.open()).value;
  assert.equal((await fetch(`${f.server.address}${other.path}`, {
    headers: { cookie: `dsbot_ui=${page.cookie}` },
  })).status, 401);
  assert.equal((await f.invoke(page, 'web.invoke', { endpoint: 'settings/describe', args: {} }, {
    cookie: '',
  })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('open rejects absent and invalid pairing credentials before reading frontend data', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.server.address}/dsbot/web/open`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"page":"settings"}',
  })).status, 401);
  assert.equal((await f.open({ page: 'settings' }, 'x'.repeat(43))).response.status, 401);
  assert.equal((await f.open({ page: 'settings', url: 'file:///private' })).response.status, 400);
  assert.equal(f.documents.length, 0);
  assert.equal((await fetch(`${f.server.address}/dsbot/web/open?pair=${f.credential.token}`, {
    method: 'POST',
  })).status, 404);
});

test('HTTP RPC retains the described-settings and selected-session policies without a generic proxy', async (t) => {
  const f = await fixture(t);
  const page = (await f.open()).value;
  const mutate = { endpoint: 'settings/update', args: { ns: 'general', patch: { compact: true } } };
  assert.equal((await f.invoke(page, 'web.invoke', mutate)).status, 400);
  const described = await f.invoke(page, 'web.invoke', { endpoint: 'settings/describe', args: {} });
  assert.equal(described.status, 200);
  assert.equal((await described.json()).ok, true);
  assert.equal((await f.invoke(page, 'web.invoke', mutate)).status, 200);
  for (const [method, params] of [
    ['session.send', { text: 'arbitrary' }],
    ['session.command', { command: 'compact' }],
    ['file.upload', { name: 'x', data: 'AAAA' }],
    ['web.invoke', { endpoint: 'shell/exec', args: {} }],
    ['web.invoke', { endpoint: 'settings/describe', args: {}, id: randomUUID() }],
    ['web.resource', { path: '/etc/passwd' }],
  ]) assert.equal((await f.invoke(page, method, params)).status, 400, method);

  const trace = (await f.open({ page: 'trace', sessionId: 'one' })).value;
  assert.equal((await f.invoke(trace, 'web.invoke', {
    endpoint: 'session/projections', args: { request: { sessionId: 'two' } },
  })).status, 400);
  assert.equal(f.calls.length, 2);
});

test('browser cross-origin requests and simple-form posts cannot open or invoke pages', async (t) => {
  const f = await fixture(t);
  const page = (await f.open()).value;
  assert.equal((await f.invoke(page, 'web.invoke', { endpoint: 'settings/describe', args: {} }, {
    origin: 'https://attacker.invalid',
  })).status, 403);
  assert.equal((await f.invoke(page, 'web.invoke', { endpoint: 'settings/describe', args: {} }, {
    origin: f.server.address,
  })).status, 200);
  assert.equal((await f.invoke(page, 'web.invoke', { endpoint: 'settings/describe', args: {} }, {
    'x-dsbot-page': '',
  })).status, 400);
  assert.equal((await fetch(`${f.server.address}/dsbot/web/open`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${f.credential.token}`, 'content-type': 'application/json',
      origin: f.server.address,
    },
    body: '{"page":"settings"}',
  })).status, 403);
  assert.equal(f.calls.length, 1);
});

test('closing or revoking an HTTP page disposes streams and immediately removes resource access', async (t) => {
  const f = await fixture(t);
  const page = (await f.open({ page: 'trace', sessionId: 'one' })).value;
  const stream = await f.invoke(page, 'web.stream.open', {
    endpoint: 'session/follow',
    args: { request: { address: { kind: 'session', sessionId: 'one' }, assistantStream: true } },
  });
  const streamId = (await stream.json()).streamId;
  assert.ok(streamId);
  const pending = f.invoke(page, 'web.stream.next', { streamId });
  await f.reading;
  assert.equal(await f.pairingStore.revoke(f.credential.code.id), true);
  assert.equal((await pending).status, 410);
  assert.equal(f.disposed, 1);
  assert.equal((await fetch(`${f.server.address}${page.path}`, {
    headers: { cookie: `dsbot_ui=${page.cookie}` },
  })).status, 401);

  const credential = await f.issue();
  const other = (await f.open({ page: 'settings' }, credential.token)).value;
  assert.equal((await f.invoke(other, 'web.close')).status, 200);
  assert.equal((await f.invoke(other, 'web.invoke', { endpoint: 'settings/describe', args: {} })).status, 401);
});

test('idle sessions expire, oversized bodies fail early and limits are enforced per device', async (t) => {
  const f = await fixture(t, { maxPagesPerDevice: 1, idleMs: 150 });
  const page = (await f.open()).value;
  assert.equal((await f.open()).response.status, 429);
  assert.equal((await fetch(`${f.server.address}${page.path}rpc`, {
    method: 'POST',
    headers: { cookie: `dsbot_ui=${page.cookie}`, 'content-type': 'application/json', 'x-dsbot-page': '1' },
    body: 'x'.repeat(1024 * 1024 + 1),
  })).status, 413);
  await new Promise((resolve) => setTimeout(resolve, 225));
  assert.equal((await fetch(`${f.server.address}${page.path}`, {
    headers: { cookie: `dsbot_ui=${page.cookie}` },
  })).status, 401);
});

test('encoded traversal and duplicate cookies cannot bypass the frozen asset manifest', async (t) => {
  const f = await fixture(t);
  const page = (await f.open()).value;
  const rawGet = (path, cookie = `dsbot_ui=${page.cookie}`) => new Promise((resolve, reject) => {
    const request = http.get(`${f.server.address}${path}`, { headers: { cookie } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  for (const path of ['assets/%2e%2e/private', 'assets/%2Fetc%2Fpasswd', 'assets/nested\\private']) {
    assert.equal(await rawGet(`${page.path}${path}`), 404, path);
  }
  assert.equal(await rawGet(page.path, `dsbot_ui=${page.cookie}; dsbot_ui=${page.cookie}`), 401);
});
