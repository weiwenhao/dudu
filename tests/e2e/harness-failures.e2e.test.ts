// Real DSH and Codex must retain harness failure codes in both the transcript and the visible error row.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startDudu } from './harness.mjs';

let folder: string;
let dudu: Awaited<ReturnType<typeof startDudu>>;

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dudu-harness-failures-'));
  const probe = join(folder, 'probe');
  await mkdir(probe);
  await writeFile(join(probe, 'package.json'), JSON.stringify({
    name: 'dudu-failure-probe', version: '1.0.0', type: 'module', main: 'index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }));
  await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - id: dudu-failure-probe\n      name: dudu-failure-probe\n');
  await writeFile(join(probe, 'index.mjs'), `
import { readSessionHistory } from ${JSON.stringify(new URL('../../host/dudu-plugin/dist/dsh-session-history.mjs', import.meta.url).href)};
export const name = 'dudu-failure-probe';
export const inject = ['connection', 'sessionController', 'sessionQuery', 'workspaceRegistry', 'agents', 'commands'];
export function apply(ctx) {
  const compactions = new Map();
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dudu-failure-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const { action, sessionId, cwd, prompt, provider = 'codex' } = await request.json();
        if (action === 'create') {
          const workspace = await ctx.workspaceRegistry.create(cwd);
          const created = await ctx.sessionController.create({ workspaceId: workspace.id });
          const catalog = await ctx.sessionController.modelCatalog();
          const model = catalog.groups.find(group => group.id === provider)?.models[0]?.id;
          if (!model) throw new Error(provider + ' is not available in the isolated model catalog.');
          await ctx.sessionController.selectModel({ sessionId: created.sessionId, provider, model });
          return Response.json(created);
        }
        if (action === 'prompt') {
          await ctx.sessionController.prompt({
            requestId: crypto.randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: prompt }],
          }, new AbortController().signal);
          return Response.json({ ok: true });
        }
        if (action === 'compact') {
          const { agent } = await ctx.sessionController.resolveAgent(sessionId);
          const controller = new AbortController();
          if (!compactions.has(sessionId)) compactions.set(sessionId, new Set());
          const pending = compactions.get(sessionId);
          pending.add(controller);
          try { return Response.json(await ctx.commands.execute(agent, '/compact', [], controller.signal)); }
          finally { pending.delete(controller); if (!pending.size) compactions.delete(sessionId); }
        }
        if (action === 'cancelCompact') {
          for (const controller of compactions.get(sessionId) ?? []) controller.abort();
          return Response.json({ ok: true });
        }
        if (action === 'selectMock') {
          await ctx.sessionController.selectModel({ sessionId, provider: 'mock', model: 'mock-1' });
          return Response.json({ ok: true });
        }
        return Response.json(await readSessionHistory({ controller: ctx.sessionController, query: ctx.sessionQuery }, sessionId));
      } catch (error) {
        return Response.json({ error: error.message, code: error.code, name: error.name }, { status: 500 });
      }
    },
  }));
}
`);
  dudu = await startDudu({ plugins: [probe], model: { nativeCodex: true, nativeClaude: true } });
});
after(async () => {
  await dudu?.stop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
afterEach(async context => { await dudu.settle(context.name, context.passed === false); });

async function probe(body: Record<string, unknown>, allowAbort = false) {
  const response = await dudu.context.request.post(`${dudu.base}/api/dudu-failure-probe`, { data: body });
  if (allowAbort && response.status() === 500 && (await response.json()).name === 'AbortError') return { cancelled: true };
  assert.equal(response.ok(), true, `probe returned ${response.status()}: ${(await response.text()).slice(0, 1000)}`);
  return response.json();
}

async function ended(sessionId: string, turn: number) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { events } = await probe({ sessionId });
    const end = events.findLast((event: any) => event.type === 'turn/end' && event.data.turn === turn);
    if (end) return end.data.reason;
    await delay(100);
  }
  assert.fail(`turn ${turn} did not finish`);
}

async function commandDone(sessionId: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { events } = await probe({ sessionId });
    const done = events.findLast((event: any) => event.type === 'command/done');
    if (done) {
      const { commandId, ...result } = done.data;
      return { commandId, result };
    }
    await delay(100);
  }
  assert.fail('the native compact command did not settle');
}

