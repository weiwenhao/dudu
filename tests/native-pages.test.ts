import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNativePages,
  NATIVE_PAGE_METHODS,
} from '../host/native-pages.mjs';

const SESSION_ID = 'session-alpha';
const sessionAddress = (sessionId = SESSION_ID) => ({ kind: 'session', sessionId });
const followArgs = (sessionId = SESSION_ID) => ({
  request: { address: sessionAddress(sessionId), assistantStream: true },
});

function createFrontend(assets = new Map()) {
  const calls = { documents: [], resources: [] };
  return {
    calls,
    async document(descriptor) {
      calls.documents.push(descriptor);
      return {
        html: '<!doctype html><html lang="zh-Hans"><script src="/assets/page.js"></script></html>',
        async resource(path) {
          calls.resources.push(path);
          const asset = assets.get(path);
          return asset && { data: asset.data, mimeType: asset.mimeType };
        },
      };
    },
  };
}

function createHarness({ frontend = createFrontend(), pageRpc = {}, resourceTimeoutMs } = {}) {
  const rpc = {
    async invoke() { return { ok: true, value: {} }; },
    async open() {
      return { async *[Symbol.asyncIterator]() {} };
    },
    ...pageRpc,
  };
  return {
    frontend,
    pageRpc: rpc,
    pages: createNativePages({ frontend, pageRpc: rpc, resourceTimeoutMs }),
    connection: { closed: false },
  };
}

