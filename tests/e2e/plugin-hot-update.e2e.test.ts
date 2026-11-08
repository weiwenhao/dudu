// Install a changed package through the real CLI and request profile HMR using the same helper as desktop:update.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { promisify } from 'node:util';
import { desktopPackageIdentity, waitForDesktopRuntime } from '../../host/desktop-runtime.mjs';
import { requestDesktopReload } from '../../scripts/update-desktop.mjs';
import { startDudu } from './harness.mjs';

const run = promisify(execFile);
let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => { dudu = await startDudu({ model: true }); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });
after(async () => { await dudu?.stop(); });

test('backend and client update together without restarting DSH, reloading the page or losing saved work', { timeout: 120_000 }, async () => {
  const page = await dudu.openPanel();
  try {
    await page.getByRole('region', { name: 'Issues', exact: true }).waitFor();
    const chat = async (text: string) => {
      await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
      const replies = await dialog.getByText('ok', { exact: true }).count();
      await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
      await dialog.getByRole('button', { name: 'Send', exact: true }).click();
      await dialog.getByText('ok', { exact: true }).nth(replies).waitFor({ timeout: 20_000 });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    };
    await chat('Before plugin update');
    const sessionId = (await dudu.api('assistant/state')).conversation.sessionId;
    const { issue } = await dudu.api('issues/add', { fields: { title: 'Preserved through hot reload' } });
    await page.getByRole('button', { name: issue.title, exact: true }).waitFor();
    const layout = (await dudu.api('dashboard/get')).layout;
    await page.evaluate(() => { window.__hotUpdateDocument = 'same document'; });
    const runtimeFile = join(dudu.home, 'dudu', 'runtime.json');
    const previous = JSON.parse(await readFile(runtimeFile, 'utf8'));
    const staged = join(dudu.folder, 'hot-update');
    await mkdir(staged);
    await run('tar', ['-xzf', dudu.packageArchive, '-C', staged]);
    const source = join(staged, 'package');
    const entry = join(source, 'index.mjs');
    const code = await readFile(entry, 'utf8');
    const signature = 'export async function apply(ctx, config = {}) {';
    assert.equal(code.split(signature).length, 2);
    await writeFile(entry, code.replace(signature, `${signature}
      ctx.effect(() => ctx.connection.fetch.register({
        path: '/api/dudu-hot-update-probe', methods: ['POST'],
        fetch: () => Response.json({ revision: 'two' }),
      }));
    `));
    const client = join(source, 'dist', 'client.js');
    await writeFile(client, await readFile(client, 'utf8') + '\nwindow.__duduHotUpdate = "two";\n');
    const expected = await desktopPackageIdentity(source);
    assert.notEqual(previous.fingerprint, expected.fingerprint);
    const archive = join(dudu.folder, `dudu-${expected.fingerprint}.tgz`);
    await run('tar', ['-czf', archive, '-C', staged, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const after = Date.now();
    await dudu.installPlugin(archive);
    await requestDesktopReload(join(dudu.home, 'profiles', 'web'), expected.fingerprint);
    const runtime = await waitForDesktopRuntime({
      folder: join(dudu.home, 'dudu'), expected, after, timeoutMs: 30_000,
      probe: async () => {
        try {
          const response = await dudu.context.request.post(`${dudu.base}/api/dudu-hot-update-probe`);
          return response.ok() && (await response.json()).revision === 'two';
        } catch { return false; }
      },
    });
    if (!runtime) {
      const observed = JSON.parse(await readFile(runtimeFile, 'utf8'));
      const installed = await desktopPackageIdentity(join(dudu.home, 'profiles', 'web', 'node_modules', 'dudu'));
      const response = await dudu.context.request.post(`${dudu.base}/api/dudu-hot-update-probe`);
      assert.fail(`hot reload: ${JSON.stringify({ expected, observed, installed, probe: { status: response.status(), body: await response.text() } })}\n${dudu.diagnostics()}`);
    }
    assert.equal(runtime.pid, previous.pid, 'the DSH backend process was not restarted');
    await page.waitForFunction(() => window.__duduHotUpdate === 'two', undefined, { timeout: 20_000 });
    assert.equal(await page.evaluate(() => window.__hotUpdateDocument), 'same document', 'the browser document was not reloaded');
    assert.deepEqual((await dudu.api('dashboard/get')).layout, layout);
    assert.equal((await dudu.api('issues/get', { id: issue.id })).issue.title, issue.title);
    await page.getByRole('region', { name: 'Issues', exact: true }).getByText(issue.title, { exact: true }).waitFor();
    const requestsBefore = dudu.model.requests.length;
    await chat('After plugin update');
    assert.equal((await dudu.api('assistant/state')).conversation.sessionId, sessionId);
    assert.ok(dudu.model.requests.slice(requestsBefore).some((request: any) => request.prompt.includes('After plugin update')),
      'the restored session accepted the prompt and delivered it to the model after hot reload');
  } finally { await page.close(); }
});
