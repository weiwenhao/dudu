// End-to-end harness: the real plugin package, installed into a real `dsh web` that runs on its own DSH_HOME and its own
// HOME, driven by a real Chrome through Playwright. Nothing here touches the owner's DSH (~/.dsh, port 3170) or Desktop.
//
//   const dudu = await startDudu();            // package, install, start, log in
//   const page = await dudu.openPanel();       // a fresh page on the 嘟嘟 panel
//   await dudu.api('issues/add', { fields });  // the plugin's own HTTP API, as the logged-in page would call it
//   await dudu.stop();                         // browser, DSH and the temporary home are gone
//
// The URL `dsh web` prints carries a login token: it is read from the process in memory, never printed or written down.
import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTUP_MS = 90_000;

/** The packaged plugin of this checkout (built fresh unless DUDU_E2E_TGZ names one that already is). */
async function packagedPlugin() {
  if (process.env.DUDU_E2E_TGZ) return process.env.DUDU_E2E_TGZ;
  const { version } = JSON.parse(await readFile(join(root, 'host', 'dudu-plugin', 'package.json'), 'utf8'));
  await run('node', [join(root, 'scripts', 'package-desktop.mjs')], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return join(root, '.local', 'release', `dudu-${version}.tgz`);
}

async function waitForUrl(child, output) {
  const started = Date.now();
  while (Date.now() - started < STARTUP_MS) {
    const found = /https?:\/\/127\.0\.0\.1:\d+\/?\S*/.exec(output.text);
    if (found) return new URL(found[0]);
    if (child.exitCode !== null) throw new Error(`dsh web exited early (code ${child.exitCode}).`);
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('dsh web did not print its address in time.');
}

export async function startDudu({ colorScheme = 'light', viewport = { width: 1440, height: 900 }, patch = '' } = {}) {
  const tgz = await packagedPlugin();
  const folder = await mkdtemp(join(tmpdir(), 'dudu-e2e-'));
  const home = join(folder, 'dsh');
  const user = join(folder, 'user'); // HOME of DSH and the plugin: no real Claude or Codex sessions, no real config to read
  await mkdir(user, { recursive: true });
  const env = {
    PATH: process.env.PATH, HOME: user, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG ?? 'en_US.UTF-8',
    DSH_HOME: home, DUDU_ALLOW_TEMP_HOME: '1', NO_COLOR: '1', ...(process.env.DUDU_E2E_ENV ? JSON.parse(process.env.DUDU_E2E_ENV) : {}),
  };
  const state = { folder, child: null, browser: null, stopped: false };
  const stop = async () => {
    if (state.stopped) return;
    state.stopped = true;
    await state.browser?.close().catch(() => {});
    if (state.child && state.child.exitCode === null) {
      state.child.kill('SIGTERM');
      await new Promise((done) => { const timer = setTimeout(() => { state.child.kill('SIGKILL'); done(); }, 10_000); state.child.once('exit', () => { clearTimeout(timer); done(); }); });
    }
    await rm(folder, { recursive: true, force: true });
  };
  process.once('exit', () => { state.child?.kill('SIGKILL'); });
  try {
    // A copy under a name of its own: the package manager keys `file:` installs by path.
    const archive = join(folder, `dudu-e2e-${process.pid}-${Date.now()}.tgz`);
    await copyFile(tgz, archive);
    await run('dsh', ['plugin', '--profile', 'web', 'add', `file:${archive}`], { env, cwd: folder, maxBuffer: 16 * 1024 * 1024 });
    // The phone port is not bound in the web runtime, but a fixed one must never be asked for; the notice is the first-run modal.
    await writeFile(join(home, 'profiles', 'web', 'cordis.patch.yml'), [
      '- id: dudu', '  config:', '    port: 0',
      '- id: ui-settings-general', '  name: "@deepseek-ai/dsh-client-ui-settings-general"', '  config:', '    welcomeNoticeVersion: 2026-09-28.1', patch,
    ].join('\n') + '\n');

    const output = { text: '' };
    state.child = spawn('dsh', ['web', '--host', '127.0.0.1', '--no-open', '--port', '0'], { env, cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [state.child.stdout, state.child.stderr]) stream.on('data', (chunk) => { output.text += chunk; });
    const login = await waitForUrl(state.child, output);
    const base = login.origin;

    state.browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await state.browser.newContext({ viewport, colorScheme, locale: 'en-US' });
    const first = await context.newPage();
    await first.goto(login.href);
    await first.waitForLoadState('domcontentloaded');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });

    const pages = new Set();
    const dudu = {
      base, context, folder, home, viewport,
      /** POST to the plugin as the logged-in browser does; the answer is the JSON the page would get. */
      async api(action, body = {}) {
        const response = await context.request.post(`${base}/api/dudu/${action}`, { data: body });
        if (!response.ok()) throw new Error(`${action}: HTTP ${response.status()}`);
        return response.json();
      },
      /** A new page, on the 嘟嘟 panel. `views` is what the page remembers of its display options (per tab), set before it loads. */
      async openPanel({ views, viewport: size } = {}) {
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
        await page.getByRole('button', { name: '嘟嘟' }).first().click({ timeout: 60_000 });
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
    await first.close();
    return dudu;
  } catch (error) {
    await stop();
    throw error;
  }
}
