import { randomUUID } from 'node:crypto';
import {
  initializePagePolicy, allowPageCall, acceptPageResult, acceptPageUplink, pageStreamItem, isDuplexStream,
} from './native-page-policy.mjs';

export const NATIVE_PAGE_METHODS = Object.freeze([
  'web.open',
  'web.resource',
  'web.invoke',
  'web.close',
  'web.stream.open',
  'web.stream.next',
  'web.stream.send',
  'web.stream.close',
]);

const PAGE_KINDS = new Set(['plugins', 'trace', 'context', 'team', 'tools', 'settings', 'panel', 'view', 'dock']);
// Pages that belong to one conversation, and pages named by an id DSH registered (see native-navigation).
const SESSION_PAGE_KINDS = new Set(['trace', 'context', 'team', 'tools', 'view', 'dock']);
const TARGET_REQUIRED = new Set(['panel', 'view', 'dock']);
const TARGET_ALLOWED = new Set(['panel', 'view', 'dock', 'settings']);
const TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$/u;
const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES = 8;
const MAX_STREAMS_PER_PAGE = 12;
const MAX_STREAMS_PER_CONNECTION = 24;
const RESOURCE_CHUNK_BYTES = 192 * 1024;
const MAX_RESOURCE_BYTES = 40 * 1024 * 1024;
const MAX_PAGE_RESOURCE_BYTES = 128 * 1024 * 1024;
const MAX_RESOURCE_COUNT = 256;
const MAX_REPLY_BYTES = 6 * 1024 * 1024;
const RESOURCE_TIMEOUT_MS = 30_000;
const STREAM_NEXT_TIMEOUT_MS = 25_000;
const STREAM_IDLE_TIMEOUT_MS = 10 * 60_000;
// A terminal's output arrives as many small frames; one reply carries what is already waiting.
const BATCHED_STREAMS = new Set(['terminal/attach']);
const BATCH_MAX_ITEMS = 64;
const BATCH_MAX_BYTES = 384 * 1024;
// What the page may have queued for a duplex stream that the desktop has not yet read.
const UPLINK_MAX_ITEMS = 1024;
const UPLINK_MAX_BYTES = 2 * 1024 * 1024;
const SEND_MAX_ITEMS = 64;

const SAFE_ERRORS = Object.freeze({
  BAD_REQUEST: '请求参数不正确。',
  NOT_FOUND: '找不到此嵌入页面。',
  LIMIT_EXCEEDED: '页面请求过多，请稍后重试。',
  UPSTREAM_UNAVAILABLE: '电脑暂时无法完成请求。',
});

export class NativePagesError extends Error {
  constructor(code) {
    super(SAFE_ERRORS[code] ?? SAFE_ERRORS.UPSTREAM_UNAVAILABLE);
    this.name = 'NativePagesError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'UPSTREAM_UNAVAILABLE';
  }
}

const fail = (code) => { throw new NativePagesError(code); };

/**
 * The page's half of a duplex stream, read by the Gateway as the method's uplink: one reader, bounded,
 * ended by the page or dropped when the stream is released.
 */
function createUplink() {
  const queue = [];
  const waiters = new Set();
  let bytes = 0;
  let ended = false;
  let closed = false;
  const wake = () => {
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };
  const done = () => ({ done: true, value: undefined });
  return {
    push(item) {
      if (closed || ended) fail('NOT_FOUND');
      const size = Buffer.byteLength(JSON.stringify(item), 'utf8');
      if (queue.length >= UPLINK_MAX_ITEMS || bytes + size > UPLINK_MAX_BYTES) fail('LIMIT_EXCEEDED');
      queue.push({ item, size });
      bytes += size;
      wake();
    },
    end() {
      ended = true;
      wake();
    },
    close() {
      closed = true;
      queue.length = 0;
      bytes = 0;
      wake();
    },
    [Symbol.asyncIterator]() { return this; },
    async next() {
      for (;;) {
        if (closed) return done();
        const entry = queue.shift();
        if (entry) {
          bytes -= entry.size;
          return { done: false, value: entry.item };
        }
        if (ended) return done();
        await new Promise((resolve) => { waiters.add(resolve); });
      }
    },
    return() {
      this.close();
      return Promise.resolve(done());
    },
  };
}
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, keys) => isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
const validSessionID = (value) => typeof value === 'string' && value.trim().length > 0
  && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);

