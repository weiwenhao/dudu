import { nativeLabels, nativeText, withNativeLocale } from './native-locale.mjs';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NATIVE_METHODS } from './native-bridge.mjs';
import { cleanClient } from './native-client.mjs';

const API = '/api/v1';
const ROUTES = Object.freeze({
  connect: `${API}/connect`,
  disconnect: `${API}/disconnect`,
  events: `${API}/events`,
  probe: `${API}/probe`,
  request: `${API}/request`,
  upload: `${API}/file/upload`,
  video: `${API}/file/video`,
});
// What one request of the phone may weigh: nine pictures with no limit of their own (owner, 2026-11-17) can be a few tens of megabytes, which the 28 MB that stood here refused.
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_PREAUTH_BYTES = 4 * 1024;
const DEFAULT_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 128;
const MAX_EVENT_BYTES = 8 * 1024 * 1024;
const MAX_POLL_MS = 25_000;
const IDLE_TIMEOUT_MS = 2 * 60_000;
// A phone that asked this computer for anything within this long is in front of its owner: the App holds an events request open and asks again at once, so one that has gone quiet for longer has
// been put away (its connection is kept two minutes more). Only a phone that is away is woken by Apple (native-board-wake.mjs); one in front is told on its connection.
const LIVE_WINDOW_MS = 45_000;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

const SAFE_ERRORS = nativeLabels(Object.freeze({
  AUTH_FAILED: '配对已失效，请重新配对。',
  AUTH_REQUIRED: '请更新电脑端的 dudu 插件。',
  BAD_REQUEST: '请求参数不正确。',
  DUPLICATE_REQUEST: '请求标识已在使用。',
  FORBIDDEN: '电脑拒绝了此操作。',
  INVALID_ATTACHMENT: '图片格式或大小不符合要求。',
  LIMIT_EXCEEDED: '请求内容过大。',
  METHOD_NOT_ALLOWED: '不支持此操作。',
  NOT_FOUND: '找不到请求的会话或项目。',
  PERMISSION_UNSUPPORTED: '当前桌面服务不支持从手机修改权限预设。',
  RESULT_UNKNOWN: '请求可能已在电脑执行，请检查会话状态。',
  STALE_APPROVAL: '此审批已失效或无法由手机处理。',
  TOO_MANY_REQUESTS: '请求过多，请稍后重试。',
  UNAUTHORIZED: '配对已失效，请重新配对。',
  UNSUPPORTED: '此操作暂不受支持。',
  UPSTREAM_ERROR: '桌面服务拒绝了此操作。',
  UPSTREAM_UNAVAILABLE: '桌面服务暂时无法完成此操作。',
}));

const reply = (response, status, value) => {
  if (response.writableEnded || response.destroyed) return;
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': body.length,
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
};

const errorValue = (error) => {
  const code = Object.hasOwn(SAFE_ERRORS, error?.code) ? error.code : 'UPSTREAM_UNAVAILABLE';
  return { code, message: SAFE_ERRORS[code] };
};

class HTTPError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function readJson(request, maximumBytes = MAX_REQUEST_BYTES) {
  const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HTTPError(415, 'BAD_REQUEST');
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maximumBytes)) {
    throw new HTTPError(413, 'LIMIT_EXCEEDED');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw new HTTPError(413, 'LIMIT_EXCEEDED');
    chunks.push(chunk);
  }
  if (!size) throw new HTTPError(400, 'BAD_REQUEST');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HTTPError(400, 'BAD_REQUEST');
  }
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || authorization.length > 64) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);
  return match?.[1];
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function localAddress() {
  const addresses = Object.values(networkInterfaces()).flat().filter(
    (item) => item && item.family === 'IPv4' && !item.internal,
  );
  return addresses.find((item) => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./u.test(item.address))?.address
    ?? addresses[0]?.address ?? '127.0.0.1';
}

