import {
  PAGE_READ_METHODS, PAGE_WRITE_METHODS, PAGE_STREAM_METHODS,
} from './native-page-rpc.mjs';

const READS = new Set(PAGE_READ_METHODS);
const WRITES = new Set(PAGE_WRITE_METHODS);
const STREAMS = new Set(PAGE_STREAM_METHODS);
const SESSION_PAGES = new Set(['trace', 'context', 'team', 'tools', 'view']);
const CONFIG_PAGES = new Set(['settings', 'plugins']);
const THIRD_PARTY_MARKET_READS = new Set([
  'dshMarket/registry',
  'dshMarket/installed',
  'dshMarket/status',
  'dshMarket/updates',
  'dshMarket/bundleOrder',
  'dshMarket/presets',
  'dshMarket/snapshots',
  'dshMarket/hostRecovery',
]);
const SESSION_EVENTS = new Set([
  'api-session/activity',
  'api-session/added',
  'api-session/error',
  'api-session/removed',
  'api-session/status',
]);
const PAGE_EVENTS = Object.freeze({
  plugins: new Set([
    'agent-preset/selected',
    'commands/change',
    'credentials/record-updated',
    'credentials/reference-updated',
    'llm/adapters-updated',
    'plugin-manager/changed',
    'plugin-manager/install-log',
    'plugin-manager/install-state',
    'plugin-market/changed',
    'settings/document-updated',
  ]),
  settings: new Set([
    'agent-preset/selected',
    'commands/change',
    'credentials/record-updated',
    'credentials/reference-updated',
    'llm/adapters-updated',
    'permission-presets/catalog-changed',
    'schedule/changed',
    'settings/document-updated',
  ]),
  tools: new Set(['commands/change']),
  // Pages for what other plugins add to DSH. They read like the rest and write nothing.
  panel: new Set([
    'commands/change',
    'plugin-manager/changed',
    'schedule/changed',
    'settings/document-updated',
  ]),
  view: new Set(['commands/change']),
});
const ARGUMENTS = Object.freeze({
  'session/list': ['_request'],
  'session/projections': ['request'],
  'session/page': ['request'],
  'session/follow': ['request'],
  'toolResults/watch': ['request'],
  'job/list': ['request'],
  'dshContext/detail': ['sessionId'],
  'dshContext/fleet': ['sessionId', 'full'],
  'dshContext/skills': ['sessionId'],
  'dshMarket/registry': [],
  'dshMarket/installed': [],
  'dshMarket/status': [],
  'dshMarket/updates': [],
  'dshMarket/bundleOrder': [],
  'dshMarket/presets': [],
  'dshMarket/snapshots': [],
  'dshMarket/hostRecovery': [],
  'agentPresets/read': ['agentPreset'],
  'llm/discoverModels': ['settingsNs', 'request'],
  'account/getProfile': ['client'],
  'account/getBalance': ['client'],
  'account/getUnnotifiedBonuses': ['client'],
  'pluginManager/inspect': ['spec', 'options'],
  'pluginMarket/search': ['url', 'query'],
  'credentials/describe': ['refs'],
  'commands/list': ['agent', 'agentId'],
  'skills/list': ['request'],
  'settings/mutate': ['ns', 'ops', 'expectedRevision'],
  'settings/update': ['ns', 'patch', 'expectedRevision'],
  'settings/replace': ['ns', 'section', 'expectedRevision'],
  'credentials/set': ['ref', 'value'],
  'credentials/unset': ['ref'],
  'pluginManager/setPluginEnabled': ['id', 'enabled'],
  'pluginManager/setBundleEnabled': ['name', 'enabled'],
  'pluginManager/installBundle': ['spec', 'options'],
  'pluginManager/removeBundle': ['name'],
  'pluginManager/cancelInstall': ['requestId'],
  'pluginManager/waitForInstall': ['requestId'],
  'pluginManager/setVersionExemption': ['packageVersion', 'runtimeVersion', 'enabled', 'acceptRisk'],
  'pluginMarket/setIndexes': ['urls'],
});

const record = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value, limit = 512) => typeof value === 'string'
  && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value);
const shortString = (value, limit = 512) => typeof value === 'string' && value.length > 0
  && boundedString(value, limit);
const ownKeys = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key));
const boundedInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const unsafeKey = (key) => ['__proto__', 'prototype', 'constructor'].includes(key);

