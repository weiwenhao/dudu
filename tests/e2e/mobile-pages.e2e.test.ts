// The installed DSH frontend and actual phone transport, served by the scoped HTTP page carrier.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Page } from 'playwright-core';
import { startDudu } from './harness.mjs';

let folder: string;
let dudu: Awaited<ReturnType<typeof startDudu>>;
let origin: string;
let credential: string;
let sessionId: string;
let transport: string;

async function request(method: string, params = {}) {
  const response = await dudu.context.request.post(`${dudu.base}/api/dudu-mobile-pages-probe`, { data: { method, params } });
  assert.equal(response.ok(), true, `${method}: ${response.status()}`);
  return response.json();
}

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dudu-mobile-pages-'));
  await writeFile(join(folder, 'package.json'), JSON.stringify({
    name: 'dudu-mobile-pages-probe', version: '1.0.0', type: 'module', main: 'index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }));
  await writeFile(join(folder, 'cordis.patch.yml'), '- insert:\n    - id: dudu-mobile-pages-probe\n      name: dudu-mobile-pages-probe\n');
  const moduleURL = (name: string) => JSON.stringify(new URL(`../../host/${name}.mjs`, import.meta.url).href);
  await writeFile(join(folder, 'index.mjs'), `
import http from 'node:http';
import { join } from 'node:path';
import { createDshMobileFrontend } from ${moduleURL('dsh-mobile-frontend')};
import { createNativePages } from ${moduleURL('native-pages')};
import { createTypertPageRpc } from ${moduleURL('native-page-rpc')};
import { createWebPageHttp } from ${moduleURL('web-page-http')};
import { createPairingStore } from ${moduleURL('pairing-devices')};
import { createNativeBridge, createTypertRpcAdapter } from ${moduleURL('native-bridge')};
export const name = 'dudu-mobile-pages-probe';
export const inject = ['connection', 'clientModules', 'typertGateway', 'webServer'];
export async function apply(ctx) {
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } });
  const pages = createNativePages({
    frontend: createDshMobileFrontend({ clientModules: ctx.clientModules }),
    pageRpc: createTypertPageRpc({
      gateway: ctx.typertGateway, peer, events: ctx, connection: ctx.connection, webServer: ctx.webServer,
    }),
  });
  const pairingStore = await createPairingStore({ folder: join(process.env.DSH_HOME, 'page-test-pairing') });
  const pageHttp = createWebPageHttp({ pages, pairingStore });
  const server = http.createServer((request, response) => {
    void pageHttp.handle(request, response).then((handled) => {
      if (!handled) { response.writeHead(404); response.end(); }
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = 'http://127.0.0.1:' + server.address().port;
  // This credential belongs only to this test's isolated DSH_HOME and loopback server.
  const code = await pairingStore.issue({ address, name: 'Isolated page test' });
  const token = new URL(code.url).searchParams.get('pair');
  const bridge = createNativeBridge({ rpc: createTypertRpcAdapter({ gateway: ctx.typertGateway, peer }) });
  const connection = {};
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dudu-mobile-pages-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const { method, params = {} } = await request.json();
      if (method === 'auth') return Response.json({ address, token });
      if (!['session.create', 'session.open', 'session.send', 'session.configure'].includes(method)) return new Response(null, { status: 400 });
      return Response.json(await bridge.dispatch(method, params, connection));
    },
  }));
  return async () => {
    await bridge.closeConnection(connection);
    await pageHttp.close();
    await new Promise((done) => server.close(done));
    await pairingStore.close();
  };
}
`);
  transport = await readFile(new URL('../../native/DSBot/Resources/EmbeddedTransport.js', import.meta.url), 'utf8');
  dudu = await startDudu({ plugins: [folder], model: {
    replies: [{ say: 'Embedded page history is available.' }],
  }, files: { 'page-result.txt': 'PHONE-RESULT-JSON' } });
  dudu.model.replies = [{
    when: 'PHONE-LIVE-RESULT',
    calls: [{ name: 'read', arguments: { file_path: join(dudu.folder, 'user', 'page-result.txt') } }],
    then: () => 'Live result received.',
  }, { say: 'Embedded page history is available.' }];
  const auth = await request('auth');
  origin = auth.address;
  credential = auth.token;
  sessionId = (await request('session.create')).id;
  // The fixture is outside the new session's default workspace; this isolated test has no approval UI.
  await request('session.configure', { id: sessionId, permissionId: 'danger-full-access' });
  await request('session.send', { id: sessionId, text: 'PHONE-PAGE-HISTORY' });
  await assertEventually(async () => {
    const detail = await request('session.open', { id: sessionId });
    return detail.session.status !== 'running'
      && detail.messages.some((message: { text: string }) => message.text.includes('Embedded page history'));
  });
});

after(async () => {
  await dudu?.stop();
  if (folder) await rm(folder, { recursive: true, force: true });
});

async function assertEventually(check: () => Promise<boolean>) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.fail(`The isolated session did not finish in time.\n${dudu.diagnostics().slice(-4000)}`);
}

