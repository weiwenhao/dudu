import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDsbotControl } from '../host/dsbot-control.mjs';
import { connectionAddress, connectionOrigin, createPairingStore } from '../host/pairing-devices.mjs';

async function directory(t: { after: (callback: () => Promise<unknown>) => void }) {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-desktop-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

async function authenticate(port: number, link: string) {
  const token = new URL(link).searchParams.get('pair');
  const response = await fetch(`http://127.0.0.1:${port}/dsbot/api/v1/connect`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const ready = await response.json();
  assert.equal(ready.type, 'ready');
  return { token, ready };
}

test('connection origins accept user-selected HTTP or HTTPS without network classification', () => {
  for (const address of ['https://desktop.example.com/', 'https://desktop.example.com:8443']) {
    assert.equal(connectionOrigin(address), new URL(address).origin);
  }
  for (const address of ['http://192.168.2.3:3107', 'http://10.0.0.3:3107', 'http://172.16.0.3',
    'http://127.0.0.1:3107', 'http://computer.local:3107', 'http://[::1]:3107', 'http://[fd01::1]:3107',
    'http://public.example.com', 'http://8.8.8.8']) {
    assert.equal(connectionOrigin(address), new URL(address).origin);
  }
  for (const address of ['https://user:pass@example.com',
    'https://example.com/path', 'https://example.com/?pair=secret', 'https://example.com#fragment',
    'file:///tmp/dsbot', '']) {
    assert.throws(() => connectionOrigin(address));
  }
});

test('pairing codes expire before use, remain reconnectable after use and store only hashes', async (t) => {
  const folder = await directory(t);
  let time = 1_000_000;
  let store = await createPairingStore({ folder, now: () => time });
  const stale = await store.issue({ address: 'http://127.0.0.1:3107', name: 'Expired' });
  time += 10 * 60_000 + 1;
  assert.equal(await store.redeem(new URL(stale.url).searchParams.get('pair')), undefined);
  const code = await store.issue({ address: 'https://desktop.example.com', name: '书房 Mac' });
  const url = new URL(code.url);
  const token = url.searchParams.get('pair')!;
  assert.equal(url.searchParams.get('computer'), store.id);
  assert.equal(url.searchParams.get('name'), '书房 Mac');
  const device = await store.redeem(token, 'iPhone');
  assert.equal(device.secureCookie, true);
  assert.equal(store.authorize(device.session), device.id);
  assert.equal(store.list()[0].name, 'iPhone');
  const disk = await readFile(join(folder, 'devices.json'), 'utf8');
  assert.ok(!disk.includes(token));
  assert.ok(!disk.includes(device.session));
  assert.equal((await stat(join(folder, 'devices.json'))).mode & 0o777, 0o600);
  await store.close();
  time += 7 * 24 * 60 * 60_000;
  store = await createPairingStore({ folder, now: () => time });
  try {
    assert.equal((await store.redeem(token)).session, device.session);
    assert.equal(store.authorize(device.session), device.id);
    const another = await store.issue({ address: 'http://127.0.0.1:3107' });
    const otherDevice = await store.redeem(new URL(another.url).searchParams.get('pair'));
    await store.revoke(device.id);
    assert.equal(await store.redeem(token), undefined);
    assert.equal(store.authorize(device.session), undefined);
    assert.equal(store.authorize(otherDevice.session), otherDevice.id);
  } finally { await store.close(); }
});

test('native addresses preserve HTTP(S) and normalize legacy WS address strings', () => {
  for (const address of ['https://desktop.example.com', 'https://desktop.example.com/dsbot',
    'wss://desktop.example.com', 'wss://desktop.example.com/dsbot']) {
    assert.equal(connectionAddress(address), 'https://desktop.example.com/dsbot');
  }
  assert.equal(connectionAddress('http://192.168.2.3:3170'), 'http://192.168.2.3:3170/dsbot');
  assert.equal(connectionAddress('ws://[fd01::1]:3170/dsbot'), 'http://[fd01::1]:3170/dsbot');
  assert.equal(connectionAddress('ws://public.example.com/dsbot'), 'http://public.example.com/dsbot');
  assert.equal(connectionAddress('http://8.8.8.8'), 'http://8.8.8.8/dsbot');
  for (const address of ['wss://user:pass@example.com/dsbot', 'wss://example.com/api',
    'wss://example.com/dsbot?pair=secret', 'wss://example.com/dsbot#secret',
    'file://example.com/dsbot']) assert.throws(() => connectionAddress(address));
});

test('saving multiple native addresses never issues pairing codes or exposes HTTP routes', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-desktop-test-'));
  let matchingComputer = false;
  const probes: string[] = [];
  const control = await createDsbotControl({
    folder, host: '127.0.0.1', port: 0, dispatch: async () => ({}),
    resolveLanAddress: () => '127.0.0.1',
    probeAddress: async (address: string, nonce: string, options: { pairingStore: { proof: (nonce: string) => string } }) => {
      probes.push(address);
      return matchingComputer ? options.pairingStore.proof(nonce) : 'a'.repeat(43);
    },
  });
  t.after(async () => {
    try { await control.close(); }
    finally { await rm(folder, { recursive: true, force: true }); }
  });
  const local = `http://127.0.0.1:${control.server.port}/dsbot`;
  const config = { name: '书房 Mac', addresses: [local, 'https://desktop.example.com/dsbot'] };
  const normalized = {
    ...config,
    addresses: [local, 'https://desktop.example.com/dsbot'],
  };
  const pendingCount = async () => JSON.parse(await readFile(join(folder, 'devices.json'), 'utf8')).devices.length;
  assert.equal(probes.length, 0);
  assert.equal(await pendingCount(), 0);
  assert.deepEqual(control.state().devices, []);
  await control.save({ ...config, addresses: [...config.addresses, ' ', normalized.addresses[1]] });
  assert.deepEqual(control.state().addresses, normalized.addresses);
  const copy = control.state();
  copy.addresses.pop();
  assert.deepEqual(control.state().addresses, normalized.addresses);
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'settings.json'), 'utf8')), {
    name: normalized.name, addresses: [normalized.addresses[1]],
  });
  assert.equal((await stat(join(folder, 'settings.json'))).mode & 0o777, 0o600);
  assert.equal(probes.length, 0);
  assert.equal(await pendingCount(), 0);
  await assert.rejects(control.generate({ ...config, address: 'wss://unlisted.example.com/dsbot' }), /已添加/);
  await assert.rejects(control.generate({ ...config, address: config.addresses[1] }), /这台电脑/);
  assert.equal(await pendingCount(), 0);
  matchingComputer = true;
  const publicCode = await control.generate({ ...config, address: config.addresses[1] });
  assert.equal(probes.at(-1), normalized.addresses[1]);
  assert.equal(new URL(publicCode.url).protocol, 'https:');
  assert.equal(new URL(publicCode.url).pathname, '/dsbot');
  assert.equal(new URL(publicCode.url).searchParams.get('computer'), control.devices.id);
  assert.equal(new URL(publicCode.url).searchParams.get('name'), config.name);
  assert.match(publicCode.svg, /<svg/);
  const localCode = await control.generate({ ...config, address: local });
  assert.equal(new URL(localCode.url).protocol, 'http:');
  assert.equal(new URL(localCode.url).pathname, '/dsbot');
  assert.equal(await pendingCount(), 2);
  for (const path of ['/', '/dsbot', '/api/remote.mux', '/.well-known/dsbot', '/api/dsbot/state']) {
    const response = await fetch(`${control.server.address}${path}`);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const connection = await authenticate(control.server.port, publicCode.url);
  assert.equal(control.state().devices.length, 1);
  await control.devices.revoke(publicCode.id);
  const revoked = await fetch(`http://127.0.0.1:${control.server.port}/dsbot/api/v1/request`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: '97b1cc4e-2431-4650-8799-4acd71f4cffe', method: 'session.list', params: {},
    }),
  });
  assert.equal(revoked.status, 401);
  assert.equal(await control.devices.authenticate(connection.token), undefined);
  assert.ok(await control.devices.authenticate(new URL(localCode.url).searchParams.get('pair'), 'iPhone'));
});

