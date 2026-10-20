import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function makeHarness({
  kind = 'context',
  sessionId = 'page-session',
  transport = 'legacy',
  httpResponder,
  pendingInvoke = false,
  invokeResult = { ok: true, value: { source: 'remote' } },
  marketResult = { ok: true, value: { status: 200, body: { source: 'market' } } },
}: {
  kind?: string;
  sessionId?: string;
  transport?: string;
  httpResponder?: (
    input: string,
    init: Record<string, unknown>,
    index: number,
  ) => Response | Promise<Response>;
  pendingInvoke?: boolean;
  invokeResult?: Record<string, unknown>;
  marketResult?: Record<string, unknown>;
} = {}) {
  const source = await readFile(
    new URL('../native/DSBot/Resources/EmbeddedTransport.js', import.meta.url),
    'utf8',
  );
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const resourceFetches: unknown[][] = [];
  const appendedScripts: Array<{ src: string; onload?: () => void; onerror?: () => void }> = [];
  const pageId = '11111111-2222-4333-8444-555555555555';
  const basePath = `/dsbot/ui/${pageId}/`;
  let resolveInvoke: ((value: string) => void) | undefined;
  const window = {
    __DSBOT_PAGE__: {
      id: transport === 'http' ? pageId : 'page-1',
      kind,
      sessionId,
      ...(transport === 'http' ? { transport, basePath } : {}),
    },
    webkit: {
      messageHandlers: {
        dsbot: {
          async postMessage(encoded: string) {
            const message = JSON.parse(encoded) as {
              method: string;
              params: Record<string, unknown>;
            };
            calls.push(message);
            if (message.method === 'web.invoke' && pendingInvoke) {
              return new Promise<string>((resolve) => {
                resolveInvoke = resolve;
              });
            }
            if (message.method === 'web.invoke') {
              const endpoint = message.params.endpoint;
              return JSON.stringify(
                typeof endpoint === 'string' && endpoint.startsWith('dshMarket/')
                  ? marketResult
                  : invokeResult,
              );
            }
            if (message.method === 'rpc.failure') return JSON.stringify({ ok: true });
            if (message.method === 'settings.mutated') return JSON.stringify({ ok: true });
            assert.fail(`unexpected native bridge method: ${message.method}`);
          },
        },
      },
    },
    async fetch(...args: unknown[]) {
      resourceFetches.push(args);
      if (httpResponder) {
        return httpResponder(
          String(args[0]),
          (args[1] ?? {}) as Record<string, unknown>,
          resourceFetches.length - 1,
        );
      }
      return Promise.resolve(new Response('asset', { status: 200 }));
    },
    addEventListener() {},
  };
  const context = vm.createContext({
    window,
    document: {
      baseURI: transport === 'http'
        ? `https://device.test${basePath}`
        : 'dsbot-ui://page-1/',
      addEventListener() {},
      createElement() {
        return { src: '', onload: undefined, onerror: undefined };
      },
      head: {
        appendChild(script: (typeof appendedScripts)[number]) {
          appendedScripts.push(script);
          queueMicrotask(() => script.onload?.());
        },
      },
    },
    URL,
    Response,
    Headers,
    DOMException,
    atob,
    setTimeout,
  });
  vm.runInContext(source, context);
  return {
    calls,
    context,
    resourceFetches,
    appendedScripts,
    basePath,
    pageId,
    finishInvoke(value = { ok: true, value: { source: 'remote' } }) {
      assert.ok(resolveInvoke);
      resolveInvoke(JSON.stringify(value));
      resolveInvoke = undefined;
    },
  };
}

function fetchInPage(
  context: vm.Context,
  input: string,
  body: string,
  init = `{
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: fetchBody,
  }`,
) {
  context.fetchInput = input;
  context.fetchBody = body;
  return vm.runInContext(`window.fetch(fetchInput, ${init})`, context) as Promise<Response>;
}

function fetchMarketInPage(
  context: vm.Context,
  input: string,
  init = '{}',
) {
  context.fetchInput = input;
  return vm.runInContext(`window.fetch(fetchInput, ${init})`, context) as Promise<Response>;
}

