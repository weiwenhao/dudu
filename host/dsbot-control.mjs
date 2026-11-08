import { Buffer } from 'node:buffer';
import { hostname } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNativeBridge } from './native-bridge.mjs';
import { createNavigationStore } from './native-navigation.mjs';
import { createNativeServer, localAddress, probeNativeAddress, equalProof } from './native-server.mjs';
import { connectionAddress, connectionKind, createPairingStore } from './pairing-devices.mjs';
import { renderPairingSvg } from './qr.mjs';
import { createWebPageHttp } from './web-page-http.mjs';

const MAX_ADDRESSES = 32;
const DEFAULT_PORT = 3170;
// Room for the shapes of every icon and a few small pictures of the ones the browser had to draw.
const MAX_NAVIGATION_BYTES = 512 * 1024;

export async function createDsbotControl({
  folder,
  rpc,
  pages,
  conversationReads,
  questionBridge,
  sessionActivity,
  sessionSearch,
  assistantConversation,
  assistant,
  board,
  duduPages,
  dispatch: injectedDispatch,
  port = DEFAULT_PORT,
  host = '0.0.0.0',
  resolveLanAddress = localAddress,
  probeAddress = probeNativeAddress,
  nativeServerFactory = createNativeServer,
  legacyKeyPath = join(folder, 'pairing-key'),
}) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const settingsPath = join(folder, 'settings.json');
  let stored;
  try { stored = JSON.parse(await readFile(settingsPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stored !== undefined && (!stored || typeof stored !== 'object' || Array.isArray(stored))) {
    throw new Error('配置格式不正确。');
  }

  const validate = (value) => {
    if (!value || typeof value !== 'object') throw new Error('配置格式不正确。');
    const name = String(value.name ?? '').trim();
    if (!name || name.length > 80) throw new Error('电脑名称请填写 1 至 80 个字符。');
    if (!Array.isArray(value.addresses) || value.addresses.length > MAX_ADDRESSES) {
      throw new Error(`连接地址最多添加 ${MAX_ADDRESSES} 个。`);
    }
    const automatic = lanAddress();
    const addresses = [];
    const addressKinds = {};
    for (const address of value.addresses) {
      if (typeof address !== 'string') throw new Error('连接地址格式不正确。');
      if (!address.trim()) continue;
      const normalized = connectionAddress(address);
      if (normalized !== automatic && !addresses.includes(normalized)) {
        addresses.push(normalized);
        const kind = value.addressKinds?.[address] ?? value.addressKinds?.[normalized];
        if (kind !== undefined && !['lan', 'public'].includes(kind)) throw new Error('配置格式不正确。');
        if (kind && kind !== connectionKind(normalized)) addressKinds[normalized] = kind;
      }
    }
    if (addresses.length >= MAX_ADDRESSES) throw new Error(`连接地址最多添加 ${MAX_ADDRESSES} 个。`);
    return { name, addresses, ...(Object.keys(addressKinds).length ? { addressKinds } : {}) };
  };

  const lanAddress = () => connectionAddress(`http://${resolveLanAddress()}:${server.port}`);
  let legacySecureCookie = false;
  if (stored && !Object.hasOwn(stored, 'addresses')) {
    if (!['lan', 'public'].includes(stored.mode)) throw new Error('配置格式不正确。');
    legacySecureCookie = stored.mode === 'public';
  }
  const devices = await createPairingStore({ folder, legacySecureCookie, legacyKeyPath });
  const navigation = await createNavigationStore({ folder });
  let bridge;
  let httpPages;
  let dispatch;
  let settings = { name: hostname().slice(0, 80) || 'DSH', addresses: [] };
  let server;
  try {
    bridge = injectedDispatch ? undefined : createNativeBridge({ rpc, pages, navigation, conversationReads, questionBridge, sessionActivity, sessionSearch, assistantConversation, assistant, board, duduPages });
    dispatch = injectedDispatch ?? bridge.dispatch;
    httpPages = typeof pages?.openHttp === 'function'
      ? createWebPageHttp({ pages, pairingStore: devices, duduPages }) : undefined;
    server = await nativeServerFactory({
      host,
      port,
      computer: () => ({ id: devices.id, name: settings.name, addresses: connectionRoutes() }),
      pairingStore: devices,
      dispatch,
      onDisconnect: bridge?.closeConnection,
      httpHandler: httpPages?.handle,
      capabilities: bridge ? ['web.pages', ...(httpPages ? ['web.http'] : [])] : [],
    });
  } catch (error) {
    await httpPages?.close();
    await devices.close();
    throw error;
  }

  try {
    if (!stored) {
      settings = validate({ name: hostname().slice(0, 80) || 'DSH', addresses: [] });
    } else if (Object.hasOwn(stored, 'addresses')) {
      settings = validate(stored);
    } else {
      const addresses = [];
      if (typeof stored.publicUrl === 'string' && stored.publicUrl.trim()) {
        addresses.push(connectionAddress(stored.publicUrl));
      }
      settings = validate({ name: stored.name ?? hostname(), addresses });
    }
  } catch (error) {
    await httpPages?.close();
    await server.close();
    await devices.close();
    throw error;
  }

  let saving = Promise.resolve();
  const persistSettings = async (next) => {
    const temporary = `${settingsPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    await rename(temporary, settingsPath);
  };
  if (JSON.stringify(stored) !== JSON.stringify(settings)) {
    try { await persistSettings(settings); }
    catch (error) {
      await httpPages?.close();
      await server.close();
      await devices.close();
      throw error;
    }
  }

  function connectionRoutes(config = settings) {
    const automatic = lanAddress();
    return [
      { kind: 'lan', url: automatic },
      ...config.addresses.filter((address) => address !== automatic)
        .map((url) => ({ kind: config.addressKinds?.[url] ?? connectionKind(url), url })),
    ];
  }
  const state = () => {
    const automatic = lanAddress();
    return {
      ...settings,
      addresses: [automatic, ...settings.addresses.filter((address) => address !== automatic)],
      lanAddress: automatic,
      routes: connectionRoutes(),
      port: server.port,
      devices: devices.list(),
    };
  };
  const save = (value) => {
    const next = validate(value);
    const operation = saving.then(async () => {
      await persistSettings(next);
      settings = next;
      return state();
    });
    saving = operation.catch(() => {});
    return operation;
  };

  return {
    server,
    devices,
    navigation,
    state,
    save,
    async generate(value) {
      const next = validate(value);
      const address = value.address === undefined ? lanAddress() : connectionAddress(value.address);
      if (value.address !== undefined) {
        if (address !== lanAddress() && !next.addresses.includes(address)) throw new Error('请选择已添加的连接地址。');
        const nonce = randomBytes(24).toString('base64url');
        const expected = devices.proof(nonce);
        let received;
        try {
          received = await probeAddress(address, nonce, { expectedProof: expected, pairingStore: devices });
        } catch {
          throw new Error('连接地址未连接到这台电脑，请检查地址、TLS 证书和网络配置。');
        }
        if (!equalProof(expected, received)) {
          throw new Error('连接地址未连接到这台电脑，请检查地址、TLS 证书和网络配置。');
        }
      }
      await save(next);
      const routes = connectionRoutes(next);
      const code = await devices.issue({ address, addresses: routes, name: next.name });
      return { ...code, svg: renderPairingSvg(code.url), name: next.name, addresses: routes };
    },
    async handle(action, request) {
      try {
        if (action === 'state') {
          return Response.json(state(), { headers: { 'cache-control': 'no-store' } });
        }
        if (action === 'nav') {
          // DSH's own client reports what its sidebar, tabs and settings contain.
          const raw = await request.text();
          if (Buffer.byteLength(raw, 'utf8') > MAX_NAVIGATION_BYTES) throw new Error('导航数据过大。');
          return Response.json(
            { changed: await navigation.ingest(JSON.parse(raw)) },
            { headers: { 'cache-control': 'no-store' } },
          );
        }
        const body = await request.json();
        if (action === 'save') {
          return Response.json(await save(body), { headers: { 'cache-control': 'no-store' } });
        }
        if (action === 'generate') {
          return Response.json(await this.generate(body), {
            headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
          });
        }
        if (action === 'revoke') {
          if (typeof body.id !== 'string') throw new Error('请选择要撤销的设备。');
          await devices.revoke(body.id);
          return Response.json(state(), { headers: { 'cache-control': 'no-store' } });
        }
        return new Response('Not found', { status: 404 });
      } catch (error) {
        const message = error instanceof SyntaxError ? '配置格式不正确。'
          : error?.code ? '配置暂时无法保存，请稍后重试。' : error.message;
        return Response.json({ error: message }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    },
    async close() {
      await saving;
      try {
        await httpPages?.close();
        await server.close();
      }
      finally {
        await navigation.close();
        await devices.close();
      }
    },
  };
}