export function equalProof(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/u.test(expected) || !/^[A-Za-z0-9_-]{43}$/u.test(received)) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function probeNativeAddress(address, nonce = randomBytes(24).toString('base64url'), {
  timeoutMs = 8000,
} = {}) {
  let url;
  try {
    url = new URL(address);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    else if (url.protocol === 'wss:') url.protocol = 'https:';
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/'
      || url.username || url.password || url.search || url.hash || !NONCE.test(nonce)) {
      throw new Error('Invalid dudu address');
    }
    url.pathname = ROUTES.probe;
  } catch {
    throw new Error(nativeText('连接地址格式不正确。'));
  }
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(nativeText('连接地址未连接到这台电脑，请检查地址、TLS 证书和网络配置。'));
  }
  if (!response.ok) throw new Error(nativeText('连接地址未连接到兼容的 dudu 服务。'));
  let value;
  try { value = await response.json(); } catch { throw new Error(nativeText('探测响应格式不正确。')); }
  if (!isRecord(value) || value.protocol !== 1 || typeof value.proof !== 'string') {
    throw new Error(nativeText('连接地址未连接到兼容的 dudu 服务。'));
  }
  return value.proof;
}

export async function createNativeServer({
  host = '0.0.0.0',
  port = 3170,
  computer,
  pairingStore,
  dispatch,
  uploadFile,
  openVideo,
  onDisconnect,
  httpHandler,
  runRequest = (operation) => operation(),
  capabilities = [],
  maxClients = 32,
  maxInflightPerClient = 32,
  maxRequestBytes = MAX_REQUEST_BYTES,
  maxBufferedBytes = DEFAULT_BUFFERED_BYTES,
}) {
  if (!pairingStore || typeof pairingStore.authenticate !== 'function'
    || typeof pairingStore.proof !== 'function' || typeof dispatch !== 'function') {
    throw new TypeError('Native HTTP server requires a pairing store and business dispatcher.');
  }
  const methods = new Set(NATIVE_METHODS);
  const connections = new Map();
  let nextConnectionId = 0;
  let closed = false;

  const closeConnection = async (connection) => {
    if (!connection || connection.closed) return;
    connection.closed = true;
    connection.watchGeneration++;
    for (const transfer of connection.transfers) transfer.abort();
    clearTimeout(connection.idleTimer);
    connection.wakeEvents();
    if (connections.get(connection.deviceId) === connection) connections.delete(connection.deviceId);
    const clearWatch = connection.clearWatch;
    connection.clearWatch = undefined;
    try { await clearWatch?.(); } catch { /* A closing client owns no lasting watch. */ }
    try { await onDisconnect?.(connection); } catch { /* Cleanup must not delay HTTP shutdown. */ }
  };

  const touchConnection = (connection) => {
    connection.touchedAt = Date.now();
    clearTimeout(connection.idleTimer);
    connection.idleTimer = setTimeout(() => { void closeConnection(connection); }, IDLE_TIMEOUT_MS);
    connection.idleTimer.unref?.();
  };

  const onRevoke = pairingStore.onRevoke?.((deviceId) => {
    void closeConnection(connections.get(deviceId));
  });

  const server = http.createServer((request, response) => {
    const language = request.headers['accept-language'];
    void runRequest(() => withNativeLocale(language, () => handle(request, response)))
      .catch((error) => withNativeLocale(language, () => {
        if (response.writableEnded || response.destroyed) return;
        if (response.headersSent) { response.destroy(); return; }
        const status = error instanceof HTTPError ? error.status : 503;
        const body = errorValue(error);
        reply(response, status, { ok: false, error: body });
      }));
  });

  function makeConnection(deviceId, clientName) {
    const connection = {
      id: ++nextConnectionId,
      deviceId,
      touchedAt: Date.now(),
      clientName,
      authenticated: true,
      closed: false,
      inFlight: new Set(),
      transfers: new Set(),
      selectedSessionId: undefined,
      watchGeneration: 0,
      clearWatch: undefined,
      events: [],
      eventBytes: 0,
      eventSequence: 0,
      eventWaiters: new Set(),
      polling: false,
      idleTimer: undefined,
      sendEvent(topic, params) {
        if (typeof topic !== 'string' || connection.closed) return false;
        const event = { id: ++connection.eventSequence, topic, params };
        const bytes = Buffer.byteLength(JSON.stringify(event));
        if (bytes > maxBufferedBytes) return false;
        // A newer snapshot of a watched conversation, and a newer "the board changed", make the one still waiting for the phone's next poll pointless.
        const replaced = topic === 'session.snapshot'
          ? (item) => item.event.topic === topic && item.event.params?.watchId === params?.watchId
          : topic === 'board.changed' ? (item) => item.event.topic === topic : null;
        if (replaced) {
          const index = connection.events.findIndex(replaced);
          if (index >= 0) {
            connection.eventBytes -= connection.events[index].bytes;
            connection.events.splice(index, 1);
          }
        }
        connection.events.push({ event, bytes });
        connection.eventBytes += bytes;
        while (connection.events.length > MAX_EVENTS || connection.eventBytes > MAX_EVENT_BYTES) {
          connection.eventBytes -= connection.events.shift().bytes;
        }
        connection.wakeEvents();
        return true;
      },
      wakeEvents() {
        for (const wake of connection.eventWaiters) wake();
        connection.eventWaiters.clear();
      },
      async waitEvents(cursor, waitMs, signal) {
        if (connection.polling) throw new HTTPError(409, 'TOO_MANY_REQUESTS');
        connection.polling = true;
        try {
          const collect = () => ({
            cursor: connection.eventSequence,
            events: connection.events.filter((entry) => entry.event.id > cursor).map((entry) => entry.event),
          });
          let result = collect();
          if (result.events.length || connection.closed || waitMs === 0) return result;
          let wake;
          const changed = new Promise((resolve) => {
            wake = resolve;
            connection.eventWaiters.add(wake);
          });
          let timer;
          const timeout = new Promise((resolve) => {
            timer = setTimeout(resolve, waitMs);
            timer.unref?.();
          });
          const aborted = new Promise((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', resolve, { once: true });
          });
          await Promise.race([changed, timeout, aborted]);
          clearTimeout(timer);
          connection.eventWaiters.delete(wake);
          result = collect();
          return result;
        } finally {
          connection.polling = false;
        }
      },
      beginWatch() {
        const generation = ++connection.watchGeneration;
        const previous = connection.clearWatch;
        connection.clearWatch = undefined;
        if (previous) void Promise.resolve(previous()).catch(() => {});
        return generation;
      },
      setWatch(cancel, generation = connection.watchGeneration) {
        if (connection.closed || generation !== connection.watchGeneration) {
          void Promise.resolve(cancel?.()).catch(() => {});
          return false;
        }
        const previous = connection.clearWatch;
        connection.clearWatch = typeof cancel === 'function' ? cancel : undefined;
        if (previous && previous !== cancel) void Promise.resolve(previous()).catch(() => {});
        return true;
      },
      async stopWatch() {
        connection.watchGeneration++;
        const cancel = connection.clearWatch;
        connection.clearWatch = undefined;
        await cancel?.();
      },
    };
    touchConnection(connection);
    return connection;
  }

  async function authenticate(request) {
    const token = bearerToken(request);
    if (!token) throw new HTTPError(401, 'AUTH_FAILED');
    let deviceId;
    try { deviceId = await pairingStore.authenticate(token, request.headers['x-dudu-client'] === 'android' ? 'Android' : 'iPhone'); }
    catch { throw new HTTPError(503, 'UPSTREAM_UNAVAILABLE'); }
    if (!deviceId) throw new HTTPError(401, 'AUTH_FAILED');
    return deviceId;
  }

  async function handle(request, response) {
    let url;
    try { url = new URL(request.url ?? '/', 'http://dudu.local'); }
    catch { throw new HTTPError(400, 'BAD_REQUEST'); }

    if (url.pathname === ROUTES.probe) {
      if (request.method !== 'POST') throw new HTTPError(405, 'METHOD_NOT_ALLOWED');
      const body = await readJson(request, MAX_PREAUTH_BYTES);
      if (!isRecord(body) || typeof body.nonce !== 'string' || !NONCE.test(body.nonce)) {
        throw new HTTPError(400, 'BAD_REQUEST');
      }
      if (body.deviceId !== undefined) {
        if (typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(body.deviceId)) {
          throw new HTTPError(400, 'BAD_REQUEST');
        }
        const identity = pairingStore.routeProof?.(body.deviceId, body.nonce);
        if (!identity) throw new HTTPError(401, 'AUTH_FAILED');
        reply(response, 200, { protocol: 1, ...identity });
      } else {
        reply(response, 200, { protocol: 1, proof: pairingStore.proof(body.nonce) });
      }
      return;
    }

    if (Object.values(ROUTES).includes(url.pathname) && request.method !== 'POST') {
      throw new HTTPError(405, 'METHOD_NOT_ALLOWED');
    }

    if (url.pathname === ROUTES.connect) {
      const deviceId = await authenticate(request);
      if (connections.size >= maxClients && !connections.has(deviceId)) {
        throw new HTTPError(429, 'TOO_MANY_REQUESTS');
      }
      // What the app says about itself, if it says anything: an app that predates this sends no body at all (see native-client.mjs).
      const declared = await readJson(request, MAX_PREAUTH_BYTES).catch(() => ({}));
      await closeConnection(connections.get(deviceId));
      const clientName = request.headers['x-dudu-client'] === 'android' ? 'Android' : 'iPhone';
      const connection = makeConnection(deviceId, clientName);
      connection.client = cleanClient(declared, clientName === 'Android' ? 'android' : 'ios');
      pairingStore.recordClient?.(deviceId, connection.client);
      connections.set(deviceId, connection);
      const readyComputer = typeof computer === 'function' ? computer() : computer;
      reply(response, 200, {
        type: 'ready', protocol: 1, computer: readyComputer, deviceId,
        capabilities: ['session.watch', 'attachment.image', ...capabilities],
      });
      return;
    }

    if (url.pathname === ROUTES.disconnect) {
      const deviceId = await authenticate(request);
      await closeConnection(connections.get(deviceId));
      reply(response, 200, { ok: true, result: {} });
      return;
    }

    if (url.pathname === ROUTES.events) {
      const deviceId = await authenticate(request);
      const connection = connections.get(deviceId);
      if (!connection || connection.closed) throw new HTTPError(409, 'DISCONNECTED');
      touchConnection(connection);
      const body = await readJson(request, MAX_PREAUTH_BYTES);
      if (!isRecord(body) || !Number.isSafeInteger(body.cursor) || body.cursor < 0
        || !Number.isSafeInteger(body.waitMs) || body.waitMs < 0 || body.waitMs > MAX_POLL_MS) {
        throw new HTTPError(400, 'BAD_REQUEST');
      }
      const abort = new AbortController();
      response.once('close', () => abort.abort());
      request.once('aborted', () => abort.abort());
      const result = await connection.waitEvents(body.cursor, body.waitMs, abort.signal);
      if (!response.destroyed) reply(response, 200, result);
      return;
    }

    if (url.pathname === ROUTES.upload || url.pathname === ROUTES.video) {
      const deviceId = await authenticate(request);
      const connection = connections.get(deviceId);
      if (!connection || connection.closed) throw new HTTPError(409, 'DISCONNECTED');
      const id = request.headers['x-dudu-request-id'];
      if (typeof id !== 'string' || !REQUEST_ID.test(id)) throw new HTTPError(400, 'BAD_REQUEST');
      if (connection.inFlight.has(id)) throw new HTTPError(409, 'DUPLICATE_REQUEST');
      if (connection.inFlight.size >= maxInflightPerClient || connection.transfers.size >= 4) {
        throw new HTTPError(429, 'TOO_MANY_REQUESTS');
      }
      const abort = new AbortController();
      const cancel = () => { if (!response.writableFinished) abort.abort(); };
      connection.inFlight.add(id);
      connection.transfers.add(abort);
      response.once('close', cancel);
      request.once('aborted', cancel);
      touchConnection(connection);
      try {
        if (url.pathname === ROUTES.upload) {
          if (typeof uploadFile !== 'function') throw new HTTPError(400, 'UNSUPPORTED');
          if (String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/octet-stream'
            || [...url.searchParams.keys()].some((key) => !['id', 'name'].includes(key))) throw new HTTPError(400, 'BAD_REQUEST');
          const expected = request.headers['content-length'];
          if (expected !== undefined && (!/^\d+$/u.test(expected) || !Number.isSafeInteger(Number(expected)) || Number(expected) < 1)) {
            throw new HTTPError(400, 'BAD_REQUEST');
          }
          const data = (async function* () {
            let bytes = 0;
            for await (const chunk of request) {
              abort.signal.throwIfAborted();
              if (connection.closed) throw new HTTPError(409, 'DISCONNECTED');
              bytes += chunk.byteLength;
              if (!Number.isSafeInteger(bytes)) throw new HTTPError(413, 'LIMIT_EXCEEDED');
              touchConnection(connection);
              yield chunk;
            }
            if (!bytes || expected !== undefined && bytes !== Number(expected)) throw new HTTPError(400, 'BAD_REQUEST');
          })();
          const result = await uploadFile({ id: url.searchParams.get('id'), name: url.searchParams.get('name') }, data, connection, abort.signal);
          reply(response, 200, { id, ok: true, result });
        } else {
          if (typeof openVideo !== 'function') throw new HTTPError(400, 'UNSUPPORTED');
          const params = await readJson(request, MAX_PREAUTH_BYTES);
          if (!isRecord(params)) throw new HTTPError(400, 'BAD_REQUEST');
          const video = await openVideo(params, connection, abort.signal);
          response.writeHead(200, {
            'content-type': video.mediaType, 'x-dudu-file-bytes': String(video.bytes),
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
          });
          const data = (async function* () {
            for await (const chunk of video.data) {
              abort.signal.throwIfAborted();
              touchConnection(connection);
              yield chunk;
            }
          })();
          await pipeline(Readable.from(data), response, { signal: abort.signal });
        }
      } catch (error) {
        if (response.headersSent) { response.destroy(); return; }
        if (response.destroyed) return;
        reply(response, error instanceof HTTPError ? error.status : 200, { id, ok: false, error: errorValue(error) });
      } finally {
        response.off('close', cancel);
        request.off('aborted', cancel);
        abort.abort();
        connection.inFlight.delete(id);
        connection.transfers.delete(abort);
      }
      return;
    }

    if (url.pathname === ROUTES.request) {
      const deviceId = await authenticate(request);
      const connection = connections.get(deviceId);
      if (!connection || connection.closed) throw new HTTPError(409, 'DISCONNECTED');
      touchConnection(connection);
      const body = await readJson(request, maxRequestBytes);
      if (!isRecord(body) || typeof body.id !== 'string' || !REQUEST_ID.test(body.id)
        || typeof body.method !== 'string' || !isRecord(body.params)) {
        throw new HTTPError(400, 'BAD_REQUEST');
      }
      if (connection.inFlight.has(body.id)) {
        reply(response, 200, {
          id: body.id, ok: false,
          error: { code: 'DUPLICATE_REQUEST', message: SAFE_ERRORS.DUPLICATE_REQUEST },
        });
        return;
      }
      if (!methods.has(body.method)) {
        reply(response, 200, {
          id: body.id, ok: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: SAFE_ERRORS.METHOD_NOT_ALLOWED },
        });
        return;
      }
      if (connection.inFlight.size >= maxInflightPerClient) {
        throw new HTTPError(429, 'TOO_MANY_REQUESTS');
      }
      connection.inFlight.add(body.id);
      try {
        const watchGeneration = body.method === 'session.watch' ? connection.beginWatch() : undefined;
        const result = await dispatch(body.method, body.params, connection, { watchGeneration });
        if (!response.destroyed) reply(response, 200, { id: body.id, ok: true, result: result ?? {} });
      } catch (error) {
        if (!response.destroyed) reply(response, 200, { id: body.id, ok: false, error: errorValue(error) });
      } finally {
        connection.inFlight.delete(body.id);
      }
      return;
    }

    if (typeof httpHandler === 'function'
      && await httpHandler(request, response)) return;
    if (response.writableEnded || response.destroyed) return;
    throw new HTTPError(404, 'NOT_FOUND');
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const addressInfo = server.address();
  const address = `http://${host.includes(':') ? `[${host}]` : host}:${addressInfo.port}`;
  return {
    server,
    address,
    port: addressInfo.port,
    /** Whether this phone's App is in front: it asked this computer for something within the last 45 seconds. */
    isLive(deviceId) {
      const connection = connections.get(deviceId);
      return Boolean(connection && !connection.closed && Date.now() - connection.touchedAt < LIVE_WINDOW_MS);
    },
    /** One event for every connected phone `accepts` (an app that did not declare what the event is for is never sent it: native-client.mjs). */
    broadcast(topic, params, accepts = () => true) {
      for (const connection of connections.values()) {
        if (!connection.closed && connection.authenticated && accepts(connection)) connection.sendEvent(topic, params);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      onRevoke?.();
      await Promise.all([...connections.values()].map((connection) => closeConnection(connection)));
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