test('downlink streams ignore the gateway uplink queue and remain readable and cancellable', async () => {
  const source = await readFile(
    new URL('../native/DSBot/Resources/EmbeddedTransport.js', import.meta.url),
    'utf8',
  );
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const uplinkItems = [{ type: 'client-only-data', value: 'must not be sent' }];
  let uplinkIteratorCalls = 0;
  let uplinkNextCalls = 0;
  const uplink = {
    items: uplinkItems,
    [Symbol.asyncIterator]() {
      uplinkIteratorCalls += 1;
      return {
        async next() {
          uplinkNextCalls += 1;
          return uplinkItems.length
            ? { done: false, value: uplinkItems.shift() }
            : { done: true };
        },
      };
    },
  };
  let downlinkIndex = 0;
  const window = {
    __DSBOT_PAGE__: {
      id: 'page-1',
      kind: 'trace',
      sessionId: 'session-1',
    },
    webkit: {
      messageHandlers: {
        dsbot: {
          async postMessage(encoded: string) {
            const call = JSON.parse(encoded) as {
              method: string;
              params: Record<string, unknown>;
            };
            calls.push(call);
            switch (call.method) {
              case 'web.stream.open':
                return JSON.stringify({ ok: true, streamId: 'stream-1' });
              case 'web.stream.next':
                return JSON.stringify({
                  ok: true,
                  items: [{ type: 'event', seq: ++downlinkIndex }],
                  done: false,
                });
              case 'web.stream.close':
                return JSON.stringify({ ok: true });
              default:
                assert.fail(`unexpected native bridge method: ${call.method}`);
            }
          },
        },
      },
    },
    addEventListener() {},
  };
  const document = {
    baseURI: 'dsbot-ui://page-1/',
    addEventListener() {},
  };
  vm.runInNewContext(source, { window, document, URL, DOMException, atob });

  const controller = new AbortController();
  const stream = window.__DSH_TRANSPORT__.rpc.open(
    '/api',
    'session/follow',
    { args: { address: { kind: 'session', sessionId: 'session-1' } } },
    controller.signal,
    uplink,
  );

  const first = await stream.next();
  const second = await stream.next();
  assert.equal(first.done, false);
  assert.equal(first.value.type, 'event');
  assert.equal(first.value.seq, 1);
  assert.equal(second.done, false);
  assert.equal(second.value.seq, 2);
  assert.deepEqual(calls.map(({ method }) => method), [
    'web.stream.open',
    'web.stream.next',
    'web.stream.next',
  ]);
  assert.deepEqual(calls[0].params, {
    endpoint: 'session/follow',
    args: { address: { kind: 'session', sessionId: 'session-1' } },
  });
  assert.equal(uplinkIteratorCalls, 0);
  assert.equal(uplinkNextCalls, 0);
  assert.equal(uplink.items.length, 1);
  assert.equal(JSON.stringify(calls).includes('client-only-data'), false);

  controller.abort();
  assert.equal((await stream.next()).done, true);
  await Promise.resolve();
  assert.deepEqual(calls.map(({ method }) => method), [
    'web.stream.open',
    'web.stream.next',
    'web.stream.next',
    'web.stream.close',
  ]);
  assert.equal(uplinkIteratorCalls, 0);
  assert.equal(uplinkNextCalls, 0);
  assert.equal(uplink.items.length, 1);
});

test('dsh-context fetch routes map real page requests to narrow web.invoke arguments', async () => {
  const cases = [
    {
      kind: 'context',
      input: 'api/dsh-context/detail',
      body: { sessionId: 'detail-session' },
      endpoint: 'dshContext/detail',
      args: { sessionId: 'detail-session' },
    },
    {
      kind: 'team',
      input: '/api/dsh-context/fleet',
      body: { full: true, sessionId: 'team-session' },
      endpoint: 'dshContext/fleet',
      args: { sessionId: 'team-session', full: true },
    },
    {
      kind: 'team',
      input: 'api/dsh-context/fleet',
      body: { full: false },
      endpoint: 'dshContext/fleet',
      args: { sessionId: 'page-session', full: false },
    },
    {
      kind: 'context',
      input: 'dsbot-ui://page-1/api/dsh-context/skills',
      body: { cwd: '/Users/private/project', sessionId: null },
      endpoint: 'dshContext/skills',
      args: { sessionId: 'page-session' },
    },
  ];

  for (const route of cases) {
    const harness = await makeHarness({ kind: route.kind });
    const response = await fetchInPage(
      harness.context,
      route.input,
      JSON.stringify(route.body),
    );
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
    assert.deepEqual(await response.json(), { ok: true, value: { source: 'remote' } });
    assert.deepEqual(harness.calls, [{
      method: 'web.invoke',
      params: { endpoint: route.endpoint, args: route.args },
    }]);
    assert.equal(harness.resourceFetches.length, 0);
    assert.equal(JSON.stringify(harness.calls).includes('private/project'), false);
    assert.equal(JSON.stringify(harness.calls).includes('credentials'), false);
  }
});

