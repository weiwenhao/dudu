// DSH's real composer -> attachment store -> plugin -> OAR -> real Codex. Only the Responses model is scripted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, test } from 'node:test';
import { startDudu } from './harness.mjs';

let dudu: Awaited<ReturnType<typeof startDudu>>;
before(async () => {
  dudu = await startDudu({ model: { nativeCodex: true, replies: [{ say: '{"changes":[]}' }] } });
});
after(async () => { await dudu?.stop(); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

test('a native DSH image-only message reaches real Codex and survives reload', async () => {
  const added = await dudu.api('issues/add', { fields: {
    title: 'Native image check', brief: 'Reply with the given marker.', agent: 'codex',
    project: { name: 'Images', path: dudu.folder },
  } });
  assert.equal(added.outcome, 'success', JSON.stringify(added));
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: 'Native image check', exact: true }).click();
  await page.getByRole('button', { name: 'Open session', exact: true }).click();
  await page.getByText('MODEL_READY', { exact: true }).waitFor({ timeout: 60_000 });
  const png = await readFile(new URL('../../host/dudu-plugin/ui/pet/pet.png', import.meta.url));
  await page.locator('input[type="file"]').setInputFiles({ name: 'native-image.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Remove image native-image.png', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('MODEL_RECEIVED_IMAGE', { exact: true }).waitFor({ timeout: 60_000 });
  const request = dudu.model.requests.filter((entry: any) => entry.api === 'responses').at(-1);
  assert.ok(request?.images.some((image: string) => image.startsWith('data:image/png;base64,')));
  assert.equal(await page.getByText('MODEL_RECEIVED_IMAGE', { exact: true }).count(), 1);
  const sessionId = (await dudu.api('issues/get', { id: added.issue.id })).issue.session.slice(4);
  const before = await dudu.api('sessions/list', { query: sessionId });
  assert.equal(before.sessions.length, 1, dudu.diagnostics());
  await page.reload();
  await page.getByRole('tree', { name: 'Sessions' }).getByText(/Native image check/).click();
  await page.getByText('MODEL_RECEIVED_IMAGE', { exact: true }).waitFor({ timeout: 30_000 });
});