test('the automatic LAN address survives deletion, follows network changes and is not stored as a custom address', async (t) => {
  const folder = await directory(t);
  let currentIP = '192.168.1.20';
  const create = () => createDsbotControl({
    folder, host: '127.0.0.1', port: 0, dispatch: async () => ({}),
    resolveLanAddress: () => currentIP,
  });
  let control = await create();
  try {
  const automatic = `http://${currentIP}:${control.server.port}/dsbot`;
    assert.equal(control.state().lanAddress, automatic);
    assert.deepEqual(control.state().addresses, [automatic]);
  const custom = 'https://desktop.example.com/dsbot';
    await control.save({ name: 'Mac', addresses: [custom] });
    assert.deepEqual(control.state().addresses, [automatic, custom]);
    await control.save({ name: 'Mac', addresses: [automatic, automatic, custom] });
    assert.deepEqual(control.state().addresses, [automatic, custom]);

    currentIP = '192.168.2.30';
  const updated = `http://${currentIP}:${control.server.port}/dsbot`;
    assert.equal(control.state().lanAddress, updated);
    assert.deepEqual(control.state().addresses, [updated, custom]);
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'settings.json'), 'utf8')), {
      name: 'Mac', addresses: [custom],
    });
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'devices.json'), 'utf8')).devices, []);

    await control.close();
    control = await create();
    assert.deepEqual(control.state().addresses, [
      `http://${currentIP}:${control.server.port}/dsbot`, custom,
    ]);
    await control.save({ name: 'Mac', addresses: [] });
    assert.deepEqual(control.state().addresses, [control.state().lanAddress]);
  } finally {
    await control.close();
  }
});