test('dsh-context fetch rejects external, noncanonical, scoped, and malformed requests', async () => {
  const cases = [
    {
      label: 'external origin',
      kind: 'context',
      input: 'https://example.com/api/dsh-context/detail',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'other route',
      kind: 'context',
      input: 'api/dsh-context/other',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'query string',
      kind: 'context',
      input: 'api/dsh-context/detail?extra=1',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'fragment',
      kind: 'context',
      input: 'api/dsh-context/detail#extra',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'URL credentials',
      kind: 'context',
      input: 'dsbot-ui://user:secret@page-1/api/dsh-context/detail',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'path traversal',
      kind: 'context',
      input: 'other/../api/dsh-context/detail',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'fleet outside team page',
      kind: 'context',
      input: 'api/dsh-context/fleet',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'skills outside context/team pages',
      kind: 'trace',
      input: 'api/dsh-context/skills',
      body: { sessionId: 'session-1' },
    },
    {
      label: 'wrong method',
      kind: 'team',
      input: 'api/dsh-context/detail',
      body: { sessionId: 'session-1' },
      init: `{ method: 'GET', headers: { 'content-type': 'application/json' }, body: fetchBody }`,
    },
    {
      label: 'invalid JSON',
      kind: 'team',
      input: 'api/dsh-context/detail',
      body: '{',
    },
    {
      label: 'nonobject JSON',
      kind: 'team',
      input: 'api/dsh-context/detail',
      body: '[]',
    },
    {
      label: 'extra route argument',
      kind: 'team',
      input: 'api/dsh-context/detail',
      body: JSON.stringify({ sessionId: 'session-1', endpoint: 'session/list' }),
    },
    {
      label: 'non-JSON content type',
      kind: 'team',
      input: 'api/dsh-context/detail',
      body: JSON.stringify({ sessionId: 'session-1' }),
      init: `{ method: 'POST', headers: { 'content-type': 'text/plain' }, body: fetchBody }`,
    },
    {
      label: 'extra header',
      kind: 'team',
      input: 'api/dsh-context/detail',
      body: JSON.stringify({ sessionId: 'session-1' }),
      init: `{
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'secret' },
        body: fetchBody,
      }`,
    },
    {
      label: 'credentials option',
      kind: 'team',
      input: 'api/dsh-context/detail',
      body: JSON.stringify({ sessionId: 'session-1' }),
      init: `{
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: fetchBody,
        credentials: 'include',
      }`,
    },
  ];

  for (const request of cases) {
    const harness = await makeHarness({ kind: request.kind });
    await assert.rejects(
      fetchInPage(
        harness.context,
        request.input,
        request.body,
        request.init,
      ),
      { name: 'TypeError' },
      request.label,
    );
    assert.deepEqual(harness.calls, [], request.label);
    assert.equal(harness.resourceFetches.length, 0, request.label);
  }
});

test('dsh-context fetch uses AbortSignal without forwarding credentials or body data', async () => {
  const harness = await makeHarness({ kind: 'team', pendingInvoke: true });
  harness.context.abortController = new AbortController();
  const pending = vm.runInContext(`window.fetch(
    'api/dsh-context/skills',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/private/path', sessionId: 'session-1' }),
      signal: abortController.signal,
    },
  )`, harness.context) as Promise<Response>;

  assert.deepEqual(harness.calls, [{
    method: 'web.invoke',
    params: { endpoint: 'dshContext/skills', args: { sessionId: 'session-1' } },
  }]);
  harness.context.abortController.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  harness.finishInvoke();
  assert.equal(JSON.stringify(harness.calls).includes('/private/path'), false);

  const alreadyAborted = await makeHarness({ kind: 'context' });
  alreadyAborted.context.abortController = new AbortController();
  alreadyAborted.context.abortController.abort();
  await assert.rejects(vm.runInContext(`window.fetch(
    'api/dsh-context/detail',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1' }),
      signal: abortController.signal,
    },
  )`, alreadyAborted.context) as Promise<Response>, { name: 'AbortError' });
  assert.deepEqual(alreadyAborted.calls, []);
});

test('same-page resource fetch still uses the original fetch implementation', async () => {
  const harness = await makeHarness({ kind: 'context' });
  const response = await vm.runInContext(
    `window.fetch('assets/client.js')`,
    harness.context,
  ) as Response;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset');
  assert.equal(harness.resourceFetches.length, 1);
  assert.deepEqual(harness.calls, []);
});

test('failed dsh-context calls log only the endpoint', async () => {
  const harness = await makeHarness({
    kind: 'context',
    invokeResult: {
      ok: false,
      error: { code: 'unavailable', message: 'private response text' },
    },
  });
  const response = await fetchInPage(
    harness.context,
    'api/dsh-context/detail',
    JSON.stringify({ sessionId: 'session-1' }),
  );

  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: 'unavailable', message: 'private response text' },
  });
  assert.deepEqual(harness.calls, [
    {
      method: 'web.invoke',
      params: { endpoint: 'dshContext/detail', args: { sessionId: 'session-1' } },
    },
    {
      method: 'rpc.failure',
      params: { endpoint: 'dshContext/detail' },
    },
  ]);
  assert.equal(JSON.stringify(harness.calls).includes('private response text'), false);
});

test('third-party market GET routes map exact page paths to fixed endpoints', async () => {
  const routes = [
    ['/dsh-market/registry', 'dshMarket/registry'],
    ['/dsh-market/installed', 'dshMarket/installed'],
    ['/dsh-market/status', 'dshMarket/status'],
    ['/dsh-market/updates', 'dshMarket/updates'],
    ['/dsh-market/bundle-order', 'dshMarket/bundleOrder'],
    ['/dsh-market/presets', 'dshMarket/presets'],
    ['/dsh-market/snapshots', 'dshMarket/snapshots'],
    ['/dsh-market/host-recovery', 'dshMarket/hostRecovery'],
  ];

  for (const kind of ['settings', 'plugins']) {
    const harness = await makeHarness({
      kind,
      marketResult: {
        ok: true,
        value: { status: 207, body: { kind, items: ['captured'] } },
      },
    });
    for (const [path, endpoint] of routes) {
      const response = await fetchMarketInPage(
        harness.context,
        path,
        `{ method: 'GET', cache: 'no-store' }`,
      );
      assert.equal(response.status, 207);
      assert.equal(response.ok, true);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
      assert.deepEqual(await response.json(), { kind, items: ['captured'] });
    }
    assert.deepEqual(harness.calls, routes.map(([, endpoint]) => ({
      method: 'web.invoke',
      params: { endpoint, args: {} },
    })));
    assert.equal(harness.resourceFetches.length, 0);
    assert.equal(JSON.stringify(harness.calls).includes('credentials'), false);
  }
});

