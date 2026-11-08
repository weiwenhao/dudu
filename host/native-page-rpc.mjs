import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { CONTEXT_PAGE_READ_METHODS, createContextPageReads } from './context-page-reads.mjs';
import { MARKET_PAGE_READ_METHODS, createDshMarketPageReads } from './dsh-market-page-reads.mjs';

export const PAGE_READ_METHODS = Object.freeze([
  ...CONTEXT_PAGE_READ_METHODS,
  ...MARKET_PAGE_READ_METHODS,
  'settings/describe',
  'session/list',
  'session/modelCatalog',
  'session/projections',
  'session/page',
  'session/canOpenWorkspacePath',
  'permissionPresets/catalog',
  'agentPresets/list',
  'agentPresets/read',
  'llm/listProviders',
  'llm/listConfigurableProviders',
  'llm/discoverModels',
  'account/getState',
  'account/getProfile',
  'account/getBalance',
  'account/getUnnotifiedBonuses',
  'account/hasRunningAccountTasks',
  'pluginManager/listPlugins',
  'pluginManager/listBundles',
  'pluginManager/registries',
  'pluginManager/listVersionExemptions',
  'pluginManager/inspect',
  'pluginInventory/list',
  'pluginRegistryProbe/fastest',
  'pluginMarket/listIndexes',
  'pluginMarket/search',
  'credentials/describe',
  'commands/list',
  'skills/list',
  'speech/catalog',
  'cotTranslation/limits',
  'schedule/catalog',
  'dynamicCordisRunner/inventory',
  'productAnalytics/enabled',
]);

export const PAGE_WRITE_METHODS = Object.freeze([
  'settings/mutate',
  'settings/update',
  'settings/replace',
  'credentials/set',
  'credentials/unset',
  'pluginManager/setPluginEnabled',
  'pluginManager/setBundleEnabled',
  'pluginManager/installBundle',
  'pluginManager/removeBundle',
  'pluginManager/cancelInstall',
  'pluginManager/waitForInstall',
  'pluginManager/setVersionExemption',
  'pluginMarket/setIndexes',
]);

export const PAGE_STREAM_METHODS = Object.freeze([
  '$events',
  'session/follow',
  'session/control',
  'toolResults/watch',
  'job/list',
  'workspace/follow',
  'account/watch',
  'account/watchExpiry',
  'remoteAccess/follow',
  'productAnalytics/watchPolicy',
]);

const CALLS = new Set([...PAGE_READ_METHODS, ...PAGE_WRITE_METHODS]);
const STREAMS = new Set([...PAGE_STREAM_METHODS]);
const NOTIFICATIONS = Object.freeze([
  'agent-preset/selected',
  'api-session/activity',
  'api-session/added',
  'api-session/error',
  'api-session/removed',
  'api-session/status',
  'commands/change',
  'credentials/record-updated',
  'credentials/reference-updated',
  'llm/adapters-updated',
  'permission-presets/catalog-changed',
  'plugin-manager/changed',
  'plugin-manager/install-log',
  'plugin-manager/install-state',
  'plugin-market/changed',
  'settings/document-updated',
  'schedule/changed',
]);

function failure(code = 'gateway/unavailable') {
  return {
    ok: false,
    error: { code, message: '电脑暂时无法完成请求。', details: {} },
  };
}

function encodeBytes(value) {
  if (value instanceof Uint8Array) {
    return { $dsbotBytes: Buffer.from(value).toString('base64') };
  }
  if (value instanceof ArrayBuffer) return encodeBytes(new Uint8Array(value));
  if (Array.isArray(value)) return value.map(encodeBytes);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeBytes(item)]));
  }
  return value ?? null;
}

