import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createDshMobileFrontend } from '../host/dsh-mobile-frontend.mjs';

const APP_URL = '/plugins/app/client.js?rev=app-r1';
const BOOTSTRAP_URL = '/plugins/core/client.js?rev=core-r1';
const DEFAULT_GRAPH = {
  entries: [
    { id: 'example', rev: 'entry-r1', url: '/plugins/example/client.js?rev=entry-r1' },
  ],
  batches: [
    { phase: 'application', url: APP_URL },
    { phase: 'bootstrap', url: BOOTSTRAP_URL },
  ],
};

function graphClient(graph = DEFAULT_GRAPH, fetchBundle) {
  return {
    graph: () => (typeof graph === 'function' ? graph() : graph),
    async fetchBundle(request) {
      if (fetchBundle) return fetchBundle(request);
      const data = Buffer.from(`bundle:${request.url}`);
      return {
        ok: true,
        headers: { get: () => 'text/javascript; charset=utf-8' },
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
      };
    },
  };
}

async function fixture(t, {
  graph = DEFAULT_GRAPH,
  fetchBundle,
  html,
  files = {},
  injections = [],
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mobile-frontend-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const dist = join(root, 'dist');
  const assets = join(dist, 'assets');
  await mkdir(assets, { recursive: true });
  await writeFile(join(dist, 'index.html'), html ?? [
    '<!doctype html>',
    '<html lang="zh-CN"><head>',
    '<meta http-equiv="Content-Security-Policy" content="default-src *">',
    '<title>DSH</title>',
    '<script id="inline-startup">window.__inlineStartup = true;</script>',
    '<link rel="stylesheet" href="/assets/site.css">',
    '</head><body><div id="root"></div>',
    '<script src="/assets/app.js"></script>',
    '<img alt="logo" src="/assets/logo.png">',
    '</body></html>',
  ].join(''), 'utf8');
  const staticFiles = {
    'app.js': 'window.__appAssetLoaded = true;',
    'site.css': 'body { color: #222; }',
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    ...files,
  };
  for (const [name, contents] of Object.entries(staticFiles)) {
    const target = join(assets, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, contents);
  }

  const frontend = createDshMobileFrontend({
    clientModules: graphClient(graph, fetchBundle),
    frontendDist: dist,
    injections,
  });
  return { frontend, root, dist, assets };
}

function internalPath(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = html.match(new RegExp(`(?:src|href)="(/__dsbot/[a-f0-9]{64}/${escaped})"`, 'u'));
  assert.ok(match, `expected a generated resource reference for ${name}`);
  return match[1];
}

function bytes(data) {
  return Buffer.from(data);
}

function assertResourceHash(path, resource) {
  const match = path.match(/^\/__dsbot\/([a-f0-9]{64})\/[^/]+$/u);
  assert.ok(match, `expected content-addressed resource path, received ${path}`);
  assert.equal(createHash('sha256').update(resource.data).digest('hex'), match[1]);
}

test('preserves queue, application preload, bootstrap, graph, and adapter boot order', async (t) => {
  const { frontend } = await fixture(t, {
    injections: [{ kind: 'script', text: 'window.__reviewInjection = true;' }],
  });
  const document = await frontend.document({ kind: 'plugins' });
  const html = document.html;
  const queuePath = internalPath(html, 'client-module-queue.js');
  const graphPath = internalPath(html, 'client-module-graph.js');
  const adapterPath = internalPath(html, 'mobile-page.js');
  const cssPath = internalPath(html, 'mobile-page.css');
  const injectionPath = internalPath(html, 'injection-0.js');
  const positions = [
    html.indexOf(queuePath),
    html.indexOf(`href="${APP_URL}"`),
    html.indexOf(`src="${BOOTSTRAP_URL}"`),
    html.indexOf(graphPath),
    html.indexOf(injectionPath),
    html.indexOf(adapterPath),
  ];
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.match(html, /href="\/assets\/site\.css"/u);
  assert.match(html, /src="\/assets\/app\.js"/u);
  assert.match(html, /src="\/assets\/logo\.png"/u);

  const inline = html.match(/<script id="inline-startup" nonce="([^"]+)">/u);
  assert.ok(inline, 'original inline startup script receives the CSP nonce');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u)?.[1];
  assert.ok(csp);
  assert.ok(csp.includes(`nonce-${inline[1]}`));
  assert.ok(csp.includes("frame-src 'none'"));

  const graphResource = await document.resource(graphPath);
  const serializedGraph = bytes(graphResource.data).toString('utf8');
  assert.match(serializedGraph, /^window\.__DSH_BOOT__=/u);
  assert.deepEqual(
    JSON.parse(serializedGraph.slice('window.__DSH_BOOT__='.length, -1)),
    DEFAULT_GRAPH,
  );
  for (const path of [queuePath, graphPath, adapterPath, cssPath, injectionPath]) {
    assertResourceHash(path, await document.resource(path));
  }
});