test('third-party market supports default GET and preserves upstream status and JSON body', async () => {
  const harness = await makeHarness({
    kind: 'plugins',
    marketResult: {
      ok: true,
      value: { status: 404, body: { error: 'not installed' } },
    },
  });
  const response = await fetchMarketInPage(harness.context, 'dsh-market/installed');

  assert.equal(response.status, 404);
  assert.equal(response.ok, false);
  assert.deepEqual(await response.json(), { error: 'not installed' });
  assert.deepEqual(harness.calls, [{
    method: 'web.invoke',
    params: { endpoint: 'dshMarket/installed', args: {} },
  }]);
});

test('third-party market rejects unsupported routes, pages, and fetch options without native fetch', async () => {
  const requests = [
    { label: 'change operation', kind: 'plugins', path: '/dsh-market/changes', init: '{}' },
    { label: 'restart operation', kind: 'settings', path: '/dsh-market/restart', init: '{}' },
    { label: 'backup operation', kind: 'settings', path: '/dsh-market/backup', init: '{}' },
    { label: 'logs route', kind: 'settings', path: '/dsh-market/logs', init: '{}' },
    { label: 'unknown route', kind: 'plugins', path: '/dsh-market/arbitrary', init: '{}' },
    { label: 'query', kind: 'plugins', path: '/dsh-market/registry?extra=1', init: '{}' },
    { label: 'fragment', kind: 'plugins', path: '/dsh-market/registry#extra', init: '{}' },
    { label: 'encoded path', kind: 'plugins', path: '/dsh-market/%72egistry', init: '{}' },
    { label: 'traversal', kind: 'plugins', path: '/dsh-market/../api/unrelated', init: '{}' },
    { label: 'wrong page', kind: 'context', path: '/dsh-market/registry', init: '{}' },
    { label: 'POST', kind: 'plugins', path: '/dsh-market/registry', init: `{ method: 'POST' }` },
    { label: 'body', kind: 'plugins', path: '/dsh-market/registry', init: `{ body: '{}' }` },
    { label: 'header', kind: 'plugins', path: '/dsh-market/registry', init: `{ headers: { accept: 'application/json' } }` },
    { label: 'credentials', kind: 'plugins', path: '/dsh-market/registry', init: `{ credentials: 'include' }` },
    { label: 'cache policy', kind: 'plugins', path: '/dsh-market/registry', init: `{ cache: 'force-cache' }` },
  ];

  for (const request of requests) {
    const harness = await makeHarness({ kind: request.kind });
    await assert.rejects(
      fetchMarketInPage(harness.context, request.path, request.init),
      { name: 'TypeError' },
      request.label,
    );
    assert.deepEqual(harness.calls, [], request.label);
    assert.equal(harness.resourceFetches.length, 0, request.label);
  }

  const external = await makeHarness({ kind: 'plugins' });
  await assert.rejects(
    fetchMarketInPage(
      external.context,
      'https://example.com/dsh-market/registry',
    ),
    { name: 'TypeError' },
  );
  assert.deepEqual(external.calls, []);
  assert.equal(external.resourceFetches.length, 0);
});

test('unsupported market writes return a definite refusal without contacting the host or resource fetch', async () => {
  const harness = await makeHarness({ kind: 'settings' });
  const response = await fetchMarketInPage(harness.context, '/dsh-market/install',
    `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"https://example.com"}' }`);
  assert.equal(response.status, 501);
  assert.equal((await response.json()).ok, false);
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.resourceFetches.length, 0);
});

test('third-party market bridge failures return concise JSON and log only the endpoint', async () => {
  const harness = await makeHarness({
    kind: 'settings',
    marketResult: {
      ok: false,
      error: { code: 'offline', message: 'private upstream details' },
    },
  });
  const response = await fetchMarketInPage(harness.context, '/dsh-market/status');

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: 'gateway/unavailable',
      message: '第三方市场暂时无法读取，请稍后重试。',
      details: {},
    },
  });
  assert.deepEqual(harness.calls, [
    {
      method: 'web.invoke',
      params: { endpoint: 'dshMarket/status', args: {} },
    },
    {
      method: 'rpc.failure',
      params: { endpoint: 'dshMarket/status' },
    },
  ]);
  assert.equal(JSON.stringify(harness.calls).includes('private upstream details'), false);
});

