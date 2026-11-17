// End-to-end harness: the real plugin package, installed into a real `dsh web` that runs on its own DSH_HOME and its own
// HOME, driven by a real Chrome through Playwright. Nothing here touches the owner's DSH (~/.dsh, port 3170) or Desktop.
//
//   const dudu = await startDudu();            // package, install, start, log in
//   const dudu = await startDudu({ model: { replies } });   // ... with a scripted model as DSH's default (see mock-model.mjs); dudu.model.requests
//   const dudu = await startDudu({ env: { NAME: 'value' } });   // more environment for DSH (and so for the plugin and what it starts)
//   const page = await dudu.openPanel();       // a fresh page on the 嘟嘟 panel
//   await dudu.api('issues/add', { fields });  // the plugin's own HTTP API, as the logged-in page would call it
//   await dudu.stop();                         // browser, DSH and the temporary home are gone
//
// The URL `dsh web` prints carries a login token: it is read from the process in memory, never printed or written down.
import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startMockModel } from './mock-model.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTUP_MS = 90_000;
// The DSH to test against: the installed one, or another build's CLI (the Desktop app ships its own: see AGENTS.md) named in DUDU_E2E_DSH.
const DSH = process.env.DUDU_E2E_DSH || 'dsh';

/**
 * Dashboard commands go through the three icons in the top right, above the board. The same in a real DSH and in the standalone fixture.
 */
export async function panelAction(page, action) {
  const entry = page.getByRole('toolbar', { name: 'Dudu menu', exact: true });
  await entry.getByRole('button', { name: action, exact: true }).click();
  if (action === 'Edit layout') await page.getByRole('toolbar', { name: 'Edit layout', exact: true }).waitFor();
}

/**
 * The way to an issue's page from a row or a card: "Open issue" in its right-click menu (the small icon that used to end the row and the card is gone,
 * owner 2026-11-05). `scope` is the row or the card, or something that holds exactly one of them.
 */
export async function openIssuePage(scope) {
  const item = scope.locator('xpath=self::*[@data-issue-row or @data-issue-card] | .//*[@data-issue-row or @data-issue-card]').first();
  await item.click({ button: 'right', position: { x: 30, y: 12 } });
  await item.page().getByRole('menuitem', { name: 'Open issue', exact: true }).click();
}

