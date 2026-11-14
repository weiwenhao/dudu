import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:http2';
import { isAbsolute, join } from 'node:path';

const TOPIC = 'com.harnessmobile.app';
const HOSTS = Object.freeze({
  development: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
});
const encoded = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Credentials stay on the paired computer; neither the phone nor a page can supply a signing key or destination. */
export async function loadAPNsSender(folder, { report = () => {} } = {}) {
  let config;
  try { config = JSON.parse(await readFile(join(folder, 'apns.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') report('APNS_CONFIG_INVALID');
    return null;
  }
  try {
    if (!/^[A-Z0-9]{10}$/u.test(config.teamId) || !/^[A-Z0-9]{10}$/u.test(config.keyId)
      || typeof config.privateKeyFile !== 'string' || !isAbsolute(config.privateKeyFile)) throw new Error();
    const key = createPrivateKey(await readFile(config.privateKeyFile));
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
    return createAPNsSender({ teamId: config.teamId, keyId: config.keyId, key });
  } catch {
    report('APNS_CONFIG_INVALID');
    return null;
  }
}

export function createAPNsSender({ teamId, keyId, key, now = Date.now, connectHTTP2 = connect }) {
  const sessions = new Map();
  let authorization;
  let issuedAt = 0;
  let closed = false;

  function jwt() {
    const seconds = Math.floor(now() / 1000);
    if (!authorization || seconds < issuedAt || seconds - issuedAt >= 40 * 60) {
      issuedAt = seconds;
      const input = `${encoded({ alg: 'ES256', kid: keyId })}.${encoded({ iss: teamId, iat: issuedAt })}`;
      authorization = `${input}.${sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    }
    return authorization;
  }

  function session(environment) {
    const previous = sessions.get(environment);
    if (previous && !previous.closed && !previous.destroyed) return previous;
    const current = connectHTTP2(HOSTS[environment]);
    sessions.set(environment, current);
    const retire = () => {
      if (sessions.get(environment) === current) sessions.delete(environment);
      current.destroy();
    };
    current.on('error', retire);
    current.on('goaway', retire);
    return current;
  }

  return {
    async send(registration, event, computerId, signal) {
      if (closed || !Object.hasOwn(HOSTS, registration.environment)
        || !/^(?:[a-f0-9]{2}){16,256}$/u.test(registration.token)) throw new Error('APNS_REGISTRATION_INVALID');
      signal?.throwIfAborted();
      const group = createHash('sha256').update(`${computerId}:${event.collector}`).digest('hex');
      const body = JSON.stringify({
        aps: { alert: { title: event.title, body: event.body }, sound: 'default', 'thread-id': group },
        dudu: { version: 1, computerId, collectorId: event.collector },
      });
      if (Buffer.byteLength(body) > 4096) throw new Error('APNS_PAYLOAD_TOO_LARGE');
      const headers = {
        ':method': 'POST', ':path': `/3/device/${registration.token}`,
        authorization: `bearer ${jwt()}`, 'apns-topic': TOPIC, 'apns-push-type': 'alert',
        'apns-priority': '10', 'apns-expiration': '0', 'apns-collapse-id': group, 'apns-id': randomUUID(),
        'content-type': 'application/json',
      };
      return new Promise((resolve, reject) => {
        const stream = session(registration.environment).request(headers, { signal });
        let status;
        let result = '';
        stream.setEncoding('utf8');
        stream.setTimeout(10_000, () => stream.destroy(new Error('APNS_TIMEOUT')));
        stream.on('response', (response) => { status = response[':status']; });
        stream.on('data', (chunk) => {
          result += chunk;
          if (result.length > 4096) stream.destroy(new Error('APNS_RESPONSE_INVALID'));
        });
        stream.on('error', () => reject(new Error('APNS_DELIVERY_FAILED')));
        stream.on('close', () => reject(new Error('APNS_CONNECTION_CLOSED')));
        stream.on('end', () => {
          if (!Number.isInteger(status)) { reject(new Error('APNS_RESPONSE_INVALID')); return; }
          let reason;
          try { reason = JSON.parse(result).reason; } catch { /* Successful requests have an empty response. */ }
          resolve({ status, reason });
        });
        stream.end(body);
      });
    },
    close() {
      closed = true;
      for (const current of sessions.values()) current.destroy();
      sessions.clear();
    },
  };
}