test('omits only the HMR module entry while preserving batches and other entries', async (t) => {
  const hmrID = '@deepseek-ai/dsh-client-hmr';
  const hmrEntry = {
    id: hmrID,
    rev: 'hmr-r1',
    url: `/plugins/${hmrID}/client.js?rev=hmr-r1`,
  };
  const graph = {
    entries: [...DEFAULT_GRAPH.entries, hmrEntry],
    batches: [
      ...DEFAULT_GRAPH.batches,
      {
        phase: 'application',
        url: '/plugins/app/client.js?rev=app-r2',
        entries: ['@deepseek-ai/dsh-client-ui-layout', hmrID],
        revision: 'app-r2',
      },
    ],
  };
  const { frontend } = await fixture(t, { graph });
  const document = await frontend.document({ kind: 'plugins' });
  const graphPath = internalPath(document.html, 'client-module-graph.js');
  const graphSource = bytes((await document.resource(graphPath)).data).toString('utf8');
  const embeddedGraph = JSON.parse(
    graphSource.slice('window.__DSH_BOOT__='.length, -1),
  );

  assert.deepEqual(embeddedGraph.entries, DEFAULT_GRAPH.entries);
  assert.deepEqual(embeddedGraph.batches, [
    ...DEFAULT_GRAPH.batches,
    {
      ...graph.batches.at(-1),
      entries: ['@deepseek-ai/dsh-client-ui-layout'],
    },
  ]);
  assert.equal(embeddedGraph.batches.at(-1).url, graph.batches.at(-1).url);
  assert.equal(embeddedGraph.batches.at(-1).revision, 'app-r2');
  assert.ok(!embeddedGraph.entries.some((entry) => entry.id === hmrID));
  assert.ok(!embeddedGraph.batches.some((batch) => batch.entries?.includes(hmrID)));
});