async function openPage(kind: string, target?: string) {
  const response = await dudu.context.request.post(`${origin}/dsbot/web/open`, {
    headers: { authorization: `Bearer ${credential}` },
    data: { page: kind, ...(['trace', 'view'].includes(kind) ? { sessionId } : {}), ...(target ? { target } : {}) },
  }).catch(() => {
    assert.fail(`The isolated page carrier could not open ${kind}.\n${dudu.diagnostics().slice(-4000)}`);
  });
  assert.equal(response.ok(), true, `page.open: ${response.status()}`);
  const opened = await response.json();
  await dudu.context.addCookies([{
    name: 'dsbot_ui', value: opened.cookie, domain: '127.0.0.1', path: opened.path, httpOnly: true, sameSite: 'Strict',
  }]);
  const page = await dudu.context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const descriptor = {
    id: opened.id, kind, target, sessionId, transport: 'http', basePath: opened.path, reviewDiagnostics: true,
  };
  await page.addInitScript({ content: `
window.__DSBOT_PAGE__ = ${JSON.stringify(descriptor)};
window.__pageMessages = [];
window.webkit = { messageHandlers: { dsbot: { async postMessage(encoded) {
  window.__pageMessages.push(JSON.parse(encoded));
  return JSON.stringify(null);
} } } };
${transport}
` });
  return { page, url: `${origin}${opened.path}` };
}

async function messages(page: Page) {
  return page.evaluate(() => (window as any).__pageMessages as { method: string; params?: Record<string, unknown> }[]);
}

for (const kind of ['plugins', 'settings', 'trace']) {
  test(`mobile embedded ${kind} uses current DSH resources and routes at phone width`, { timeout: 90_000 }, async () => {
    const { page, url } = await openPage(kind);
    const errors: string[] = [];
    const calls: unknown[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().endsWith('/rpc')) return;
      const data = request.postDataJSON();
      if (data?.method === 'web.stream.open' || data?.method === 'web.invoke') calls.push(data);
    });
    try {
      await page.goto(url);
      await page.waitForFunction(() => (window as any).__pageMessages.some((message: any) =>
        message.method === 'ready' || message.method === 'bootstrap.failure'), undefined, { timeout: 40_000 });
      const reports = await messages(page);
      const viewState = await page.evaluate(() => {
        const ctx = (window as any).__DSBOT_APP_UI__?.ctx;
        return {
          tabs: [...document.querySelectorAll('[data-conversation-tabs] [role="tab"]')].map((tab) => tab.textContent),
          entries: ctx?.slots?.entries?.('conversation.view')?.map((entry: any) => entry.options.id),
          developer: ctx?.configForms?.get?.('ui-settings')?.getSnapshot?.(),
        };
      });
      assert.equal(reports.some((report) => report.method === 'bootstrap.failure'), false,
        JSON.stringify({ reports: reports.map(({ method, params }) => ({
          method, params: params ? { ...params, stack: undefined } : undefined,
        })), errors, calls, viewState, diagnostics: dudu.diagnostics().slice(-4000) }));
      assert.equal(errors.length, 0, JSON.stringify(errors));
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        root: document.querySelector('#root')?.getBoundingClientRect().toJSON(),
      }));
      assert.equal(geometry.scrollWidth <= geometry.width + 1, true, JSON.stringify(geometry));
      if (kind === 'plugins') {
        await page.locator('[data-plugin-panel]').waitFor();
        assert.equal(await page.locator('[data-plugin-header-part="title"]').first().isVisible(), false);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsbot:command', { detail: 'add' })));
        await page.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
      }
      if (kind === 'settings') await page.locator('[data-dsbot-settings-body]').waitFor();
      if (kind === 'trace') {
        await page.getByText('PHONE-PAGE-HISTORY', { exact: false }).first().waitFor();
        const clearance = await page.locator('[class*="_ledger"]').evaluate((ledger) =>
          getComputedStyle(ledger).getPropertyValue('--dsh-trajectory-bottom-clearance').trim());
        assert.equal(clearance, '0px', 'the phone has no desktop composer to reserve space for');
        await request('session.send', { id: sessionId, text: 'PHONE-LIVE-RESULT' });
        await page.getByText('Live result received.', { exact: false }).first().waitFor();
        assert.equal(dudu.model.requests.some((request: any) =>
          request.toolResults.some((text: string) => text.includes('PHONE-RESULT-JSON'))), true);
        await page.locator('tr[data-kind="tool"]').last().click();
        const details = page.getByRole('complementary', { name: 'Event details', exact: true });
        await details.getByRole('tab', { name: 'Result', exact: true }).click();
        await details.getByRole('region', { name: 'Raw result', exact: true }).getByText('PHONE-RESULT-JSON', { exact: false }).waitFor();
        await details.getByRole('region', { name: 'Rendered result', exact: true }).getByText('PHONE-RESULT-JSON', { exact: false }).waitFor();
        const rectangle = await details.boundingBox();
        assert.ok(rectangle && rectangle.x >= -1 && rectangle.x + rectangle.width <= 391);
        assert.equal(await details.getByRole('separator').isVisible(), false);
      }
      const shots = join(process.cwd(), '.local', 'dsh-compat-nov06', 'mobile-pages');
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `${kind}-390.png`) });
      assert.deepEqual((await messages(page)).filter((report) =>
        report.method === 'rpc.failure' || report.method === 'bootstrap.failure'), []);
    } catch (error) {
      const shots = join(process.cwd(), '.local', 'dsh-compat-nov06', 'mobile-pages');
      await mkdir(shots, { recursive: true });
      await writeFile(join(shots, `${kind}-diagnostics.json`), JSON.stringify({
        detail: await request('session.open', { id: sessionId }).catch(() => undefined),
        requests: dudu.model.requests,
        errors, calls, diagnostics: dudu.diagnostics(),
      }, null, 2));
      throw error;
    } finally {
      const shots = join(process.cwd(), '.local', 'dsh-compat-nov06', 'mobile-pages');
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `${kind}-390.png`) }).catch(() => {});
      await page.close();
    }
  });
}