function validMarketQuery(query) {
  if (!record(query)
    || !ownKeys(query, ['text', 'category', 'labels', 'sort', 'offset', 'limit', 'refresh', 'fetchedAt'])
    || !boundedInteger(query.offset, 0, Number.MAX_SAFE_INTEGER)
    || !boundedInteger(query.limit, 1, 100)
    || (query.text !== undefined && !boundedString(query.text, 1000))
    || (query.category !== undefined && !boundedString(query.category, 256))
    || (query.labels !== undefined
      && (!Array.isArray(query.labels) || !query.labels.every((label) => boundedString(label, 256))))
    || (query.refresh !== undefined && typeof query.refresh !== 'boolean')
    || (query.fetchedAt !== undefined && typeof query.fetchedAt !== 'number')) return false;

  const { sort } = query;
  if (!record(sort)) return false;
  if (sort.kind === 'index' || sort.kind === 'relevance') {
    return ownKeys(sort, ['kind']);
  }
  if (sort.kind === 'published') {
    return ownKeys(sort, ['kind', 'direction'])
      && ['asc', 'desc'].includes(sort.direction);
  }
  return sort.kind === 'key'
    && ownKeys(sort, ['kind', 'id', 'direction'])
    && boundedString(sort.id, 256)
    && ['asc', 'desc'].includes(sort.direction);
}

function safeJSON(value, depth = 0) {
  if (depth > 40) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 512 * 1024;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 5000 && value.every((item) => safeJSON(item, depth + 1));
  return record(value) && Object.entries(value).every(([key, item]) =>
    !unsafeKey(key) && safeJSON(item, depth + 1));
}

function scopedAddress(page, address) {
  if (!record(address)) return false;
  if (address.kind === 'session') {
    return ownKeys(address, ['kind', 'sessionId']) && page.sessionIds.has(address.sessionId);
  }
  return page.kind === 'team' && address.kind === 'subagent'
    && ownKeys(address, ['kind', 'parentSessionId', 'childSessionId', 'mode'])
    && address.parentSessionId === page.sessionId && page.sessionIds.has(address.childSessionId)
    && ['one-shot', 'continuable', 'unknown'].includes(address.mode);
}

function sessionRequest(page, endpoint, request) {
  if (!SESSION_PAGES.has(page.kind) || !record(request)) return false;
  if (endpoint === 'session/projections') {
    return ownKeys(request, ['sessionId']) && page.sessionIds.has(request.sessionId);
  }
  const keys = ['address', 'maxMessages', 'turnWindow'];
  if (endpoint === 'session/follow') keys.push('assistantStream', 'activate');
  else keys.push('throughSeq', 'beforeSeq');
  if (!ownKeys(request, keys) || !scopedAddress(page, request.address)) return false;
  if (request.maxMessages !== undefined && !boundedInteger(request.maxMessages, 1, 500)) return false;
  if (request.assistantStream !== undefined && request.assistantStream !== true) return false;
  if (request.activate !== undefined && typeof request.activate !== 'boolean') return false;
  if (request.turnWindow !== undefined) {
    if (!ownKeys(request.turnWindow, ['minMessages', 'minTurns'])
      || !boundedInteger(request.turnWindow.minMessages, 0, request.maxMessages ?? 500)
      || !boundedInteger(request.turnWindow.minTurns, 0, 100)) return false;
  }
  if (endpoint === 'session/page') {
    if (!boundedInteger(request.throughSeq, 0, Number.MAX_SAFE_INTEGER)) return false;
    if (request.beforeSeq !== undefined
      && !boundedInteger(
        request.beforeSeq,
        0,
        Math.min(Number.MAX_SAFE_INTEGER, request.throughSeq + 1),
      )) return false;
  }
  return true;
}

export function initializePagePolicy(page) {
  page.sessionIds = new Set(page.sessionId ? [page.sessionId] : []);
  page.settingsNamespaces = new Set();
  page.credentialRefs = new Set();
  page.pluginIds = new Set();
  page.bundleNames = new Set();
  page.marketIndexes = new Set();
  page.installIds = new Set();
}

