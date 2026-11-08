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

test('failed owner admission never enters the market handler or leaks the reason', async () => {
  let invoked = false;
  const { reads } = setup({
    admit: () => ({ rejection: 401 }),
    handler() { invoked = true; },
  });
  assert.equal((await reads.invoke('dshMarket/registry', {})).ok, false);
  assert.equal(invoked, false);
});
