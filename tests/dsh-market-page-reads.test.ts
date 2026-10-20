import assert from 'node:assert/strict';
import test from 'node:test';
import { createDshMarketPageReads, MARKET_PAGE_READ_METHODS } from '../host/dsh-market-page-reads.mjs';

const peer = { principal: { kind: 'owner' } };
function setup({ handler, match, admit, timeoutMs = 1_000 } = {}) {
  const calls = [];
  const connection = {
    authenticatedUrl(base) { return `${base}?token=private-launch-token`; },
    authorizeIndex(req, res) {
      assert.equal(req.method, 'GET');
      assert.equal(req.headers.host, '127.0.0.1:3080');
      assert.equal(new URL(req.url, 'http://local').searchParams.get('token'), 'private-launch-token');
      res.writeHead(303, { 'set-cookie': 'dsh-owner=private-cookie; HttpOnly; Path=/' });
      res.end();
      return false;
    },
    admit(req) {
      assert.equal(req.headers.cookie, 'dsh-owner=private-cookie');
      return admit ? admit(req) : { peer };
    },
  };
  const webServer = {
    getOrigin() { return 'http://127.0.0.1:3080'; },
    match(path) {
      calls.push(path);
      return match ? match(path) : {
        kind: 'exact', path,
        handler: handler ?? ((req, res) => {
          assert.equal(req.method, 'GET');
          assert.equal(req.url, path);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(path.endsWith('/registry')
            ? { path, registry: { updated: 'today', count: 0, categories: {}, plugins: [] } } : { path }));
        }),
      };
    },
  };
  return { reads: createDshMarketPageReads({ connection, webServer, peer, timeoutMs }), calls, connection, webServer };
}

test('fixed market readers require the owner and reject every argument or unlisted route', async () => {
  assert.ok(Object.isFrozen(MARKET_PAGE_READ_METHODS));
  assert.equal(MARKET_PAGE_READ_METHODS.length, 8);
  assert.throws(() => createDshMarketPageReads({ peer: { principal: { kind: 'device' } } }), TypeError);
  const { reads, calls } = setup();
  for (const [endpoint, args] of [
    ['dshMarket/install', {}], ['dshMarket/registry', { url: 'http://private' }],
    ['dshMarket/registry', []], ['dshMarket/updates', { force: true }],
  ]) await assert.rejects(reads.invoke(endpoint, args), /Unsupported market page read/);
  assert.equal(calls.length, 0);
});

test('all eight reads use exact in-process GET handlers with a real owner admission', async () => {
  const { reads, calls } = setup();
  for (const endpoint of MARKET_PAGE_READ_METHODS) {
    const result = await reads.invoke(endpoint, {});
    assert.equal(result.ok, true);
    assert.equal(result.value.status, 200);
    if (!['dshMarket/status', 'dshMarket/registry'].includes(endpoint)) assert.equal(result.value.body.path, calls.at(-1));
    assert.doesNotMatch(JSON.stringify(result), /private-launch-token|private-cookie/);
  }
  assert.deepEqual(calls, [
    '/dsh-market/registry', '/dsh-market/installed', '/dsh-market/status',
    '/dsh-market/updates', '/dsh-market/bundle-order', '/dsh-market/presets',
    '/dsh-market/snapshots', '/dsh-market/host-recovery',
  ]);
});

test('missing services and prefix fallback routes fail closed without invoking handlers', async () => {
  assert.equal((await createDshMarketPageReads({ peer }).invoke('dshMarket/registry', {})).ok, false);
  let invoked = false;
  const { reads } = setup({ match: () => ({
    kind: 'prefix', path: '/dsh-market', handler() { invoked = true; },
  }) });
  assert.equal((await reads.invoke('dshMarket/registry', {})).ok, false);
  assert.equal(invoked, false);
});

test('failed owner admission never enters the market handler or leaks the reason', async () => {
  let invoked = false;
  const { reads } = setup({
    admit: () => ({ rejection: 401 }),
    handler() { invoked = true; },
  });
  assert.equal((await reads.invoke('dshMarket/registry', {})).ok, false);
  assert.equal(invoked, false);
});

test('market status excludes environment, process logs, errors and maintenance controls', async () => {
  const { reads } = setup({ handler(req, res) {
    res.end(JSON.stringify({
      active: false, installed: { plugin: '1.0' }, version: '1.0', region: 'global',
      buildEnv: { token: 'secret' }, lastLine: 'secret', ndjson: 'secret',
      error: 'secret', supervisor: 'secret', debugger: 'secret', futureSecret: 'secret',
      restart: true, restartReachable: true,
    }));
  } });
  const result = await reads.invoke('dshMarket/status', {});
  assert.deepEqual(result.value.body, {
    active: false, installed: { plugin: '1.0' }, version: '1.0', region: 'global',
    restart: false, restartReachable: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|buildEnv|lastLine|ndjson|supervisor|debugger/);
});

test('catalogs discard unused bulk metadata while preserving every visible entry within the carrier budget', async () => {
  const { reads } = setup({ handler(req, res) {
    res.end(JSON.stringify({
      registry: {
        updated: 'today', count: 1, categories: { tools: { zh: '工具', en: 'Tools' } },
        plugins: [{ name: 'test', owner: 'owner', url: 'https://example.com', category: 'tools',
          description: { zh: '说明', en: 'Description' }, unknownBulk: 'x'.repeat(7 * 1024 * 1024) }],
      },
      hostVersion: '1', unknownRoot: 'private',
    }));
  } });
  const result = await reads.invoke('dshMarket/registry', {});
  assert.equal(result.ok, true);
  assert.equal(result.value.body.registry.plugins.length, 1);
  assert.equal(result.value.body.registry.plugins[0].name, 'test');
  assert.deepEqual(result.value.body.registry.plugins[0].description, { zh: '说明', en: 'Description' });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024);
  assert.doesNotMatch(JSON.stringify(result), /unknownBulk|unknownRoot|private/);
});

test('upstream errors, malformed JSON and oversized replies are normalized', async () => {
  for (const handler of [
    () => { throw new Error('secret-error'); },
    (req, res) => { res.end('secret-invalid-json'); },
    (req, res) => { res.end('x'.repeat(24 * 1024 * 1024 + 1)); },
  ]) {
    const { reads } = setup({ handler });
    const result = await reads.invoke('dshMarket/registry', {});
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
  const { reads } = setup({ handler(req, res) { res.writeHead(500); res.end('secret-error'); } });
  const result = await reads.invoke('dshMarket/registry', {});
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 500);
  assert.doesNotMatch(JSON.stringify(result), /secret-error/);
});

test('deadlines and caller cancellation end stalled reads', async () => {
  const { reads } = setup({ timeoutMs: 15, handler: () => new Promise(() => {}) });
  assert.equal((await reads.invoke('dshMarket/registry', {})).ok, false);
  const controller = new AbortController();
  const { reads: cancellable } = setup({ handler: () => new Promise(() => {}) });
  const pending = cancellable.invoke('dshMarket/registry', {}, controller.signal);
  controller.abort();
  assert.equal((await pending).ok, false);
  assert.equal((await cancellable.invoke('dshMarket/registry', {}, controller.signal)).ok, false);
});