export function allowPageCall(page, endpoint, args, stream = false) {
  if (!shortString(endpoint, 100) || !record(args) || !safeJSON(args)
    || Buffer.byteLength(JSON.stringify(args), 'utf8') > 768 * 1024) return false;
  if (THIRD_PARTY_MARKET_READS.has(endpoint)
    && (stream || STREAMS.has(endpoint) || WRITES.has(endpoint) || !READS.has(endpoint))) return false;
  if (!(stream ? STREAMS : READS).has(endpoint) && (stream || !WRITES.has(endpoint))) return false;
  if (!ownKeys(args, ARGUMENTS[endpoint] ?? [])) return false;
  if (WRITES.has(endpoint) && !CONFIG_PAGES.has(page.kind)) return false;

  if (THIRD_PARTY_MARKET_READS.has(endpoint)) return CONFIG_PAGES.has(page.kind);
  if (endpoint === 'job/list') {
    return SESSION_PAGES.has(page.kind)
      && ownKeys(args.request, ['sessionId']) && args.request.sessionId === page.sessionId;
  }
  if (endpoint === 'toolResults/watch') {
    return ['trace', 'view'].includes(page.kind)
      && ownKeys(args.request, ['sessionId', 'seq'])
      && args.request.sessionId === page.sessionId
      && boundedInteger(args.request.seq, 0, Number.MAX_SAFE_INTEGER);
  }
  if (['session/projections', 'session/follow', 'session/page'].includes(endpoint)) {
    return sessionRequest(page, endpoint, args.request);
  }
  if (endpoint === 'commands/list') {
    return Object.keys(args).length === 1 && page.sessionIds.has(args.agentId ?? args.agent);
  }
  if (endpoint === 'skills/list') {
    return SESSION_PAGES.has(page.kind) && ownKeys(args.request, ['sessionId'])
      && args.request.sessionId === page.sessionId;
  }
  if (['dshContext/detail', 'dshContext/skills'].includes(endpoint)) {
    return ['context', 'team'].includes(page.kind)
      && page.sessionIds.has(args.sessionId);
  }
  if (endpoint === 'dshContext/fleet') {
    return page.kind === 'team'
      && page.sessionIds.has(args.sessionId)
      && (args.full === undefined || typeof args.full === 'boolean');
  }
  if (endpoint === 'agentPresets/read') {
    return boundedString(args.agentPreset);
  }
  if (endpoint === 'session/list') {
    return args._request === undefined || (ownKeys(args._request, ['cursor'])
      && (args._request.cursor === undefined || shortString(args._request.cursor, 4096)));
  }
  if (endpoint.startsWith('settings/') && endpoint !== 'settings/describe') {
    if (!page.settingsNamespaces.has(args.ns)) return false;
    if (args.expectedRevision !== undefined
      && !boundedInteger(args.expectedRevision, 0, Number.MAX_SAFE_INTEGER)) return false;
    if (endpoint === 'settings/mutate') {
      return Array.isArray(args.ops) && args.ops.length > 0 && args.ops.length <= 128
        && args.ops.every((op) => ownKeys(op, op?.op === 'set' ? ['op', 'path', 'value'] : ['op', 'path'])
          && ['set', 'unset'].includes(op.op) && Array.isArray(op.path)
          && op.path.length > 0 && op.path.length <= 30
          && op.path.every((key) => shortString(key, 256) && !unsafeKey(key))
          && (op.op !== 'set' || Object.hasOwn(op, 'value')));
    }
    return record(endpoint === 'settings/update' ? args.patch : args.section);
  }
  if (endpoint === 'credentials/describe'
    && (!Array.isArray(args.refs) || args.refs.length > 128
      || !args.refs.every((ref) => shortString(ref, 256)))) return false;
  if (['credentials/set', 'credentials/unset'].includes(endpoint)) {
    return page.credentialRefs.has(args.ref)
      && (endpoint !== 'credentials/set' || shortString(args.value, 32 * 1024));
  }
  if (endpoint === 'pluginManager/setPluginEnabled') {
    return page.pluginIds.has(args.id) && typeof args.enabled === 'boolean';
  }
  if (['pluginManager/setBundleEnabled', 'pluginManager/removeBundle'].includes(endpoint)) {
    return page.bundleNames.has(args.name)
      && (endpoint !== 'pluginManager/setBundleEnabled' || typeof args.enabled === 'boolean');
  }
  if (['pluginManager/installBundle', 'pluginManager/inspect'].includes(endpoint)) {
    const valid = CONFIG_PAGES.has(page.kind) && shortString(args.spec, 1024)
      && (args.options === undefined || record(args.options));
    if (valid && endpoint === 'pluginManager/installBundle' && shortString(args.options?.requestId, 128)) {
      page.installIds.add(args.options.requestId);
    }
    return valid;
  }
  if (['pluginManager/waitForInstall', 'pluginManager/cancelInstall'].includes(endpoint)) {
    return page.installIds.has(args.requestId);
  }
  if (endpoint === 'pluginManager/setVersionExemption') {
    return shortString(args.packageVersion, 256) && shortString(args.runtimeVersion, 128)
      && typeof args.enabled === 'boolean' && typeof args.acceptRisk === 'boolean';
  }
  if (endpoint === 'pluginMarket/search') {
    return page.marketIndexes.has(args.url) && validMarketQuery(args.query);
  }
  if (endpoint === 'pluginMarket/setIndexes') {
    return Array.isArray(args.urls) && args.urls.length <= 32 && args.urls.every((value) => {
      if (!shortString(value, 2048)) return false;
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch { return false; }
    });
  }
  if (endpoint === 'llm/discoverModels') {
    return CONFIG_PAGES.has(page.kind) && page.settingsNamespaces.has(args.settingsNs) && record(args.request);
  }
  return true;
}