test('wraps known UI registrations after the bootstrap installs the live loader', async (t) => {
  const { frontend } = await fixture(t);
  const document = await frontend.document({ kind: 'plugins' });
  const queuePath = internalPath(document.html, 'client-module-queue.js');
  const queueScript = bytes((await document.resource(queuePath)).data).toString('utf8');
  const events = [];
  const window = { dispatchEvent: (event) => events.push(event) };
  runInNewContext(queueScript, {
    window,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  });

  const loader = window.__ModuleLoader__;
  const layoutId = '@deepseek-ai/dsh-client-ui-layout';
  const settingsId = '@deepseek-ai/dsh-client-ui-settings-general';
  const layoutContext = { source: 'layout' };
  const layoutRegistration = {
    id: layoutId,
    factory: () => ({
      apply(ctx, label) {
        assert.strictEqual(ctx, layoutContext);
        return `sync:${label}`;
      },
    }),
  };
  const liveRegistrations = [];
  loader.load({
    id: '@deepseek-ai/dsh-client-modules',
    factory: () => ({
      apply() {},
      createClientModuleSystem(liveLoader) {
        liveLoader.mode = 'live';
        liveLoader.load = (registration) => {
          liveRegistrations.push(registration);
          return `loaded:${registration.id}`;
        };
        liveLoader.load(layoutRegistration);
        return { mode: liveLoader.mode };
      },
    }),
  });
  assert.deepEqual(loader.create({}), { mode: 'live' });
  assert.equal(loader.mode, 'live');

  const liveLayoutRegistration = liveRegistrations[0];
  assert.notStrictEqual(liveLayoutRegistration, layoutRegistration);
  assert.equal(
    liveLayoutRegistration.factory().apply(layoutContext, 'after-create'),
    'sync:after-create',
  );
  assert.strictEqual(window.__DSBOT_APP_UI__.ctx, layoutContext);
  assert.strictEqual(window.__DSBOT_APP_UI__.contexts[layoutId], layoutContext);
  assert.equal(events.at(-1)?.type, 'dsbot:app-ui-ready');

  const afterContext = { source: 'live' };
  const settingsRegistration = {
    id: settingsId,
    factory: () => ({
      async apply(ctx, label) {
        assert.strictEqual(ctx, afterContext);
        return `async:${label}`;
      },
    }),
  };
  assert.equal(loader.load(settingsRegistration), `loaded:${settingsId}`);
  const liveSettingsRegistration = liveRegistrations[1];
  assert.notStrictEqual(liveSettingsRegistration, settingsRegistration);
  assert.equal(
    await liveSettingsRegistration.factory().apply(afterContext, 'after-create'),
    'async:after-create',
  );
  assert.strictEqual(window.__DSBOT_APP_UI__.ctx, afterContext);
  assert.strictEqual(window.__DSBOT_APP_UI__.contexts[settingsId], afterContext);
  assert.equal(events.filter((event) => event.type === 'dsbot:app-ui-ready').length, 2);

  const ordinaryRegistration = { id: 'ordinary-module', factory() {} };
  loader.load(ordinaryRegistration);
  assert.strictEqual(liveRegistrations[2], ordinaryRegistration);
});

test('removes only the known eager expression compiler and fails closed if invoked', async (t) => {
  const exactEvaluator = [
    'import "./vendor.js";',
    'const C7=new Function("ctx","expr",`',
    '  with (ctx) {',
    '    return eval(expr)',
    '  }',
    '`);function R0(e,t){return C7(e,t.__jsExpr)}',
    'globalThis.evaluate=R0;',
  ].join('\n');
  const { frontend } = await fixture(t, {
    html: '<!doctype html><html><head><title>DSH</title><script type="module" src="/assets/index-mobiletest.js"></script></head><body></body></html>',
    files: {
      'index-mobiletest.js': exactEvaluator,
      'other-index.js': exactEvaluator,
      'index-unrecognized.js': exactEvaluator.replace('return eval(expr)', 'return eval (expr)'),
    },
  });
  const document = await frontend.document({ kind: 'plugins' });
  const compatiblePath = document.html.match(
    /<script\b[^>]*src="([^"]*\/assets\/index-mobiletest\.js\?dsbot=[a-f0-9]{64})"/u,
  )?.[1];
  assert.ok(compatiblePath);
  const compatibleResource = await document.resource(compatiblePath);
  const mobileAsset = bytes(compatibleResource.data).toString('utf8');
  const otherAsset = bytes((await document.resource('/assets/other-index.js')).data).toString('utf8');
  const unrecognizedAsset = bytes(
    (await document.resource('/assets/index-unrecognized.js')).data,
  ).toString('utf8');

  assert.ok(document.html.includes(`src="${compatiblePath}"`));
  assert.equal(
    new URL('./vendor.js', `dsbot-ui://dsh${compatiblePath}`).pathname,
    '/assets/vendor.js',
    'relative module imports retain the original asset directory',
  );
  assert.equal(
    new URL(compatiblePath, 'dsbot-ui://dsh/').searchParams.get('dsbot'),
    createHash('sha256').update(compatibleResource.data).digest('hex'),
  );
  assert.doesNotMatch(mobileAsset, /new Function|eval\\(expr\\)/u);
  assert.match(mobileAsset, /DSH dynamic configuration expressions are disabled/u);
  assert.match(otherAsset, /new Function/u, 'non-shell chunks are left untouched');
  assert.match(unrecognizedAsset, /new Function/u, 'unknown evaluator variants are left untouched');

  const sandbox = {};
  runInNewContext(mobileAsset.replace('import "./vendor.js";\n', ''), sandbox);
  assert.throws(
    () => sandbox.evaluate({}, { __jsExpr: 'return 1' }),
    /DSH dynamic configuration expressions are disabled/u,
  );
});