async function openPage(pages, connection, page = 'plugins', sessionId) {
  return pages.dispatch('web.open', {
    page,
    ...(sessionId ? { sessionId } : {}),
  }, connection);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('exports the authenticated embedded-page methods and validates page identity', async () => {
  assert.deepEqual(NATIVE_PAGE_METHODS, [
    'web.open', 'web.resource', 'web.invoke', 'web.close',
    'web.stream.open', 'web.stream.next', 'web.stream.send', 'web.stream.close',
  ]);
  const { pages, connection, frontend } = createHarness();
  await assert.rejects(openPage(pages, connection, 'public-url'), { code: 'BAD_REQUEST' });
  await assert.rejects(openPage(pages, connection, 'trace'), { code: 'BAD_REQUEST' });
  await assert.rejects(pages.dispatch('web.open', { page: 'trace', sessionId: 'bad\nvalue' }, connection), {
    code: 'BAD_REQUEST',
  });
  await assert.rejects(pages.dispatch('web.open', { page: 'plugins' }, { closed: true }), {
    code: 'NOT_FOUND',
  });
  assert.deepEqual(frontend.calls.documents, []);
});

test('serves only document-provider manifest resources and rejects URL and traversal paths', async () => {
  const source = new TextEncoder().encode('bundled frontend asset');
  const frontend = createFrontend(new Map([
    ['/assets/page.js', { data: source, mimeType: 'text/javascript; charset=utf-8' }],
  ]));
  const { pages, connection } = createHarness({ frontend });
  const page = await openPage(pages, connection);
  assert.deepEqual(frontend.calls.documents, [{ kind: 'plugins', sessionId: undefined }]);

  const result = await pages.dispatch('web.resource', {
    id: page.id,
    path: '/assets/page.js',
  }, connection);
  assert.equal(result.mimeType, 'text/javascript; charset=utf-8');
  assert.deepEqual(Buffer.from(result.dataBase64, 'base64'), Buffer.from(source));
  assert.equal(result.eof, true);

  for (const path of [
    'https://example.invalid/page.js',
    'file:///etc/passwd',
    '//example.invalid/page.js',
    '/%2e%2e/etc/passwd',
    '/%2fetc/passwd',
    '/%5cetc/passwd',
    '/assets/page.js#fragment',
    '/assets\\..\\secret',
  ]) {
    await assert.rejects(pages.dispatch('web.resource', {
      id: page.id, path, offset: 0,
    }, connection), { code: 'NOT_FOUND' }, path);
  }
  await assert.rejects(pages.dispatch('web.resource', {
    id: page.id, path: '/assets/not-in-manifest.js', offset: 0,
  }, connection), { code: 'NOT_FOUND' });
  assert.deepEqual(frontend.calls.resources, ['/assets/page.js', '/assets/not-in-manifest.js']);
});

test('serves direct HTTP documents and raw manifest resources per connection and page id', async () => {
  const source = Buffer.from('HTTP frontend asset');
  const frontend = createFrontend(new Map([
    ['/assets/page.js', { data: source, mimeType: 'text/javascript; charset=utf-8' }],
  ]));
  const { pages, connection } = createHarness({ frontend });
  const page = await pages.openHttp({ page: 'plugins' }, connection);
  const basePath = `/dsbot/ui/${page.id}/`;

  assert.match(page.id, /^[0-9a-f-]{36}$/iu);
  assert.deepEqual(frontend.calls.documents, [{
    kind: 'plugins', sessionId: undefined, transport: 'http', basePath,
  }]);
  assert.equal(await pages.documentHttp({ id: page.id }, connection), page.html);

  const asset = await pages.resourceHttp({
    id: page.id, path: `${basePath}assets/page.js`,
  }, connection);
  assert.equal(asset.mimeType, 'text/javascript; charset=utf-8');
  assert.ok(Buffer.isBuffer(asset.data));
  assert.deepEqual(asset.data, source);
  assert.equal('dataBase64' in asset, false);

  await assert.rejects(pages.documentHttp({ id: page.id }, { closed: false }), { code: 'NOT_FOUND' });
  await assert.rejects(pages.resourceHttp({
    id: page.id, path: `/dsbot/ui/${'0'.repeat(8)}-0000-0000-0000-000000000000/assets/page.js`,
  }, connection), { code: 'NOT_FOUND' });
  await assert.rejects(pages.resourceHttp({
    id: page.id, path: `${basePath}../../etc/passwd`,
  }, connection), { code: 'NOT_FOUND' });

  await pages.dispatch('web.close', { id: page.id }, connection);
  await assert.rejects(pages.documentHttp({ id: page.id }, connection), { code: 'NOT_FOUND' });
});

test('returns large manifest resources as lossless bounded chunks', async () => {
  const bytes = Uint8Array.from({ length: 192 * 1024 + 17 }, (_, index) => index % 251);
  const frontend = createFrontend(new Map([
    ['/assets/large.bin', { data: bytes, mimeType: 'application/octet-stream' }],
  ]));
  const { pages, connection } = createHarness({ frontend });
  const page = await openPage(pages, connection);
  const first = await pages.dispatch('web.resource', {
    id: page.id, path: '/assets/large.bin', offset: 0,
  }, connection);
  const firstBytes = Buffer.from(first.dataBase64, 'base64');
  assert.equal(firstBytes.byteLength, 192 * 1024);
  assert.equal(first.totalBytes, bytes.byteLength);
  assert.equal(first.eof, false);

  const second = await pages.dispatch('web.resource', {
    id: page.id, path: '/assets/large.bin', offset: firstBytes.byteLength,
  }, connection);
  const restored = Buffer.concat([firstBytes, Buffer.from(second.dataBase64, 'base64')]);
  assert.equal(second.eof, true);
  assert.deepEqual(restored, Buffer.from(bytes));
  assert.equal(frontend.calls.resources.filter((path) => path === '/assets/large.bin').length, 1);
});

test('caps cached resources at 128 MiB per page and keeps the 40 MiB per-resource limit', async () => {
  const mib = 1024 * 1024;
  const sizes = new Map([
    ['/assets/too-large.bin', 40 * mib + 1],
    ['/assets/a.bin', 40 * mib],
    ['/assets/b.bin', 40 * mib],
    ['/assets/c.bin', 40 * mib],
    ['/assets/d.bin', 8 * mib],
    ['/assets/over-budget.bin', 1],
  ]);
  const calls = [];
  const frontend = {
    async document() {
      return {
        html: '<!doctype html><html></html>',
        async resource(path) {
          calls.push(path);
          const size = sizes.get(path);
          return size === undefined ? undefined : {
            data: new Uint8Array(size),
            mimeType: 'application/octet-stream',
          };
        },
      };
    },
  };
  const { pages, connection } = createHarness({ frontend });
  const page = await openPage(pages, connection);

  await assert.rejects(pages.dispatch('web.resource', {
    id: page.id, path: '/assets/too-large.bin', offset: 0,
  }, connection), { code: 'LIMIT_EXCEEDED' });
  for (const path of ['/assets/a.bin', '/assets/b.bin', '/assets/c.bin', '/assets/d.bin']) {
    await pages.dispatch('web.resource', { id: page.id, path, offset: 0 }, connection);
  }
  await assert.rejects(pages.dispatch('web.resource', {
    id: page.id, path: '/assets/over-budget.bin', offset: 0,
  }, connection), { code: 'LIMIT_EXCEEDED' });
  assert.equal(calls.length, 6);
});

test('page close cancels resource waits and late provider results are not cached', async () => {
  const started = deferred();
  const lateResult = deferred();
  let resourceSignal;
  let resourceCalls = 0;
  const frontend = {
    async document() {
      return {
        html: '<!doctype html><html></html>',
        resource(_path, options) {
          resourceCalls += 1;
          resourceSignal = options.signal;
          started.resolve();
          return lateResult.promise;
        },
      };
    },
  };
  const { pages, connection } = createHarness({ frontend });
  const page = await openPage(pages, connection);
  const loading = pages.dispatch('web.resource', {
    id: page.id, path: '/assets/page.js', offset: 0,
  }, connection);
  await started.promise;

  await pages.dispatch('web.close', { id: page.id }, connection);
  await assert.rejects(loading, { code: 'NOT_FOUND' });
  assert.equal(resourceSignal.aborted, true);

  lateResult.resolve({
    data: new TextEncoder().encode('late asset'),
    mimeType: 'text/javascript',
  });
  await lateResult.promise;
  await assert.rejects(pages.dispatch('web.resource', {
    id: page.id, path: '/assets/page.js', offset: 0,
  }, connection), { code: 'NOT_FOUND' });
  assert.equal(resourceCalls, 1);
});

test('resource timeout aborts the provider and allows a clean retry', async () => {
  const signals = [];
  let resourceCalls = 0;
  const frontend = {
    async document() {
      return {
        html: '<!doctype html><html></html>',
        resource(_path, options) {
          resourceCalls += 1;
          signals.push(options.signal);
          if (resourceCalls === 1) return new Promise(() => {});
          return Promise.resolve({
            data: new TextEncoder().encode('retried asset'),
            mimeType: 'text/javascript',
          });
        },
      };
    },
  };
  const { pages, connection } = createHarness({ frontend, resourceTimeoutMs: 10 });
  const page = await openPage(pages, connection);

  await assert.rejects(pages.dispatch('web.resource', {
    id: page.id, path: '/assets/retry.js', offset: 0,
  }, connection), { code: 'UPSTREAM_UNAVAILABLE' });
  assert.equal(signals[0].aborted, true);
  const retried = await pages.dispatch('web.resource', {
    id: page.id, path: '/assets/retry.js', offset: 0,
  }, connection);
  assert.equal(retried.eof, true);
  assert.equal(resourceCalls, 2);
});

test('page ids and resources are scoped to the authenticated connection', async () => {
  const { pages } = createHarness();
  const firstConnection = { closed: false };
  const secondConnection = { closed: false };
  const page = await openPage(pages, firstConnection);
  await assert.rejects(pages.dispatch('web.resource', {
    id: page.id, path: '/assets/page.js', offset: 0,
  }, secondConnection), { code: 'NOT_FOUND' });
  await assert.rejects(pages.dispatch('web.invoke', {
    id: page.id, endpoint: 'session/list', args: {},
  }, secondConnection), { code: 'NOT_FOUND' });

  assert.deepEqual(await pages.dispatch('web.close', { id: page.id }, firstConnection), {});
  assert.deepEqual(await pages.dispatch('web.close', { id: page.id }, firstConnection), {});
  await assert.rejects(pages.dispatch('web.resource', {
    id: page.id, path: '/assets/page.js', offset: 0,
  }, firstConnection), { code: 'NOT_FOUND' });
});

test('invokes config writes only after their namespace or inventory is learned', async () => {
  const calls = [];
  const { pages, connection } = createHarness({
    pageRpc: {
      async invoke(endpoint, args) {
        calls.push({ endpoint, args });
        if (endpoint === 'settings/describe') {
          return { ok: true, value: { namespaces: [{ ns: 'model' }] } };
        }
        if (endpoint === 'credentials/describe') {
          return {
            ok: true,
            value: { 'provider/key': null },
          };
        }
        if (endpoint === 'pluginManager/listPlugins') {
          return { ok: true, value: { plugins: [{ entryId: 'plugin-known' }] } };
        }
        return { ok: true, value: {} };
      },
    },
  });
  const settings = await openPage(pages, connection, 'settings');
  await assert.rejects(pages.dispatch('web.invoke', {
    id: settings.id,
    endpoint: 'settings/update',
    args: { ns: 'model', patch: { selectedModel: 'safe-model' } },
  }, connection), { code: 'BAD_REQUEST' });
  await pages.dispatch('web.invoke', {
    id: settings.id, endpoint: 'settings/describe', args: {},
  }, connection);
  await pages.dispatch('web.invoke', {
    id: settings.id,
    endpoint: 'settings/update',
    args: { ns: 'model', patch: { selectedModel: 'safe-model' } },
  }, connection);
  await assert.rejects(pages.dispatch('web.invoke', {
    id: settings.id,
    endpoint: 'settings/update',
    args: { ns: 'other', patch: { selectedModel: 'unsafe-model' } },
  }, connection), { code: 'BAD_REQUEST' });

  const plugins = await openPage(pages, connection);
  await pages.dispatch('web.invoke', {
    id: plugins.id, endpoint: 'pluginManager/listPlugins', args: {},
  }, connection);
  await assert.rejects(pages.dispatch('web.invoke', {
    id: plugins.id,
    endpoint: 'credentials/set',
    args: { ref: 'provider/key', value: 'secret' },
  }, connection), { code: 'BAD_REQUEST' });
  await pages.dispatch('web.invoke', {
    id: plugins.id,
    endpoint: 'credentials/describe',
    args: { refs: ['provider/key'] },
  }, connection);
  await pages.dispatch('web.invoke', {
    id: plugins.id,
    endpoint: 'credentials/set',
    args: { ref: 'provider/key', value: 'secret' },
  }, connection);
  await pages.dispatch('web.invoke', {
    id: plugins.id,
    endpoint: 'pluginManager/setPluginEnabled',
    args: { id: 'plugin-known', enabled: false },
  }, connection);
  await assert.rejects(pages.dispatch('web.invoke', {
    id: plugins.id,
    endpoint: 'pluginManager/setPluginEnabled',
    args: { id: 'plugin-unlisted', enabled: false },
  }, connection), { code: 'BAD_REQUEST' });

  assert.deepEqual(calls, [
    { endpoint: 'settings/describe', args: {} },
    { endpoint: 'settings/update', args: { ns: 'model', patch: { selectedModel: 'safe-model' } } },
    { endpoint: 'pluginManager/listPlugins', args: {} },
    { endpoint: 'credentials/describe', args: { refs: ['provider/key'] } },
    { endpoint: 'credentials/set', args: { ref: 'provider/key', value: 'secret' } },
    { endpoint: 'pluginManager/setPluginEnabled', args: { id: 'plugin-known', enabled: false } },
  ]);
});

test('trace follow uses named session-scoped arguments and preserves detailed bodies', async () => {
  const detailedEvent = {
    type: 'event',
    event: {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'FULL_TRACE_BODY_FOR_UI' }] } },
    },
  };
  const calls = [];
  let index = 0;
  const { pages, connection } = createHarness({
    pageRpc: {
      async open(endpoint, args) {
        calls.push({ endpoint, args });
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                return index++ === 0
                  ? { done: false, value: detailedEvent }
                  : { done: true, value: undefined };
              },
            };
          },
        };
      },
    },
  });
  const page = await openPage(pages, connection, 'trace', SESSION_ID);
  const args = {
    request: {
      address: sessionAddress(),
      assistantStream: true,
      maxMessages: 100,
      turnWindow: { minMessages: 50, minTurns: 2 },
    },
  };
  const opened = await pages.dispatch('web.stream.open', {
    id: page.id, endpoint: 'session/follow', args,
  }, connection);
  assert.deepEqual(calls, [{ endpoint: 'session/follow', args }]);
  const next = await pages.dispatch('web.stream.next', {
    id: page.id, streamId: opened.streamId,
  }, connection);
  assert.deepEqual(next, { items: [detailedEvent], done: false });
  assert.match(JSON.stringify(next), /FULL_TRACE_BODY_FOR_UI/);

  await assert.rejects(pages.dispatch('web.stream.open', {
    id: page.id,
    endpoint: 'session/follow',
    args: { request: { address: sessionAddress('session-other'), assistantStream: true } },
  }, connection), { code: 'BAD_REQUEST' });
  await assert.rejects(pages.dispatch('web.stream.open', {
    id: page.id,
    endpoint: 'session/follow',
    args: [{ address: sessionAddress(), assistantStream: true }],
  }, connection), { code: 'BAD_REQUEST' });
});