test('third-party market fetch honors AbortSignal without sending request data', async () => {
  const harness = await makeHarness({ kind: 'settings', pendingInvoke: true });
  harness.context.abortController = new AbortController();
  const pending = vm.runInContext(`window.fetch(
    '/dsh-market/registry',
    { cache: 'no-store', signal: abortController.signal },
  )`, harness.context) as Promise<Response>;

  assert.deepEqual(harness.calls, [{
    method: 'web.invoke',
    params: { endpoint: 'dshMarket/registry', args: {} },
  }]);
  harness.context.abortController.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  harness.finishInvoke({
    ok: true,
    value: { status: 200, body: { shouldNotBeRead: true } },
  });
  assert.equal(JSON.stringify(harness.calls).includes('shouldNotBeRead'), false);
});

test('HTTP page RPC uses scoped same-origin fetch and never posts page calls to the native bridge', async () => {
  const harness = await makeHarness({
    kind: 'trace',
    transport: 'http',
    httpResponder: async (_input, init) => new Response(
      JSON.stringify({ ok: true, value: { source: 'native-pages' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  });
  const result = await vm.runInContext(`window.__DSH_TRANSPORT__.rpc.call(
    '/api',
    'session/list',
    { args: { _request: { cursor: 'next-page' } } },
  )`, harness.context) as Record<string, unknown>;

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    value: { source: 'native-pages' },
  });
  assert.equal(harness.resourceFetches.length, 1);
  const [input, init] = harness.resourceFetches[0] as [string, Record<string, unknown>];
  assert.equal(input, `https://device.test${harness.basePath}rpc`);
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.redirect, 'error');
  assert.deepEqual(JSON.parse(JSON.stringify(init.headers)), {
    'content-type': 'application/json',
    'X-DSBot-Page': '1',
  });
  assert.deepEqual(JSON.parse(String(init.body)), {
    method: 'web.invoke',
    params: { endpoint: 'session/list', args: { _request: { cursor: 'next-page' } } },
  });
  assert.deepEqual(harness.calls, []);
  assert.equal(
    vm.runInContext("'pairingToken' in window.__DSBOT_NATIVE__.page", harness.context),
    false,
  );
});

test('HTTP page RPC maps 401 to a safe auth failure and settings writes notify the native store', async () => {
  const unauthorized = await makeHarness({
    kind: 'trace',
    transport: 'http',
    httpResponder: async () => new Response(
      JSON.stringify({ error: { code: 'AUTH_FAILED', message: 'private server detail' } }),
      { status: 401 },
    ),
  });
  const failed = await vm.runInContext(`window.__DSH_TRANSPORT__.rpc.call(
    '/api', 'session/list', { args: {} },
  )`, unauthorized.context) as Record<string, any>;
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'AUTH_FAILED');
  assert.equal(failed.error.message, '请重新连接电脑。');
  assert.doesNotMatch(JSON.stringify(failed), /private server detail/u);
  assert.deepEqual(unauthorized.calls, [{
    method: 'rpc.failure',
    params: { endpoint: 'session/list' },
  }]);

  const settings = await makeHarness({
    kind: 'settings',
    transport: 'http',
    httpResponder: async () => new Response(
      JSON.stringify({ ok: true, value: { revision: 4 } }),
      { status: 200 },
    ),
  });
  const updated = await vm.runInContext(`window.__DSH_TRANSPORT__.rpc.call(
    '/api',
    'settings/replace',
    { args: { ns: 'general', section: 'appearance', expectedRevision: 3 } },
  )`, settings.context) as Record<string, any>;
  assert.equal(updated.ok, true);
  assert.deepEqual(settings.calls, [{
    method: 'settings.mutated',
    params: {},
  }]);
  assert.equal(settings.resourceFetches.length, 1);
});

test('HTTP downlink streams use scoped HTTP RPC and ignore the gateway uplink queue', async () => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  let downlinkSequence = 0;
  const harness = await makeHarness({
    kind: 'trace',
    transport: 'http',
    httpResponder: async (_input, init) => {
      const request = JSON.parse(String(init.body)) as {
        method: string;
        params: Record<string, unknown>;
      };
      requests.push(request);
      if (request.method === 'web.stream.open') {
        return new Response(JSON.stringify({ streamId: 'http-stream-1' }), { status: 200 });
      }
      if (request.method === 'web.stream.next') {
        return new Response(JSON.stringify({
          items: [{ type: 'event', seq: ++downlinkSequence }],
          done: false,
        }), { status: 200 });
      }
      if (request.method === 'web.stream.close') {
        return new Response('{}', { status: 200 });
      }
      assert.fail(`unexpected HTTP page RPC: ${request.method}`);
    },
  });
  const uplinkItems = [{ type: 'private-uplink', value: 'must remain local' }];
  let uplinkReads = 0;
  const uplink = {
    items: uplinkItems,
    [Symbol.asyncIterator]() {
      return {
        async next() {
          uplinkReads += 1;
          return { done: false, value: uplinkItems[0] };
        },
      };
    },
  };
  const stream = vm.runInContext(`window.__DSH_TRANSPORT__.rpc.open(
    '/api',
    'session/follow',
    { args: { address: { kind: 'session', sessionId: 'session-1' } } },
    undefined,
    uplinkValue,
  )`, Object.assign(harness.context, { uplinkValue: uplink })) as AsyncIterableIterator<{
    type: string;
    seq: number;
  }>;

  const first = await stream.next();
  const second = await stream.next();
  assert.equal(first.value?.seq, 1);
  assert.equal(second.value?.seq, 2);
  await stream.return?.();
  assert.deepEqual(requests.map(({ method }) => method), [
    'web.stream.open',
    'web.stream.next',
    'web.stream.next',
    'web.stream.close',
  ]);
  assert.deepEqual(requests[0].params, {
    endpoint: 'session/follow',
    args: { address: { kind: 'session', sessionId: 'session-1' } },
  });
  assert.deepEqual(harness.calls, []);
  assert.equal(uplinkReads, 0);
  assert.equal(uplinkItems.length, 1);
  assert.equal(JSON.stringify(requests).includes('private-uplink'), false);
});