test('reuses compatible main assets across documents and isolates hashed asset versions', async (t) => {
  const expression = (version: string) => [
    `// ${version}`,
    'const C7=new Function("ctx","expr",`',
    '  with (ctx) {',
    '    return eval(expr)',
    '  }',
    '`);function R0(e,t){return C7(e,t.__jsExpr)}',
    `globalThis.assetVersion="${version}";`,
  ].join('\n');
  const html = [
    '<!doctype html><html><head><title>DSH</title>',
    '<script type="module" src="/assets/index-shell-v1.js"></script>',
    '<script type="module" src="/assets/index-shell-v2.js"></script>',
    '</head><body></body></html>',
  ].join('');
  const { frontend } = await fixture(t, {
    html,
    files: {
      'index-shell-v1.js': expression('version-one'),
      'index-shell-v2.js': expression('version-two'),
    },
  });
  const firstDocument = await frontend.document({ kind: 'plugins' });
  const secondDocument = await frontend.document({ kind: 'trace', sessionId: 'session-one' });
  const transformedPath = (source: string, version: string) => {
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = source.match(new RegExp(
      `<script\\b[^>]*src="([^"]*\\/assets\\/${escapedVersion}\\.js\\?dsbot=[a-f0-9]{64})"`,
      'u',
    ));
    assert.ok(match, `expected a transformed asset path for ${version}`);
    return match[1];
  };

  const firstV1Path = transformedPath(firstDocument.html, 'index-shell-v1');
  const firstV2Path = transformedPath(firstDocument.html, 'index-shell-v2');
  const secondV1Path = transformedPath(secondDocument.html, 'index-shell-v1');
  const secondV2Path = transformedPath(secondDocument.html, 'index-shell-v2');
  assert.equal(firstV1Path, secondV1Path);
  assert.equal(firstV2Path, secondV2Path);

  const firstV1 = await firstDocument.resource(firstV1Path);
  const firstV2 = await firstDocument.resource(firstV2Path);
  const secondV1 = await secondDocument.resource(secondV1Path);
  const secondV2 = await secondDocument.resource(secondV2Path);
  assert.strictEqual(secondV1.data, firstV1.data, 'the cached transformed bytes are reused');
  assert.strictEqual(secondV2.data, firstV2.data, 'the other version is reused independently');
  assert.notStrictEqual(firstV1.data, firstV2.data, 'different versioned paths never share bytes');
  assert.match(bytes(firstV1.data).toString('utf8'), /version-one/u);
  assert.match(bytes(firstV2.data).toString('utf8'), /version-two/u);
  assert.equal(
    new URL(firstV1Path, 'dsbot-ui://dsh/').searchParams.get('dsbot'),
    createHash('sha256').update(firstV1.data).digest('hex'),
  );
  assert.equal(
    new URL(firstV2Path, 'dsbot-ui://dsh/').searchParams.get('dsbot'),
    createHash('sha256').update(firstV2.data).digest('hex'),
  );

  const csp = firstDocument.html.match(
    /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u,
  )?.[1];
  assert.ok(csp);
  assert.doesNotMatch(csp, /unsafe-eval/u);
});

