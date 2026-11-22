import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAPNsSender } from './apns.mjs';

export const NATIVE_NOTIFICATION_METHODS = Object.freeze([
  'notifications.state', 'notifications.register', 'notifications.unregister',
]);

const validRegistration = (value) => value && typeof value === 'object'
  && typeof value.token === 'string' && /^(?:[a-f0-9]{2}){16,256}$/u.test(value.token)
  && ['development', 'production'].includes(value.environment);
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

/** Push registrations belong to pairing identities, not transient connections or the conversation being watched. */
export async function createNativeNotifications({
  folder, devices, source, enabled = () => false, sender: suppliedSender,
  report = (code) => console.warn(`[dudu] ${code}`),
}) {
  const sender = suppliedSender === undefined ? await loadAPNsSender(folder, { report }) : suppliedSender;
  const path = join(folder, 'push-devices.json');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let stored = { version: 1, devices: [] };
  try { stored = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') { sender?.close(); throw error; } }
  if (stored?.version !== 1 || !Array.isArray(stored.devices) || stored.devices.length > 128
    || stored.devices.some((row) => !validRegistration(row) || typeof row.deviceId !== 'string')) {
    sender?.close();
    throw new Error('Invalid push device registry.');
  }
  const paired = (id) => devices.list().some((device) => device.id === id);
  const registrations = new Map(stored.devices.filter((row) => paired(row.deviceId))
    .map((row) => [row.deviceId, { ...row, revision: randomUUID() }]));
  const deliveries = new Set();
  let writing = Promise.resolve();
  let closed = false;
  function save() {
    const body = JSON.stringify({ version: 1, devices: [...registrations.values()] });
    const operation = writing.then(async () => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, body, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    });
    writing = operation.catch(() => {});
    return operation;
  }
  // Also discard registrations whose pairing was revoked while the plugin was not running.
  await save();

  const stopRevoke = devices.onRevoke((deviceId) => {
    for (const delivery of deliveries) if (delivery.deviceId === deviceId) delivery.abort.abort();
    registrations.delete(deviceId);
    void save().catch(() => report('APNS_REGISTRY_WRITE_FAILED'));
  });
  /** One push to one registration. Resolves with what Apple answered (`{ status, reason }`), or nothing if it could not be sent. A registration that Apple says is dead is dropped. */
  async function deliver(registration, event) {
    const delivery = { deviceId: registration.deviceId, abort: new AbortController() };
    deliveries.add(delivery);
    try {
      const result = await sender.send(registration, event, devices.id, delivery.abort.signal);
      if (closed || delivery.abort.signal.aborted) return undefined;
      if (result.status === 410 || ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(result.reason)) {
        if (registrations.get(registration.deviceId)?.revision === registration.revision) {
          registrations.delete(registration.deviceId);
          await save();
        }
      }
      if (result.status !== 200) report('APNS_DELIVERY_REJECTED');
      return result;
    } catch {
      if (!closed && !delivery.abort.signal.aborted) report('APNS_DELIVERY_FAILED');
      return undefined;
    } finally {
      deliveries.delete(delivery);
    }
  }
  async function publish(event) {
    if (closed || !sender) return;
    await Promise.allSettled([...registrations.values()].filter((registration) => paired(registration.deviceId))
      .map((registration) => deliver(registration, event)));
  }
  const stopSource = source?.subscribe((event) => { void publish(event); });
  return {
    /** The board changed while this phone was away: wake its App with a push that shows nothing (apns.mjs, `board`). Resolves with what Apple answered, or nothing. */
    async wake(deviceId) {
      const registration = registrations.get(deviceId);
      if (closed || !sender || !registration || !paired(deviceId)) return undefined;
      return deliver(registration, { kind: 'board' });
    },
    /** A reply or a question nobody has read: tell this phone with an alert that also wakes its App (apns.mjs, `announce`). Resolves with what Apple answered, or nothing. */
    async notice(deviceId, { conversationId, title, body }) {
      const registration = registrations.get(deviceId);
      if (closed || !sender || !registration || !paired(deviceId)) return undefined;
      return deliver(registration, { kind: 'announce', conversationId, title, body });
    },
    async dispatch(method, params, connection) {
      if (closed || !connection?.authenticated || !paired(connection.deviceId)) fail('FORBIDDEN');
      if (!params || typeof params !== 'object' || Array.isArray(params)) fail('BAD_REQUEST');
      if (method === 'notifications.state') {
        if (Object.keys(params).length) fail('BAD_REQUEST');
        return { configured: Boolean(sender), enabled: enabled() === true };
      }
      if (method === 'notifications.register') {
        if (!validRegistration(params) || Object.keys(params).some((key) => !['token', 'environment'].includes(key))) fail('BAD_REQUEST');
        if (!sender) fail('UPSTREAM_UNAVAILABLE');
        if (!registrations.has(connection.deviceId) && registrations.size >= 128) fail('LIMIT_EXCEEDED');
        // A token belongs to one pairing on this computer, including after a fresh pairing of the same phone.
        for (const [id, row] of registrations) {
          if (row.token === params.token && row.environment === params.environment) registrations.delete(id);
        }
        registrations.set(connection.deviceId, {
          deviceId: connection.deviceId, token: params.token, environment: params.environment, revision: randomUUID(),
        });
        await save();
        return { outcome: 'success' };
      }
      if (method === 'notifications.unregister') {
        if (Object.keys(params).length) fail('BAD_REQUEST');
        for (const delivery of deliveries) if (delivery.deviceId === connection.deviceId) delivery.abort.abort();
        registrations.delete(connection.deviceId);
        await save();
        return { outcome: 'success' };
      }
      fail('UNSUPPORTED');
    },
    async close() {
      closed = true;
      stopSource?.();
      stopRevoke();
      for (const delivery of deliveries) delivery.abort.abort();
      sender?.close();
      await writing;
    },
  };
}
