import { Buffer } from 'node:buffer';
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
      // Three things are pushed. A collector's notification is an alert. The board wake (owner, 2026-11-22: 「通过通知唤醒，然后将消息写入」) is nothing the person sees: no alert, no sound, no number;
      // it only wakes an App that iOS has suspended for a few seconds, so that it can read the board and write it down before it is opened (native-board-wake.mjs). A notice of a reply or a question
      // (「弹通知也行」, native-board-announce.mjs) is an alert, without a sound, that also carries the wake (and the notification extension's `mutable-content`): Apple delivers an alert at once, and the next
      // notice of the same conversation replaces it.
      const wake = event.kind === 'board';
      const notice = event.kind === 'announce';
      const group = createHash('sha256').update(`${computerId}:${wake ? 'board' : notice ? `conversation:${event.conversationId}` : event.collector}`).digest('hex');
      const body = JSON.stringify(wake
        ? { aps: { 'content-available': 1 }, dudu: { version: 1, computerId, kind: 'board' } }
        : notice
          ? {
            // Both ways to write the board: the notification extension runs before the notice is shown, also with the App swiped away (`mutable-content`), and the App is woken after it (`content-available`),
            // which still works if the extension could not reach the computer. A phone without the extension ignores the first.
            aps: { alert: { title: event.title, body: event.body }, 'mutable-content': 1, 'content-available': 1, 'thread-id': group },
            dudu: { version: 1, computerId, kind: 'board', conversationId: event.conversationId },
          }
          : {
            aps: { alert: { title: event.title, body: event.body }, sound: 'default', 'thread-id': group },
            dudu: { version: 1, computerId, collectorId: event.collector },
          });
      if (Buffer.byteLength(body) > 4096) throw new Error('APNS_PAYLOAD_TOO_LARGE');
      const headers = {
        ':method': 'POST', ':path': `/3/device/${registration.token}`,
        authorization: `bearer ${jwt()}`, 'apns-topic': TOPIC, 'apns-push-type': wake ? 'background' : 'alert',
        'apns-priority': wake ? '5' : '10',
        // A wake that Apple could not hand over at once is kept for an hour (the App reads the board as it is then, and a newer wake replaces it); an alert is not kept.
        'apns-expiration': wake ? String(Math.floor(now() / 1000) + 3600) : '0',
        'apns-collapse-id': group, 'apns-id': randomUUID(),
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