test('HTTP fetch scopes root assets and existing context and market read routes', async () => {
  const harness = await makeHarness({
    kind: 'team',
    transport: 'http',
    httpResponder: async (input, init) => {
      if (input.endsWith('/rpc')) {
        const request = JSON.parse(String(init.body)) as {
          method: string;
          params: { endpoint: string };
        };
        assert.equal(request.method, 'web.invoke');
        assert.equal(request.params.endpoint, 'dshContext/skills');
        return new Response(JSON.stringify({ ok: true, value: { skills: ['real'] } }), { status: 200 });
      }
      return new Response('asset-body', { status: 200 });
    },
  });

  const asset = await vm.runInContext(
    `window.fetch('/assets/mobile.css')`,
    harness.context,
  ) as Response;
  assert.equal(await asset.text(), 'asset-body');

  const contextResponse = await fetchInPage(
    harness.context,
    '/api/dsh-context/skills',
    JSON.stringify({ sessionId: 'team-session', cwd: '/private/path' }),
  );
  assert.deepEqual(await contextResponse.json(), {
    ok: true,
    value: { skills: ['real'] },
  });

  assert.deepEqual(harness.resourceFetches.map(([input]) => input), [
    `https://device.test${harness.basePath}assets/mobile.css`,
    `https://device.test${harness.basePath}rpc`,
  ]);
  const contextInit = harness.resourceFetches[1][1] as Record<string, unknown>;
  assert.deepEqual(JSON.parse(String(contextInit.body)), {
    method: 'web.invoke',
    params: {
      endpoint: 'dshContext/skills',
      args: { sessionId: 'team-session' },
    },
  });
  assert.equal(contextInit.credentials, 'same-origin');
  assert.equal(contextInit.redirect, 'error');
  assert.deepEqual(harness.calls, []);
  assert.equal(JSON.stringify(harness.resourceFetches).includes('/private/path'), false);

  const market = await makeHarness({
    kind: 'plugins',
    transport: 'http',
    httpResponder: async (input, init) => {
      assert.match(input, /\/dsbot\/ui\/[0-9a-f-]+\/rpc$/u);
      const request = JSON.parse(String(init.body)) as {
        method: string;
        params: { endpoint: string };
      };
      assert.equal(request.method, 'web.invoke');
      assert.equal(request.params.endpoint, 'dshMarket/registry');
      return new Response(JSON.stringify({
        ok: true,
        value: { status: 200, body: { items: ['market'] } },
      }), { status: 200 });
    },
  });
  const marketResponse = await fetchMarketInPage(market.context, '/dsh-market/registry');
  assert.deepEqual(await marketResponse.json(), { items: ['market'] });
  assert.equal(
    (market.resourceFetches[0][0] as string),
    `https://device.test${market.basePath}rpc`,
  );
  assert.deepEqual(market.calls, []);
});

test('HTTP bundle URLs are scoped once and external or encoded traversal paths are rejected', async () => {
  const harness = await makeHarness({
    kind: 'plugins',
    transport: 'http',
    httpResponder: async () => new Response('asset', { status: 200 }),
  });

  await vm.runInContext(`window.__DSH_TRANSPORT__.loadBundle(
    '/plugins/??@deepseek-ai/example/client.js&rev=abc',
  )`, harness.context);
  await vm.runInContext(`window.__DSH_TRANSPORT__.loadBundle(
    '${harness.basePath}plugins/second.js',
  )`, harness.context);
  assert.equal(harness.appendedScripts.length, 2);
  assert.equal(
    harness.appendedScripts[0].src,
    `https://device.test${harness.basePath}plugins/??@deepseek-ai/example/client.js&rev=abc`,
  );
  assert.equal(
    harness.appendedScripts[1].src,
    `https://device.test${harness.basePath}plugins/second.js`,
  );

  await assert.rejects(
    fetchInPage(harness.context, 'https://outside.test/assets/file', '{}'),
    { name: 'TypeError' },
  );
  await assert.rejects(
    fetchInPage(harness.context, '/assets/%252e%252e/private', '{}'),
    { name: 'TypeError' },
  );
  await assert.rejects(
    fetchInPage(
      harness.context,
      '/dsbot/ui/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/assets/private',
      '{}',
    ),
    { name: 'TypeError' },
  );
  await assert.rejects(vm.runInContext(`window.__DSH_TRANSPORT__.loadBundle(
    'https://outside.test/plugins/evil.js',
  )`, harness.context), { message: 'UNSUPPORTED' });
  await assert.rejects(vm.runInContext(`window.__DSH_TRANSPORT__.loadBundle(
    '/plugins/%252e%252e/private.js',
  )`, harness.context), { message: 'UNSUPPORTED' });

  assert.equal(harness.resourceFetches.length, 0);
  assert.equal(harness.appendedScripts.length, 2);
  assert.deepEqual(harness.calls, [
    { method: 'bootstrap.failure', params: { kind: 'resource' } },
    { method: 'bootstrap.failure', params: { kind: 'resource' } },
  ]);
});