test('does not retain failed static asset reads in the cache', async (t) => {
  const { frontend, assets } = await fixture(t);
  const document = await frontend.document({ kind: 'plugins' });
  const appAsset = join(assets, 'app.js');

  await rm(appAsset);
  await assert.rejects(document.resource('/assets/app.js'), { code: 'ENOENT' });

  await writeFile(appAsset, 'window.__appAssetRecovered = true;', 'utf8');
  const recovered = await document.resource('/assets/app.js');
  assert.match(bytes(recovered.data).toString('utf8'), /__appAssetRecovered/u);
});

test('hashes generated resources and keeps each document resolver bound to its own bytes', async (t) => {
  const first = await fixture(t, {
    injections: [{ kind: 'script', text: 'window.__pageVersion = "one";' }],
  });
  const firstDocument = await first.frontend.document({ kind: 'plugins' });
  const firstPath = internalPath(firstDocument.html, 'injection-0.js');
  const firstResource = await firstDocument.resource(firstPath);

  const second = await fixture(t, {
    injections: [{ kind: 'script', text: 'window.__pageVersion = "two";' }],
  });
  const secondDocument = await second.frontend.document({ kind: 'plugins' });
  const secondPath = internalPath(secondDocument.html, 'injection-0.js');
  const secondResource = await secondDocument.resource(secondPath);

  assert.notEqual(firstPath, secondPath);
  assert.notDeepEqual(bytes(firstResource.data), bytes(secondResource.data));
  assertResourceHash(firstPath, firstResource);
  assertResourceHash(secondPath, secondResource);
  assert.match(bytes((await firstDocument.resource(firstPath)).data).toString('utf8'), /"one"/u);
});

test('serves only frozen graph entries, current-revision chunks, and rejects stale or unrelated modules', async (t) => {
  let currentGraph = structuredClone(DEFAULT_GRAPH);
  const fetched = [];
  const { frontend } = await fixture(t, {
    graph: () => currentGraph,
    fetchBundle: async ({ url }) => {
      fetched.push(url);
      const data = Buffer.from(`module:${url}`);
      return {
        ok: true,
        headers: { get: () => 'application/javascript' },
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
      };
    },
  });
  const oldDocument = await frontend.document({ kind: 'trace', sessionId: 'session-one' });
  const allowedChunk = '/plugins/example/client.route-hash.js?rev=entry-r1';
  assert.match(bytes((await oldDocument.resource(APP_URL)).data).toString('utf8'), /module:/u);
  assert.match(bytes((await oldDocument.resource(allowedChunk)).data).toString('utf8'), /client\.route-hash\.js/u);

  currentGraph = {
    entries: [{ id: 'example', rev: 'entry-r2', url: '/plugins/example/client.js?rev=entry-r2' }],
    batches: [{ phase: 'application', url: '/plugins/app/client.js?rev=app-r2' }],
  };
  const newDocument = await frontend.document({ kind: 'trace', sessionId: 'session-one' });
  await assert.rejects(oldDocument.resource('/plugins/example/client.route-hash.js?rev=entry-r2'));
  await assert.rejects(oldDocument.resource('/plugins/other/client.route-hash.js?rev=entry-r1'));
  await assert.rejects(oldDocument.resource('/plugins/example/unrelated.js?rev=entry-r1'));
  await assert.rejects(oldDocument.resource('/plugins/example/client.node.js?rev=entry-r1'));
  await assert.rejects(oldDocument.resource('/plugins/example/client.route-hash.js'));
  assert.match(bytes((await newDocument.resource('/plugins/example/client.route-hash.js?rev=entry-r2')).data).toString('utf8'), /entry-r2/u);
  assert.deepEqual(fetched, [
    APP_URL,
    allowedChunk,
    '/plugins/example/client.route-hash.js?rev=entry-r2',
  ]);
});

