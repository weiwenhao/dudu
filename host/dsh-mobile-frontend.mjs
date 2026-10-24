import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { MOBILE_PAGE_CSS, MOBILE_PAGE_SCRIPT } from './mobile-page-adapter.mjs';

const APP_ASAR = 'app.asar';
const FRONTEND_PACKAGE = '@deepseek-ai/dsh-web-frontend/package.json';
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules';
const EMBEDDED_DISABLED_MODULE_IDS = new Set([
  '@deepseek-ai/dsh-client-hmr',
]);
const RESOURCE_LIMIT = 40 * 1024 * 1024;
const STATIC_CACHE_LIMIT = 48 * 1024 * 1024;
const STATIC_CACHE_MAX_ENTRIES = 128;
const COMPAT_ASSET_CACHE_LIMIT = 48 * 1024 * 1024;
const COMPAT_ASSET_CACHE_MAX_ENTRIES = 8;
const INTERNAL_ROOT = '/__dsbot';
const DYNAMIC_EXPR_UNAVAILABLE = 'DSH dynamic configuration expressions are disabled in the mobile embedded view.';
const KNOWN_DYNAMIC_EXPR_EVALUATOR = 'const C7=new Function("ctx","expr",`\n  with (ctx) {\n    return eval(expr)\n  }\n`);function R0(';
const HTTP_BASE_PATH = /^\/dsbot\/ui\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/iu;
const MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});
function resolveFrontendDist(frontendDist) {
  if (frontendDist) return resolve(frontendDist);

  const candidates = [];
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(createRequire(resolve(process.resourcesPath, APP_ASAR, 'dsh', 'package.json')));
  }
  candidates.push(createRequire(import.meta.url));
  for (const require of candidates) {
    try {
      return joinDist(dirname(require.resolve(FRONTEND_PACKAGE)));
    } catch {
      // Try the next DSH-owned module root.
    }
  }
  throw new Error('DSH mobile frontend could not resolve the installed DSH frontend package.');
}

function joinDist(packageDirectory) {
  return resolve(packageDirectory, 'dist');
}

