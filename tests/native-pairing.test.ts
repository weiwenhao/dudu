import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connectionAddress, createPairingStore } from '../host/pairing-devices.mjs';

test('native addresses are the origin and nothing else', () => {
  assert.equal(connectionAddress('https://desktop.example.com'), 'https://desktop.example.com');
  assert.equal(connectionAddress('wss://desktop.example.com'), 'https://desktop.example.com');
  assert.equal(connectionAddress('http://192.168.1.20:3170'), 'http://192.168.1.20:3170');
  assert.equal(connectionAddress('http://laptop.local:3170'), 'http://laptop.local:3170');
  assert.equal(connectionAddress('ws://desktop.example.com:3170'), 'http://desktop.example.com:3170');
  assert.equal(connectionAddress('http://8.8.8.8:3170'), 'http://8.8.8.8:3170');
  assert.throws(() => connectionAddress('https://user:pass@desktop.example.com'), /连接地址只需/);
  assert.throws(() => connectionAddress('https://desktop.example.com/?token=abc'), /连接地址只需/);
});

test('pairing links use root addresses and preserve secure authentication for legacy imports', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-pairing-address-'));
  const store = await createPairingStore({ folder });
  t.after(async () => {
    await store.close();
    await rm(folder, { recursive: true, force: true });
  });

  const legacyHttp = await store.issue({ address: 'http://desktop.example.com' });
  assert.equal(new URL(legacyHttp.url).protocol, 'http:');
  assert.equal(new URL(legacyHttp.url).pathname, '/');

  const httpEndpoint = await store.issue({ address: 'http://desktop.example.com' });
  assert.equal(new URL(httpEndpoint.url).protocol, 'http:');
  assert.equal(new URL(httpEndpoint.url).pathname, '/');
  assert.equal((await store.redeem(new URL(httpEndpoint.url).searchParams.get('pair'))).secureCookie, false);

  const httpsEndpoint = await store.issue({ address: 'https://desktop.example.com' });
  assert.equal(new URL(httpsEndpoint.url).protocol, 'https:');
  assert.equal(new URL(httpsEndpoint.url).pathname, '/');
  assert.equal((await store.redeem(new URL(httpsEndpoint.url).searchParams.get('pair'))).secureCookie, true);

  const legacyWss = await store.issue({ address: 'wss://desktop.example.com' });
  assert.equal(new URL(legacyWss.url).protocol, 'https:');
  assert.equal(new URL(legacyWss.url).pathname, '/');
});

test('concurrent legacy authentication imports one credential and revoke cannot reimport it', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-native-pairing-'));
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

test('one multi-address code has one credential and nonce-bound route proofs expire or revoke with it', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-dual-address-'));
  let now = 1000;
  const store = await createPairingStore({ folder, now: () => now });
  t.after(async () => { await store.close(); await rm(folder, { recursive: true, force: true }); });
  const addresses = [
    { kind: 'lan', url: 'http://192.168.1.20:3170' },
    { kind: 'public', url: 'https://desktop.example.test' },
  ];
  const code = await store.issue({ address: addresses[0].url, name: 'Office', addresses });
  const url = new URL(code.url);
  assert.equal(url.searchParams.get('device'), code.id);
  assert.deepEqual(url.searchParams.getAll('lan'), [addresses[0].url]);
  assert.deepEqual(url.searchParams.getAll('public'), [addresses[1].url]);
  assert.equal(JSON.parse(await readFile(join(folder, 'devices.json'), 'utf8')).devices.length, 1);
  const token = url.searchParams.get('pair')!;
  const nonce = 'nonce_for_first_route_12345';
  const proof = store.routeProof(code.id, nonce);
  assert.equal(proof.computerId, store.id);
  const key = createHash('sha256').update(token).digest();
  assert.equal(proof.deviceProof, createHmac('sha256', key)
    .update(`dudu-route:v1:${nonce}:${store.id}:${code.id}`).digest('base64url'));
  assert.notEqual(store.routeProof(code.id, 'nonce_for_other_route_12345').deviceProof, proof.deviceProof);
  assert.equal(store.routeProof('unknown', nonce), undefined);
  assert.equal(store.routeProof(code.id, 'bad'), undefined);
  assert.equal(store.list().length, 0, 'probing must not redeem a pending pairing');
  now += 600_001;
  assert.equal(store.routeProof(code.id, nonce), undefined);

  const fresh = await store.issue({ address: addresses[0].url, addresses });
  const freshToken = new URL(fresh.url).searchParams.get('pair');
  assert.equal(await store.authenticate(freshToken, 'iPhone'), fresh.id);
  now += 600_001;
  assert.equal(await store.authenticate(freshToken, 'iPhone'), fresh.id, 'the same QR code reuses the paired device');
  assert.equal(store.list().length, 1);
  assert.ok(store.routeProof(fresh.id, nonce), 'an established pairing survives the QR expiry');
  await store.revoke(fresh.id);
  assert.equal(store.routeProof(fresh.id, nonce), undefined);
  assert.equal((await readFile(join(folder, 'devices.json'), 'utf8')).includes(token), false);
});