test('existing default LAN settings migrate without duplicating the protected row or touching pairing records', async (t) => {
  const folder = await directory(t);
  await writeFile(join(folder, 'settings.json'), JSON.stringify({
    name: 'Existing Mac',
    addresses: ['http://192.168.1.20:3170', 'wss://desktop.example.com/dsbot'],
  }));
  const control = await createDsbotControl({
    folder, port: 3170, dispatch: async () => ({}),
    resolveLanAddress: () => '192.168.1.20',
    nativeServerFactory: async () => ({ port: 3170, async close() {} }),
  });
  try {
    assert.deepEqual(control.state().addresses, [
      'http://192.168.1.20:3170/dsbot', 'https://desktop.example.com/dsbot',
    ]);
    assert.deepEqual(JSON.parse(await readFile(join(folder, 'settings.json'), 'utf8')), {
      name: 'Existing Mac', addresses: ['https://desktop.example.com/dsbot'],
    });
    assert.deepEqual(control.state().devices, []);
  } finally {
    await control.close();
  }
});

test('legacy desktop settings and issued credentials survive the native transport upgrade', async (t) => {
  const folder = await directory(t);
  const registry = await createPairingStore({ folder });
  const legacy = await registry.issue({ address: 'https://old.example.com' });
  assert.equal(new URL(legacy.url).pathname, '/', 'legacy origin-only links keep their root path');
  await registry.close();
  const raw = JSON.parse(await readFile(join(folder, 'devices.json'), 'utf8'));
  delete raw.devices[0].secureCookie;
  await writeFile(join(folder, 'devices.json'), JSON.stringify(raw));
  await writeFile(join(folder, 'settings.json'), JSON.stringify({
    name: 'Old Desktop', mode: 'public', publicUrl: 'https://old.example.com',
  }));
  let control = await createDsbotControl({ folder, host: '127.0.0.1', port: 0, dispatch: async () => ({}) });
  try {
    assert.ok(control.state().addresses.includes('https://old.example.com/dsbot'));
    assert.equal(control.state().addresses.length, 2);
    assert.equal('mode' in control.state(), false);
    const computerId = control.devices.id;
    await control.save({ name: control.state().name, addresses: control.state().addresses });
    await control.close();
    control = await createDsbotControl({ folder, host: '127.0.0.1', port: 0, dispatch: async () => ({}) });
    assert.equal(control.devices.id, computerId);
    await authenticate(control.server.port, legacy.url);
    assert.equal(control.state().devices.length, 1);
    assert.equal(JSON.parse(await readFile(join(folder, 'devices.json'), 'utf8')).devices[0].secureCookie, true);
  } finally { await control.close(); }
});
