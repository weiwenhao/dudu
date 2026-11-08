import { Buffer } from 'node:buffer';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const OPEN_PATH = '/dsbot/web/open';
const PAGE_PREFIX = '/dsbot/ui/';
const PLUGIN_ROUTE = 'api/dudu/';
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const PAGE_PATH = /^\/dsbot\/ui\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.*)$/u;
const MAX_BODY_BYTES = 1024 * 1024;
const digest = (value) => createHash('sha256').update(value).digest();
const gzipBytes = promisify(gzip);

function acceptsGzip(header) {
  const codings = String(header ?? '').split(',').map((item) => item.toLowerCase().split(';').map((part) => part.trim()));
  const coding = codings.find(([name]) => name === 'gzip') ?? codings.find(([name]) => name === '*');
  if (!coding) return false;
  const quality = coding.slice(1).find((part) => part.startsWith('q='));
  return quality === undefined || Number(quality.slice(2)) > 0 && Number(quality.slice(2)) <= 1;
}

class PageHttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function responseJSON(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(status === 401 ? { 'www-authenticate': 'Bearer realm="dsbot-pages"' } : {}),
  });
  response.end(body);
}

async function readJSON(request, limit, timeoutMs) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? '')) {
    throw new PageHttpError(415, 'BAD_REQUEST');
  }
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > limit)) {
    throw new PageHttpError(413, 'LIMIT_EXCEEDED');
  }
  const text = await new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener('data', data);
      request.removeListener('end', end);
      request.removeListener('error', fail);
      request.removeListener('aborted', aborted);
    };
    const fail = (error) => { cleanup(); reject(error); };
    const aborted = () => fail(new PageHttpError(400, 'BAD_REQUEST'));
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        request.pause();
        fail(new PageHttpError(413, 'LIMIT_EXCEEDED'));
      } else {
        chunks.push(chunk);
      }
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, bytes).toString('utf8')); };
    const timer = setTimeout(() => {
      request.pause();
      fail(new PageHttpError(408, 'BAD_REQUEST'));
    }, timeoutMs);
    timer.unref();
    request.on('data', data);
    request.once('end', end);
    request.once('error', fail);
    request.once('aborted', aborted);
  });
  let value;
  try { value = JSON.parse(text); } catch { throw new PageHttpError(400, 'BAD_REQUEST'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PageHttpError(400, 'BAD_REQUEST');
  }
  return value;
}

function bearer(request) {
  const count = request.rawHeaders.reduce((sum, value, index) =>
    sum + (index % 2 === 0 && value.toLowerCase() === 'authorization' ? 1 : 0), 0);
  if (count !== 1) throw new PageHttpError(401, 'AUTH_REQUIRED');
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(request.headers.authorization ?? '')?.[1];
  if (!token) throw new PageHttpError(401, 'AUTH_FAILED');
  return token;
}

function pageCookie(request) {
  const values = String(request.headers.cookie ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith('dsbot_ui='));
  if (values.length !== 1) throw new PageHttpError(401, 'AUTH_REQUIRED');
  const value = values[0].slice('dsbot_ui='.length);
  if (!TOKEN.test(value)) throw new PageHttpError(401, 'AUTH_FAILED');
  return value;
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  try {
    const value = new URL(origin);
    const target = new URL(`${value.protocol}//${request.headers.host}/`);
    if (!['http:', 'https:'].includes(value.protocol) || value.origin !== target.origin
      || value.pathname !== '/' || value.search || value.hash || value.username || value.password) {
      throw new Error('Invalid origin');
    }
  } catch { throw new PageHttpError(403, 'AUTH_REQUIRED'); }
}