test('serializes concurrent stream next calls and closes unopened streams without polling', async () => {
  let activeNext = 0;
  let maxActiveNext = 0;
  let nextCount = 0;
  let disposeCount = 0;
  let returnCount = 0;
  const { pages, connection } = createHarness({
    pageRpc: {
      async open() {
        return {
          async dispose() { disposeCount += 1; },
          [Symbol.asyncIterator]() {
            return {
              async next() {
                activeNext += 1;
                maxActiveNext = Math.max(maxActiveNext, activeNext);
                await new Promise((resolve) => setTimeout(resolve, 5));
                activeNext -= 1;
                nextCount += 1;
                return nextCount <= 2
                  ? { done: false, value: { type: 'event', seq: nextCount } }
                  : { done: true, value: undefined };
              },
              async return() {
                returnCount += 1;
                return { done: true, value: undefined };
              },
            };
          },
        };
      },
    },
  });
  const page = await openPage(pages, connection, 'trace', SESSION_ID);
  const opened = await pages.dispatch('web.stream.open', {
    id: page.id, endpoint: 'session/follow', args: followArgs(),
  }, connection);
  const results = await Promise.all([
    pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection),
    pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection),
  ]);
  assert.equal(maxActiveNext, 1);
  assert.deepEqual(results.map((item) => item.items[0].seq), [1, 2]);
  await pages.dispatch('web.stream.close', { id: page.id, streamId: opened.streamId }, connection);
  assert.equal(disposeCount, 1);
  assert.equal(returnCount, 1);

  let neverReadNext = 0;
  let neverReadDispose = 0;
  let neverReadReturn = 0;
  const unopenedHarness = createHarness({
    pageRpc: {
      async open() {
        return {
          async dispose() { neverReadDispose += 1; },
          [Symbol.asyncIterator]() {
            return {
              async next() { neverReadNext += 1; return { done: true }; },
              async return() { neverReadReturn += 1; return { done: true }; },
            };
          },
        };
      },
    },
  });
  const unopenedPage = await openPage(unopenedHarness.pages, unopenedHarness.connection, 'trace', SESSION_ID);
  await unopenedHarness.pages.dispatch('web.stream.open', {
    id: unopenedPage.id, endpoint: 'session/follow', args: followArgs(),
  }, unopenedHarness.connection);
  await unopenedHarness.pages.closeConnection(unopenedHarness.connection);
  assert.equal(neverReadNext, 0);
  assert.equal(neverReadDispose, 1);
  assert.equal(neverReadReturn, 1);
});

