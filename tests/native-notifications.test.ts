import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCollectorNotifications } from '../host/assistant/collectors/notifications.mjs';
import { createNativeNotifications } from '../host/native-notifications.mjs';
import { createAPNsSender } from '../host/apns.mjs';
import { createNativeSettings } from '../host/native-settings.mjs';
import { createNativeBridge, NATIVE_METHODS } from '../host/native-bridge.mjs';

const collector = { id: 'mentions', name: '飞书 @我', notify: true };
const record = { id: 1, title: '确认配置', text: '请确认生产配置。' };
const token = 'ab'.repeat(32);
const params = { token, environment: 'development' };

function pairingFixture() {
  const paired = new Set(['phone', 'other']);
  const callbacks = new Set<(id: string) => void>();
  return {
    id: 'computer',
    list: () => [...paired].map((id) => ({ id })),
    onRevoke(callback: (id: string) => void) { callbacks.add(callback); return () => callbacks.delete(callback); },
    revoke(id: string) { paired.delete(id); for (const callback of callbacks) callback(id); },
  };
}

function connection(deviceId = 'phone') { return { deviceId, authenticated: true }; }

test('mobile push registrations are authenticated, durable, scoped to pairing and never replay old collections', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-push-'));
  const source = createCollectorNotifications();
  const devices = pairingFixture();
  const sent: any[] = [];
  const sender = {
    async send(registration: any, event: any, computerId: string) {
      sent.push({ registration, event, computerId });
      return { status: 200 };
    },
    close() {},
  };
  let service = await createNativeNotifications({ folder, devices, source, sender, enabled: () => true });
  t.after(async () => { await service.close(); source.close(); await rm(folder, { recursive: true, force: true }); });
  for (const method of ['notifications.state', 'notifications.register', 'notifications.unregister']) {
    assert.ok(NATIVE_METHODS.includes(method));
    await assert.rejects(service.dispatch(method, {}, connection('unknown')), { code: 'FORBIDDEN' });
  }
  await assert.rejects(service.dispatch('notifications.register', { ...params, deviceId: 'other' }, connection()), { code: 'BAD_REQUEST' });
  await assert.rejects(service.dispatch('notifications.register', { ...params, environment: 'http://leak.test' }, connection()), { code: 'BAD_REQUEST' });
  const bridged: any[] = [];
  const bridge = createNativeBridge({ rpc: { call() {}, open() {} }, notifications: { dispatch: (...args: any[]) => { bridged.push(args); return {}; } } });
  await bridge.dispatch('notifications.state', {}, connection());
  assert.equal(bridged[0][2].deviceId, 'phone', 'the native bridge passes the authenticated pairing identity');
  source.publish(collector, [record]);
  assert.equal(sent.length, 0);
  await service.dispatch('notifications.register', params, connection());
  assert.equal((await stat(join(folder, 'push-devices.json'))).mode & 0o777, 0o600);
  await service.close();
  service = await createNativeNotifications({ folder, devices, source, sender, enabled: () => true });
  assert.deepEqual(await service.dispatch('notifications.state', {}, connection()), { configured: true, enabled: true });
  source.publish({ ...collector, notify: false }, [record]);
  assert.equal(sent.length, 0);
  source.publish(collector, [record]);
  assert.equal(sent.length, 1, 'one live collection, including while the phone has no HTTP connection');
  assert.equal(sent[0].computerId, devices.id);
  assert.equal(sent[0].registration.token, token);
  assert.deepEqual(sent[0].event, { collector: collector.id, title: collector.name, body: `${record.title}\n${record.text}` });
  await service.dispatch('notifications.register', params, connection('other'));
  source.publish(collector, [record]);
  assert.equal(sent.at(-1).registration.deviceId, 'other');
  assert.equal(sent.length, 2, 're-pairing replaces a previous owner of the same token');
  devices.revoke('other');
  source.publish(collector, [record]);
  assert.equal(sent.length, 2, 'revocation immediately prevents delivery, without relying on HTTP disconnect');
  await service.close();
  assert.equal(JSON.parse(await readFile(join(folder, 'push-devices.json'), 'utf8')).devices.length, 0);
});

