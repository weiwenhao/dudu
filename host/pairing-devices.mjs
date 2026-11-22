import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const validToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const equalDigest = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string'
    || !/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

export function connectionOrigin(value) {
  let url;
  try {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid URL');
    url = new URL(value.trim());
  } catch { throw new Error('请输入完整的连接地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || /[?#]/.test(value)) {
    throw new Error('连接地址只需填写域名和端口，不包含路径或配对凭据。');
  }
  return url.origin;
}

export function connectionAddress(value) {
  let url;
  try {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid URL');
    url = new URL(value.trim());
  } catch { throw new Error('请输入完整的连接地址。'); }
  const originalProtocol = url.protocol;
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(originalProtocol) || url.username || url.password
    || !['', '/'].includes(url.pathname) || url.search || url.hash || /[?#]/.test(value)) {
    throw new Error('连接地址只需填写主机和端口。');
  }
  if (originalProtocol === 'ws:') url.protocol = 'http:';
  else if (originalProtocol === 'wss:') url.protocol = 'https:';
  return url.origin;
}

/** A default for imported addresses; a user may explicitly classify a LAN domain. */
export function connectionKind(address) {
  const host = new URL(connectionAddress(address)).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1'
    || /^(fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]:/u.test(host)) return 'lan';
  const octets = host.split('.').map(Number);
  if (octets.length === 4 && /^\d+\.\d+\.\d+\.\d+$/u.test(host)
    && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = octets;
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return 'lan';
  }
  return 'public';
}