test('disconnect aborts a pending stream open before the first next call', async () => {
  const opened = deferred();
  let abortObserved = false;
  const { pages, connection } = createHarness({
    pageRpc: {
      open(_endpoint, _args, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            abortObserved = true;
            reject(new Error('aborted open'));
          }, { once: true });
          opened.resolve();
        });
      },
    },
  });
  const page = await openPage(pages, connection, 'trace', SESSION_ID);
  const opening = pages.dispatch('web.stream.open', {
    id: page.id, endpoint: 'session/follow', args: followArgs(),
  }, connection);
  await opened.promise;
  await pages.closeConnection(connection);
  await assert.rejects(opening, { code: 'UPSTREAM_UNAVAILABLE' });
  assert.equal(abortObserved, true);
});

test('pages for what plugins add are named by a registered id, and ids and sessions are validated', async () => {
  const { pages, connection, frontend } = createHarness();
  const open = (params: Record<string, unknown>) => pages.dispatch('web.open', params, connection);

  // A sidebar panel needs a target and no conversation.
  await assert.rejects(open({ page: 'panel' }), { code: 'BAD_REQUEST' });
  const panel = await open({ page: 'panel', target: 'insight' });
  assert.match(panel.id, /^[0-9a-f-]{36}$/u);
  assert.deepEqual(frontend.calls.documents.at(-1), { kind: 'panel', sessionId: undefined });

  // A conversation view or a dock entry needs both.
  await assert.rejects(open({ page: 'view', target: 'notes' }), { code: 'BAD_REQUEST' });
  await assert.rejects(open({ page: 'view', sessionId: SESSION_ID }), { code: 'BAD_REQUEST' });
  await assert.rejects(open({ page: 'dock', sessionId: SESSION_ID }), { code: 'BAD_REQUEST' });
  await open({ page: 'view', sessionId: SESSION_ID, target: 'notes' });
  await open({ page: 'dock', sessionId: SESSION_ID, target: 'example-board:open' });
  assert.deepEqual(frontend.calls.documents.slice(-2).map((item: { kind: string }) => item.kind), ['view', 'dock']);

  // Settings can open on a section; other pages take no target at all.
  await open({ page: 'settings', target: 'models' });
  await assert.rejects(open({ page: 'plugins', target: 'x' }), { code: 'BAD_REQUEST' });
  await assert.rejects(open({ page: 'trace', sessionId: SESSION_ID, target: 'x' }), { code: 'BAD_REQUEST' });

  for (const target of ['', 'has space', 'a'.repeat(300), '../up', 'line\nbreak', '<script>', 42]) {
    await assert.rejects(open({ page: 'panel', target }), { code: 'BAD_REQUEST' }, String(target));
  }
});

