import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDsbotControl } from '../host/dsbot-control.mjs';
import { createNativePages } from '../host/native-pages.mjs';
import { createTypertPageRpc } from '../host/native-page-rpc.mjs';

test('phone requests leave the bootstrap HMR transaction before invoking plugin management', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-hmr-context-'));
  let control;
  t.after(async () => {
    try { await control?.close(); }
    finally { await rm(folder, { recursive: true, force: true }); }
  });
  const executing = new AsyncLocalStorage<boolean>();
  const otherContext = new AsyncLocalStorage<string>();
  const peer = { principal: { kind: 'owner' } };
  const runExclusive = async (operation: () => unknown) => {
    if (executing.getStore()) throw new Error('HMR transactions cannot be nested');
    return executing.run(true, operation);
  };
  let mutations = 0;
  const pages = createNativePages({
    frontend: {
      async document() {
        return { html: '<!doctype html><html></html>', async resource() { return undefined; } };
      },
    },
    pageRpc: createTypertPageRpc({
      peer,
      gateway: {
        async invoke() { throw new Error('Unexpected fallback invocation'); },
        async stream() { throw new Error('Unexpected stream'); },
        async dispatchRpc(endpoint, _request, _signal, caller) {
          assert.equal(caller, peer);
          assert.equal(otherContext.getStore(), 'plugin-owner');
          if (endpoint === 'pluginManager/listPlugins') {
            return { ok: true, value: { plugins: [{ entryId: 'known-plugin' }] } };
          }
          if (endpoint === 'pluginManager/listBundles') {
            return { ok: true, value: { bundles: [{ name: 'known-bundle' }] } };
          }
          assert.ok(['pluginManager/setPluginEnabled', 'pluginManager/setBundleEnabled'].includes(endpoint));
          try {
            const value = await runExclusive(async () => {
              await Promise.resolve();
              assert.equal(executing.getStore(), true);
              mutations++;
              return { application: 'applied', changed: true };
            });
            return { ok: true, value };
          } catch (error) {
            return { ok: true, value: { application: 'failed', error: error.message } };
          }
        },
      },
    }),
  });
  control = await otherContext.run('plugin-owner', () => executing.run(true, () => createDsbotControl({
    folder, host: '127.0.0.1', port: 0, pages,
    resolveLanAddress: () => '127.0.0.1',
    runRequest: (operation) => executing.exit(operation),
    dispatch: async () => {
      await Promise.resolve();
      assert.equal(executing.getStore(), undefined);
      assert.equal(otherContext.getStore(), 'plugin-owner');
      return { detached: true };
    },
  })));
  assert.equal(executing.getStore(), undefined, 'the startup transaction has ended');

  // Only the temporary test pairing store is used; no live pairing is generated.
  const code = await control.devices.issue({ address: control.server.address });
  const token = new URL(code.url).searchParams.get('pair');
  const post = (path, body, headers = {}) => fetch(`${control.server.address}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const opened = await post('/dsbot/web/open', { page: 'plugins' }, { authorization: `Bearer ${token}` });
  assert.equal(opened.status, 200);
  const page = await opened.json();
  const invoke = async (endpoint, args) => {
    const response = await post(`${page.path}rpc`, {
      method: 'web.invoke', params: { endpoint, args },
    }, { 'x-dsbot-page': '1', cookie: `dsbot_ui=${page.cookie}` });
    assert.equal(response.status, 200);
    return response.json();
  };
  await invoke('pluginManager/listPlugins', {});
  assert.deepEqual(await invoke('pluginManager/setPluginEnabled', { id: 'known-plugin', enabled: true }), {
    ok: true, value: { application: 'applied', changed: true },
  });
  await invoke('pluginManager/listBundles', {});
  assert.deepEqual(await invoke('pluginManager/setBundleEnabled', { name: 'known-bundle', enabled: true }), {
    ok: true, value: { application: 'applied', changed: true },
  });
  assert.equal(mutations, 2);
  assert.equal((await post('/dsbot/api/v1/connect', {}, { authorization: `Bearer ${token}` })).status, 200);
  const native = await post('/dsbot/api/v1/request', {
    id: randomUUID(), method: 'session.list', params: {},
  }, { authorization: `Bearer ${token}` });
  assert.equal((await native.json()).result.detached, true);
  await assert.rejects(runExclusive(() => runExclusive(() => {})), /HMR transactions cannot be nested/);
});
