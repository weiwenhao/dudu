import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createRelay } from '../host/relay.mjs';
import { createMobileAdapterScript } from '../src/mobile-adapter.ts';

test('mobile adapter exposes settings categories directly to the app', () => {
  const script = createMobileAdapterScript();
  assert.match(script, /settings-categories/);
  assert.match(script, /selectSettingsCategory/);
});

test('the relay pairs separately and forwards the existing authenticated HTTP and WebSocket connection', async (t) => {
  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://upstream');
    if (url.pathname === '/' && url.searchParams.get('token') === 'desktop-secret') {
      res.writeHead(303, { location: './', 'set-cookie': 'dsh=upstream-private; HttpOnly; Path=/' });
      res.end();
    } else if (req.headers.cookie !== 'dsh=upstream-private') {
      res.writeHead(401); res.end('Unauthorized');
    } else if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'never=leak' });
      res.end('<html><head></head><body><div id="root">Original Harness UI</div></body></html>');
    } else if (url.pathname === '/api/echo') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), origin: req.headers.origin,
        cookie: req.headers.cookie, path: req.url }));
    } else {
      res.writeHead(404); res.end();
    }
  });
  const mux = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.cookie, 'dsh=upstream-private');
    mux.handleUpgrade(req, socket, head, (client) => {
      client.on('message', (data, binary) => client.send(data, { binary }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = (upstream.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const relay = await createRelay({
    upstreamUrl: `${origin}/?token=desktop-secret`, host: '127.0.0.1', port: 0,
    adapterScript: createMobileAdapterScript({ nativeToolbar: false }),
  });
  t.after(async () => {
    await relay.close();
    for (const client of mux.clients) client.terminate();
    mux.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
  await t.test('rejects unauthenticated access and malformed pairing tokens', async () => {
    assert.equal((await fetch(`${relay.address}/api/echo`)).status, 401);
    const pair = new URL(relay.pairUrl);
    pair.searchParams.set('pair', 'é'.repeat(43));
    assert.equal((await fetch(pair, { redirect: 'manual' })).status, 401);
    assert.equal((await fetch(`${relay.address}/api/echo`)).status, 401);
  });
  const pairing = await fetch(relay.pairUrl, { redirect: 'manual' });
  const cookie = pairing.headers.getSetCookie()[0]!.split(';')[0];
  await t.test('exchanges the pairing token for its own cookie and removes it from the URL', () => {
    assert.equal(pairing.status, 303);
    assert.equal(pairing.headers.get('location'), '/');
    assert.match(cookie, /^harness_mobile=/);
    assert.ok(!cookie.includes('desktop-secret'));
    assert.ok(!cookie.includes('upstream-private'));
  });
  await t.test('serves the actual upstream page with the adapter and withholds upstream credentials', async () => {
    const response = await fetch(relay.address, { headers: { cookie } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Original Harness UI/);
    assert.match(html, /data-harness-mobile-adapter/);
    assert.ok(!html.includes('desktop-secret'));
    assert.ok(!html.includes('upstream-private'));
    assert.deepEqual(response.headers.getSetCookie(), []);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  await t.test('preserves request bodies and rewrites only the upstream transport origin', async () => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'mobile-one', method: 'session/list', payload: { args: { _request: {} } } });
    const response = await fetch(`${relay.address}/api/echo?original=1`, {
      method: 'POST', headers: { cookie, origin: relay.address, 'content-type': 'application/json' }, body,
    });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.body, body);
    assert.equal(value.cookie, 'dsh=upstream-private');
    assert.equal(value.origin, origin);
    assert.equal(value.path, '/api/echo?original=1');
  });
  await t.test('forwards native multiplexed stream frames without creating another Harness Host', async () => {
    const ws = new WebSocket(relay.address.replace('http:', 'ws:') + '/api/remote.mux', { headers: { cookie } });
    await once(ws, 'open');
    const message = once(ws, 'message');
    const frame = JSON.stringify({ type: 'open', streamId: 'phone', endpoint: '$events', payload: { args: {} } });
    ws.send(frame);
    assert.equal((await message)[0].toString(), frame);
    ws.close();
    await once(ws, 'close');
    assert.equal((await fetch(`${origin}/?token=desktop-secret`, { redirect: 'manual' })).status, 303);
  });
  await t.test('accepts the same pairing key on a new relay and isolates other installations', async () => {
    const pairToken = new URL(relay.pairUrl).searchParams.get('pair')!;
    const restarted = await createRelay({
      upstreamUrl: `${origin}/?token=desktop-secret`, host: '127.0.0.1', port: 0,
      adapterScript: '', pairToken,
    });
    const other = await createRelay({
      upstreamUrl: `${origin}/?token=desktop-secret`, host: '127.0.0.1', port: 0,
      adapterScript: '',
    });
    try {
      assert.equal(new URL(restarted.pairUrl).searchParams.get('pair'), pairToken);
      assert.equal((await fetch(restarted.pairUrl, { redirect: 'manual' })).status, 303);
      assert.notEqual(new URL(other.pairUrl).searchParams.get('pair'), pairToken);
      const wrong = new URL(other.pairUrl);
      wrong.searchParams.set('pair', pairToken);
      assert.equal((await fetch(wrong, { redirect: 'manual' })).status, 401);
    } finally {
      await Promise.all([restarted.close(), other.close()]);
    }
  });
});