// ---- Terminals: the right dock's duplex stream -------------------------------------------------

const TERMINAL_ID = 'terminal-one';

async function openDock(pages, connection, target = 'terminal:new') {
  return pages.dispatch('web.open', { page: 'dock', sessionId: SESSION_ID, target }, connection);
}

/** A terminal attachment as DSH's gateway presents it: reads the page's uplink, answers with frames. */
function terminalRpc({ output = [], onItem = () => {} } = {}) {
  const seen = { opens: [], uplinks: [] };
  return {
    seen,
    pageRpc: {
      async invoke(endpoint, args) {
        if (endpoint === 'terminal/list') return { ok: true, value: [{ id: TERMINAL_ID, state: 'running' }] };
        if (endpoint === 'terminal/shells') return { ok: true, value: [{ path: '/bin/zsh', args: [], name: 'zsh' }] };
        return { ok: true, value: {} };
      },
      async open(endpoint, args, signal, uplink) {
        seen.opens.push({ endpoint, args, uplink: Boolean(uplink) });
        return {
          async *[Symbol.asyncIterator]() {
            for (const frame of output) yield frame;
            if (!uplink) return;
            for await (const item of uplink) {
              seen.uplinks.push(item);
              onItem(item);
              yield { type: 'ack', sequence: item.sequence };
            }
          },
        };
      },
    },
  };
}

