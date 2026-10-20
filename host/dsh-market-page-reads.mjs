import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';

const ROUTES = Object.freeze({
  'dshMarket/registry': '/dsh-market/registry',
  'dshMarket/installed': '/dsh-market/installed',
  'dshMarket/status': '/dsh-market/status',
  'dshMarket/updates': '/dsh-market/updates',
  'dshMarket/bundleOrder': '/dsh-market/bundle-order',
  'dshMarket/presets': '/dsh-market/presets',
  'dshMarket/snapshots': '/dsh-market/snapshots',
  'dshMarket/hostRecovery': '/dsh-market/host-recovery',
});
export const MARKET_PAGE_READ_METHODS = Object.freeze(Object.keys(ROUTES));
const MAX_REPLY_BYTES = 6 * 1024 * 1024;
const MAX_CATALOG_BYTES = 24 * 1024 * 1024;
const CATALOG_FIELDS = new Set([
  'name', 'owner', 'url', 'npm', 'tarball', 'category', 'stars', 'downloads',
  'downloadsStart', 'downloadsEnd', 'downloadsCheckedAt', 'version', 'added',
  'install', 'deprecated', 'replacement', 'capabilities', 'capabilityRedLines',
  'capabilityCheckedAt', 'screenshots',
]);
const STATUS_FIELDS = new Set([
  'active', 'target', 'seconds', 'phase', 'done', 'total', 'currentPackage',
  'downloaded', 'size', 'cancelling', 'busy', 'runningAgents', 'pnpm', 'boot',
  'agentGuardAvailable', 'version', 'channel', 'channels', 'region', 'regions',
  'githubProxy', 'githubRoutes', 'githubProxyCustom', 'githubProxyManaged',
  'regionAuto', 'selfManaged', 'settingsNamespace', 'installed',
]);
const failure = (code = 'gateway/unavailable') => ({
  ok: false, error: { code, message: '插件市场暂时无法读取。', details: {} },
});

class MemoryResponse extends Writable {
  constructor(limit) {
    super();
    this.limit = limit;
    this.statusCode = 200;
    this.headersSent = false;
    this.headers = new Map();
    this.chunks = [];
    this.bytes = 0;
  }
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); return this; }
  getHeader(name) { return this.headers.get(name.toLowerCase()); }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    this.headersSent = true;
    return this;
  }
  _write(chunk, encoding, callback) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.bytes += data.length;
    if (this.bytes > this.limit) { callback(new Error('Market reply exceeds the page budget.')); return; }
    this.chunks.push(data);
    callback();
  }
}

function request(origin, path, cookie) {
  const req = new IncomingMessage(new Socket());
  req.method = 'GET';
  req.url = path;
  req.headers = { host: origin.host };
  if (cookie) req.headers.cookie = cookie;
  return req;
}

function ownerCookie(connection, origin) {
  const authenticated = new URL(connection.authenticatedUrl(`${origin.origin}/`));
  if (authenticated.origin !== origin.origin || authenticated.pathname !== '/'
    || authenticated.username || authenticated.password || authenticated.hash) throw new Error('Invalid owner origin.');
  const req = request(origin, `${authenticated.pathname}${authenticated.search}`);
  const res = new MemoryResponse(16 * 1024);
  res.on('error', () => {});
  try {
    connection.authorizeIndex(req, res);
    const header = res.getHeader('set-cookie');
    const cookies = typeof header === 'string' ? [header] : header;
    if (res.statusCode !== 303 || !Array.isArray(cookies) || cookies.length !== 1
      || typeof cookies[0] !== 'string') throw new Error('Owner admission unavailable.');
    const cookie = cookies[0].split(';', 1)[0];
    if (!cookie || !cookie.includes('=') || /[\r\n]/u.test(cookie)) throw new Error('Invalid owner admission.');
    return cookie;
  } finally {
    req.destroy();
    res.destroy();
  }
}