function safeJSON(value) {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

function contentPath(name, data) {
  const digest = createHash('sha256').update(data).digest('hex');
  return `${INTERNAL_ROOT}/${digest}/${name}`;
}

function htmlAttribute(value) {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');
}

function canonicalLocalURL(value) {
  if (typeof value !== 'string' || !value || value.startsWith('//')) return undefined;
  let url;
  try {
    url = new URL(value, 'https://dsh-mobile.invalid/');
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://dsh-mobile.invalid' || !url.pathname.startsWith('/assets/')) {
    return undefined;
  }
  return `${url.pathname}${url.search}`;
}

function staticAssetKey(requestPath) {
  let url;
  try {
    url = new URL(requestPath, 'https://dsh-mobile.invalid/');
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://dsh-mobile.invalid' || !url.pathname.startsWith('/assets/')) {
    return undefined;
  }
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
}

function documentResourcePath(path, basePath) {
  if (!basePath || typeof path !== 'string'
    || !/^\/(?:assets|plugins|__dsbot)\//u.test(path)) return path;
  return `${basePath}${path.slice(1)}`;
}

function rewriteRootResourceURLs(value, basePath) {
  if (!basePath || typeof value !== 'string') return value;
  return value.replace(/(^|[\s"'`(=,:])\/(assets|plugins|__dsbot)\//gu,
    (_match, boundary, root) => `${boundary}${basePath}${root}/`);
}

function graphForDocument(graph, basePath) {
  if (!basePath) return graph;
  const rewriteURL = (value) => {
    const normalized = normalizeGraphURL(value);
    return normalized ? documentResourcePath(normalized, basePath) : value;
  };
  return {
    ...graph,
    entries: graph.entries.map((entry) => ({ ...entry, url: rewriteURL(entry?.url) })),
    batches: graph.batches.map((batch) => ({ ...batch, url: rewriteURL(batch?.url) })),
  };
}

async function loadStaticAssetManifest(dist) {
  const assetsDirectory = resolve(dist, 'assets');
  const manifest = new Map();
  const pending = [assetsDirectory];
  while (pending.length) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const filePath = resolve(directory, entry.name);
      const relativePath = relative(assetsDirectory, filePath);
      if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(filePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      const mimeType = MIME_TYPES[extension];
      if (!mimeType) continue;
      manifest.set(`/assets/${relativePath.split(sep).join('/')}`, { filePath, mimeType });
      if (manifest.size > 20_000) throw new Error('The installed DSH frontend asset manifest is too large.');
    }
  }
  if (!manifest.size) throw new Error('The installed DSH frontend contains no supported assets.');
  return manifest;
}

function graphSnapshot(clientModules) {
  if (typeof clientModules?.graph !== 'function' || typeof clientModules?.fetchBundle !== 'function') {
    throw new TypeError('DSH mobile frontend requires the live clientModules service.');
  }
  const graph = clientModules.graph();
  if (!graph || !Array.isArray(graph.entries) || !Array.isArray(graph.batches)) {
    throw new Error('The live DSH client module graph is malformed.');
  }
  const snapshot = JSON.parse(JSON.stringify(graph));
  snapshot.entries = snapshot.entries.filter(
    (entry) => !EMBEDDED_DISABLED_MODULE_IDS.has(entry?.id),
  );
  snapshot.batches = snapshot.batches.map((batch) => {
    if (!Array.isArray(batch?.entries)) return batch;
    return {
      ...batch,
      entries: batch.entries.filter((id) => !EMBEDDED_DISABLED_MODULE_IDS.has(id)),
    };
  });
  return snapshot;
}

function normalizeGraphURL(value) {
  if (typeof value !== 'string' || !value || value.startsWith('//')) return undefined;
  let url;
  try {
    url = new URL(value, 'https://dsh-mobile.invalid/');
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://dsh-mobile.invalid'
    || !url.pathname.startsWith('/plugins/')
    || url.hash || url.username || url.password) return undefined;
  return `${url.pathname}${url.search}`;
}

function graphResourcePolicy(graph) {
  const exact = new Set();
  const dynamicChunks = [];
  for (const batch of graph.batches) {
    const url = normalizeGraphURL(batch?.url);
    if (url) exact.add(url);
  }
  for (const entry of graph.entries) {
    const url = normalizeGraphURL(entry?.url);
    if (url) exact.add(url);
    if (typeof entry?.id === 'string' && entry.id && typeof entry.rev === 'string' && entry.rev) {
      dynamicChunks.push({ id: entry.id, rev: entry.rev });
    }
  }
  return (url) => {
    const canonical = normalizeGraphURL(url);
    if (!canonical) return false;
    if (exact.has(canonical)) return true;
    return dynamicChunks.some(({ id, rev }) => {
      const prefix = `/plugins/${id}/`;
      if (!canonical.startsWith(prefix)) return false;
      const filename = canonical.slice(prefix.length).split('?', 1)[0];
      if (!/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(filename)
        || filename === 'client.node.js' || filename.startsWith('client.node.')) return false;
      return canonical === `${prefix}${filename}?rev=${encodeURIComponent(rev)}`;
    });
  };
}

function bootQueueScript() {
  return `(()=>{
const pendingQueue=[];
const appUIModuleIDs=new Set([
  "@deepseek-ai/dsh-client-ui-settings-general",
  "@deepseek-ai/dsh-client-ui-layout"
]);
function exposeAppUI(moduleID,ctx){
  if(ctx===null||(typeof ctx!=="object"&&typeof ctx!=="function"))return;
  try{
    let ui=window.__DSBOT_APP_UI__;
    if(!ui||typeof ui!=="object"){
      ui={contexts:Object.create(null)};
      window.__DSBOT_APP_UI__=ui;
    }
    if(!ui.contexts||typeof ui.contexts!=="object")ui.contexts=Object.create(null);
    ui.contexts[moduleID]=ctx;
    ui.ctx=ctx;
    ui.context=ctx;
    ui.moduleId=moduleID;
    window.dispatchEvent(new CustomEvent("dsbot:app-ui-ready",{detail:{moduleId:moduleID}}));
  }catch{}
}
function wrapAppUIExports(moduleID,exports){
  if(exports===null||(typeof exports!=="object"&&typeof exports!=="function")
    ||typeof exports.apply!=="function")return exports;
  const originalApply=exports.apply;
  if(originalApply.__dsbotAppUIWrapped)return exports;
  const wrappedApply=function(ctx,...args){
    const result=originalApply.apply(this,[ctx,...args]);
    if(result&&typeof result.then==="function"){
      return result.then(value=>{
        exposeAppUI(moduleID,ctx);
        return value;
      });
    }
    exposeAppUI(moduleID,ctx);
    return result;
  };
  Object.defineProperty(wrappedApply,"__dsbotAppUIWrapped",{value:true});
  const applyDescriptor=Object.getOwnPropertyDescriptor(exports,"apply");
  const wrappedDescriptor=applyDescriptor&&"value" in applyDescriptor
    ? {...applyDescriptor,value:wrappedApply}
    : {
      configurable:applyDescriptor?.configurable??true,
      enumerable:applyDescriptor?.enumerable??true,
      writable:true,
      value:wrappedApply
    };
  try{
    Object.defineProperty(exports,"apply",wrappedDescriptor);
    return exports;
  }catch{}
  if(typeof exports==="function")return exports;
  const descriptors=Object.getOwnPropertyDescriptors(exports);
  descriptors.apply={
    configurable:wrappedDescriptor.configurable??true,
    enumerable:wrappedDescriptor.enumerable??true,
    writable:true,
    value:wrappedApply
  };
  return Object.create(Object.getPrototypeOf(exports),descriptors);
}
function wrapAppUIRegistration(registration){
  if(!registration||!appUIModuleIDs.has(registration.id)
    ||typeof registration.factory!=="function"
    ||registration.factory.__dsbotAppUIWrapped)return registration;
  const moduleID=registration.id;
  const originalFactory=registration.factory;
  const wrappedFactory=function(...args){
    return wrapAppUIExports(moduleID,originalFactory.apply(this,args));
  };
  Object.defineProperty(wrappedFactory,"__dsbotAppUIWrapped",{value:true});
  const descriptors=Object.getOwnPropertyDescriptors(registration);
  const factoryDescriptor=descriptors.factory||{};
  descriptors.factory={
    configurable:factoryDescriptor.configurable??true,
    enumerable:factoryDescriptor.enumerable??true,
    writable:true,
    value:wrappedFactory
  };
  return Object.create(Object.getPrototypeOf(registration),descriptors);
}
let liveLoad=(registration)=>pendingQueue.push(wrapAppUIRegistration(registration));
const loaderTarget={
  mode:"queue",
  pendingQueue,
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: module system already booted");
    const index=pendingQueue.findIndex(registration=>registration.id===${safeJSON(CLIENT_MODULES_ID)});
    const registration=pendingQueue[index];
    if(registration===undefined)throw new Error("client-modules: module bootstrap was not preloaded");
    pendingQueue.splice(index,1);
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: bootstrap requested external "'+specifier+'" too early')
    });
    if(typeof exports!=="object"||exports===null
      ||typeof exports.createClientModuleSystem!=="function"
      ||typeof exports.apply!=="function"){
      throw new Error("client-modules: invalid bootstrap exports");
    }
    const clientSystem=exports.createClientModuleSystem(this,{id:registration.id,exports},options);
    if(this.mode==="queue")this.mode="live";
    return clientSystem
  }
};
const loader=new Proxy(loaderTarget,{
  get(target,key,receiver){
    if(key==="load")return liveLoad;
    return Reflect.get(target,key,receiver)
  },
  set(target,key,value,receiver){
    if(key==="load"){
      if(typeof value!=="function")throw new TypeError("client-modules: invalid module registration loader");
      liveLoad=function(registration,...args){
        return value.apply(receiver,[wrapAppUIRegistration(registration),...args]);
      };
      return true
    }
    return Reflect.set(target,key,value,receiver)
  }
});
window.__ModuleLoader__=loader;
})()`;
}

function createBootResources(graph, addResource) {
  const queue = Buffer.from(bootQueueScript(), 'utf8');
  const graphScript = Buffer.from(
    `window.__DSH_BOOT__=${safeJSON(graph)};`,
    'utf8',
  );
  const queuePath = addResource('client-module-queue.js', 'text/javascript; charset=utf-8', queue);
  const graphPath = addResource('client-module-graph.js', 'text/javascript; charset=utf-8', graphScript);
  const application = graph.batches.filter((batch) => batch.phase === 'application');
  const bootstrap = graph.batches.filter((batch) => batch.phase === 'bootstrap');
  return {
    queuePath,
    graphPath,
    application,
    bootstrap,
  };
}

function staticAssetRecord(manifest, requestPath) {
  const key = staticAssetKey(requestPath);
  if (!key || key.split('/').some((part) => part === '.' || part === '..')
    || key.includes('\\') || key.includes('\0')) return undefined;
  return manifest.get(key);
}

function transformKnownDynamicExpression(assetPath, mimeType, data) {
  if (mimeType !== 'text/javascript; charset=utf-8'
    || !/^\/assets\/index-[A-Za-z0-9_-]+\.js$/u.test(assetPath)) return data;
  const source = data.toString('utf8');
  const first = source.indexOf(KNOWN_DYNAMIC_EXPR_EVALUATOR);
  if (first < 0 || source.indexOf(KNOWN_DYNAMIC_EXPR_EVALUATOR, first + 1) >= 0) return data;
  const replacement = `const C7=(ctx,expr)=>{throw new Error(${JSON.stringify(DYNAMIC_EXPR_UNAVAILABLE)})};function R0(`;
  return Buffer.from(
    `${source.slice(0, first)}${replacement}${source.slice(first + KNOWN_DYNAMIC_EXPR_EVALUATOR.length)}`,
    'utf8',
  );
}

function rewriteAssetTags(html, staticManifest, resourceOverrides = new Map(), basePath) {
  return html.replace(/<(script|link|img|source)\b[^>]*>/giu, (tag, tagName) => {
    const attribute = tagName.toLowerCase() === 'link' ? 'href' : 'src';
    const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'iu'));
    if (!match) return tag;

    const value = match[2];
    const resource = canonicalLocalURL(value);
    if (!resource || !staticAssetRecord(staticManifest, resource)) {
      if (tagName.toLowerCase() === 'script'
        || tagName.toLowerCase() === 'source'
        || (tagName.toLowerCase() === 'link' && /\brel\s*=\s*["'](?:stylesheet|modulepreload|preload)["']/iu.test(tag))) {
        throw new Error('The installed DSH frontend references an unsupported external asset.');
      }
      if (tagName.toLowerCase() === 'link') return '';
      if (/^(?:data:|blob:)/iu.test(value)) return tag;
      return tag.replace(match[0], '');
    }
    const assetPath = staticAssetKey(resource);
    const resolved = documentResourcePath(resourceOverrides.get(assetPath) || resource, basePath);
    return tag.replace(match[0], `${attribute}="${htmlAttribute(resolved)}"`);
  });
}

function cspMeta(nonce, httpTransport = false) {
  const localSource = httpTransport ? "'self'" : 'dsbot-ui:';
  const policy = [
    "default-src 'none'",
    `script-src ${localSource} 'nonce-${nonce}'`,
    `style-src ${localSource} 'unsafe-inline'`,
    `img-src ${localSource} data: blob:`,
    `font-src ${localSource}`,
    `media-src ${localSource}`,
    httpTransport ? "connect-src 'self'" : "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${htmlAttribute(policy)}">`;
}

function injectDocumentHTML(html, {
  nonce,
  cssPath,
  scriptPath,
  queuePath,
  graphPath,
  application,
  bootstrap,
  extraScripts,
  extraStyles,
  basePath,
  httpTransport,
  kind,
}) {
  let output = html;
  output = output.replace(/<meta\b[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/giu, '');
  output = output.replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>/giu, (tag) => {
    if (/\bnonce\s*=/iu.test(tag)) return tag;
    return tag.replace(/>$/u, ` nonce="${nonce}">`);
  });
  const localPath = (path) => documentResourcePath(path, basePath);
  const tags = [
    cspMeta(nonce, httpTransport),
    `<script src="${localPath(queuePath)}"></script>`,
    ...application.map((batch) => `<link rel="preload" as="script" href="${htmlAttribute(localPath(batch.url))}">`),
    ...bootstrap.map((batch) => `<script src="${htmlAttribute(localPath(batch.url))}"></script>`),
    `<script src="${localPath(graphPath)}"></script>`,
    ...extraScripts.map((path) => `<script src="${localPath(path)}"></script>`),
    `<script src="${localPath(scriptPath)}"></script>`,
  ];
  const head = output.match(/<head\b[^>]*>/iu);
  if (!head) throw new Error('The installed DSH frontend has no head element.');
  output = output.replace(head[0], `${head[0]}${tags.join('')}`);
  const styles = [
    `<link rel="stylesheet" href="${localPath(cssPath)}">`,
    ...extraStyles.map((path) => `<link rel="stylesheet" href="${localPath(path)}">`),
  ];
  if (!/<\/head\s*>/iu.test(output)) throw new Error('The installed DSH frontend has no closing head element.');
  return output.replace(/<\/head\s*>/iu, `${styles.join('')}</head>`);
}

function normalizeInjection(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)
    || !['script', 'style'].includes(item.kind) || typeof item.text !== 'string'
    || item.text.length > 256 * 1024) {
    throw new TypeError('DSH mobile frontend injections must be bounded script or style text.');
  }
  return { kind: item.kind, text: item.text };
}

export function createDshMobileFrontend({
  clientModules,
  frontendDist,
  injections = [],
} = {}) {
  if (!Array.isArray(injections)) {
    throw new TypeError('DSH mobile frontend injections must be an array.');
  }
  const normalizedInjections = injections.map(normalizeInjection);
  if (normalizedInjections.length > 32
    || normalizedInjections.reduce((size, item) => size + Buffer.byteLength(item.text, 'utf8'), 0) > 1024 * 1024) {
    throw new TypeError('DSH mobile frontend injections exceed the page limit.');
  }
  const dist = resolveFrontendDist(frontendDist);
  let htmlPromise;
  let staticManifestPromise;
  const loadHTML = () => {
    htmlPromise ??= readFile(resolve(dist, 'index.html'), 'utf8');
    return htmlPromise;
  };
  const loadAssets = () => {
    staticManifestPromise ??= loadStaticAssetManifest(dist);
    return staticManifestPromise;
  };
  const staticCache = new Map();
  let staticCacheBytes = 0;
  const compatAssetCache = new Map();
  let compatAssetCacheBytes = 0;
  const recentDocuments = [];
  const fallbackResources = new Map();

  function trimStaticCache() {
    while (staticCache.size > STATIC_CACHE_MAX_ENTRIES
      || staticCacheBytes > STATIC_CACHE_LIMIT) {
      const oldestKey = staticCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = staticCache.get(oldestKey);
      staticCache.delete(oldestKey);
      staticCacheBytes -= oldest?.byteCount ?? 0;
    }
  }

  async function staticResource(path, staticManifest) {
    const target = staticAssetRecord(staticManifest, path);
    if (!target) return undefined;
    const cacheKey = `${target.filePath}`;
    const cached = staticCache.get(cacheKey);
    if (cached) {
      staticCache.delete(cacheKey);
      staticCache.set(cacheKey, cached);
      return cached.promise;
    }

    const entry = { byteCount: 0, promise: undefined };
    entry.promise = readFile(target.filePath).then((data) => {
      if (data.byteLength > RESOURCE_LIMIT) throw new Error('DSH frontend asset exceeds the resource limit.');
      const resource = { mimeType: target.mimeType, data };
      if (staticCache.get(cacheKey) === entry) {
        entry.byteCount = data.byteLength;
        staticCacheBytes += entry.byteCount;
        trimStaticCache();
      }
      return resource;
    }).catch((error) => {
      if (staticCache.get(cacheKey) === entry) {
        staticCache.delete(cacheKey);
        staticCacheBytes -= entry.byteCount;
      }
      throw error;
    });
    staticCache.set(cacheKey, entry);
    trimStaticCache();
    return entry.promise;
  }

  function compatAsset(assetPath, target, original) {
    const cacheKey = `${assetPath}\0${target.filePath}\0${original.mimeType}`;
    const cached = compatAssetCache.get(cacheKey);
    if (cached) {
      compatAssetCache.delete(cacheKey);
      compatAssetCache.set(cacheKey, cached);
      return cached;
    }

    const data = transformKnownDynamicExpression(assetPath, original.mimeType, original.data);
    if (data === original.data) return undefined;

    const version = createHash('sha256').update(data).digest('hex');
    const entry = {
      path: `${assetPath}?dsbot=${version}`,
      resource: { mimeType: original.mimeType, data },
      byteCount: data.byteLength,
    };
    if (entry.byteCount <= COMPAT_ASSET_CACHE_LIMIT) {
      compatAssetCache.set(cacheKey, entry);
      compatAssetCacheBytes += entry.byteCount;
      while (compatAssetCache.size > COMPAT_ASSET_CACHE_MAX_ENTRIES
        || compatAssetCacheBytes > COMPAT_ASSET_CACHE_LIMIT) {
        const oldestKey = compatAssetCache.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = compatAssetCache.get(oldestKey);
        compatAssetCache.delete(oldestKey);
        compatAssetCacheBytes -= oldest?.byteCount ?? 0;
      }
    }
    return entry;
  }

  async function resolveResource(path, manifest) {
    if (typeof path !== 'string' || path.length > 8192 || !path.startsWith('/')
      || path.startsWith('//') || /[\u0000-\u0020\u007f\\#]/u.test(path)) {
      throw new Error('Unknown DSH mobile frontend resource.');
    }
    let resource = manifest.resources.get(path) ?? manifest.transformedAssets.get(path);
    if (!resource && manifest.allowBundle(path)) {
      const response = await clientModules.fetchBundle({ method: 'GET', url: path });
      if (!response?.ok) throw new Error('Unknown DSH client module resource.');
      const data = Buffer.from(await response.arrayBuffer());
      if (data.byteLength > RESOURCE_LIMIT) throw new Error('DSH client module exceeds the resource limit.');
      const mimeType = response.headers?.get?.('content-type') || 'text/javascript; charset=utf-8';
      if (/[\r\n]/u.test(mimeType)) throw new Error('Invalid DSH client module content type.');
      resource = { mimeType, data };
    }

    if (!resource) resource = await staticResource(path, manifest.staticManifest);
    if (!resource) throw new Error('Unknown DSH mobile frontend resource.');
    if (manifest.basePath && /^(?:text\/(?:javascript|css)|application\/(?:javascript|x-javascript))(?:;|$)/iu.test(resource.mimeType)) {
      const source = resource.data.toString('utf8');
      const rewritten = rewriteRootResourceURLs(source, manifest.basePath);
      if (rewritten !== source) return { mimeType: resource.mimeType, data: Buffer.from(rewritten, 'utf8') };
    }
    return resource;
  }

  return Object.freeze({
    async document({ kind, sessionId, transport, basePath } = {}) {
      if (!['plugins', 'trace', 'context', 'team', 'tools', 'settings', 'panel', 'view'].includes(kind)) {
        throw new TypeError('Unsupported DSH mobile page kind.');
      }
      if (!['plugins', 'settings', 'panel'].includes(kind)
        && (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256)) {
        throw new TypeError('A session is required for this DSH mobile page.');
      }
      if ((transport === undefined && basePath !== undefined)
        || (transport !== undefined && (transport !== 'http'
          || typeof basePath !== 'string' || !HTTP_BASE_PATH.test(basePath)))) {
        throw new TypeError('Invalid DSH mobile HTTP document path.');
      }
      const httpTransport = transport === 'http';

      const [sourceHTML, graph, staticManifest] = await Promise.all([
        loadHTML(),
        Promise.resolve(graphSnapshot(clientModules)),
        loadAssets(),
      ]);
      const nonce = randomBytes(18).toString('base64');
      const resources = new Map();
      const transformedAssets = new Map();
      const addResource = (name, mimeType, value) => {
        const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const path = contentPath(name, data);
        resources.set(path, { mimeType, data });
        fallbackResources.set(path, { mimeType, data });
        return path;
      };
      const resourceOverrides = new Map();
      for (const match of sourceHTML.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/giu)) {
        const source = canonicalLocalURL(match[2]);
        const assetPath = source && staticAssetKey(source);
        if (!assetPath || !/^\/assets\/index-[A-Za-z0-9_-]+\.js$/u.test(assetPath)) continue;
        const target = staticAssetRecord(staticManifest, source);
        if (!target || target.mimeType !== 'text/javascript; charset=utf-8') continue;
        const original = await staticResource(source, staticManifest);
        if (!original) continue;
        const compatible = compatAsset(assetPath, target, original);
        if (compatible) {
          transformedAssets.set(compatible.path, compatible.resource);
          resourceOverrides.set(assetPath, compatible.path);
        }
      }
      const mobileCSS = addResource(
        'mobile-page.css',
        'text/css; charset=utf-8',
        Buffer.from(
          `${MOBILE_PAGE_CSS}\nhtml,body{font-family:"PingFang SC",-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif!important}`,
          'utf8',
        ),
      );
      const mobileScript = addResource(
        'mobile-page.js',
        'text/javascript; charset=utf-8',
        Buffer.from(MOBILE_PAGE_SCRIPT, 'utf8'),
      );
      const pageGraph = graphForDocument(graph, basePath);
      const boot = createBootResources(pageGraph, addResource);
      const extraScripts = [];
      const extraStyles = [];
      for (const injection of normalizedInjections) {
        const isScript = injection.kind === 'script';
        const path = addResource(
          `injection-${extraScripts.length + extraStyles.length}.${isScript ? 'js' : 'css'}`,
          isScript ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
          Buffer.from(injection.text, 'utf8'),
        );
        (isScript ? extraScripts : extraStyles).push(path);
      }
      const allowBundle = graphResourcePolicy(graph);
      const documentManifest = { resources, transformedAssets, allowBundle, staticManifest, basePath };
      const html = rewriteRootResourceURLs(injectDocumentHTML(
        rewriteAssetTags(sourceHTML, staticManifest, resourceOverrides, basePath), {
        nonce,
        cssPath: mobileCSS,
        scriptPath: mobileScript,
        queuePath: boot.queuePath,
        graphPath: boot.graphPath,
        application: boot.application,
        bootstrap: boot.bootstrap,
        extraScripts,
        extraStyles,
        basePath,
        httpTransport,
        kind,
      }), basePath);

      recentDocuments.push(documentManifest);
      if (recentDocuments.length > 8) recentDocuments.shift();
      fallbackResources.clear();
      for (const previous of recentDocuments) {
        for (const [path, resource] of previous.resources) fallbackResources.set(path, resource);
      }

      return Object.freeze({
        html,
        resource: (path) => {
          const unprefixedPath = basePath && typeof path === 'string' && path.startsWith(basePath)
            ? `/${path.slice(basePath.length)}`
            : path;
          return resolveResource(unprefixedPath, documentManifest);
        },
      });
    },

    async resource(path) {
      const resource = fallbackResources.get(path);
      if (resource) return resource;
      const manifest = [...recentDocuments].reverse().find((item) => item.transformedAssets.has(path))
        ?? recentDocuments.at(-1);
      const transformedAsset = manifest?.transformedAssets.get(path);
      if (transformedAsset) return transformedAsset;
      if (manifest && manifest.allowBundle(path)) {
        return resolveResource(path, manifest);
      }
      const staticManifest = manifest?.staticManifest ?? await loadAssets();
      const asset = await staticResource(path, staticManifest);
      if (asset) return asset;
      throw new Error('Unknown DSH mobile frontend resource.');
    },
  });
}