// ---- A terminal's duplex stream ----------------------------------------------------------------

/** What DSH's Gateway client hands a transport as the uplink: a single-reader queue of the page's items. */
function createUplinkQueue() {
  const items: unknown[] = [];
  let ended = false;
  let closed = false;
  let wake: (() => void) | undefined;
  const signal = () => { const resume = wake; wake = undefined; resume?.(); };
  return {
    push(item: unknown) { items.push(item); signal(); },
    end() { ended = true; signal(); },
    close() { closed = true; signal(); },
    get isClosed() { return closed; },
    [Symbol.asyncIterator]() { return this; },
    async next() {
      for (;;) {
        if (closed) return { done: true, value: undefined };
        if (items.length) return { done: false, value: items.shift() };
        if (ended) return { done: true, value: undefined };
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
    return() { this.close(); return Promise.resolve({ done: true, value: undefined }); },
  };
}

const settle = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

/** A desktop that holds `web.stream.next` open like the real long poll, and records every request. */
function terminalDesktop({ nextReplies = [] as unknown[], sendReply = {} as unknown } = {}) {
  const requests: Array<{ method: string; params: Record<string, any> }> = [];
  let release: (() => void) | undefined;
  const closedByPage = new Promise<void>((resolve) => { release = resolve; });
  const replies = [...nextReplies];
  return {
    requests,
    release: () => release?.(),
    sends: () => requests.filter((request) => request.method === 'web.stream.send').map((request) => request.params),
    async respond(_input: string, init: Record<string, unknown>) {
      const request = JSON.parse(String(init.body)) as { method: string; params: Record<string, any> };
      requests.push(request);
      switch (request.method) {
        case 'web.stream.open': return json({ streamId: 'terminal-stream' });
        case 'web.stream.next': {
          const reply = replies.shift();
          if (reply !== undefined) return json(reply);
          await closedByPage;
          return json({ items: [], done: true });
        }
        case 'web.stream.send': return json(sendReply);
        case 'web.stream.close': release?.(); return json({});
        default: assert.fail(`unexpected HTTP page RPC: ${request.method}`);
      }
    },
  };
}

async function openTerminal(desktop: ReturnType<typeof terminalDesktop>, uplink: unknown, endpoint = 'terminal/attach') {
  const harness = await makeHarness({ kind: 'dock', transport: 'http', httpResponder: desktop.respond });
  const stream = vm.runInContext(`window.__DSH_TRANSPORT__.rpc.open(
    '/api', ${JSON.stringify(endpoint)}, { args: { agentId: 'page-session', id: 'terminal-one' } }, undefined, uplinkValue,
  )`, Object.assign(harness.context, { uplinkValue: uplink })) as AsyncIterableIterator<any>;
  return { harness, stream };
}

test('a terminal\'s keystrokes go up in order, a batch at a time, and the end of the uplink ends the stream', async () => {
  const desktop = terminalDesktop();
  const uplink = createUplinkQueue();
  const { stream } = await openTerminal(desktop, uplink);
  const pending = stream.next();
  await settle();

  const write = (sequence: number, data: string) => ({ type: 'write', sequence, data });
  uplink.push(write(1, 'l'));
  uplink.push(write(2, 's'));
  uplink.push(write(3, '\r'));
  await settle();
  assert.deepEqual(desktop.sends(), [{
    streamId: 'terminal-stream', items: [write(1, 'l'), write(2, 's'), write(3, '\r')],
  }], 'what was already queued travels in one request');

  uplink.push({ type: 'resize', sequence: 4, cols: 100, rows: 30 });
  await settle();
  assert.equal(desktop.sends().length, 2);
  assert.deepEqual(desktop.sends()[1].items, [{ type: 'resize', sequence: 4, cols: 100, rows: 30 }]);

  uplink.end();
  await settle();
  assert.deepEqual(desktop.sends()[2], { streamId: 'terminal-stream', items: [], end: true });

  await stream.return?.();
  desktop.release();
  assert.equal((await pending).done, true);
});

test('requests carrying keystrokes never overlap, so they cannot arrive out of order', async () => {
  const gates: Array<() => void> = [];
  let inFlight = 0;
  let overlapped = false;
  const requests: Array<{ method: string; params: Record<string, any> }> = [];
  let release: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { release = resolve; });
  const harness = await makeHarness({
    kind: 'dock',
    transport: 'http',
    httpResponder: async (_input, init) => {
      const request = JSON.parse(String(init.body)) as { method: string; params: Record<string, any> };
      requests.push(request);
      if (request.method === 'web.stream.open') return json({ streamId: 'terminal-stream' });
      if (request.method === 'web.stream.next') { await closed; return json({ items: [], done: true }); }
      if (request.method === 'web.stream.close') { release?.(); return json({}); }
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await new Promise<void>((resolve) => { gates.push(resolve); });
      inFlight -= 1;
      return json({});
    },
  });
  const uplink = createUplinkQueue();
  const stream = vm.runInContext(`window.__DSH_TRANSPORT__.rpc.open(
    '/api', 'terminal/attach', { args: {} }, undefined, uplinkValue,
  )`, Object.assign(harness.context, { uplinkValue: uplink })) as AsyncIterableIterator<any>;
  const pending = stream.next();
  await settle();

  uplink.push({ type: 'write', sequence: 1, data: 'a' });
  await settle();
  uplink.push({ type: 'write', sequence: 2, data: 'b' });
  uplink.push({ type: 'write', sequence: 3, data: 'c' });
  await settle();
  assert.equal(gates.length, 1, 'the second request waits for the first to be answered');
  gates.shift()?.();
  await settle();
  assert.equal(gates.length, 1);
  gates.shift()?.();
  await settle();
  assert.equal(overlapped, false);
  assert.deepEqual(
    requests.filter((request) => request.method === 'web.stream.send').flatMap((request) => request.params.items.map((item: any) => item.sequence)),
    [1, 2, 3],
  );
  await stream.return?.();
  release?.();
  await pending;
});

test('a large paste is split to fit a request, and no keystroke is dropped or reordered', async () => {
  const desktop = terminalDesktop();
  const uplink = createUplinkQueue();
  const { stream } = await openTerminal(desktop, uplink);
  const pending = stream.next();
  await settle();

  const chunk = 'x'.repeat(60 * 1024);
  for (let sequence = 1; sequence <= 20; sequence += 1) uplink.push({ type: 'write', sequence, data: chunk });
  await settle(40);
  const sends = desktop.sends();
  assert.ok(sends.length > 1, 'twenty chunks are more than one request carries');
  for (const send of sends) {
    assert.ok(JSON.stringify(send).length < 900 * 1024, 'each request stays under the page limit');
    assert.ok(send.items.length <= 64);
  }
  assert.deepEqual(sends.flatMap((send) => send.items.map((item: any) => item.sequence)),
    Array.from({ length: 20 }, (_, index) => index + 1));
  await stream.return?.();
  desktop.release();
  await pending;
});

test('input the desktop did not accept ends the stream, so the page can offer a reconnect', async () => {
  const desktop = terminalDesktop({ sendReply: { error: { code: 'LIMIT_EXCEEDED', message: 'x' } } });
  const uplink = createUplinkQueue();
  const { stream } = await openTerminal(desktop, uplink);
  const pending = stream.next();
  await settle();

  uplink.push({ type: 'write', sequence: 1, data: 'a' });
  await settle();
  assert.ok(desktop.requests.some((request) => request.method === 'web.stream.close'), 'the stream is closed');
  assert.equal(uplink.isClosed, true, 'and the Gateway client is told it can no longer send');
  assert.equal((await pending).done, true);
});

test('closing the stream wakes a pump that is waiting for a keystroke', async () => {
  const desktop = terminalDesktop();
  const uplink = createUplinkQueue();
  const { stream } = await openTerminal(desktop, uplink);
  const pending = stream.next();
  await settle();
  await stream.return?.();
  await settle();
  assert.equal(uplink.isClosed, true);
  assert.deepEqual(desktop.sends(), [], 'nothing is sent for a stream that was closed');
  desktop.release();
  await pending;
});

test('only a terminal\'s stream carries its uplink; others still ignore it', async () => {
  const desktop = terminalDesktop({ nextReplies: [{ items: [{ n: 1 }], done: false }] });
  const uplink = createUplinkQueue();
  uplink.push({ type: 'write', sequence: 1, data: 'x' });
  const { stream } = await openTerminal(desktop, uplink, 'terminal/retain');
  assert.equal((await stream.next()).value.n, 1);
  await stream.return?.();
  await settle();
  assert.deepEqual(desktop.sends(), []);
});

test('output delivered together with the end is still delivered', async () => {
  const desktop = terminalDesktop({ nextReplies: [{ items: [{ n: 1 }, { n: 2 }], done: true }] });
  const { stream } = await openTerminal(desktop, createUplinkQueue());
  const seen = [];
  for (let index = 0; index < 3; index += 1) {
    const next = await stream.next();
    if (next.done) break;
    seen.push(next.value.n);
  }
  assert.deepEqual(seen, [1, 2]);
});