async function attachTerminal(pages, connection, page) {
  await pages.dispatch('web.invoke', {
    id: page.id, endpoint: 'terminal/list', args: { sessionId: SESSION_ID },
  }, connection);
  return pages.dispatch('web.stream.open', {
    id: page.id, endpoint: 'terminal/attach', args: { agentId: SESSION_ID, id: TERMINAL_ID },
  }, connection);
}

test('a terminal attachment is a duplex stream: input goes up in order and the desktop answers', async () => {
  const rpc = terminalRpc();
  const { pages, connection } = createHarness({ pageRpc: rpc.pageRpc });
  const page = await openDock(pages, connection);
  const opened = await attachTerminal(pages, connection, page);
  assert.equal(rpc.seen.opens[0].uplink, true, 'the Gateway is handed an uplink');

  const write = (sequence, data) => ({ type: 'write', sequence, data });
  await pages.dispatch('web.stream.send', {
    id: page.id, streamId: opened.streamId, items: [write(1, 'ls'), write(2, '\r')],
  }, connection);
  await pages.dispatch('web.stream.send', {
    id: page.id, streamId: opened.streamId, items: [{ type: 'resize', sequence: 3, cols: 80, rows: 24 }],
  }, connection);

  const acks = [];
  while (acks.length < 3) {
    const next = await pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection);
    acks.push(...next.items);
  }
  assert.deepEqual(rpc.seen.uplinks.map((item) => item.sequence), [1, 2, 3]);
  assert.deepEqual(acks.map((frame) => frame.sequence), [1, 2, 3]);

  await pages.dispatch('web.stream.send', { id: page.id, streamId: opened.streamId, items: [], end: true }, connection);
  const last = await pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection);
  assert.deepEqual(last, { items: [], done: true }, 'ending the uplink ends the attachment');
});

