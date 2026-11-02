import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startFixture } from './fixture.mjs';

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(async () => { fixture = await startFixture({ handlers: {
  'assistant/conversation': () => ({ outcome: 'success', sessionId: 'dudu-assistant-fixture', cursor: 0 }),
} }); });
after(async () => { await fixture?.stop(); });

test('voice controls follow the shared DSH speech provider readiness and never fall back to browser recognition', async () => {
  const page = await fixture.open();
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dudu', exact: true });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => typeof (window as any).webkitSpeechRecognition), 'function', 'Chrome provides its own speech recognition; dudu must still follow the host');
  assert.equal(await dialog.getByRole('button', { name: 'Voice input', exact: true }).count(), 0);
  fixture.speech.catalog = {
    selection: { providerId: 'shared', language: 'zh' }, maxDurationSeconds: 30, maxAudioBytes: 960044,
    providers: [{ id: 'shared', preparation: { phase: 'ready' } }],
  };
  await dialog.getByRole('button', { name: 'Voice input', exact: true }).waitFor({ timeout: 6000 });
  fixture.speech.catalog = null;
  await dialog.getByRole('button', { name: 'Voice input', exact: true }).waitFor({ state: 'hidden', timeout: 6000 });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.getByText('Hold Space to speak', { exact: true }).count(), 0);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.down('Space');
  await page.waitForTimeout(650);
  await page.keyboard.up('Space');
  assert.equal(await page.getByText('Release to send · Esc to cancel', { exact: true }).count(), 0);
  await page.close();
});