test('an empty harness session has no native history to compact and does not prompt a model', async () => {
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder });
  const calls = dudu.model!.requests.length;
  const execution = await probe({ action: 'compact', sessionId });
  assert.deepEqual(execution.result, {
    kind: 'success', text: 'No compactable history yet.',
  });
  const { events } = await probe({ sessionId });
  assert.equal(events.filter((event: any) => event.type === 'command/run').length, 1);
  const done = events.filter((event: any) => event.type === 'command/done');
  assert.equal(done.length, 1);
  assert.equal(done[0].data.commandId, execution.commandId);
  assert.equal(done[0].data.kind, 'success');
  assert.equal(events.filter((event: any) => event.type.startsWith('compaction/') || ['turn/start', 'user/message'].includes(event.type)).length, 0);
  assert.equal(dudu.model!.requests.length, calls);
  await probe({ action: 'selectMock', sessionId });
  const builtin = await probe({ action: 'compact', sessionId });
  assert.equal(builtin.result.kind, 'success', 'the native guard does not replace compaction for DSH model providers');
});

function replies(provider: string, next: any[]) {
  if (provider === 'codex') dudu.model!.responseReplies = next;
  else dudu.model!.anthropicReplies = next;
}

async function nativeTranscript(provider: string, nativeId: string) {
  const root = join(dudu.folder, 'user', provider === 'codex' ? '.codex/sessions' : '.claude/projects');
  const files = await readdir(root, { recursive: true });
  const source = files.find(file => file.endsWith(`${nativeId}.jsonl`));
  assert.ok(source, `the real ${provider} transcript was saved`);
  return (await readFile(join(root, source), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}

for (const provider of ['codex', 'claude']) test(`manual ${provider} compaction waits for the native result and resumes the same compacted session`, async context => {
  replies(provider, [{ say: `OLD_RESPONSE_${provider}` }]);
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder, provider });
  await probe({ action: 'prompt', sessionId, prompt: `ORIGINAL_TASK_${provider}` });
  assert.equal((await ended(sessionId, 1)).kind, 'completed');
  const { events: before } = await probe({ sessionId });
  const nativeId = before.findLast((event: any) => event.type === 'assistant/message')?.data.message.source.replayState.nativeSessionId;
  assert.ok(nativeId);
  const page = await dudu.openPanel({ selectPanel: false });
  context.after(() => page.close());
  const tree = page.getByRole('tree', { name: 'Sessions' });
  const workspace = tree.getByRole('treeitem').filter({ has: page.getByText(basename(dudu.folder), { exact: true }) });
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${sessionId}"]`).click();
  await page.getByText(`OLD_RESPONSE_${provider}`, { exact: true }).waitFor();
  const release = Promise.withResolvers<void>();
  const summary = `DUDU_COMPACTED_CONTEXT_${provider}`;
  replies(provider, [{ say: summary, waitFor: release.promise }]);
  const calls = dudu.model!.requests.length;
  await page.locator('[contenteditable="true"][role="textbox"]').fill('/compact');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const compacting = commandDone(sessionId);
  compacting.catch(() => {});
  try {
    const deadline = Date.now() + 20_000;
    while (dudu.model!.requests.length === calls && Date.now() < deadline) await delay(100);
    assert.ok(dudu.model!.requests.length > calls, 'native compaction really called the isolated model');
    const { events: during } = await probe({ sessionId });
    const command = during.findLast((event: any) => event.type === 'command/run');
    assert.ok(command);
    assert.equal(during.some((event: any) => event.type === 'command/done' && event.data.commandId === command.data.commandId), false, 'acknowledgement is not reported as completed');
    await page.getByText('Compacting context…', { exact: true }).waitFor();
    release.resolve();
    const execution = await compacting;
    assert.deepEqual(execution.result, { kind: 'success' });
    await page.getByText('Compacting context…', { exact: true }).waitFor({ state: 'detached' });
    // DSH binds a manual command to its requesting page; reloading during it cancels that request.
    // Reopen after completion to verify its durable result, then resume the same native session.
    await page.reload();
    await workspace.waitFor();
    if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
    await tree.locator(`[data-row-key="session:${sessionId}"]`).click();
    await page.getByText(`OLD_RESPONSE_${provider}`, { exact: true }).waitFor();
    const { events } = await probe({ sessionId });
    assert.equal(events.filter((event: any) => event.type === 'command/run').length, 1, 'manual compaction has one command row');
    const done = events.filter((event: any) => event.type === 'command/done');
    assert.equal(done.length, 1);
    assert.equal(done[0].data.kind, 'success');
    assert.equal(done[0].data.commandId, execution.commandId);
    assert.deepEqual(events.filter((event: any) => event.type === 'user/message'), before.filter((event: any) => event.type === 'user/message'), 'the command adds no boss message or runtime context');
    assert.equal(events.filter((event: any) => event.type === 'compaction/summary').length, 0, 'native compaction does not replace the DSH mirror');
    const transcript = await nativeTranscript(provider, nativeId);
    assert.ok(transcript.some(record => provider === 'codex' ? record.type === 'compacted' : record.type === 'system' && record.subtype === 'compact_boundary'), 'the native history contains a real compaction receipt');
    replies(provider, [{ say: `AFTER_MANUAL_COMPACTION_${provider}` }]);
    await page.locator('[contenteditable="true"][role="textbox"]').fill(`FOLLOWUP_${provider}`);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText(`AFTER_MANUAL_COMPACTION_${provider}`, { exact: true }).waitFor({ timeout: 20_000 });
    assert.equal((await ended(sessionId, 2)).kind, 'completed');
    const request = dudu.model!.requests.filter((entry: any) => entry.api === (provider === 'codex' ? 'responses' : 'anthropic')).at(-1);
    assert.ok(JSON.stringify(request.messages).includes(summary), 'the next turn actually uses the native compacted context');
    const latest = (await probe({ sessionId })).events.findLast((event: any) => event.type === 'assistant/message');
    assert.equal(latest.data.message.source.replayState.nativeSessionId, nativeId);
    assert.equal(await page.getByText(/active writer|No conversation found|UNKNOWN/).count(), 0);
  } finally {
    release.resolve();
    await compacting.catch(() => {});
  }
});