function catalogBody(body) {
  const registry = body?.registry;
  if (!registry || !Array.isArray(registry.plugins)) throw new Error('Invalid catalog.');
  const localized = (value) => Object.fromEntries(['zh', 'en']
    .filter((key) => typeof value?.[key] === 'string').map((key) => [key, value[key].slice(0, 2048)]));
  return {
    hostVersion: typeof body.hostVersion === 'string' ? body.hostVersion : null,
    registry: {
      updated: registry.updated,
      count: registry.count,
      categories: Object.fromEntries(Object.entries(registry.categories ?? {})
        .map(([key, value]) => [key, localized(value)])),
      plugins: registry.plugins.map((plugin) => ({
        ...Object.fromEntries(Object.entries(plugin).filter(([key]) => CATALOG_FIELDS.has(key))),
        description: localized(plugin.description),
      })),
    },
  };
}

export function createDshMarketPageReads({ connection, webServer, peer, timeoutMs = 15_000, onDiagnostic }) {
  if (peer?.principal?.kind !== 'owner') throw new TypeError('Market pages require an owner-scoped peer.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive safe integer.');
  return Object.freeze({
    async invoke(endpoint, args, signal) {
      if (!Object.hasOwn(ROUTES, endpoint) || !args || typeof args !== 'object'
        || Array.isArray(args) || Object.keys(args).length) throw new Error('Unsupported market page read.');
      if (typeof webServer?.match !== 'function' || typeof webServer.getOrigin !== 'function'
        || typeof connection?.authenticatedUrl !== 'function'
        || typeof connection.authorizeIndex !== 'function' || typeof connection.admit !== 'function') {
        return failure('gateway/not-found');
      }
      if (signal?.aborted) return failure();
      const inputLimit = endpoint === 'dshMarket/registry' ? MAX_CATALOG_BYTES : MAX_REPLY_BYTES;
      const res = new MemoryResponse(inputLimit);
      let req;
      let timer;
      let abort;
      let stage = 'origin';
      try {
        let originText;
        try { originText = webServer.getOrigin(); } catch {
          // Desktop can own routes without binding its web listener.
          originText = `${webServer.protocol === 'https:' ? 'https:' : 'http:'}//127.0.0.1`;
        }
        const origin = new URL(originText);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
          || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Invalid host origin.');
        const path = ROUTES[endpoint];
        stage = 'route';
        const route = webServer.match(path);
        if (route?.kind !== 'exact' || route.path !== path || typeof route.handler !== 'function') {
          return failure('gateway/not-found');
        }
        // The real host admits an owner in memory; no HTTP socket or credential reaches the page.
        stage = 'cookie';
        req = request(origin, path, ownerCookie(connection, origin));
        stage = 'admission';
        const admission = connection.admit(req);
        if (admission?.peer?.principal?.kind !== 'owner' || Object.hasOwn(admission, 'rejection')) {
          throw new Error('Owner admission refused.');
        }
        const finished = new Promise((resolve, reject) => {
          res.once('finish', resolve);
          res.once('error', reject);
          abort = () => reject(new Error('Market page read stopped.'));
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(abort, timeoutMs);
          if (signal?.aborted) abort();
        });
        stage = 'handler';
        await Promise.all([
          Promise.resolve().then(() => {
            if (signal?.aborted) throw new Error('Market page read stopped.');
            return route.handler(req, res);
          }),
          finished,
        ]);
        stage = 'response';
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return { ok: true, value: {
            status: res.statusCode,
            body: { ok: false, error: '此项目暂时无法读取，请在电脑端查看。' },
          } };
        }
        let body = JSON.parse(Buffer.concat(res.chunks, Math.min(res.bytes, inputLimit)).toString('utf8'));
        if (endpoint === 'dshMarket/registry') body = catalogBody(body);
        if (endpoint === 'dshMarket/status') {
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid market status.');
          body = Object.fromEntries(Object.entries(body).filter(([key]) => STATUS_FIELDS.has(key)));
          body.restart = false;
          body.restartReachable = false;
        }
        const result = { ok: true, value: { status: res.statusCode, body } };
        if (Buffer.byteLength(JSON.stringify(result)) > MAX_REPLY_BYTES) throw new Error('Market reply exceeds the page budget.');
        return result;
      } catch (error) {
        try { onDiagnostic?.(stage, error); } catch {}
        return failure();
      } finally {
        clearTimeout(timer);
        if (abort) signal?.removeEventListener('abort', abort);
        req?.destroy();
        res.destroy();
      }
    },
  });
}