function restoreAttachments(result) {
  if (!result?.ok || !Array.isArray(result.attachments)) return result;
  for (const attachment of result.attachments) {
    const path = attachment.path;
    if (!Array.isArray(path) || !path.length) continue;
    let target = result.value;
    for (const key of path.slice(0, -1)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        target = undefined;
        break;
      }
      target = target?.[key];
    }
    const key = path.at(-1);
    if (target && key !== '__proto__' && key !== 'prototype' && key !== 'constructor') {
      target[key] = attachment.bytes;
    }
  }
  return { ok: true, value: result.value };
}

// Embedded pages observe notifications without joining approval waterfalls.
function notificationStream(events, signal) {
  const pending = [];
  const disposers = [];
  let wake;
  let overflow = false;
  let ended = false;
  const notify = () => { wake?.(); wake = undefined; };
  const dispose = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', dispose);
    for (const release of disposers) release();
    disposers.length = 0;
    pending.length = 0;
    notify();
  };
  if (events?.on && !signal.aborted) {
    for (const event of NOTIFICATIONS) {
      disposers.push(events.on(event, (...args) => {
        if (signal.aborted || ended) return;
        if (pending.length >= 256) {
          overflow = true;
          notify();
          return;
        }
        pending.push({ type: 'emit', event, args });
        notify();
      }));
    }
  }
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return {
    dispose,
    async *[Symbol.asyncIterator]() {
      try {
        if (ended) return;
        yield { type: 'ready', clientId: randomUUID(), host: { home: homedir() } };
        while (!signal.aborted && !ended) {
          if (overflow) throw new Error('Notification consumer fell behind.');
          if (pending.length) yield encodeBytes(pending.shift());
          else await new Promise((resolve) => {
            wake = resolve;
            if (signal.aborted || ended || pending.length || overflow) notify();
          });
        }
      } finally {
        dispose();
      }
    },
  };
}

export function createTypertPageRpc({ gateway, peer, events, connection, webServer }) {
  if (typeof gateway?.invoke !== 'function' || typeof gateway?.stream !== 'function'
    || peer?.principal?.kind !== 'owner') {
    throw new TypeError('Embedded pages require the owner-scoped Typert Gateway.');
  }
  const contextReads = createContextPageReads({ connection, peer });
  const marketReads = createDshMarketPageReads({ connection, webServer, peer });
  return Object.freeze({
    async invoke(endpoint, args, signal) {
      if (!CALLS.has(endpoint)) throw new Error('Unsupported embedded method.');
      if (CONTEXT_PAGE_READ_METHODS.includes(endpoint)) {
        return contextReads.invoke(endpoint, args, signal);
      }
      if (MARKET_PAGE_READ_METHODS.includes(endpoint)) {
        return marketReads.invoke(endpoint, args, signal);
      }
      if (endpoint === 'productAnalytics/enabled' || endpoint === 'session/canOpenWorkspacePath') {
        return { ok: true, value: false };
      }
      try {
        if (typeof gateway.dispatchRpc === 'function') {
          const result = await gateway.dispatchRpc(endpoint, { args }, signal, peer);
          if (result?.ok === false) {
            const code = typeof result.error?.code === 'string' ? result.error.code : 'gateway/unavailable';
            return failure(code);
          }
          return encodeBytes(restoreAttachments(result));
        }
        const [namespace, method] = endpoint.split('/');
        const value = await gateway.invoke({ namespace, method, args, peer, signal });
        return { ok: true, value: encodeBytes(value) };
      } catch {
        return failure();
      }
    },
    async open(endpoint, args, signal) {
      if (!STREAMS.has(endpoint)) throw new Error('Unsupported embedded stream.');
      if (endpoint === '$events') return notificationStream(events, signal);
      if (endpoint === 'productAnalytics/watchPolicy') {
        return { async *[Symbol.asyncIterator]() { yield false; } };
      }
      const [namespace, method] = endpoint.split('/');
      const source = await gateway.stream({
        namespace, method, args, peer, signal,
      });
      return {
        dispose: () => source.dispose?.(),
        async *[Symbol.asyncIterator]() {
          for await (const item of source) {
            if (signal.aborted) return;
            yield encodeBytes(item);
          }
        },
      };
    },
  });
}