export function acceptPageResult(page, endpoint, result, args) {
  if (result?.ok === false) return result;
  const value = result?.ok === true ? result.value : result;
  if (endpoint === 'credentials/describe' && result?.ok === true
    && record(value) && Array.isArray(args?.refs)) {
    // DSH returns one JSON view per requested reference, keyed by reference name.
    for (const ref of args.refs) {
      if (shortString(ref, 256) && Object.hasOwn(value, ref)) page.credentialRefs.add(ref);
    }
  }
  if (endpoint === 'settings/describe') {
    for (const item of value?.namespaces ?? []) {
      if (shortString(item?.ns)) page.settingsNamespaces.add(item.ns);
    }
  }
  if (endpoint === 'session/projections' && page.kind === 'team') {
    const projections = value?.values ?? {};
    for (const member of [...(projections.agentTeam?.members ?? []), ...(projections.subagentCatalog ?? [])]) {
      if (shortString(member?.id, 256)) page.sessionIds.add(member.id);
    }
  }
  if (endpoint === 'pluginManager/listPlugins') {
    for (const plugin of Array.isArray(value) ? value : value?.plugins ?? []) {
      if (shortString(plugin?.entryId)) page.pluginIds.add(plugin.entryId);
    }
  }
  if (endpoint === 'pluginManager/listBundles') {
    for (const bundle of Array.isArray(value) ? value : value?.bundles ?? []) {
      if (shortString(bundle?.name)) page.bundleNames.add(bundle.name);
    }
  }
  if (endpoint === 'pluginMarket/listIndexes') {
    for (const index of Array.isArray(value) ? value : value?.indexes ?? []) {
      const url = typeof index === 'string' ? index : index?.url;
      if (shortString(url, 2048)) page.marketIndexes.add(url);
    }
  }
  if (endpoint === 'pluginManager/installBundle' && shortString(value?.requestId)) {
    page.installIds.add(value.requestId);
  }
  return result;
}

export function pageStreamItem(page, endpoint, item) {
  if (endpoint === '$events') {
    // The initial ready frame bootstraps the embedded frontend on every page.
    if (item?.type === 'ready') return item;
    if (item?.type !== 'emit' || typeof item.event !== 'string') return undefined;

    if (SESSION_EVENTS.has(item.event)) {
      if (!SESSION_PAGES.has(page.kind)) return undefined;
      const subject = Array.isArray(item.args) ? item.args[0] : undefined;
      const id = typeof subject === 'string' ? subject : subject?.sessionId;
      if (!shortString(id, 256) || !page.sessionId || !page.sessionIds.has(id)) return undefined;
      return item;
    }

    if (!PAGE_EVENTS[page.kind]?.has(item.event)) return undefined;
  }
  if (endpoint === 'session/control') {
    if (item?.type === 'baseline') {
      const parent = item.value?.projections?.[page.sessionId];
      if (parent && page.kind === 'team') {
        acceptPageResult(page, 'session/projections', { ok: true, value: parent });
      }
      return {
        ...item,
        value: { ...item.value, projections: Object.fromEntries(
          Object.entries(item.value?.projections ?? {}).filter(([id]) => page.sessionIds.has(id)),
        ) },
      };
    }
    if (item?.type === 'projection' && !page.sessionIds.has(item.sessionId)) return undefined;
    if (page.kind === 'team' && item?.type === 'projection' && item.sessionId === page.sessionId
      && ['agentTeam', 'subagentCatalog'].includes(item.key)) {
      acceptPageResult(page, 'session/projections', { ok: true, value: { values: { [item.key]: item.value } } });
    }
  }
  return item;
}