test('terminal input is validated before it reaches the desktop', async () => {
  const rpc = terminalRpc();
  const { pages, connection } = createHarness({ pageRpc: rpc.pageRpc });
  const page = await openDock(pages, connection);
  const opened = await attachTerminal(pages, connection, page);
  const send = (items, extra = {}) => pages.dispatch('web.stream.send', {
    id: page.id, streamId: opened.streamId, items, ...extra,
  }, connection);

  for (const items of [
    [{ type: 'write', sequence: 1 }],
    [{ type: 'write', sequence: 0, data: 'x' }],
    [{ type: 'write', sequence: 1.5, data: 'x' }],
    [{ type: 'write', sequence: 1, data: '' }],
    [{ type: 'write', sequence: 1, data: 'x', extra: true }],
    [{ type: 'write', sequence: 1, data: 'x'.repeat(65 * 1024) }],
    [{ type: 'resize', sequence: 1, cols: 1, rows: 24 }],
    [{ type: 'resize', sequence: 1, cols: 501, rows: 24 }],
    [{ type: 'resize', sequence: 1, cols: 80, rows: 201 }],
    [{ type: 'run', sequence: 1, command: 'rm -rf /' }],
    ['write'],
    [null],
  ]) {
    await assert.rejects(send(items), { code: 'BAD_REQUEST' }, JSON.stringify(items).slice(0, 80));
  }
  await assert.rejects(send(Array.from({ length: 65 }, (_, index) => ({ type: 'write', sequence: index + 1, data: 'a' }))), {
    code: 'BAD_REQUEST',
  });
  await assert.rejects(send([], {}), { code: 'BAD_REQUEST' }, 'nothing to send and no end');
  await assert.rejects(send([], { end: false }), { code: 'BAD_REQUEST' });
  await assert.rejects(send([{ type: 'write', sequence: 1, data: 'a' }], { extra: 1 }), { code: 'BAD_REQUEST' });
  assert.deepEqual(rpc.seen.uplinks, [], 'nothing invalid was delivered');

  // Multi-byte input counts by UTF-8 bytes, not characters.
  await assert.rejects(send([{ type: 'write', sequence: 1, data: '你'.repeat(22 * 1024) }]), { code: 'BAD_REQUEST' });
  await send([{ type: 'write', sequence: 1, data: '你'.repeat(20 * 1024) }]);
});

test('only a stream that carries an uplink accepts one, and only from its own page', async () => {
  const rpc = terminalRpc();
  const { pages, connection } = createHarness({ pageRpc: rpc.pageRpc });
  const page = await openDock(pages, connection);
  const events = await pages.dispatch('web.stream.open', { id: page.id, endpoint: '$events', args: {} }, connection);
  await assert.rejects(pages.dispatch('web.stream.send', {
    id: page.id, streamId: events.streamId, items: [{ type: 'write', sequence: 1, data: 'x' }],
  }, connection), { code: 'NOT_FOUND' });

  const other = await openDock(pages, connection, 'browser:new');
  const opened = await attachTerminal(pages, connection, page);
  await assert.rejects(pages.dispatch('web.stream.send', {
    id: other.id, streamId: opened.streamId, items: [{ type: 'write', sequence: 1, data: 'x' }],
  }, connection), { code: 'NOT_FOUND' }, 'a stream belongs to the page that opened it');
  await assert.rejects(pages.dispatch('web.stream.send', {
    id: page.id, streamId: 'not-an-id', items: [],
  }, connection), { code: 'BAD_REQUEST' });
});