for (const provider of ['codex', 'claude']) test(`manual ${provider} compaction reports failure and cancellation, refuses overlap and releases the session`, async () => {
  replies(provider, [{ say: `HISTORY_${provider}` }]);
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder, provider });
  await probe({ action: 'prompt', sessionId, prompt: 'History for failure and cancellation checks.' });
  assert.equal((await ended(sessionId, 1)).kind, 'completed');
  replies(provider, [{ fail: { status: 400, message: 'DUDU_NATIVE_COMPACT_FAILURE' } }]);
  const failed = await probe({ action: 'compact', sessionId });
  assert.equal(failed.result.kind, 'error', JSON.stringify(failed));
  assert.match(failed.result.text, /DUDU_NATIVE_COMPACT_FAILURE/);
  const release = Promise.withResolvers<void>();
  replies(provider, [{ say: 'Summary after cancellation.', waitFor: release.promise }]);
  const calls = dudu.model!.requests.length;
  const compacting = probe({ action: 'compact', sessionId }, true);
  compacting.catch(() => {});
  try {
    const deadline = Date.now() + 20_000;
    while (dudu.model!.requests.length === calls && Date.now() < deadline) await delay(100);
    assert.ok(dudu.model!.requests.length > calls);
    const activeCalls = dudu.model!.requests.length;
    const busy = await probe({ action: 'compact', sessionId });
    assert.equal(busy.result.kind, 'error');
    assert.match(busy.result.text, /not idle/);
    assert.equal(dudu.model!.requests.length, activeCalls, 'overlapping compaction starts no native operation');
    await probe({ action: 'cancelCompact', sessionId });
    const cancelled = await compacting;
    assert.deepEqual(cancelled, { cancelled: true }, 'the command registry reports request cancellation through its existing transport');
    const { events } = await probe({ sessionId });
    const runs = events.filter((event: any) => event.type === 'command/run');
    assert.equal(runs.length, 3);
    for (const run of runs) {
      const done = events.filter((event: any) => event.type === 'command/done' && event.data.commandId === run.data.commandId);
      assert.equal(done.length, 1);
      assert.equal(done[0].data.kind, 'error');
    }
    assert.equal(events.filter((event: any) => event.type === 'compaction/summary').length, 0);
    replies(provider, [{ say: `RECOVERED_AFTER_COMPACTION_${provider}` }]);
    await probe({ action: 'prompt', sessionId, prompt: 'Continue after cancellation.' });
    assert.equal((await ended(sessionId, 2)).kind, 'completed');
  } finally {
    release.resolve();
    await compacting.catch(() => {});
  }
});