export async function createPairingStore({
  folder, now = Date.now, ttlMs = 10 * 60_000, legacySecureCookie = false, legacyKeyPath,
}) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, 'devices.json');
  let data;
  try { data = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = { version: 1, id: randomUUID(), secret: randomBytes(32).toString('base64url'), devices: [] };
  }
  if (data.version !== 1 || !validToken(data.secret) || !Array.isArray(data.devices)
    || typeof data.id !== 'string') throw new Error('Invalid dudu device registry.');
  if (data.legacyImportedTokenHash !== undefined
    && (typeof data.legacyImportedTokenHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(data.legacyImportedTokenHash))) {
    throw new Error('Invalid legacy dudu migration marker.');
  }
  data.devices = data.devices.map((device) => ({ ...device }));
  // Preserve the cookie policy of codes created before each code stored its own policy.
  for (const device of data.devices) {
    if (typeof device.secureCookie !== 'boolean') device.secureCookie = legacySecureCookie;
  }
  let writing = Promise.resolve();
  const save = () => {
    const body = JSON.stringify(data);
    const operation = writing.then(async () => {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, body, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    });
    writing = operation.catch(() => {});
    return operation;
  };
  await save();
  const revoked = new Set();
  let credentialOperations = Promise.resolve();
  const serializeCredentialOperation = (operation) => {
    const result = credentialOperations.then(operation);
    credentialOperations = result.catch(() => {});
    return result;
  };
  let flushTimer;
  const legacyKey = async () => {
    if (!legacyKeyPath) return;
    try {
      const candidate = (await readFile(legacyKeyPath, 'utf8')).trim();
      return validToken(candidate) ? candidate : undefined;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  };
  const deferSave = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void save().catch(() => console.error('[dudu] Device activity could not be saved.'));
    }, 1000);
    flushTimer.unref();
  };
  const publicDevice = (device) => ({
    id: device.id, name: device.name, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt,
    ...(device.client ? { client: device.client } : {}),
  });
  return {
    id: data.id,
    proof(nonce) {
      if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
        throw new Error('Invalid dudu probe nonce.');
      }
      return createHmac('sha256', data.secret)
        .update(`dudu-probe:v1:${nonce}`).digest('base64url');
    },
    routeProof(deviceId, nonce) {
      if (typeof deviceId !== 'string' || typeof nonce !== 'string'
        || !/^[A-Za-z0-9_-]{16,128}$/u.test(nonce)) return undefined;
      const device = data.devices.find((item) => item.id === deviceId);
      if (!device || (!device.pairedAt && device.expiresAt <= now())) return undefined;
      // Knowing a device ID permits only a nonce-bound identity proof, never authentication.
      // The phone derives this key from its credential locally; no credential goes to an unverified route.
      return {
        computerId: data.id,
        deviceId: device.id,
        deviceProof: createHmac('sha256', Buffer.from(device.tokenHash, 'hex'))
          .update(`dudu-route:v1:${nonce}:${data.id}:${device.id}`).digest('base64url'),
      };
    },
    /** What the app on a device said about itself when it connected (platform, version, build, what it understands): kept to tell which builds are still in use. */
    recordClient(deviceId, client) {
      const device = data.devices.find((item) => item.id === deviceId && item.pairedAt);
      if (!device || !client || typeof client !== 'object') return;
      const next = { platform: client.platform ?? null, ...(client.version ? { version: client.version } : {}), ...(client.build ? { build: client.build } : {}), capabilities: client.capabilities ?? [] };
      if (JSON.stringify(device.client) === JSON.stringify(next)) return;
      device.client = next;
      deferSave();
    },
    list() {
      return data.devices.filter((device) => device.pairedAt)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt).map(publicDevice);
    },
    async issue({ address, name, addresses }) {
      if (addresses !== undefined && (!Array.isArray(addresses) || !addresses.length || addresses.length > 32)) {
        throw new Error('连接地址格式不正确。');
      }
      const routes = (addresses ?? []).map((route) => {
        if (!route || !['lan', 'public'].includes(route.kind)) throw new Error('连接地址格式不正确。');
        return { kind: route.kind, url: connectionAddress(route.url) };
      });
      let pairingAddress;
      let secureCookie;
      try {
        const parsed = new URL(address);
        const canonicalAddress = connectionAddress(address);
        pairingAddress = `${canonicalAddress}/`;
        secureCookie = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
      } catch (error) {
        if (error.message.includes('连接地址') || error.message.includes('完整')) throw error;
        throw new Error('连接地址格式不正确。');
      }
      const token = randomBytes(32).toString('base64url');
      const timestamp = now();
      data.devices = data.devices.filter((device) => device.pairedAt || device.expiresAt > timestamp);
      // A pending code stores only hashes; the printable token is returned once.
      const session = createHmac('sha256', data.secret).update(token).digest('base64url');
      const device = {
        id: randomUUID(), tokenHash: digest(token), sessionHash: digest(session),
        createdAt: timestamp, expiresAt: timestamp + ttlMs, pairedAt: null,
        lastSeenAt: null, name: '', secureCookie,
      };
      data.devices.push(device);
      try { await save(); }
      catch (error) { data.devices = data.devices.filter((item) => item !== device); throw error; }
      const query = new URLSearchParams({ pair: token, computer: data.id, device: device.id });
      if (typeof name === 'string') query.set('name', name);
      for (const route of routes) query.append(route.kind, route.url);
      const separator = pairingAddress.includes('?') ? '&' : '?';
      return { id: device.id, url: `${pairingAddress}${separator}${query}`, expiresAt: device.expiresAt };
    },
    async redeem(token, userAgent = '') {
      if (!validToken(token)) return;
      const tokenHash = digest(token);
      const device = data.devices.find((item) => equalDigest(item.tokenHash, tokenHash));
      if (!device || (!device.pairedAt && device.expiresAt <= now())) return;
      if (!device.pairedAt) {
        const previous = { ...device };
        device.pairedAt = now();
        device.lastSeenAt = now();
        device.name = /iPhone/i.test(userAgent) ? 'iPhone'
          : /iPad/i.test(userAgent) ? 'iPad' : /Android/i.test(userAgent) ? 'Android' : '手机';
        try { await save(); } catch (error) { Object.assign(device, previous); throw error; }
      }
      return {
        id: device.id,
        session: createHmac('sha256', data.secret).update(token).digest('base64url'),
        secureCookie: device.secureCookie,
      };
    },
    authenticate(token, clientName = '') {
      return serializeCredentialOperation(async () => {
      if (!validToken(token)) return;
      const tokenHash = digest(token);
      let device = data.devices.find((item) => equalDigest(item.tokenHash, tokenHash));
      if (!device && legacyKeyPath && !data.legacyImportedTokenHash) {
        const candidate = await legacyKey();
        // Another concurrent authentication may have completed migration while the file read waited.
        device = data.devices.find((item) => equalDigest(item.tokenHash, tokenHash));
        if (device || data.legacyImportedTokenHash) {
          // Continue through the normal paired-device path below.
        } else if (candidate && equalDigest(digest(candidate), tokenHash)) {
          const timestamp = now();
          device = {
            id: randomUUID(), tokenHash, sessionHash: digest(createHmac('sha256', data.secret)
              .update(candidate).digest('base64url')),
            createdAt: timestamp, expiresAt: Number.MAX_SAFE_INTEGER,
            pairedAt: timestamp, lastSeenAt: timestamp,
            name: typeof clientName === 'string' && clientName.trim()
              ? clientName.trim().slice(0, 80) : 'Legacy device',
            secureCookie: false, legacy: true,
          };
          data.devices.push(device);
          data.legacyImportedTokenHash = tokenHash;
          try { await save(); }
          catch (error) {
            data.devices = data.devices.filter((item) => item !== device);
            delete data.legacyImportedTokenHash;
            throw error;
          }
          return device.id;
        }
      }
      if (!device || (!device.pairedAt && device.expiresAt <= now())) return;
      if (!device.pairedAt) {
        const previous = { ...device };
        device.pairedAt = now();
        device.lastSeenAt = now();
        if (typeof clientName === 'string' && clientName.trim()) {
          device.name = clientName.trim().slice(0, 80);
        }
        try { await save(); } catch (error) { Object.assign(device, previous); throw error; }
      } else if (now() - (device.lastSeenAt ?? 0) >= 60_000) {
        device.lastSeenAt = now();
        deferSave();
      }
      return device.id;
      });
    },
    authorize(session) {
      if (!validToken(session)) return;
      const sessionHash = digest(session);
      const device = data.devices.find((item) => item.pairedAt && equalDigest(item.sessionHash, sessionHash));
      if (!device) return;
      if (now() - device.lastSeenAt >= 60_000) {
        device.lastSeenAt = now();
        deferSave();
      }
      return device.id;
    },
    revoke(id) {
      return serializeCredentialOperation(async () => {
      const device = data.devices.find((item) => item.id === id);
      if (!device) return false;
      const previous = data.devices;
      data.devices = previous.filter((item) => item.id !== id);
      try { await save(); } catch (error) { data.devices = previous; throw error; }
      for (const callback of revoked) callback(id);
      return true;
      });
    },
    onRevoke(callback) {
      revoked.add(callback);
      return () => revoked.delete(callback);
    },
    async close() {
      clearTimeout(flushTimer);
      await credentialOperations;
      await save();
      await writing;
      revoked.clear();
    },
  };
}