test('terminal output is delivered a batch at a time, and the end never travels with items', async () => {
  const frames = Array.from({ length: 5 }, (_, index) => ({ type: 'output', sequence: index + 1, data: `line ${index}` }));
  const rpc = terminalRpc({ output: frames });
  rpc.pageRpc.open = async (endpoint, args, signal, uplink) => ({
    async *[Symbol.asyncIterator]() { for (const frame of frames) yield frame; },
  });
  const { pages, connection } = createHarness({ pageRpc: rpc.pageRpc });
  const page = await openDock(pages, connection);
  const opened = await attachTerminal(pages, connection, page);

  const first = await pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection);
  assert.deepEqual(first.items.map((frame) => frame.sequence), [1, 2, 3, 4, 5], 'everything already waiting is one reply');
  assert.equal(first.done, false, 'the end is reported on its own');
  const second = await pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection);
  assert.deepEqual(second, { items: [], done: true });
});

test('other streams still deliver one item per reply', async () => {
  const { pages, connection } = createHarness({
    pageRpc: {
      async open() {
        return { async *[Symbol.asyncIterator]() { yield { type: 'ready' }; yield { type: 'emit', event: 'commands/change', args: [] }; } };
      },
    },
  });
  const page = await pages.dispatch('web.open', { page: 'plugins' }, connection);
  const opened = await pages.dispatch('web.stream.open', { id: page.id, endpoint: '$events', args: {} }, connection);
  const first = await pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection);
  assert.equal(first.items.length, 1);
});

test('a page that outruns the desktop loses its terminal stream instead of filling its memory', async () => {
  const gate = deferred();
  const rpc = terminalRpc();
  rpc.pageRpc.open = async (endpoint, args, signal, uplink) => ({
    async *[Symbol.asyncIterator]() {
      await gate.promise; // the desktop is not reading yet
      for await (const item of uplink) yield { type: 'ack', sequence: item.sequence };
    },
  });
  const { pages, connection } = createHarness({ pageRpc: rpc.pageRpc });
  const page = await openDock(pages, connection);
  const opened = await attachTerminal(pages, connection, page);

  const chunk = 'x'.repeat(60 * 1024);
  let failure;
  for (let sequence = 1; sequence <= 80 && !failure; sequence += 1) {
    try {
      await pages.dispatch('web.stream.send', {
        id: page.id, streamId: opened.streamId, items: [{ type: 'write', sequence, data: chunk }],
      }, connection);
    } catch (error) {
      failure = error;
    }
  }
  assert.equal(failure?.code, 'LIMIT_EXCEEDED');
  await assert.rejects(pages.dispatch('web.stream.send', {
    id: page.id, streamId: opened.streamId, items: [{ type: 'write', sequence: 99, data: 'x' }],
  }, connection), { code: 'NOT_FOUND' }, 'the stream is gone');
  gate.resolve();
});

test('closing a terminal stream or its page releases the uplink for the desktop', async () => {
  let released = 0;
  const rpc = terminalRpc();
  rpc.pageRpc.open = async (endpoint, args, signal, uplink) => ({
    async *[Symbol.asyncIterator]() {
      try {
        for await (const item of uplink) yield { type: 'ack', sequence: item.sequence };
      } finally {
        released += 1;
      }
    },
  });
  const { pages, connection } = createHarness({ pageRpc: rpc.pageRpc });
  const page = await openDock(pages, connection);

  // The desktop is reading the uplink once the first keystroke has been answered.
  const running = async () => {
    const opened = await attachTerminal(pages, connection, page);
    await pages.dispatch('web.stream.send', {
      id: page.id, streamId: opened.streamId, items: [{ type: 'write', sequence: 1, data: 'a' }],
    }, connection);
    await pages.dispatch('web.stream.next', { id: page.id, streamId: opened.streamId }, connection);
    return opened;
  };

  const first = await running();
  const pending = pages.dispatch('web.stream.next', { id: page.id, streamId: first.streamId }, connection);
  await pages.dispatch('web.stream.close', { id: page.id, streamId: first.streamId }, connection);
  assert.deepEqual(await pending, { items: [], done: true });
  assert.equal(released, 1);

  const second = await running();
  const waiting = pages.dispatch('web.stream.next', { id: page.id, streamId: second.streamId }, connection);
  await pages.dispatch('web.close', { id: page.id }, connection);
  await waiting.catch(() => {});
  assert.equal(released, 2);
});