test('late APNs invalidation cannot delete a newer token and unregister cancels outstanding delivery', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-push-race-'));
  const source = createCollectorNotifications();
  const devices = pairingFixture();
  let finish!: (value: any) => void;
  let signal!: AbortSignal;
  let complete!: () => void;
  const waited = new Promise<void>((resolve) => { complete = resolve; });
  const sender = {
    send(_registration: any, _event: any, _computer: string, incomingSignal: AbortSignal) {
      signal = incomingSignal;
      return new Promise((resolve) => { finish = resolve; });
    },
    close() {},
  };
  const service = await createNativeNotifications({
    folder, devices, source, sender,
    report: (code: string) => { if (code === 'APNS_DELIVERY_REJECTED') complete(); },
  });
  t.after(async () => { await service.close(); source.close(); await rm(folder, { recursive: true, force: true }); });
  await service.dispatch('notifications.register', params, connection());
  source.publish(collector, [record]);
  await service.dispatch('notifications.register', { ...params, token: 'cd'.repeat(32) }, connection());
  finish({ status: 410, reason: 'Unregistered' });
  await waited;
  const saved = JSON.parse(await readFile(join(folder, 'push-devices.json'), 'utf8'));
  assert.equal(saved.devices[0].token, 'cd'.repeat(32));
  source.publish(collector, [record]);
  await service.dispatch('notifications.unregister', {}, connection());
  assert.equal(signal.aborted, true);
  finish({ status: 200 });
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'push-devices.json'), 'utf8')).devices, []);
});

test('APNs uses a verifiable ES256 JWT, fixed Apple hosts and the Dudu topic, with bounded content and no credentials in the payload', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const requests: any[] = [];
  let now = 1_800_000_000_000;
  const sender = createAPNsSender({
    key: privateKey, teamId: 'TEAM000001', keyId: 'KEY0000001', now: () => now,
    connectHTTP2: (host: string) => {
      const session = new EventEmitter() as any;
      session.destroy = () => { session.destroyed = true; };
      session.request = (headers: any, options: any) => {
        const stream = new EventEmitter() as any;
        stream.setEncoding = () => {};
        stream.setTimeout = () => {};
        stream.end = (body: string) => {
          requests.push({ host, headers, options, body });
          stream.emit('response', { ':status': 200 });
          stream.emit('end');
        };
        return stream;
      };
      return session;
    },
  });
  const event = { collector: 'mentions', title: '飞书', body: '新消息' };
  assert.deepEqual(await sender.send(params, event, 'computer'), { status: 200, reason: undefined });
  const first = requests[0];
  assert.equal(first.host, 'https://api.sandbox.push.apple.com');
  assert.equal(first.headers['apns-topic'], 'com.harnessmobile.app');
  assert.equal(first.headers['apns-push-type'], 'alert');
  assert.equal(first.headers['apns-expiration'], '0');
  const jwt = first.headers.authorization.slice(7).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(jwt[0], 'base64url').toString()), { alg: 'ES256', kid: 'KEY0000001' });
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url').toString()).iss, 'TEAM000001');
  assert.equal(verify('sha256', Buffer.from(jwt.slice(0, 2).join('.')), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')), true);
  assert.deepEqual(JSON.parse(first.body).dudu, { version: 1, computerId: 'computer', collectorId: 'mentions' });
  assert.equal(first.body.includes(token), false);
  await sender.send({ ...params, environment: 'production' }, event, 'computer');
  assert.equal(requests[1].host, 'https://api.push.apple.com');
  assert.equal(requests[1].headers.authorization, first.headers.authorization, 'one provider token is reused within its valid window');
  now += 41 * 60_000;
  await sender.send(params, event, 'computer');
  assert.notEqual(requests[2].headers.authorization, first.headers.authorization);
  await assert.rejects(sender.send(params, { ...event, body: '汉'.repeat(2000) }, 'computer'), /APNS_PAYLOAD_TOO_LARGE/);
  await assert.rejects(sender.send({ ...params, token: '../other' }, event, 'computer'));
  sender.close();
});

test('missing APNs configuration stays explicit and the native collector bell updates the existing shared preference only', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-no-push-'));
  const devices = pairingFixture();
  const service = await createNativeNotifications({ folder, devices, enabled: () => true });
  t.after(async () => { await service.close(); await rm(folder, { recursive: true, force: true }); });
  assert.deepEqual(await service.dispatch('notifications.state', {}, connection()), { configured: false, enabled: true });
  await assert.rejects(service.dispatch('notifications.register', params, connection()), { code: 'UPSTREAM_UNAVAILABLE' });
  const actions: any[] = [];
  const settings = createNativeSettings({ call: async (action: string, body: any) => {
    actions.push([action, body]);
    return { status: 200, body: { outcome: 'success', collectors: [], connectors: [] } };
  } });
  await settings.dispatch('settings.act', { section: 'collectors', name: 'notify', args: { id: 'mentions' }, value: 'true' });
  assert.deepEqual(actions.find(([action]) => action === 'collectors/update'), ['collectors/update', { id: 'mentions', notify: true }]);
  actions.length = 0;
  assert.equal((await settings.dispatch('settings.act', { section: 'collectors', name: 'notify', args: { id: 'mentions' }, value: 'yes' })).outcome, 'error');
  assert.equal(actions.some(([action]) => action === 'collectors/update'), false);
});