test('serves only the scanned static manifest and denies maps, symlinks, and traversal', async (t) => {
  const { frontend, assets, root } = await fixture(t, {
    files: {
      'nested/font.woff2': Buffer.from('font-data'),
      'source.js.map': '{"sources":["private.ts"]}',
      'regular.js': 'window.regular = true;',
    },
  });
  const outside = join(root, 'outside-secret.js');
  await writeFile(outside, 'must not be served');
  await symlink(outside, join(assets, 'leaked.js'));

  const document = await frontend.document({ kind: 'plugins' });
  const font = await document.resource('/assets/nested/font.woff2');
  assert.equal(font.mimeType, 'font/woff2');
  assert.equal(bytes(font.data).toString('utf8'), 'font-data');
  assert.equal(
    bytes((await document.resource('/assets/regular.js')).data).toString('utf8'),
    'window.regular = true;',
  );

  for (const path of [
    '/assets/source.js.map',
    '/assets/leaked.js',
    '/assets/../outside-secret.js',
    '/assets/%2e%2e/outside-secret.js',
    '/assets/%252e%252e/outside-secret.js',
    '/assets/%5c..%5coutside-secret.js',
    '/assets/nested/font.woff2#fragment',
  ]) {
    await assert.rejects(document.resource(path), undefined, path);
  }
});

test('uses a restrictive local-only CSP and strips the upstream permissive policy', async (t) => {
  const { frontend } = await fixture(t);
  const document = await frontend.document({ kind: 'plugins' });
  const csp = document.html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/u)?.[1];
  assert.ok(csp);
  assert.match(csp, /default-src 'none'/u);
  assert.match(csp, /script-src dsbot-ui: 'nonce-[^']+'/u);
  assert.match(csp, /style-src dsbot-ui: 'unsafe-inline'/u);
  assert.match(csp, /img-src dsbot-ui: data: blob:/u);
  assert.match(csp, /font-src dsbot-ui:/u);
  assert.match(csp, /connect-src 'none'/u);
  assert.match(csp, /base-uri 'none'/u);
  assert.match(csp, /form-action 'none'/u);
  assert.doesNotMatch(document.html, /default-src \*/u);
  assert.doesNotMatch(document.html, /https?:\/\//u);
  const cssPath = internalPath(document.html, 'mobile-page.css');
  assert.match(
    bytes((await document.resource(cssPath)).data).toString('utf8'),
    /font-family:"Pingfang SC",-apple-system/iu,
  );
});