function requireParams(params, keys) {
  if (!keysAre(params, keys)) fail('BAD_REQUEST');
}

function requireID(value) {
  if (typeof value !== 'string' || !PAGE_ID.test(value)) fail('BAD_REQUEST');
  return value;
}

function boundedReply(value) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_REPLY_BYTES) fail('LIMIT_EXCEEDED');
  return value;
}

export function createNativePages({
  frontend,
  pageRpc,
  resourceTimeoutMs = RESOURCE_TIMEOUT_MS,
} = {}) {
  if (!Number.isSafeInteger(resourceTimeoutMs) || resourceTimeoutMs < 1) {
    throw new TypeError('resourceTimeoutMs must be a positive safe integer.');
  }
  const connections = new WeakMap();
  const disconnected = new WeakSet();

  function stateFor(connection, create = false) {
    if (!isRecord(connection)) fail('BAD_REQUEST');
    if (connection.closed || disconnected.has(connection)) fail('NOT_FOUND');
    let pages = connections.get(connection);
    if (!pages && create) {
      pages = new Map();
      connections.set(connection, pages);
    }
    return pages;
  }

  function pageFor(connection, id) {
    const page = stateFor(connection)?.get(requireID(id));
    if (!page || page.closed) fail('NOT_FOUND');
    return page;
  }

  function closeStream(stream) {
    if (stream.closePromise) return stream.closePromise;
    stream.closed = true;
    clearTimeout(stream.idleTimer);
    stream.uplink?.close();
    stream.abort.abort();
    stream.releaseClosed();
    stream.closePromise = Promise.resolve().then(async () => {
      try { await stream.source?.dispose?.(); } catch { /* Release whichever source opened. */ }
      try { await stream.iterator?.return?.(); } catch { /* A cancelled read may already have ended. */ }
    });
    return stream.closePromise;
  }

  function refreshIdle(page, stream) {
    clearTimeout(stream.idleTimer);
    stream.idleTimer = setTimeout(() => {
      void closeStream(stream).finally(() => page.streams.delete(stream.id));
    }, STREAM_IDLE_TIMEOUT_MS);
    stream.idleTimer.unref?.();
  }

  function closePage(connection, page) {
    if (page.closePromise) return page.closePromise;
    page.closed = true;
    page.abort.abort();
    page.resources.clear();
    page.resourceBytes = 0;
    page.closePromise = Promise.all([...page.streams.values()].map(closeStream)).then(() => {
      page.streams.clear();
      connections.get(connection)?.delete(page.id);
    });
    return page.closePromise;
  }

  async function open(params, connection, transport) {
    requireParams(params, ['page', 'sessionId', 'target']);
    if (!PAGE_KINDS.has(params.page)) fail('BAD_REQUEST');
    if (params.sessionId !== undefined && !validSessionID(params.sessionId)) fail('BAD_REQUEST');
    if (SESSION_PAGE_KINDS.has(params.page) && !params.sessionId) fail('BAD_REQUEST');
    if (params.target !== undefined
      && (!TARGET_ALLOWED.has(params.page) || typeof params.target !== 'string' || !TARGET_ID.test(params.target))) {
      fail('BAD_REQUEST');
    }
    if (TARGET_REQUIRED.has(params.page) && params.target === undefined) fail('BAD_REQUEST');
    const pages = stateFor(connection, true);
    if (pages.size >= MAX_PAGES) fail('LIMIT_EXCEEDED');
    if (typeof frontend?.document !== 'function' || typeof pageRpc?.invoke !== 'function'
      || typeof pageRpc?.open !== 'function') fail('UPSTREAM_UNAVAILABLE');
    const id = randomUUID();
    const httpBasePath = transport === 'http' ? `/dsbot/ui/${id}/` : undefined;
    const page = {
      id, kind: params.page, sessionId: params.sessionId, target: params.target, httpBasePath,
      streams: new Map(), resources: new Map(), resourceBytes: 0,
      abort: new AbortController(), closed: false,
    };
    initializePagePolicy(page);
    pages.set(page.id, page);
    try {
      const descriptor = { kind: page.kind, sessionId: page.sessionId };
      if (httpBasePath) Object.assign(descriptor, { transport: 'http', basePath: httpBasePath });
      const document = await frontend.document(descriptor);
      if (page.closed || connection.closed || disconnected.has(connection)) fail('NOT_FOUND');
      if (typeof document?.html !== 'string' || !document.html
        || Buffer.byteLength(document.html, 'utf8') > 768 * 1024) fail('UPSTREAM_UNAVAILABLE');
      page.resource = document.resource ?? frontend.resource?.bind(frontend);
      if (typeof page.resource !== 'function') fail('UPSTREAM_UNAVAILABLE');
      page.html = document.html;
      return { id: page.id, html: document.html };
    } catch (error) {
      await closePage(connection, page);
      if (error instanceof NativePagesError) throw error;
      fail('UPSTREAM_UNAVAILABLE');
    }
  }

  async function openHttp(params, connection) {
    return open(params, connection, 'http');
  }

  async function documentHttp(params, connection) {
    requireParams(params, ['id']);
    const page = pageFor(connection, params.id);
    if (!page.httpBasePath || typeof page.html !== 'string') fail('NOT_FOUND');
    return page.html;
  }

  async function resource(params, connection, raw = false) {
    requireParams(params, raw ? ['id', 'path'] : ['id', 'path', 'offset']);
    const page = pageFor(connection, params.id);
    let path = params.path;
    if (raw) {
      if (!page.httpBasePath || typeof path !== 'string' || path.length > 8192
        || !path.startsWith(page.httpBasePath)) fail('NOT_FOUND');
      path = `/${path.slice(page.httpBasePath.length)}`;
    }
    if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/')
      || path.startsWith('//') || /[\u0000-\u0020\u007f\\#]/u.test(path)
      || path.split('?')[0].split('/').some((part) => {
        try { return ['.', '..'].includes(decodeURIComponent(part)) || /[/\\]/u.test(decodeURIComponent(part)); }
        catch { return true; }
      })) fail('NOT_FOUND');
    const offset = raw ? 0 : params.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) fail('BAD_REQUEST');
    let pending = page.resources.get(path);
    if (!pending) {
      if (page.resources.size >= MAX_RESOURCE_COUNT) fail('LIMIT_EXCEEDED');
      // The provider serves only its frozen asset manifest, never arbitrary files or URLs.
      const entry = { promise: undefined };
      page.resources.set(path, entry);
      let timedOut = false;
      const abort = new AbortController();
      let rejectStopped;
      const stopped = new Promise((_, reject) => { rejectStopped = reject; });
      const onPageAbort = () => {
        abort.abort();
        rejectStopped(new NativePagesError('NOT_FOUND'));
      };
      page.abort.signal.addEventListener('abort', onPageAbort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        abort.abort();
        rejectStopped(new NativePagesError('UPSTREAM_UNAVAILABLE'));
      }, resourceTimeoutMs);
      const load = Promise.resolve().then(() => {
        if (page.closed || abort.signal.aborted) fail('NOT_FOUND');
        return page.resource(path, { signal: abort.signal });
      });
      entry.promise = Promise.race([load, stopped]).then((result) => {
        if (page.closed || abort.signal.aborted) fail('NOT_FOUND');
        if (!result || !(result.data instanceof Uint8Array)
          || typeof result.mimeType !== 'string' || result.mimeType.length > 256
          || /[\r\n]/u.test(result.mimeType)) fail('NOT_FOUND');
        if (result.data.byteLength > MAX_RESOURCE_BYTES
          || page.resourceBytes + result.data.byteLength > MAX_PAGE_RESOURCE_BYTES) {
          fail('LIMIT_EXCEEDED');
        }
        const bytes = Buffer.from(
          result.data.buffer, result.data.byteOffset, result.data.byteLength,
        );
        if (page.closed || abort.signal.aborted) fail('NOT_FOUND');
        page.resourceBytes += bytes.byteLength;
        return { mimeType: result.mimeType, bytes };
      }).catch((error) => {
        if (page.resources.get(path) === entry) page.resources.delete(path);
        if (page.closed) fail('NOT_FOUND');
        if (timedOut) fail('UPSTREAM_UNAVAILABLE');
        if (error instanceof NativePagesError) throw error;
        fail('NOT_FOUND');
      }).finally(() => {
        clearTimeout(timeout);
        page.abort.signal.removeEventListener('abort', onPageAbort);
        abort.abort();
      });
      pending = entry;
    }
    const result = await pending.promise;
    if (page.closed) fail('NOT_FOUND');
    if (raw) return { mimeType: result.mimeType, data: result.bytes };
    if (offset > result.bytes.length) fail('BAD_REQUEST');
    const chunk = result.bytes.subarray(offset, offset + RESOURCE_CHUNK_BYTES);
    return {
      mimeType: result.mimeType, dataBase64: chunk.toString('base64'),
      totalBytes: result.bytes.length, eof: offset + chunk.length >= result.bytes.length,
    };
  }

  async function invoke(params, connection) {
    requireParams(params, ['id', 'endpoint', 'args']);
    const page = pageFor(connection, params.id);
    if (!allowPageCall(page, params.endpoint, params.args)) fail('BAD_REQUEST');
    try {
      const result = await pageRpc.invoke(params.endpoint, params.args, page.abort.signal);
      if (page.closed) fail('NOT_FOUND');
      return boundedReply(acceptPageResult(page, params.endpoint, result, params.args));
    } catch (error) {
      if (error instanceof NativePagesError) throw error;
      fail('UPSTREAM_UNAVAILABLE');
    }
  }

  async function streamOpen(params, connection) {
    requireParams(params, ['id', 'endpoint', 'args']);
    const page = pageFor(connection, params.id);
    if (!allowPageCall(page, params.endpoint, params.args, true)) fail('BAD_REQUEST');
    const count = [...stateFor(connection).values()].reduce((sum, item) => sum + item.streams.size, 0);
    if (page.streams.size >= MAX_STREAMS_PER_PAGE || count >= MAX_STREAMS_PER_CONNECTION) {
      fail('LIMIT_EXCEEDED');
    }
    const abort = new AbortController();
    let releaseClosed;
    const stream = {
      id: randomUUID(), endpoint: params.endpoint, abort, closed: false,
      closedPromise: new Promise((resolve) => { releaseClosed = resolve; }),
      releaseClosed, queue: Promise.resolve(),
      uplink: isDuplexStream(params.endpoint) ? createUplink() : undefined,
    };
    page.streams.set(stream.id, stream);
    try {
      stream.source = await pageRpc.open(params.endpoint, params.args, abort.signal, stream.uplink);
      if (stream.closed || page.closed) {
        try { await stream.source?.dispose?.(); } catch { /* Opening raced page closure. */ }
        fail('NOT_FOUND');
      }
      if (typeof stream.source?.[Symbol.asyncIterator] !== 'function') fail('UPSTREAM_UNAVAILABLE');
      stream.iterator = stream.source[Symbol.asyncIterator]();
      refreshIdle(page, stream);
      return { streamId: stream.id };
    } catch (error) {
      await closeStream(stream);
      page.streams.delete(stream.id);
      if (error instanceof NativePagesError) throw error;
      fail('UPSTREAM_UNAVAILABLE');
    }
  }

  // One read of the source at a time; a read that outlives its caller's wait is kept for the next call.
  function pendingRead(stream) {
    if (!stream.pendingNext) {
      const pending = Promise.resolve().then(() => stream.iterator.next())
        .then((value) => ({ value }), (error) => ({ error }));
      stream.pendingNext = pending;
      void pending.finally(() => {
        if (stream.pendingNext === pending) stream.pendingNext = undefined;
      });
    }
    return stream.pendingNext;
  }

  async function nextWithDeadline(stream) {
    const pending = pendingRead(stream);
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timeout: true }), STREAM_NEXT_TIMEOUT_MS);
      timer.unref?.();
    });
    const result = await Promise.race([
      pending, deadline, stream.closedPromise.then(() => ({ closed: true })),
    ]);
    clearTimeout(timer);
    if (result.error) throw result.error;
    return result;
  }

  // What the source can give without waiting: a macrotask is enough for items it already holds.
  async function nextIfReady(stream) {
    const pending = pendingRead(stream);
    let handle;
    const idle = new Promise((resolve) => { handle = setImmediate(() => resolve({ idle: true })); });
    const result = await Promise.race([
      pending, idle, stream.closedPromise.then(() => ({ closed: true })),
    ]);
    clearImmediate(handle);
    if (result.error) throw result.error;
    return result;
  }

  async function readStream(page, stream) {
    try {
      if (stream.finished) {
        await closeStream(stream);
        page.streams.delete(stream.id);
        return { items: [], done: true };
      }
      for (let scanned = 0; scanned < 32; scanned += 1) {
        if (stream.closed || page.closed) return { items: [], done: true };
        const next = await nextWithDeadline(stream);
        if (next.timeout) return { items: [], done: false };
        if (next.closed || next.value?.done || stream.closed || page.closed) {
          await closeStream(stream);
          page.streams.delete(stream.id);
          return { items: [], done: true };
        }
        const item = pageStreamItem(page, stream.endpoint, next.value.value);
        if (item === undefined) continue;
        const items = [item];
        if (BATCHED_STREAMS.has(stream.endpoint)) {
          let bytes = JSON.stringify(item).length;
          while (items.length < BATCH_MAX_ITEMS && bytes < BATCH_MAX_BYTES) {
            const more = await nextIfReady(stream);
            if (more.idle || more.closed || stream.closed || page.closed) break;
            if (more.value?.done) {
              // Items and the end never travel together: the page drops what is queued behind an end.
              stream.finished = true;
              break;
            }
            const extra = pageStreamItem(page, stream.endpoint, more.value.value);
            if (extra === undefined) continue;
            items.push(extra);
            bytes += JSON.stringify(extra).length;
          }
        }
        return boundedReply({ items, done: false });
      }
      return { items: [], done: false };
    } catch (error) {
      await closeStream(stream);
      page.streams.delete(stream.id);
      if (error instanceof NativePagesError) throw error;
      fail('UPSTREAM_UNAVAILABLE');
    }
  }

  async function streamNext(params, connection) {
    requireParams(params, ['id', 'streamId']);
    const page = pageFor(connection, params.id);
    const stream = page.streams.get(requireID(params.streamId));
    if (!stream || stream.closed || !stream.iterator) fail('NOT_FOUND');
    refreshIdle(page, stream);
    const result = stream.queue.then(() => readStream(page, stream));
    stream.queue = result.catch(() => {});
    return result;
  }

  async function streamSend(params, connection) {
    requireParams(params, ['id', 'streamId', 'items', 'end']);
    const page = pageFor(connection, params.id);
    const stream = page.streams.get(requireID(params.streamId));
    if (!stream || stream.closed || !stream.uplink) fail('NOT_FOUND');
    if (!Array.isArray(params.items) || params.items.length > SEND_MAX_ITEMS
      || (params.end !== undefined && params.end !== true)
      || (params.items.length === 0 && params.end !== true)
      || !params.items.every((item) => acceptPageUplink(page, stream.endpoint, item))) {
      fail('BAD_REQUEST');
    }
    refreshIdle(page, stream);
    try {
      for (const item of params.items) stream.uplink.push(item);
      if (params.end === true) stream.uplink.end();
    } catch (error) {
      // A page that outruns the desktop loses the stream rather than the desktop its memory.
      await closeStream(stream);
      page.streams.delete(stream.id);
      throw error;
    }
    return {};
  }

  async function streamClose(params, connection) {
    requireParams(params, ['id', 'streamId']);
    const page = pageFor(connection, params.id);
    const id = requireID(params.streamId);
    const stream = page.streams.get(id);
    if (stream) {
      await closeStream(stream);
      page.streams.delete(id);
    }
    return {};
  }

  async function close(params, connection) {
    requireParams(params, ['id']);
    const page = stateFor(connection)?.get(requireID(params.id));
    if (page) await closePage(connection, page);
    return {};
  }

  return Object.freeze({
    async dispatch(method, params, connection) {
      switch (method) {
        case 'web.open': return open(params, connection);
        case 'web.resource': return resource(params, connection);
        case 'web.invoke': return invoke(params, connection);
        case 'web.close': return close(params, connection);
        case 'web.stream.open': return streamOpen(params, connection);
        case 'web.stream.next': return streamNext(params, connection);
        case 'web.stream.send': return streamSend(params, connection);
        case 'web.stream.close': return streamClose(params, connection);
        default: fail('BAD_REQUEST');
      }
    },
    openHttp,
    documentHttp,
    resourceHttp(params, connection) {
      return resource(params, connection, true);
    },
    async closeConnection(connection) {
      if (!isRecord(connection)) fail('BAD_REQUEST');
      disconnected.add(connection);
      const pages = connections.get(connection);
      if (!pages) return;
      await Promise.all([...pages.values()].map((page) => closePage(connection, page)));
      connections.delete(connection);
    },
  });
}
