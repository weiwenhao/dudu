// A real browser and the real interface, with the plugin's answers in the test's hands. For what a real DSH cannot be made to
// say on any machine (an account's usage, a session that failed): `handlers` answers those; everything else (`issues/*`,
// `dashboard/*`) is the real library, in memory, behind the same `request` the plugin's page uses. Not a replacement for harness.mjs:
// DSH itself is not in it.
//
//   const fixture = await startFixture({ handlers: { 'overview/usage': () => ({ providers: [...] }) } });
//   fixture.issues.add({ ... });           // the real issues library (sessionState: fixture.sessions[key])
//   const page = await fixture.open();     // the dashboard, in a page of its own
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { compileCss } from '../../scripts/build-client.mjs';
import { createDashboard } from '../../host/assistant/dashboard/index.mjs';
import { createDashboardApi } from '../../host/assistant/dashboard/api.mjs';
import { createIssues } from '../../host/assistant/issues/index.mjs';
import { createIssuesApi } from '../../host/assistant/issues/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
let bundled;

/** The fixture page's script: the interface and a real React, built once per process. */
async function script() {
  bundled ??= (async () => {
    const work = await mkdtemp(join(tmpdir(), 'dudu-fixture-'));
    try {
      const css = await compileCss(work);
      const { outputFiles } = await build({
        entryPoints: [join(here, 'fixture-entry.jsx')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
        minify: true, logLevel: 'warning', outfile: join(work, 'fixture.js'), define: { 'process.env.NODE_ENV': '"production"', __DUDU_CSS__: JSON.stringify(css) },
      });
      return outputFiles[0].text;
    } finally { await rm(work, { recursive: true, force: true }); }
  })();
  return bundled;
}

/** The grid library's engine, which Node cannot load as it is (see the plugin's packaging): bundled for the dashboard library. */
async function engine() {
  const work = await mkdtemp(join(tmpdir(), 'dudu-engine-'));
  try {
    const file = join(work, 'engine.mjs');
    await build({ entryPoints: [join(root, 'host', 'assistant', 'dashboard', 'engine.mjs')], outfile: file, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning' });
    return (await import(file)).GridStackEngine;
  } finally { await rm(work, { recursive: true, force: true }); }
}

export async function startFixture({ handlers = {}, viewport = { width: 1440, height: 900 }, colorScheme = 'light' } = {}) {
  const sessions = {};
  const issues = createIssues({ file: ':memory:', sessionState: (key) => sessions[key] ?? null });
  const folder = await mkdtemp(join(tmpdir(), 'dudu-fixture-dashboard-'));
  const dashboard = createDashboard({ file: join(folder, 'dashboard.json'), engine: await engine() });
  const apis = { issues: createIssuesApi({ issues }), dashboard: createDashboardApi({ dashboard }) };
  const opened = [];
  const answer = async (action, body) => {
    if (handlers[action]) return handlers[action](body);
    const [area, name] = action.split('/');
    if (!apis[area]) return {};
    const response = await apis[area].handle(name, new Request('http://fixture.test/', { method: 'POST', body: JSON.stringify(body) }));
    return response.json();
  };
  const html = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}#root{position:absolute;inset:0}</style><div id="root"></div><script src="/fixture.js"></script>';
  const code = await script();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages = new Set();
  return {
    issues, sessions, dashboard, opened,
    /** A page on the dashboard, which starts from the default layout unless `keepLayout` (the plugin keeps it between pages, as the real one does). */
    async open({ size = viewport, keepLayout = false } = {}) {
      if (!keepLayout) dashboard.reset();
      const context = await browser.newContext({ viewport: size, colorScheme });
      const page = await context.newPage();
      pages.add(page);
      await page.exposeFunction('__request', answer);
      await page.exposeFunction('__opened', (target) => { opened.push(target); });
      await page.route('http://fixture.test/**', (route) => (route.request().url().endsWith('/fixture.js')
        ? route.fulfill({ contentType: 'text/javascript', body: code }) : route.fulfill({ contentType: 'text/html', body: html })));
      await page.goto('http://fixture.test/');
      return page;
    },
    async stop() {
      await browser.close().catch(() => {});
      issues.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}
