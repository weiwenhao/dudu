import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

const COOKIE = 'harness_mobile';
const equal = (a, b) => {
  if (typeof a !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function localAddress() {
  const addresses = Object.values(networkInterfaces()).flat().filter(
    (item) => item && item.family === 'IPv4' && !item.internal,
  );
  return addresses.find((item) => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(item.address))?.address
    ?? addresses[0]?.address ?? '127.0.0.1';
}

export function injectAdapter(html, script) {
  const tag = `<script data-harness-mobile-adapter>${script.replaceAll('</script', '<\\/script')}</script>`;
  return html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag;
}

/**
 * Forward the existing Harness UI and API. Upstream credentials remain on the
 * computer; the phone receives a separate, revocable relay session.
 */
export async function createRelay({
  upstreamUrl, adapterScript, host = localAddress(), port = 3097,
  pairToken = randomBytes(32).toString('base64url'),
  pairingStore, secureCookie = () => false, allowedOrigins, privatePaths = [], healthId,
}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(pairToken)) throw new Error('Invalid pairing token.');
  const upstream = new URL(upstreamUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) {
    throw new Error('The upstream must be an HTTP(S) Harness launch URL.');
  }
  const upstreamOrigin = upstream.origin;
  const base = new URL(upstream.pathname.endsWith('/') ? upstream.pathname : `${upstream.pathname}/`, upstreamOrigin);
  const sessionToken = randomBytes(32).toString('base64url');
  let upstreamCookie;
  const bootstrap = async () => {
    const response = await fetch(upstream, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const cookies = response.headers.getSetCookie();
    await response.body?.cancel();
    if (!cookies.length || ![302, 303].includes(response.status)) {
      throw new Error('Harness did not accept the launch URL. Use the complete URL including ?token=.');
    }
    upstreamCookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  };
  await bootstrap();
  const authorized = (req) => {
    const cookies = (req.headers.cookie ?? '').split(';').map((item) => item.trim());
    const cookie = cookies.find((item) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return pairingStore ? pairingStore.authorize(cookie) : equal(cookie, sessionToken);
  };
  const fail = (res, status, message) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(message);
  };
  const wsServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const clients = new Set();
  const requests = new Set();
  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url ?? '/', 'http://relay.local'); }
    catch { fail(res, 400, 'Invalid URL'); return; }
    if (healthId && req.method === 'GET' && url.pathname === '/.well-known/dudu') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ id: healthId }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('pair')) {
      let device;
      try {
        if (pairingStore && url.searchParams.getAll('pair').length === 1) {
          device = await pairingStore.redeem(url.searchParams.get('pair'), req.headers['user-agent']);
        }
      } catch { fail(res, 503, '配对信息暂时无法保存，请稍后重试。'); return; }
      if (url.searchParams.getAll('pair').length !== 1
        || (pairingStore ? !device : !equal(url.searchParams.get('pair'), pairToken))) {
        fail(res, 401, '连接链接已失效，请重新扫描电脑上的二维码。');
        return;
      }
      url.searchParams.delete('pair');
      url.searchParams.delete('computer');
      url.searchParams.delete('name');
      res.writeHead(303, {
        location: url.pathname + url.search,
        'set-cookie': `${COOKIE}=${device?.session ?? sessionToken}; HttpOnly; SameSite=Strict; Path=/${(device?.secureCookie ?? secureCookie()) ? '; Secure' : ''}`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      });
      res.end();
      return;
    }
    if (!authorized(req)) {
      fail(res, 401, '请使用电脑显示的完整 Harness Mobile 连接链接。');
      return;
    }
    if (privatePaths.some((path) => url.pathname === path.replace(/\/$/, '') || url.pathname.startsWith(path))) {
      fail(res, 404, 'Not found');
      return;
    }
    // Resolve relative to the configured mount without letting // change origin.
    const target = new URL(base.href);
    target.pathname = base.pathname.replace(/\/$/, '') + url.pathname;
    target.search = url.search;
    const headers = {
      ...req.headers, host: upstream.host, cookie: upstreamCookie,
      'accept-encoding': 'identity',
    };
    delete headers.referer;
    delete headers['x-forwarded-host'];
    delete headers['x-forwarded-proto'];
    if (headers.origin) headers.origin = upstreamOrigin;
    const transport = upstream.protocol === 'https:' ? https : http;
    const proxy = transport.request(target, { method: req.method, headers }, (response) => {
      const responseHeaders = { ...response.headers, 'referrer-policy': 'no-referrer' };
      delete responseHeaders['set-cookie'];
      if (responseHeaders.location) {
        try {
          const redirect = new URL(responseHeaders.location, target);
          if (redirect.origin === upstreamOrigin) {
            redirect.searchParams.delete('token');
            responseHeaders.location = redirect.pathname + redirect.search;
          }
        } catch { /* Preserve valid non-URL response metadata. */ }
      }
      const html = req.method === 'GET' && response.statusCode === 200
        && String(response.headers['content-type']).includes('text/html')
        && (url.pathname === '/' || url.pathname.endsWith('/index.html'));
      if (html) {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { response.destroy(); proxy.destroy(); }
          else chunks.push(chunk);
        });
        response.on('end', () => {
          const body = injectAdapter(Buffer.concat(chunks).toString('utf8'), adapterScript);
          delete responseHeaders['content-length'];
          delete responseHeaders.etag;
          delete responseHeaders['content-encoding'];
          res.writeHead(response.statusCode, { ...responseHeaders, 'cache-control': 'no-store' });
          res.end(body);
        });
        response.on('error', () => { if (!res.headersSent) fail(res, 502, 'Harness 页面暂时不可用。'); else res.destroy(); });
      } else {
        res.writeHead(response.statusCode ?? 502, responseHeaders);
        pipeline(response, res, () => {});
      }
    });
    requests.add(proxy);
    proxy.once('close', () => requests.delete(proxy));
    proxy.on('error', () => { if (!res.headersSent) fail(res, 502, '电脑上的 Harness 连接已断开。'); else res.destroy(); });
    req.on('aborted', () => proxy.destroy());
    res.on('close', () => { if (!res.writableEnded) proxy.destroy(); });
    pipeline(req, proxy, () => {});
  });
  server.on('upgrade', async (req, socket, head) => {
    const deviceId = authorized(req);
    if (!deviceId) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    if (allowedOrigins && req.headers.origin && !allowedOrigins().includes(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://relay.local');
    if (url.pathname !== '/api/remote.mux') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const target = new URL('api/remote.mux', base);
    target.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
    const remote = new WebSocket(target, {
      headers: { cookie: upstreamCookie, origin: upstreamOrigin },
      handshakeTimeout: 10_000, perMessageDeflate: false,
    });
    clients.add(remote);
    remote.once('close', () => clients.delete(remote));
    let local;
    socket.once('close', () => remote.terminate());
    remote.on('error', () => { if (local) local.close(1011, 'Harness unavailable'); else socket.destroy(); });
    remote.once('open', () => {
      if (socket.destroyed) { remote.terminate(); return; }
      if (!authorized(req)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        remote.terminate();
        return;
      }
      wsServer.handleUpgrade(req, socket, head, (client) => {
        local = client;
        client.deviceId = deviceId;
        clients.add(client);
        client.once('close', () => { clients.delete(client); remote.close(); });
        client.on('error', () => remote.close());
        client.on('message', (data, isBinary) => {
          if (remote.readyState === WebSocket.OPEN) remote.send(data, { binary: isBinary });
        });
        remote.on('message', (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });
        // Native DSH pings every two seconds; answer on this computer and
        // separately check the phone, since WebSocket control frames terminate here.
        client.isAlive = true;
        client.on('pong', () => { client.isAlive = true; });
        remote.on('close', () => client.close(1012, 'Harness disconnected'));
      });
    });
  });
  const unsubscribe = pairingStore?.onRevoke((id) => {
    for (const client of clients) {
      if (client.deviceId === id) client.terminate();
    }
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.isAlive === undefined) continue;
      if (!client.isAlive) client.terminate();
      else { client.isAlive = false; client.ping(); }
    }
  }, 20_000);
  heartbeat.unref();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    unsubscribe?.();
    clearInterval(heartbeat);
    throw error;
  }
  const actualPort = server.address().port;
  const address = `http://${host.includes(':') ? `[${host}]` : host}:${actualPort}`;
  return {
    server, address, pairUrl: `${address}/?pair=${pairToken}`,
    async close() {
      unsubscribe?.();
      clearInterval(heartbeat);
      for (const client of clients) client.terminate();
      for (const request of requests) request.destroy();
      wsServer.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
