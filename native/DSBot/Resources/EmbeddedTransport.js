(() => {
  'use strict';
  const page = window.__DSBOT_PAGE__;
  const handler = window.webkit?.messageHandlers?.dsbot;
  if (!page || !handler) return;

  const reviewDiagnosticsEnabled = page.reviewDiagnostics === true;
  const interactionActions = new Set([
    'search', 'expand', 'collapse', 'detail', 'back', 'tab', 'change',
  ]);
  const httpTransport = page.transport === 'http';
  let bootstrapReady = false;
  const abortError = () => new DOMException('Page closed', 'AbortError');
  const call = async (method, params = {}) => {
    const encoded = await handler.postMessage(JSON.stringify({ method, params }));
    return JSON.parse(encoded);
  };
  const nativeFetch = typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : null;
  const httpPageBase = (() => {
    if (!httpTransport || typeof page.basePath !== 'string'
      || !/^\/dsbot\/ui\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/iu.test(page.basePath)) {
      return null;
    }
    try {
      const documentURL = new URL(document.baseURI);
      const baseURL = new URL(page.basePath, documentURL);
      if (!['http:', 'https:'].includes(documentURL.protocol)
        || baseURL.origin !== documentURL.origin
        || baseURL.pathname !== page.basePath
        || documentURL.pathname !== page.basePath
        || documentURL.username || documentURL.password) {
        return null;
      }
      return baseURL;
    } catch {
      return null;
    }
  })();
  const bytes = (value) => {
    if (Array.isArray(value)) return value.map(bytes);
    if (value && typeof value === 'object') {
      if (Object.keys(value).length === 1 && typeof value.$dsbotBytes === 'string') {
        const binary = atob(value.$dsbotBytes);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bytes(item)]));
    }
    return value;
  };
  const reportRPCFailure = (endpoint) => {
    try {
      const pending = window.__DSBOT_NATIVE__?.rpcFailure?.(endpoint);
      if (pending && typeof pending.catch === 'function') void pending.catch(() => {});
    } catch {}
    reportReviewDiagnostic('rpc.failure', { endpoint });
  };
  const reportBootstrapFailure = (kind) => {
    try {
      const pending = window.__DSBOT_NATIVE__?.fail?.(kind);
      if (pending && typeof pending.catch === 'function') void pending.catch(() => {});
    } catch {}
  };
  const errorDetails = (value) => {
    if (typeof value === 'string') return { message: value.slice(0, 4096) };
    try {
      if (value instanceof Error) {
        return {
          message: typeof value.message === 'string' ? value.message.slice(0, 4096) : undefined,
          stack: typeof value.stack === 'string' ? value.stack.split('\n').slice(0, 12).join('\n') : undefined,
        };
      }
    } catch {}
    return { message: 'Unprintable web error' };
  };
  function reportReviewDiagnostic(stage, details = {}) {
    if (!reviewDiagnosticsEnabled) return;
    const params = { stage };
    for (const field of ['message', 'filename', 'stack', 'endpoint']) {
      if (typeof details[field] === 'string') {
        params[field] = details[field].slice(0, field === 'stack' ? 12 * 1024 : 16 * 1024);
      }
    }
    try {
      const pending = call('review.diagnostic', params);
      if (pending && typeof pending.catch === 'function') void pending.catch(() => {});
    } catch {}
  }
  const reportMissingRPC = (endpoint, result) => {
    const code = result?.error?.code;
    if (typeof code === 'string' && /(?:not-found|not_found|method-not-found|missing)/iu.test(code)) {
      reportReviewDiagnostic('rpc.missing', { endpoint, message: code.slice(0, 256) });
    }
  };

  const safeHTTPError = (code, message) => ({
    ok: false,
    error: { code, message, details: {} },
  });
  const pageRPC = async (method, params = {}, signal) => {
    if (!httpTransport) return call(method, params);
    if (signal?.aborted) throw abortError();
    if (!httpPageBase || !nativeFetch) throw new Error('PAGE_HTTP_UNAVAILABLE');
    const response = await nativeFetch(new URL('rpc', httpPageBase).href, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'X-DSBot-Page': '1',
      },
      body: JSON.stringify({ method, params }),
      signal,
    });
    if (response.status === 401) {
      return safeHTTPError('AUTH_FAILED', '请重新连接电脑。');
    }
    return bytes(await response.json());
  };
  const settingsWriteEndpoints = new Set([
    'settings/mutate', 'settings/update', 'settings/replace',
    'credentials/set', 'credentials/unset',
    'pluginManager/setPluginEnabled', 'pluginManager/setBundleEnabled',
    'pluginManager/installBundle', 'pluginManager/removeBundle',
    'pluginManager/cancelInstall', 'pluginManager/waitForInstall',
    'pluginManager/setVersionExemption', 'pluginMarket/setIndexes',
  ]);
  const invokePage = async (endpoint, args, signal) => {
    const result = await pageRPC('web.invoke', { endpoint, args }, signal);
    if (httpTransport && page.kind === 'settings' && result?.ok === true
      && settingsWriteEndpoints.has(endpoint)) {
      try {
        await call('settings.mutated');
      } catch {}
    }
    return result;
  };

  function remoteStream(endpoint, payload, signal) {
    let streamID;
    let closed = false;
    let closeSent = false;
    const queued = [];
    let opening;
    const close = () => {
      closed = true;
      queued.length = 0;
      signal?.removeEventListener('abort', close);
      if (streamID && !closeSent) {
        closeSent = true;
        void pageRPC('web.stream.close', { streamId: streamID }).catch(() => {
          if (!signal?.aborted) reportRPCFailure(endpoint);
        });
      }
    };

    signal?.addEventListener('abort', close, { once: true });
    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        if ((closed && !queued.length) || signal?.aborted) return { done: true };
        try {
          if (!opening) {
            const args = endpoint === '$events' ? {} : (payload?.args ?? {});
            opening = pageRPC('web.stream.open', { endpoint, args }, signal);
          }
          if (!streamID) {
            const result = await opening;
            if (result?.ok === false || typeof result?.streamId !== 'string') {
              reportMissingRPC(endpoint, result);
              throw new Error('STREAM_OPEN_FAILED');
            }
            streamID = result.streamId;
            if (closed || signal?.aborted) {
              close();
              return { done: true };
            }
          }
          while (!queued.length && !closed) {
            const result = await pageRPC('web.stream.next', { streamId: streamID }, signal);
            if (signal?.aborted) {
              close();
              return { done: true };
            }
            if (result?.ok === false) throw new Error('STREAM_READ_FAILED');
            queued.push(...(result.items ?? []).map(bytes));
            if (result.done) {
              closed = true;
              closeSent = true;
              signal?.removeEventListener('abort', close);
            }
          }
          return queued.length ? { done: false, value: queued.shift() } : { done: true };
        } catch (error) {
          if (!signal?.aborted) {
            reportReviewDiagnostic('transport.error', errorDetails(error));
            reportRPCFailure(endpoint);
            close();
          }
          throw error;
        }
      },
      async return() {
        close();
        return { done: true };
      },
    };
  }

  const contextRoutes = new Map([
    ['/api/dsh-context/detail', 'dshContext/detail'],
    ['/api/dsh-context/fleet', 'dshContext/fleet'],
    ['/api/dsh-context/skills', 'dshContext/skills'],
  ]);
  const marketRoutes = new Map([
    ['/dsh-market/registry', 'dshMarket/registry'],
    ['/dsh-market/installed', 'dshMarket/installed'],
    ['/dsh-market/status', 'dshMarket/status'],
    ['/dsh-market/updates', 'dshMarket/updates'],
    ['/dsh-market/bundle-order', 'dshMarket/bundleOrder'],
    ['/dsh-market/presets', 'dshMarket/presets'],
    ['/dsh-market/snapshots', 'dshMarket/snapshots'],
    ['/dsh-market/host-recovery', 'dshMarket/hostRecovery'],
  ]);
  const plainRecord = (value) => value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const rawPath = (value) => {
    const scheme = value.indexOf('://');
    const pathStart = scheme >= 0 ? value.indexOf('/', scheme + 3) : -1;
    const path = scheme >= 0
      ? (pathStart < 0 ? '/' : value.slice(pathStart))
      : value;
    return path.split(/[?#]/u, 1)[0];
  };
  const hasUnsafePathTraversal = (path) => {
    let decoded = path;
    for (let depth = 0; depth < 5; depth += 1) {
      if (decoded.includes('\\')) return true;
      let next;
      try {
        next = decodeURIComponent(decoded);
      } catch {
        return true;
      }
      if (next === decoded) break;
      decoded = next;
    }
    return decoded.split('/').some((part) => part === '..');
  };
  const httpFetchURL = (value) => {
    if (!httpPageBase || !nativeFetch) throw new TypeError('HTTP page transport is unavailable');
    const path = rawPath(value);
    if (hasUnsafePathTraversal(path)) throw new TypeError('Fetch URL contains path traversal');
    let original;
    try {
      original = new URL(value, document.baseURI);
    } catch {
      throw new TypeError('Invalid fetch URL');
    }
    if (original.origin !== httpPageBase.origin || original.username || original.password) {
      throw new TypeError('Fetch URL is outside this page origin');
    }

    const basePath = page.basePath;
    let url;
    if (original.pathname === basePath.slice(0, -1)) {
      url = new URL(`${basePath}${original.search}${original.hash}`, original.origin);
    } else if (original.pathname.startsWith(basePath)) {
      url = original;
    } else {
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(original.pathname);
      } catch {
        throw new TypeError('Invalid fetch path');
      }
      if (decodedPath === '/dsbot/ui' || decodedPath.startsWith('/dsbot/ui/')) {
        throw new TypeError('Fetch URL is outside this page scope');
      }
      url = new URL(
        `${original.pathname.replace(/^\/+/u, '')}${original.search}${original.hash}`,
        httpPageBase,
      );
    }
    if (url.origin !== httpPageBase.origin || !url.pathname.startsWith(basePath)) {
      throw new TypeError('Fetch URL is outside this page scope');
    }
    const routePath = `/${url.pathname.slice(basePath.length)}`;
    let canonicalRoutePath;
    if (path.startsWith(basePath)) {
      canonicalRoutePath = `/${path.slice(basePath.length)}`;
    } else if (path === basePath.slice(0, -1)) {
      canonicalRoutePath = '/';
    } else {
      canonicalRoutePath = path.startsWith('/') ? path : `/${path}`;
    }
    return { value, url, path, routePath, canonicalRoutePath };
  };
  const fetchURL = (input) => {
    const value = typeof input === 'string'
      ? input
      : input instanceof URL ? input.href : null;
    if (value === null) throw new TypeError('Unsupported fetch input');
    if (httpTransport) return httpFetchURL(value);
    let url;
    try {
      url = new URL(value, document.baseURI);
    } catch {
      throw new TypeError('Invalid fetch URL');
    }
    if (url.protocol !== 'dsbot-ui:' || url.host !== page.id
      || url.username || url.password) {
      throw new TypeError('Fetch URL is outside this page');
    }
    return {
      value,
      url,
      path: rawPath(value),
      routePath: url.pathname,
      canonicalRoutePath: rawPath(value),
    };
  };
  const requestHeaders = (headers) => {
    if (headers === undefined) return [];
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      return [...headers.entries()];
    }
    if (Array.isArray(headers)) {
      if (!headers.every((pair) => Array.isArray(pair) && pair.length === 2)) {
        throw new TypeError('Invalid fetch headers');
      }
      return headers;
    }
    if (plainRecord(headers)) return Object.entries(headers);
    throw new TypeError('Invalid fetch headers');
  };
  const responseJSON = (result) => new Response(JSON.stringify(bytes(result)), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  const marketErrorResponse = () => new Response(JSON.stringify({
    ok: false,
    error: {
      code: 'gateway/unavailable',
      message: '第三方市场暂时无法读取，请稍后重试。',
      details: {},
    },
  }), {
    status: 502,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  const invokeMarketRoute = async (endpoint, signal) => {
    if (signal?.aborted) throw abortError();
    let abortListener;
    const pending = invokePage(endpoint, {}, signal);
    try {
      const result = signal
        ? await new Promise((resolve, reject) => {
          abortListener = () => reject(abortError());
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) {
            reject(abortError());
            return;
          }
          pending.then(resolve, reject);
        })
        : await pending;
      if (signal?.aborted) throw abortError();
      const value = result?.value;
      const status = value?.status;
      if (result?.ok !== true || !Number.isInteger(status)
        || status < 200 || status > 599 || !Object.hasOwn(value, 'body')) {
        reportRPCFailure(endpoint);
        return marketErrorResponse();
      }
      let json;
      try {
        json = JSON.stringify(bytes(value.body));
      } catch {
        reportRPCFailure(endpoint);
        return marketErrorResponse();
      }
      if (typeof json !== 'string') {
        reportRPCFailure(endpoint);
        return marketErrorResponse();
      }
      const body = [204, 205, 304].includes(status) ? null : json;
      return new Response(body, {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      reportRPCFailure(endpoint);
      return marketErrorResponse();
    } finally {
      if (abortListener) signal.removeEventListener('abort', abortListener);
    }
  };
  const invokeContextRoute = async (endpoint, body, signal) => {
    if (signal?.aborted) throw abortError();
    const sessionId = body.sessionId ?? page.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) {
      throw new TypeError('Invalid dsh-context session');
    }
    const args = { sessionId };
    if (endpoint === 'dshContext/fleet' && Object.hasOwn(body, 'full')) {
      if (typeof body.full !== 'boolean') throw new TypeError('Invalid dsh-context fleet options');
      args.full = body.full;
    }

    let abortListener;
    const pending = invokePage(endpoint, args, signal);
    try {
      const result = signal
        ? await new Promise((resolve, reject) => {
          abortListener = () => reject(abortError());
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) {
            reject(abortError());
            return;
          }
          pending.then(resolve, reject);
        })
        : await pending;
      if (signal?.aborted) throw abortError();
      if (result?.ok === false) reportRPCFailure(endpoint);
      return responseJSON(result);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      reportRPCFailure(endpoint);
      return responseJSON({
        ok: false,
        error: { code: 'gateway/unavailable', message: '电脑暂时无法完成请求。', details: {} },
      });
    } finally {
      if (abortListener) signal.removeEventListener('abort', abortListener);
    }
  };
  const fetchHTTPResource = (url, init) => {
    if (!nativeFetch) throw new TypeError('Fetch is unavailable');
    if (url.pathname === '/rpc' || url.pathname.startsWith('/rpc/')) {
      throw new TypeError('Use the scoped page RPC transport');
    }
    if (!plainRecord(init ?? {})) throw new TypeError('Invalid fetch options');
    const options = init ?? {};
    const allowedOptions = new Set(['method', 'headers', 'cache', 'signal']);
    if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
      throw new TypeError('Unsupported fetch options');
    }
    const method = options.method ?? 'GET';
    if (typeof method !== 'string' || !['GET', 'HEAD'].includes(method.toUpperCase())) {
      throw new TypeError('Only resource GET and HEAD requests are supported');
    }
    if (options.cache !== undefined
      && !['default', 'no-store', 'reload', 'no-cache', 'force-cache', 'only-if-cached'].includes(options.cache)) {
      throw new TypeError('Invalid resource cache option');
    }
    const headers = requestHeaders(options.headers);
    const blockedHeaders = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-dsbot-page']);
    if (headers.some((pair) => blockedHeaders.has(String(pair[0]).toLowerCase()))) {
      throw new TypeError('Credential headers are not supported');
    }
    if (options.signal !== undefined
      && (!options.signal || typeof options.signal.aborted !== 'boolean'
        || typeof options.signal.addEventListener !== 'function'
        || typeof options.signal.removeEventListener !== 'function')) {
      throw new TypeError('Invalid fetch signal');
    }
    return nativeFetch(url.href, {
      ...options,
      method: method.toUpperCase(),
      credentials: 'same-origin',
      redirect: 'error',
    });
  };
  window.fetch = async (input, init) => {
    const { value, url, path, routePath, canonicalRoutePath } = fetchURL(input);
    const requestPath = httpTransport ? routePath : url.pathname;
    const exactPath = httpTransport
      ? canonicalRoutePath === routePath
      : [url.pathname, url.pathname.slice(1)].includes(path);
    let decodedPath = httpTransport ? routePath : path;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {}
    let decodedRoutePath = requestPath;
    try {
      decodedRoutePath = decodeURIComponent(requestPath);
    } catch {}
    const marketPath = requestPath.startsWith('/dsh-market/')
      || requestPath === '/dsh-market'
      || decodedRoutePath.startsWith('/dsh-market/')
      || decodedRoutePath === '/dsh-market'
      || path.startsWith('/dsh-market/')
      || path.startsWith('dsh-market/')
      || decodedPath.startsWith('/dsh-market/')
      || decodedPath.startsWith('dsh-market/');
    if (marketPath) {
      const endpoint = marketRoutes.get(requestPath);
      if (!endpoint && ['settings', 'plugins'].includes(page.kind)
        && !url.search && !url.hash && !/[?#]/u.test(value)
        && exactPath
        && /^\/dsh-market\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/u.test(requestPath)
        && plainRecord(init) && typeof init.method === 'string' && init.method.toUpperCase() === 'POST') {
        // A rejected mutation must not resemble a dropped network request to the market's install queue.
        return new Response(JSON.stringify({
          ok: false, error: '请在电脑端完成此操作。',
        }), { status: 501, headers: { 'content-type': 'application/json; charset=utf-8' } });
      }
      if (!endpoint || url.search || url.hash || /[?#]/u.test(value)
        || !exactPath) {
        throw new TypeError('Unsupported embedded market route');
      }
      if (!['settings', 'plugins'].includes(page.kind)) {
        throw new TypeError('Embedded market is unavailable on this page');
      }
      if (!plainRecord(init ?? {})) throw new TypeError('Invalid fetch options');
      const options = init ?? {};
      const allowedOptions = new Set(['method', 'cache', 'signal']);
      if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
        throw new TypeError('Unsupported fetch options');
      }
      if (options.method !== undefined
        && (typeof options.method !== 'string' || options.method.toUpperCase() !== 'GET')) {
        throw new TypeError('Only GET is supported for embedded market routes');
      }
      if (options.cache !== undefined && options.cache !== 'no-store') {
        throw new TypeError('Only no-store cache is supported for embedded market routes');
      }
      if (options.signal !== undefined
        && (!options.signal || typeof options.signal.aborted !== 'boolean'
          || typeof options.signal.addEventListener !== 'function'
          || typeof options.signal.removeEventListener !== 'function')) {
        throw new TypeError('Invalid fetch signal');
      }
      return invokeMarketRoute(endpoint, options.signal);
    }
    const apiPath = requestPath === '/api' || requestPath.startsWith('/api/');
    if (!apiPath) {
      if (httpTransport) return fetchHTTPResource(url, init);
      if (!nativeFetch) throw new TypeError('Fetch is unavailable');
      return nativeFetch(input, init);
    }

    const endpoint = contextRoutes.get(requestPath);
    if (!endpoint || url.search || url.hash || /[?#]/u.test(value)
      || !exactPath) {
      throw new TypeError('Unsupported embedded API route');
    }
    if (!['context', 'team'].includes(page.kind)
      || (endpoint === 'dshContext/fleet' && page.kind !== 'team')) {
      throw new TypeError('Embedded API is unavailable on this page');
    }
    if (!plainRecord(init ?? {})) throw new TypeError('Invalid fetch options');
    const options = init ?? {};
    const allowedOptions = new Set(['method', 'headers', 'body', 'signal']);
    if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
      throw new TypeError('Unsupported fetch options');
    }
    if (typeof options.method !== 'string' || options.method.toUpperCase() !== 'POST') {
      throw new TypeError('Only POST is supported for embedded API routes');
    }
    const headers = requestHeaders(options.headers);
    if (headers.length !== 1
      || String(headers[0][0]).toLowerCase() !== 'content-type'
      || !/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?$/iu.test(String(headers[0][1]))) {
      throw new TypeError('Only JSON requests are supported for embedded API routes');
    }
    if (typeof options.body !== 'string' || options.body.length > 64 * 1024) {
      throw new TypeError('Invalid embedded API body');
    }
    let body;
    try {
      body = JSON.parse(options.body);
    } catch {
      throw new TypeError('Invalid embedded API JSON');
    }
    if (!plainRecord(body)) throw new TypeError('Invalid embedded API JSON');

    const allowedBody = endpoint === 'dshContext/fleet'
      ? new Set(['sessionId', 'full'])
      : endpoint === 'dshContext/skills'
        ? new Set(['sessionId', 'cwd'])
        : new Set(['sessionId']);
    if (Object.keys(body).some((key) => !allowedBody.has(key))) {
      throw new TypeError('Unsupported embedded API arguments');
    }
    if (endpoint === 'dshContext/fleet' && Object.hasOwn(body, 'full')
      && typeof body.full !== 'boolean') {
      throw new TypeError('Invalid dsh-context fleet options');
    }
    if (options.signal !== undefined
      && (!options.signal || typeof options.signal.aborted !== 'boolean'
        || typeof options.signal.addEventListener !== 'function'
        || typeof options.signal.removeEventListener !== 'function')) {
      throw new TypeError('Invalid fetch signal');
    }
    return invokeContextRoute(endpoint, body, options.signal);
  };

  window.__DSH_TRANSPORT__ = {
    ownsHost: false,
    rpc: {
      async call(channel, endpoint, payload, signal) {
        if (channel !== '/api') throw new Error('UNSUPPORTED');
        if (signal?.aborted) throw abortError();
        try {
          const result = await invokePage(endpoint, payload?.args ?? {}, signal);
          if (signal?.aborted) throw abortError();
          if (result?.ok === false) {
            reportMissingRPC(endpoint, result);
            reportRPCFailure(endpoint);
          }
          return bytes(result);
        } catch (error) {
          if (signal?.aborted) throw abortError();
          reportReviewDiagnostic('transport.error', errorDetails(error));
          reportRPCFailure(endpoint);
          return { ok: false, error: { code: 'gateway/unavailable', message: '电脑暂时无法完成请求。', details: {} } };
        }
      },
      open(channel, endpoint, payload, signal) {
        if (channel !== '/api') throw new Error('UNSUPPORTED');
        return remoteStream(endpoint, payload, signal);
      },
    },
    loadBundle(path) {
      return new Promise((resolve, reject) => {
        let url;
        try {
          if (httpTransport) {
            const value = typeof path === 'string'
              ? path
              : path instanceof URL ? path.href : null;
            if (value === null) throw new TypeError('Unsupported bundle URL');
            url = httpFetchURL(value).url;
            if (url.hash || !url.pathname.startsWith(`${page.basePath}plugins/`)) {
              throw new TypeError('Bundle URL is outside this page plugin scope');
            }
          } else {
            url = new URL(path, document.baseURI);
          }
        } catch {
          reportReviewDiagnostic('resource.fetch.fail', { message: 'Invalid bundle URL' });
          reportBootstrapFailure('resource');
          reject(new Error('UNSUPPORTED'));
          return;
        }
        if ((!httpTransport && (url.protocol !== 'dsbot-ui:' || url.host !== page.id))
          || (httpTransport && (!httpPageBase || url.origin !== httpPageBase.origin))) {
          reportReviewDiagnostic('resource.fetch.fail', {
            message: 'Bundle URL is outside the page resource scope',
            filename: url.pathname,
          });
          reportBootstrapFailure('resource');
          reject(new Error('UNSUPPORTED'));
          return;
        }
        const script = document.createElement('script');
        script.src = url.href;
        script.onload = () => resolve();
        script.onerror = () => {
          reportReviewDiagnostic('script.resource.error', {
            message: 'Bundle script failed to load',
            filename: `${url.pathname}${url.search}`,
          });
          reportReviewDiagnostic('resource.fetch.fail', {
            message: 'Bundle script failed to load',
            filename: `${url.pathname}${url.search}`,
          });
          reportBootstrapFailure('resource');
          reject(new Error('RESOURCE_FAILED'));
        };
        document.head.appendChild(script);
      });
    },
  };

  window.__DSBOT_NATIVE__ = Object.freeze({
    page: Object.freeze({ kind: page.kind, sessionId: page.sessionId }),
    ready: async () => {
      const result = await call('ready');
      bootstrapReady = true;
      reportReviewDiagnostic('boot.transport.ready');
      return result;
    },
    fail: (kind = 'page') => call('bootstrap.failure', { kind }),
    rpcFailure: (endpoint) => call('rpc.failure', { endpoint }),
    settingsCategories: (categories) => {
      if (page.kind !== 'settings') return Promise.reject(new Error('UNSUPPORTED'));
      return call('settings.categories', { categories });
    },
    interaction: (action) => {
      if (!interactionActions.has(action)) return Promise.reject(new Error('UNSUPPORTED'));
      return call('interaction', { action });
    },
  });
  const classifyInteraction = (target) => {
    if (!(target instanceof Element)) return null;
    const element = target.closest('button,a,[role=button],[role=tab],input,select,summary');
    if (!element) return null;
    const label = (element.getAttribute('aria-label') || '').trim().toLowerCase();
    if (element.matches('[role=tab]') || element.closest('[role=tablist]')) return 'tab';
    if (element.closest('[role=search]') || element.matches('input[type=search]')
      || /search|搜索/u.test(label)) return 'search';
    if (/^(back|go back)(\b|$)/u.test(label) || /^(返回|上一步)/u.test(label)) return 'back';
    if (element.matches('input,select')) return 'change';
    const expanded = element.getAttribute('aria-expanded');
    if (expanded === 'true') return 'collapse';
    if (expanded === 'false') return 'expand';
    if (element instanceof HTMLSummaryElement) {
      return element.parentElement?.matches('details[open]') ? 'collapse' : 'expand';
    }
    if (element.matches('a,[role=link]')) return 'detail';
    if (element.getAttribute('aria-haspopup') === 'dialog') return 'detail';
    return 'change';
  };
  const reportInteraction = (target) => {
    const action = classifyInteraction(target);
    if (action) void window.__DSBOT_NATIVE__.interaction(action).catch(() => {});
  };
  document.addEventListener('click', (event) => reportInteraction(event.target), {
    capture: true, passive: true,
  });
  document.addEventListener('change', (event) => reportInteraction(event.target), {
    capture: true, passive: true,
  });
  window.addEventListener('error', (event) => {
    if (event.target instanceof HTMLScriptElement) {
      reportReviewDiagnostic('script.resource.error', {
        message: 'Script resource failed to load',
        filename: event.target.src,
      });
      if (!bootstrapReady) reportBootstrapFailure('script');
      return;
    }
    if (event instanceof ErrorEvent) {
      reportReviewDiagnostic('script.error', {
        message: event.message,
        filename: event.filename,
        stack: errorDetails(event.error).stack,
      });
      if (!bootstrapReady) reportBootstrapFailure('script');
    }
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    const details = errorDetails(event.reason);
    reportReviewDiagnostic('unhandledrejection', details);
    if (!bootstrapReady) reportBootstrapFailure('script');
  });
})();