export function createWebPageHttp({
  pages,
  pairingStore,
  /** 嘟嘟's own pages (phone-pages.mjs): the plugin actions they may ask for. */
  duduPages,
  maxPages = 32,
  maxPagesPerDevice = 8,
  maxInflightPerPage = 32,
  maxBodyBytesInFlight = 8 * MAX_BODY_BYTES,
  maxBodyBytesPerDevice = 2 * MAX_BODY_BYTES,
  idleMs = 10 * 60_000,
  bodyTimeoutMs = 10_000,
} = {}) {
  if (!pages || typeof pages.openHttp !== 'function' || typeof pages.documentHttp !== 'function'
    || typeof pages.resourceHttp !== 'function' || typeof pages.dispatch !== 'function'
    || typeof pages.closeConnection !== 'function' || typeof pairingStore?.authenticate !== 'function') {
    throw new TypeError('HTTP pages require scoped pages and the pairing registry.');
  }
  const sessions = new Map();
  const revokedDevices = new Set();
  const deviceOpens = new Map();
  const openings = new Set();
  const connectionCleanup = new WeakMap();
  const deviceBodyBytes = new Map();
  const closing = new Set();
  let bodyBytes = 0;
  let pendingOpen = 0;
  let closed = false;
  const methods = new Set([
    'web.invoke', 'web.stream.open', 'web.stream.next', 'web.stream.close', 'web.close',
  ]);

  function disposeConnection(connection) {
    const previous = connectionCleanup.get(connection);
    if (previous) return previous;
    connection.closed = true;
    const pending = Promise.resolve().then(() => pages.closeConnection(connection)).finally(() => {
      closing.delete(pending);
    });
    connectionCleanup.set(connection, pending);
    closing.add(pending);
    return pending;
  }

  function closeSession(session) {
    if (session.closePromise) return session.closePromise;
    sessions.delete(session.id);
    clearTimeout(session.timer);
    for (const response of session.responses) {
      responseJSON(response, 410, { error: { code: 'NOT_FOUND', message: '页面已关闭。' } });
    }
    session.responses.clear();
    session.closePromise = disposeConnection(session.connection);
    return session.closePromise;
  }

  function reserveBody(request, deviceId) {
    const length = request.headers['content-length'];
    if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) {
      throw new PageHttpError(413, 'LIMIT_EXCEEDED');
    }
    // Unknown-length requests reserve their full allowance until the operation finishes.
    const bytes = length === undefined ? MAX_BODY_BYTES : Math.max(4096, Number(length));
    const perDevice = deviceBodyBytes.get(deviceId) ?? 0;
    if (bodyBytes + bytes > maxBodyBytesInFlight || perDevice + bytes > maxBodyBytesPerDevice) {
      throw new PageHttpError(429, 'LIMIT_EXCEEDED');
    }
    bodyBytes += bytes;
    deviceBodyBytes.set(deviceId, perDevice + bytes);
    return () => {
      bodyBytes -= bytes;
      const remaining = (deviceBodyBytes.get(deviceId) ?? bytes) - bytes;
      if (remaining) deviceBodyBytes.set(deviceId, remaining);
      else deviceBodyBytes.delete(deviceId);
    };
  }

  function touch(session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void closeSession(session).catch(() => {}); }, idleMs);
    session.timer.unref();
  }

  async function open(request, response) {
    if (request.method !== 'POST') throw new PageHttpError(404, 'NOT_FOUND');
    if (request.headers.origin !== undefined) throw new PageHttpError(403, 'AUTH_REQUIRED');
    const token = bearer(request);
    if (pendingOpen + sessions.size >= maxPages) throw new PageHttpError(429, 'LIMIT_EXCEEDED');
    pendingOpen++;
    let connection;
    let opening;
    let openingDevice;
    let published = false;
    try {
      const params = await readJSON(request, 4096, bodyTimeoutMs);
      const deviceId = await pairingStore.authenticate(token, 'iPhone');
      if (!deviceId || revokedDevices.has(deviceId)) throw new PageHttpError(401, 'AUTH_FAILED');
      const deviceCount = [...sessions.values()].filter((item) => item.connection.deviceId === deviceId).length
        + (deviceOpens.get(deviceId) ?? 0);
      if (deviceCount >= maxPagesPerDevice) {
        throw new PageHttpError(429, 'LIMIT_EXCEEDED');
      }
      if (closed || response.destroyed) throw new PageHttpError(503, 'UPSTREAM_UNAVAILABLE');
      openingDevice = deviceId;
      deviceOpens.set(deviceId, (deviceOpens.get(deviceId) ?? 0) + 1);
      connection = { authenticated: true, deviceId, closed: false };
      let cancel;
      const cancelled = new Promise((_, reject) => { cancel = reject; });
      opening = { connection, cancel };
      openings.add(opening);
      const document = await Promise.race([pages.openHttp(params, connection), cancelled]);
      if (revokedDevices.has(deviceId)) throw new PageHttpError(401, 'AUTH_FAILED');
      if (closed || response.destroyed) throw new PageHttpError(503, 'UPSTREAM_UNAVAILABLE');
      const cookie = randomBytes(32).toString('base64url');
      const session = {
        id: document.id, cookieHash: digest(cookie), connection, inflight: 0, responses: new Set(), kind: params.page,
      };
      sessions.set(session.id, session);
      published = true;
      touch(session);
      responseJSON(response, 200, {
        id: session.id, path: `${PAGE_PREFIX}${session.id}/`, cookie, computerId: pairingStore.id,
      });
    } finally {
      pendingOpen--;
      if (opening) openings.delete(opening);
      if (openingDevice) {
        const count = (deviceOpens.get(openingDevice) ?? 1) - 1;
        if (count) deviceOpens.set(openingDevice, count);
        else deviceOpens.delete(openingDevice);
      }
      if (connection && !published) {
        await disposeConnection(connection);
      }
    }
  }

  const revoke = pairingStore.onRevoke?.((deviceId) => {
    revokedDevices.add(deviceId);
    for (const opening of openings) {
      if (opening.connection.deviceId === deviceId) {
        opening.cancel(new PageHttpError(401, 'AUTH_FAILED'));
        void disposeConnection(opening.connection).catch(() => {});
      }
    }
    for (const session of sessions.values()) {
      if (session.connection.deviceId === deviceId) void closeSession(session).catch(() => {});
    }
  });

  return Object.freeze({
    async handle(request, response) {
      const raw = request.url ?? '';
      if (raw !== OPEN_PATH && !raw.startsWith(`${OPEN_PATH}?`) && !raw.startsWith(PAGE_PREFIX)) return false;
      try {
        if (closed) throw new PageHttpError(503, 'UPSTREAM_UNAVAILABLE');
        if (raw === OPEN_PATH) {
          await open(request, response);
          return true;
        }
        if (/[\u0000-\u0020\u007f\\#]/u.test(raw)) throw new PageHttpError(404, 'NOT_FOUND');
        const [pathname] = raw.split('?', 1);
        const match = PAGE_PATH.exec(pathname);
        if (!match) throw new PageHttpError(404, 'NOT_FOUND');
        const session = sessions.get(match[1]);
        const cookie = pageCookie(request);
        if (!session || !timingSafeEqual(digest(cookie), session.cookieHash)) {
          throw new PageHttpError(401, 'AUTH_FAILED');
        }
        requireSameOrigin(request);
        if (session.inflight >= maxInflightPerPage) throw new PageHttpError(429, 'LIMIT_EXCEEDED');
        touch(session);
        session.inflight++;
        session.responses.add(response);
        let releaseBody;
        try {
          const resource = match[2];
          if (resource === 'rpc') {
            if (request.method !== 'POST' || raw !== pathname || request.headers['x-dsbot-page'] !== '1') {
              throw new PageHttpError(400, 'BAD_REQUEST');
            }
            releaseBody = reserveBody(request, session.connection.deviceId);
            const call = await readJSON(request, MAX_BODY_BYTES, bodyTimeoutMs);
            if (session.connection.closed) throw new PageHttpError(410, 'NOT_FOUND');
            if (Object.keys(call).some((key) => !['method', 'params'].includes(key))
              || !methods.has(call.method) || !call.params || typeof call.params !== 'object'
              || Array.isArray(call.params) || Object.hasOwn(call.params, 'id')) {
              throw new PageHttpError(400, 'BAD_REQUEST');
            }
            const value = await pages.dispatch(call.method, { ...call.params, id: session.id }, session.connection);
            responseJSON(response, 200, value);
            if (call.method === 'web.close') {
              session.responses.delete(response);
              await closeSession(session);
            }
          } else if (resource.startsWith(PLUGIN_ROUTE)) {
            // A page of 嘟嘟's own asks the plugin for one of the actions its settings pages use; no other kind of page may, and nothing outside the list.
            const action = resource.slice(PLUGIN_ROUTE.length);
            if (request.method !== 'POST' || raw !== pathname || request.headers['x-dsbot-page'] !== '1'
              || session.kind !== 'dudu' || !duduPages?.allowed(action)) throw new PageHttpError(404, 'NOT_FOUND');
            releaseBody = reserveBody(request, session.connection.deviceId);
            const body = await readJSON(request, MAX_BODY_BYTES, bodyTimeoutMs);
            if (session.connection.closed) throw new PageHttpError(410, 'NOT_FOUND');
            const answer = await duduPages.call(action, body);
            responseJSON(response, answer.status, answer.body);
          } else {
            if (request.method !== 'GET') throw new PageHttpError(404, 'NOT_FOUND');
            let mimeType;
            let data;
            if (!resource) {
              if (raw !== pathname) throw new PageHttpError(404, 'NOT_FOUND');
              mimeType = 'text/html; charset=utf-8';
              data = Buffer.from(await pages.documentHttp({ id: session.id }, session.connection));
            } else {
              ({ mimeType, data } = await pages.resourceHttp({ id: session.id, path: raw }, session.connection));
            }
            let encoded = data;
            if (data.byteLength >= 1024 && acceptsGzip(request.headers['accept-encoding'])
              && /^(?:text\/(?:html|css|javascript)|application\/(?:javascript|json)|image\/svg\+xml)(?:;|$)/iu.test(mimeType)) {
              const compressed = await gzipBytes(data);
              if (compressed.byteLength < data.byteLength) encoded = compressed;
            }
            if (!response.destroyed && !response.writableEnded) {
              response.writeHead(200, {
                'content-type': mimeType,
                'content-length': encoded.byteLength,
                ...(encoded !== data ? { 'content-encoding': 'gzip' } : {}),
                vary: 'Accept-Encoding',
                'cache-control': 'no-store',
                'content-security-policy': "frame-ancestors 'none'",
                'x-content-type-options': 'nosniff',
                'referrer-policy': 'no-referrer',
              });
              response.end(encoded);
            }
          }
        } finally {
          releaseBody?.();
          session.inflight--;
          session.responses.delete(response);
        }
      } catch (error) {
        const code = ['BAD_REQUEST', 'NOT_FOUND', 'LIMIT_EXCEEDED', 'AUTH_REQUIRED', 'AUTH_FAILED']
          .includes(error?.code) ? error.code : 'UPSTREAM_UNAVAILABLE';
        const status = error instanceof PageHttpError ? error.status
          : { BAD_REQUEST: 400, NOT_FOUND: 404, LIMIT_EXCEEDED: 413 }[code] ?? 503;
        if (!request.complete && !response.headersSent) response.setHeader('connection', 'close');
        responseJSON(response, status, { error: { code, message: status === 401 ? '请重新连接电脑。' : '页面请求未能完成。' } });
      }
      return true;
    },
    async close() {
      if (closed) return;
      closed = true;
      revoke?.();
      for (const opening of openings) {
        opening.cancel(new PageHttpError(503, 'UPSTREAM_UNAVAILABLE'));
        void disposeConnection(opening.connection).catch(() => {});
      }
      await Promise.allSettled([...sessions.values()].map(closeSession));
      await Promise.allSettled([...closing]);
    },
  });
}
