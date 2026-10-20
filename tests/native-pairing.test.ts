import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connectionAddress, createPairingStore } from '../host/pairing-devices.mjs';

test('native addresses preserve HTTP(S) and map legacy WS schemes onto /dsbot', () => {
  assert.equal(connectionAddress('https://desktop.example.com'), 'https://desktop.example.com/dsbot');
  assert.equal(connectionAddress('wss://desktop.example.com/dsbot'), 'https://desktop.example.com/dsbot');
  assert.equal(connectionAddress('http://192.168.1.20:3170'), 'http://192.168.1.20:3170/dsbot');
  assert.equal(connectionAddress('http://laptop.local:3170/dsbot'), 'http://laptop.local:3170/dsbot');
  assert.equal(connectionAddress('ws://desktop.example.com:3170'), 'http://desktop.example.com:3170/dsbot');
  assert.equal(connectionAddress('http://8.8.8.8:3170/dsbot'), 'http://8.8.8.8:3170/dsbot');
  assert.throws(() => connectionAddress('https://user:pass@desktop.example.com'), /连接地址只需/);
  assert.throws(() => connectionAddress('https://desktop.example.com/dsbot?token=abc'), /连接地址只需/);
});

test('pairing links use /dsbot for explicit endpoints and preserve legacy root links', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-pairing-address-'));
  const store = await createPairingStore({ folder });
  t.after(async () => {
    await store.close();
    await rm(folder, { recursive: true, force: true });
  });

  const legacyHttp = await store.issue({ address: 'http://desktop.example.com' });
  assert.equal(new URL(legacyHttp.url).protocol, 'http:');
  assert.equal(new URL(legacyHttp.url).pathname, '/');

  const httpEndpoint = await store.issue({ address: 'http://desktop.example.com/dsbot' });
  assert.equal(new URL(httpEndpoint.url).protocol, 'http:');
  assert.equal(new URL(httpEndpoint.url).pathname, '/dsbot');
  assert.equal((await store.redeem(new URL(httpEndpoint.url).searchParams.get('pair'))).secureCookie, false);

  const httpsEndpoint = await store.issue({ address: 'https://desktop.example.com/dsbot' });
  assert.equal(new URL(httpsEndpoint.url).protocol, 'https:');
  assert.equal(new URL(httpsEndpoint.url).pathname, '/dsbot');
  assert.equal((await store.redeem(new URL(httpsEndpoint.url).searchParams.get('pair'))).secureCookie, true);

  const legacyWss = await store.issue({ address: 'wss://desktop.example.com' });
  assert.equal(new URL(legacyWss.url).protocol, 'https:');
  assert.equal(new URL(legacyWss.url).pathname, '/dsbot');
});

test('concurrent legacy authentication imports one credential and revoke cannot reimport it', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-native-pairing-'));
  const legacyKeyPath = join(folder, 'pairing-key');
  const token = randomBytes(32).toString('base64url');
  await writeFile(legacyKeyPath, token, { mode: 0o600 });
  let store = await createPairingStore({ folder, legacyKeyPath });
  t.after(async () => {
    await store.close().catch(() => {});
    await rm(folder, { recursive: true, force: true });
  });

  const ids = await Promise.all([
    store.authenticate(token, 'iPhone'),
    store.authenticate(token, 'iPad'),
    store.authenticate(token, 'Android'),
  ]);
  assert.equal(new Set(ids).size, 1);
  assert.equal(store.list().length, 1);

  const id = ids[0];
  assert.equal(await store.revoke(id), true);
  assert.equal(await store.authenticate(token, 'iPhone'), undefined);

  const registryText = await readFile(join(folder, 'devices.json'), 'utf8');
  assert.equal(registryText.includes(token), false);
  const registry = JSON.parse(registryText);
  assert.equal(typeof registry.legacyImportedTokenHash, 'string');
  assert.equal(registry.devices.length, 0);

  await store.close();
  store = await createPairingStore({ folder, legacyKeyPath });
  assert.equal(await store.authenticate(token, 'iPhone'), undefined);
  assert.deepEqual(store.list(), []);
});
