// Native OAR and the actual installed Claude CLI, in an isolated home; only the model is scripted.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeRuntime } from '@dudu/oar-adapter';
import { startMockModel } from './e2e/mock-model.mjs';

test('OAR inherits native Auto and saved effort rather than bypassing permissions', { timeout: 60000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'dudu-native-permissions-'));
  let model: Awaited<ReturnType<typeof startMockModel>> | undefined;
  let session: Awaited<ReturnType<typeof claudeRuntime.session>> | undefined;
  let stop: (() => void) | undefined;
  t.after(async () => {
    stop?.();
    // The live CLI still writes registry files here. Release it before removing
    // its home; an early cleanup error must not skip the remaining resources.
    try { await session?.dispose(); }
    finally {
      try { await model?.stop(); }
      finally { await rm(home, { recursive: true, force: true }); }
    }
  });
  await mkdir(join(home, '.claude'));
  await writeFile(join(home, '.claude/settings.json'), JSON.stringify({
    model: 'sonnet', effortLevel: 'xhigh', permissions: { defaultMode: 'auto' },
  }));
  model = await startMockModel({ anthropicReplies: [{ say: 'PERMISSION_READBACK' }] });
  const env = {
    HOME: home, ANTHROPIC_API_KEY: 'dudu-e2e-key', ANTHROPIC_BASE_URL: model.url.replace(/\/v1$/, ''),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
  };
  const installation = await claudeRuntime.installation();
  assert.equal(installation.kind, 'available');
  const configured = await claudeRuntime.configuration(installation as any, { cwd: home, env });
  assert.equal(configured.model, 'sonnet');
  assert.equal(configured.effort, 'xhigh');
  assert.equal(configured.permissionMode, 'auto');
  const catalog = await claudeRuntime.listModels(installation as any, { cwd: home, env });
  assert.equal(catalog.kind, 'ok');
  if (catalog.kind === 'ok') {
    assert.equal(catalog.models.find(item => item.default)?.id, 'sonnet');
    for (const id of ['sonnet', 'default']) assert.equal(catalog.models.find(item => item.id === id)?.defaultEffort, 'xhigh');
  }
  session = await claudeRuntime.session(installation as any, {
    cwd: home, env, model: configured.model, effort: configured.effort, permissionMode: 'inherit',
  });
  const records: any[] = [];
  const done = Promise.withResolvers<void>();
  stop = session.rawEvents(record => {
    records.push(record);
    if (record.kind === 'frame' && record.body.events.some(event => event.kind === 'turn_ended')) done.resolve();
  });
  const accepted = await session.prompt('Confirm the isolated native launch.');
  assert.equal(accepted.kind, 'accepted');
  await done.promise;
  const init = records.find(record => record.kind === 'frame' && record.body.native?.type === 'system' && record.body.native?.subtype === 'init')?.body.native;
  assert.ok(init, 'native initialization was observed through OAR');
  assert.equal(init.permissionMode, 'auto');
  assert.equal(init.model, 'claude-sonnet-5-5');
  assert.equal(model.requests[0].reasoningEffort, 'xhigh');
});