for (const provider of ['codex', 'claude']) test(`manual ${provider} compaction keeps new input queued until the native writer is released`, async () => {
  replies(provider, [{ say: `HISTORY_FOR_QUEUE_${provider}` }]);
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder, provider });
  await probe({ action: 'prompt', sessionId, prompt: 'History for queued input.' });
  assert.equal((await ended(sessionId, 1)).kind, 'completed');
  const release = Promise.withResolvers<void>();
  const summary = `QUEUED_COMPACT_CONTEXT_${provider}`;
  replies(provider, [{ say: summary, waitFor: release.promise }]);
  const calls = dudu.model!.requests.length;
  const compacting = probe({ action: 'compact', sessionId });
  compacting.catch(() => {});
  try {
    const deadline = Date.now() + 20_000;
    while (dudu.model!.requests.length === calls && Date.now() < deadline) await delay(100);
    assert.ok(dudu.model!.requests.length > calls);
    const activeCalls = dudu.model!.requests.length;
    await probe({ action: 'prompt', sessionId, prompt: 'QUEUED_AFTER_COMPACTION' });
    const { events: queued } = await probe({ sessionId });
    assert.equal(queued.filter((event: any) => event.type === 'turn/start').length, 1, 'the next turn has not started');
    assert.equal(dudu.model!.requests.length, activeCalls);
    replies(provider, [{ say: `QUEUED_FOLLOWUP_${provider}` }]);
    release.resolve();
    assert.equal((await compacting).result.kind, 'success');
    assert.equal((await ended(sessionId, 2)).kind, 'completed');
    const request = dudu.model!.requests.filter((entry: any) => entry.api === (provider === 'codex' ? 'responses' : 'anthropic')).at(-1);
    assert.ok(JSON.stringify(request.messages).includes(summary));
    assert.equal(request.prompt.split('QUEUED_AFTER_COMPACTION').length - 1, 1);
  } finally {
    release.resolve();
    await compacting.catch(() => {});
  }
});

for (const stage of ['opening', 'streaming']) test(`a ${stage} harness failure keeps its code and the next message can run`, async context => {
  const cwd = join(dudu.folder, `${stage}-project`);
  await mkdir(cwd);
  const cli = join(dudu.folder, 'codex');
  const provider = (await dudu.api('providers/state')).providers.find((item: any) => item.id === 'codex');
  if (stage === 'opening') {
    context.after(() => dudu.api('providers/save', { id: 'codex', path: '' }));
    // The real executable remains untouched. Remove only this test's alias after OAR has detected it.
    await symlink(provider.path, cli);
    await dudu.api('providers/save', { id: 'codex', path: cli });
  }
  const { sessionId } = await probe({ action: 'create', cwd });
  const prompt = `Fail during ${stage}.`;
  const code = stage === 'opening' ? 'HARNESS_UNAVAILABLE' : 'HARNESS_FAILED';
  if (stage === 'opening') await rm(cli);
  else dudu.model!.responseReplies = [{ when: prompt, fail: { status: 400, message: 'DUDU_MODEL_FAILURE' } }];
  await probe({ action: 'prompt', sessionId, prompt });
  const reason = await ended(sessionId, 1);
  assert.equal(reason.kind, 'error');
  assert.equal(reason.error.code, code);
  assert.match(reason.error.message, stage === 'opening' ? /Could not start ChatGPT/ : /DUDU_MODEL_FAILURE/);

  const page = await dudu.openPanel({ selectPanel: false });
  const tree = page.getByRole('tree', { name: 'Sessions' });
  const workspace = tree.getByRole('treeitem').filter({ has: page.getByText(`${stage}-project`, { exact: true }) });
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${sessionId}"]`).click();
  await page.getByText(code, { exact: true }).waitFor();
  assert.equal(await page.getByText('UNKNOWN', { exact: true }).count(), 0);
  await page.reload();
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${sessionId}"]`).click();
  await page.getByText(code, { exact: true }).waitFor();

  if (stage === 'opening') await symlink(provider.path, cli);
  dudu.model!.responseReplies = [{ say: 'RECOVERED_AFTER_FAILURE' }];
  await page.locator('[contenteditable="true"][role="textbox"]').fill(`Continue after ${stage} failure.`);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('RECOVERED_AFTER_FAILURE', { exact: true }).waitFor({ timeout: 20_000 });
  assert.equal((await ended(sessionId, 2)).kind, 'completed');
  await page.close();
});