/** The packaged plugin of this checkout (built fresh unless DUDU_E2E_TGZ names one that already is). */
async function packagedPlugin() {
  if (process.env.DUDU_E2E_TGZ) return process.env.DUDU_E2E_TGZ;
  const { version } = JSON.parse(await readFile(join(root, 'host', 'dudu-plugin', 'package.json'), 'utf8'));
  await run('node', [join(root, 'scripts', 'package-desktop.mjs')], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return join(root, '.local', 'release', `dsh-dudu-${version}.tgz`);
}

async function waitForUrl(child, output) {
  const started = Date.now();
  while (Date.now() - started < STARTUP_MS) {
    const found = /https?:\/\/127\.0\.0\.1:\d+\/?\S*/.exec(output.text);
    if (found) return new URL(found[0]);
    if (child.exitCode !== null) throw new Error(`dsh web exited early (code ${child.exitCode}).\n${output.text.replace(/https?:\/\/\S+/g, '[URL redacted]').slice(-6000)}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('dsh web did not print its address in time.');
}

export async function startDudu({ colorScheme = 'light', viewport = { width: 1440, height: 900 }, patch = '', files = {}, env: moreEnv = {}, model, plugins = [], launchBrowser = true } = {}) {
  const tgz = await packagedPlugin();
  const folder = await mkdtemp(join(tmpdir(), 'dudu-e2e-'));
  const home = join(folder, 'dsh');
  const user = join(folder, 'user'); // HOME of DSH and the plugin: no real Claude or Codex sessions, no real config to read
  await mkdir(user, { recursive: true });
  // Files to put in HOME before anything starts (a Claude Code session to find, say): { 'relative/path': text }.
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(user, path)), { recursive: true });
    await writeFile(join(user, path), text);
  }
  const env = {
    PATH: process.env.PATH, HOME: user, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG ?? 'en_US.UTF-8',
    DSH_HOME: home, DUDU_ALLOW_TEMP_HOME: '1', NO_COLOR: '1', ...(process.env.DUDU_E2E_ENV ? JSON.parse(process.env.DUDU_E2E_ENV) : {}), ...moreEnv,
  };
  // A scripted model on a local port, which DSH is told to use as its default: no real model, no real credential. Its key is a made-up one.
  const mock = model ? await startMockModel(model === true ? {} : model) : null;
  if (mock) env.DUDU_MOCK_MODEL_KEY = 'mock-key';
  if (mock && model.nativeClaude) Object.assign(env, {
    ANTHROPIC_API_KEY: 'dudu-e2e-key', ANTHROPIC_BASE_URL: mock.url.replace(/\/v1$/, ''),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
  });
  if (mock && model.nativeCodex) {
    await mkdir(join(user, '.codex'), { recursive: true });
    await writeFile(join(user, '.codex', 'config.toml'), [
      'model = "gpt-5.5"', 'model_provider = "dudu_e2e"', 'model_reasoning_effort = "low"',
      'sandbox_mode = "workspace-write"',
      '[model_providers.dudu_e2e]', 'name = "Test model"', `base_url = "${mock.url}"`,
      'env_key = "DUDU_MOCK_MODEL_KEY"', 'wire_api = "responses"', 'supports_websockets = false',
    ].join('\n'));
  }
  if (mock && model.nativePi) {
    // Pi reads ~/.pi/agent (HOME is the isolated one): a provider of its own that speaks to the scripted model, and no network of its own.
    const agent = join(user, '.pi', 'agent');
    await mkdir(agent, { recursive: true });
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { dudu_e2e: {
      baseUrl: mock.url, api: 'openai-completions', apiKey: 'dudu-e2e-key',
      models: (model.piModels ?? [{ id: 'mock-pi', name: 'Mock Pi' }]).map((entry) => ({ reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 8192, cost: zero, ...entry })),
    } } }));
    await writeFile(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'dudu_e2e', defaultModel: (model.piModels ?? [{ id: 'mock-pi' }])[0].id, quietStartup: true, ...(model.piSettings ?? {}) }));
    Object.assign(env, { PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' });
  }
  const modelPatch = mock ? [
    '- id: llm-pi-ai', '  config:', '    providers:', '      mock:', '        displayName: Mock', '        api: openai-completions',
    `        baseURL: ${mock.url}`, '        apiKeyEnv: DUDU_MOCK_MODEL_KEY',
    `        models: ${JSON.stringify(model.models ?? [{ id: 'mock-1', name: 'Mock', contextWindow: 100000 }])}`,
    '- id: agent-default-model', '  config:', '    provider: mock', '    model: mock-1',
  ].join('\n') : '';
  const state = { folder, child: null, browser: null, stopped: false, output: { text: '' } };
  const stopChild = async () => {
    if (!state.child || state.child.exitCode !== null) return;
    state.child.kill('SIGTERM');
    await new Promise((done) => {
      const timer = setTimeout(() => { state.child.kill('SIGKILL'); done(); }, 10_000);
      state.child.once('exit', () => { clearTimeout(timer); done(); });
    });
  };
  const launch = async (port = '0') => {
    const output = { text: '' };
    state.output = output;
    state.child = spawn(DSH, ['web', '--host', '127.0.0.1', '--no-open', '--port', port], { env, cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [state.child.stdout, state.child.stderr]) stream.on('data', (chunk) => { output.text += chunk; });
    return waitForUrl(state.child, output);
  };
  const stop = async () => {
    if (state.stopped) return;
    state.stopped = true;
    await state.browser?.close().catch(() => {});
    await stopChild();
    await mock?.stop().catch(() => {});
    await rm(folder, { recursive: true, force: true });
  };
  process.once('exit', () => { state.child?.kill('SIGKILL'); });
  try {
    // A copy under a name of its own: the package manager keys `file:` installs by path.
    const archive = join(folder, `dudu-e2e-${process.pid}-${Date.now()}.tgz`);
    await copyFile(tgz, archive);
    await run(DSH, ['plugin', '--profile', 'web', 'add', `file:${archive}`], { env, cwd: folder, maxBuffer: 16 * 1024 * 1024 });
    for (const plugin of plugins) await run(DSH, ['plugin', '--profile', 'web', 'add', plugin], { env, cwd: folder, maxBuffer: 16 * 1024 * 1024 });
    // The phone port is not bound in the web runtime, but a fixed one must never be asked for; the notice is the first-run modal.
    await writeFile(join(home, 'profiles', 'web', 'cordis.patch.yml'), [
      '- id: dudu', '  config:', '    port: 0',
      '- id: ui-settings-general', '  name: "@deepseek-ai/dsh-client-ui-settings-general"', '  config:', '    welcomeNoticeVersion: 2026-09-28.1', modelPatch, patch,
    ].join('\n') + '\n');

    let login = await launch();
    const base = login.origin;

    // Visible review can use the owner's authorized browser while retaining this isolated DSH.
    // The launch token stays in memory; only a scoped cookie is exchanged with that browser.
    let context;
    let first;
    let cookie;
    if (launchBrowser) {
      state.browser = await chromium.launch({ channel: 'chrome', headless: true });
      context = await state.browser.newContext({ viewport, colorScheme, locale: 'en-US' });
      first = await context.newPage();
      await first.goto(login.href);
      await first.waitForLoadState('domcontentloaded');
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    } else {
      const response = await fetch(login.href, { redirect: 'manual' });
      cookie = response.headers.get('set-cookie')?.split(';')[0];
      if (response.status !== 303 || !cookie) throw new Error('The isolated review session could not be authorized.');
    }

    const pages = new Set();
    const dudu = {
      base, context, folder, home, viewport, model: mock, packageArchive: tgz,
      diagnostics: () => state.output.text.replace(/https?:\/\/\S+/g, '[URL redacted]'),
      /** Authorize this isolated origin (or its loopback alias) without exposing the token-bearing launch URL. */
      async authorizeBrowserOrigin(origin) {
        const target = new URL(origin);
        if (target.protocol !== 'http:' || target.port !== new URL(base).port
          || (target.origin !== base && !target.hostname.endsWith('.localhost'))) throw new Error('Use the origin or a loopback alias of this isolated DSH.');
        const response = context
          ? await context.request.get(login.href, { headers: { host: target.host }, maxRedirects: 0 })
          : await new Promise((resolve, reject) => {
            const request = httpRequest(login, { headers: { host: target.host } }, (response) => {
              response.resume();
              resolve({ statusCode: response.statusCode, headers: response.headers });
            });
            request.once('error', reject);
            request.end();
          });
        const scoped = context ? response.headers()['set-cookie'] : response.headers['set-cookie']?.[0];
        const status = context ? response.status() : response.statusCode;
        if (status !== 303 || !scoped) throw new Error('The isolated browser session could not be authorized.');
        return scoped;
      },
      /** Change only this test profile's package selection; restart() applies it on runtimes without profile hot reload. */
      async removePlugin(name) {
        await run(DSH, ['plugin', '--profile', 'web', 'remove', name], { env, cwd: folder, maxBuffer: 16 * 1024 * 1024 });
      },
      /** Install only into this test's profile; profile HMR can activate it while this DSH keeps running. */
      async installPlugin(archive) {
        await run(DSH, ['plugin', '--profile', 'web', 'add', `file:${archive}`], { env, cwd: folder, maxBuffer: 16 * 1024 * 1024 });
      },
      /** Restart the same isolated home, keeping its sessions, model and browser origin. */
      async restart() {
        await stopChild();
        const next = await launch(new URL(base).port);
        login = next;
        if (context) {
          const auth = await context.newPage();
          try { await auth.goto(next.href); await auth.waitForLoadState('domcontentloaded'); }
          finally { await auth.close(); }
        } else {
          const response = await fetch(next.href, { redirect: 'manual' });
          cookie = response.headers.get('set-cookie')?.split(';')[0];
          if (response.status !== 303 || !cookie) throw new Error('The restarted review session could not be authorized.');
        }
      },
      /** POST to the plugin as the logged-in browser does; the answer is the JSON the page would get. */
      async api(action, body = {}) {
        const response = context ? await context.request.post(`${base}/api/dudu/${action}`, { data: body })
          : await fetch(`${base}/api/dudu/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
        const ok = context ? response.ok() : response.ok;
        if (!ok) throw new Error(`${action}: HTTP ${context ? response.status() : response.status}`);
        return response.json();
      },
      /** A new page, on the 嘟嘟 panel. `views` is what the page remembers of its display options (per tab), set before it loads. */
      async openPanel({ views, viewport: size, selectPanel = true } = {}) {
        if (!context) throw new Error('Use the authorized external browser for this review.');
        const page = await context.newPage();
        if (size) await page.setViewportSize(size);
        // The browser keeps the display options per origin, so a test starts from what it names (nothing, by default): once per tab,
        // so that a reload inside a test still finds what the page remembered.
        await page.addInitScript((value) => {
          try {
            if (sessionStorage.getItem('dudu-e2e-views')) return;
            sessionStorage.setItem('dudu-e2e-views', '1');
            localStorage.setItem('dudu.issues.views.v1', value);
          } catch { /* not remembered */ }
        }, JSON.stringify(views ?? {}));
        pages.add(page);
        page.once('close', () => pages.delete(page));
        await page.goto(`${base}/`);
        if (selectPanel) await page.getByRole('button', { name: 'Dudu' }).first().click({ timeout: 60_000 });
        return page;
      },
      /** After a failed test: a picture of every page still open (in .local/e2e-failures, or DUDU_E2E_SHOTS), then close them all. */
      async settle(name, failed) {
        if (failed) {
          const dir = process.env.DUDU_E2E_SHOTS ?? join(root, '.local', 'e2e-failures');
          await mkdir(dir, { recursive: true });
          let index = 0;
          for (const page of pages) await page.screenshot({ path: join(dir, `${name.replace(/[^\w]+/g, '-').slice(0, 60)}-${index++}.png`) }).catch(() => {});
        }
        for (const page of [...pages]) await page.close().catch(() => {});
      },
      stop,
    };
    await first?.close();
    return dudu;
  } catch (error) {
    await stop();
    throw error;
  }
}