test('builds direct HTTP documents with page-scoped roots and rewrites manifest text resources', async (t) => {
  const pageId = '36b8f84d-df4e-4d49-b662-bcde71a8764f';
  const basePath = `/dsbot/ui/${pageId}/`;
  const fetched = [];
  const { frontend } = await fixture(t, {
    files: {
      'app.js': [
        'window.assetPath = "/assets/logo.png";',
        'window.pluginPath = "/plugins/example/client.js?rev=entry-r1";',
        'window.internalPath = "/__dsbot/cache/item.js";',
        'window.externalPath = "https://example.invalid/assets/remote.png";',
      ].join('\n'),
      'site.css': 'body{background:url(/assets/logo.png)}@font-face{src:url("/assets/nested/font.woff2")}',
      'nested/font.woff2': Buffer.from('font-data'),
    },
    fetchBundle: async ({ url }) => {
      fetched.push(url);
      const data = Buffer.from(`bundle:${url}`);
      return {
        ok: true,
        headers: { get: () => 'text/javascript; charset=utf-8' },
        async arrayBuffer() {
          return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        },
      };
    },
  });

  const document = await frontend.document({
    kind: 'plugins', transport: 'http', basePath,
  });
  assert.ok(document.html.includes(`href="${basePath}assets/site.css"`));
  assert.ok(document.html.includes(`src="${basePath}assets/app.js"`));
  assert.ok(document.html.includes(`href="${basePath}plugins/app/client.js?rev=app-r1"`));
  assert.match(document.html, new RegExp(`src="${basePath}__dsbot/[a-f0-9]{64}/client-module-graph\\.js"`,'u'));
  assert.match(document.html, /script-src 'self' 'nonce-[^']+'/u);
  assert.match(document.html, /style-src 'self' 'unsafe-inline'/u);
  assert.match(document.html, /img-src 'self' data: blob:/u);
  assert.match(document.html, /connect-src 'self'/u);
  assert.doesNotMatch(document.html, /dsbot-ui:/u);

  const script = bytes((await document.resource(`${basePath}assets/app.js`)).data).toString('utf8');
  assert.ok(script.includes(`"${basePath}assets/logo.png"`));
  assert.ok(script.includes(`"${basePath}plugins/example/client.js?rev=entry-r1"`));
  assert.ok(script.includes(`"${basePath}__dsbot/cache/item.js"`));
  assert.match(script, /"https:\/\/example\.invalid\/assets\/remote\.png"/u);

  const stylesheet = bytes((await document.resource(`${basePath}assets/site.css`)).data).toString('utf8');
  assert.ok(stylesheet.includes(`url(${basePath}assets/logo.png)`));
  assert.ok(stylesheet.includes(`url("${basePath}assets/nested/font.woff2")`));

  const graphPath = document.html.match(new RegExp(
    `src="(${basePath}__dsbot/[a-f0-9]{64}/client-module-graph\\.js)"`, 'u',
  ))?.[1];
  assert.ok(graphPath);
  const graphScript = bytes((await document.resource(graphPath)).data).toString('utf8');
  assert.ok(graphScript.includes(`"${basePath}plugins/example/client.js?rev=entry-r1"`));
  await document.resource(`${basePath}plugins/example/client.js?rev=entry-r1`);
  assert.deepEqual(fetched, ['/plugins/example/client.js?rev=entry-r1']);

  await assert.rejects(frontend.document({
    kind: 'plugins', transport: 'http', basePath: '/dsbot/ui/not-a-uuid/',
  }), TypeError);
});

test('rejects malformed module graphs and bounds generated input, paths, and bundle errors', async (t) => {
  for (const graph of [
    null,
    { entries: {}, batches: [] },
    { entries: [], batches: {} },
  ]) {
    const { frontend } = await fixture(t, { graph });
    await assert.rejects(frontend.document({ kind: 'plugins' }), (error) => {
      assert.ok(error.message.length < 256);
      return error instanceof Error;
    });
  }

  assert.throws(() => createDshMobileFrontend({
    clientModules: graphClient(),
    frontendDist: '/does/not/need/to/exist',
    injections: [{ kind: 'script', text: 'x'.repeat(256 * 1024 + 1) }],
  }), /bounded script or style/u);
  assert.throws(() => createDshMobileFrontend({
    clientModules: graphClient(),
    frontendDist: '/does/not/need/to/exist',
    injections: Array.from({ length: 33 }, () => ({ kind: 'style', text: 'x' })),
  }), /exceed the page limit/u);
  assert.throws(() => createDshMobileFrontend({
    clientModules: graphClient(),
    frontendDist: '/does/not/need/to/exist',
    injections: Array.from({ length: 5 }, () => ({ kind: 'script', text: 'x'.repeat(256 * 1024) })),
  }), /exceed the page limit/u);

  const tooLarge = Buffer.alloc(40 * 1024 * 1024 + 1, 0x61);
  const { frontend } = await fixture(t, {
    fetchBundle: async () => ({
      ok: true,
      headers: { get: () => 'text/javascript' },
      async arrayBuffer() {
        return tooLarge.buffer.slice(
          tooLarge.byteOffset,
          tooLarge.byteOffset + tooLarge.byteLength,
        );
      },
    }),
  });
  const document = await frontend.document({ kind: 'plugins' });
  await assert.rejects(document.resource(APP_URL), (error) => {
    assert.ok(error.message.length < 256);
    return /exceeds the resource limit/u.test(error.message);
  });
  await assert.rejects(document.resource(`/${'x'.repeat(8192)}`), (error) => {
    assert.ok(error.message.length < 256);
    return /Unknown DSH mobile frontend resource/u.test(error.message);
  });
});
