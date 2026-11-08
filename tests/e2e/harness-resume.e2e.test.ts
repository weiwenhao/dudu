// A stopped tool-ended turn in a real DSH must resume its native Codex ID on the next user turn.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { withAppServer } from '../../host/providers/native/codex-store.mjs';
import { scrubbedEnvironment } from '../../host/providers/oar.mjs';
import { buildSessionEvents } from '../../host/providers/native/session-events.mjs';
import { encodeArtifact } from '../../scripts/repair-imported-session.mjs';
import { startDudu } from './harness.mjs';

const timestamp = '2026-11-02T01:00:00.000Z';
const lines = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n';
let folder: string;
let dudu: Awaited<ReturnType<typeof startDudu>>;
const cases = ['aborted', 'error', 'completed'].map((kind, index) => ({
  kind, nativeId: `33333333-cccc-4333-8333-${String(index + 1).padStart(12, '0')}`,
  sessionId: `session-tool-ended-${kind}`, title: `Resume tool-ended ${kind}`,
  original: `Original ${kind} request`, prompt: `Continue after ${kind} restart.`,
}));

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dudu-resume-e2e-'));
  const probe = join(folder, 'probe');
  await mkdir(probe);
  await writeFile(join(probe, 'package.json'), JSON.stringify({
    name: 'dudu-resume-probe', version: '1.0.0', type: 'module', main: 'index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }));
  await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - id: dudu-resume-probe\n      name: dudu-resume-probe\n');
  await writeFile(join(probe, 'index.mjs'), `
import { readSessionHistory } from ${JSON.stringify(new URL('../../host/dudu-plugin/dist/dsh-session-history.mjs', import.meta.url).href)};
export const name = 'dudu-resume-probe';
export const inject = ['connection', 'sessionController', 'sessionQuery', 'workspaceRegistry', 'agents', 'sessionProjections'];
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dudu-resume-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const { sessionId, attach } = await request.json();
      const inspected = await readSessionHistory({ controller: ctx.sessionController, query: ctx.sessionQuery }, sessionId);
      if (attach) {
        const workspace = await ctx.workspaceRegistry.create(inspected.meta.cwd);
        await workspace.attachSession(sessionId);
      }
      const agent = ctx.agents.get(sessionId);
      return Response.json({
        events: inspected.events, options: agent?.options,
        tools: agent?.ctx.tools.schemas(agent).map(tool => tool.name),
        permissions: agent && ctx.sessionProjections.stateOf(agent.session, 'permissions'),
      });
    },
  }));
}
`);
  const files: Record<string, Buffer | string> = {};
  for (const item of cases) {
    const history = {
      id: item.nativeId, cwd: folder, title: item.title, createdAt: Date.parse(timestamp),
      turns: [{ prompt: item.original, at: Date.parse(timestamp),
        steps: [{ blocks: [
          { type: 'text', text: `Before ${item.kind} restart.` },
          { type: 'tool-call', id: 'old-call', name: 'shell', arguments: JSON.stringify({ command: 'printf fixture', cwd: folder }) },
        ] }], results: new Map([['old-call', { output: 'fixture', isError: false }]]) }],
    };
    const { header, events } = buildSessionEvents({ history, route: 'codex', model: 'default', sessionId: item.sessionId });
    events.at(-1)!.data.reason = item.kind === 'aborted' ? { kind: 'aborted', reason: { kind: 'disposed' } }
      : item.kind === 'error' ? { kind: 'error', error: { message: 'Fixture stopped.', code: 'UNKNOWN' } }
      : { kind: 'completed' };
    const project = `--${folder.replaceAll('/', '-').replace(/^-+/, '')}--`;
    files[`../dsh/sessions/${project}/${item.sessionId}/session.v4.jsonl.zstd`] = encodeArtifact([{ type: 'session', ...header }, ...events], true);
    files[`.codex/sessions/2026/11/02/rollout-2026-11-02T01-00-00-${item.nativeId}.jsonl`] = lines([
      { timestamp, type: 'session_meta', payload: {
        id: item.nativeId, timestamp, cwd: folder, originator: 'codex_cli_rs', cli_version: '0.162.1',
        source: 'cli', model_provider: 'dudu_e2e', base_instructions: { text: '' },
      } },
      { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'old-turn', model_context_window: 100000, collaboration_mode_kind: 'default' } },
      { timestamp, type: 'event_msg', payload: { type: 'user_message', message: item.original, images: [], local_images: [], text_elements: [] } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: item.original }] } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Before ${item.kind} restart.` }] } },
      { timestamp, type: 'response_item', payload: { type: 'function_call', call_id: 'old-call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'printf fixture' }) } },
      { timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id: 'old-call', output: 'fixture' } },
      { timestamp, type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 'old-turn', reason: 'interrupted' } },
    ]);
  }
  dudu = await startDudu({ plugins: [probe], files, model: { nativeCodex: true } });
  const user = join(dudu.folder, 'user');
  // Register only synthetic histories in the isolated Codex DB; no prompt is sent here.
  await withAppServer({ command: 'codex', env: {
    ...scrubbedEnvironment([/^(CODEX_|ORCA_|HERDR_)/]), HOME: user, CODEX_HOME: join(user, '.codex'),
  } }, async (request) => {
    for (const item of cases) await request('thread/resume', { threadId: item.nativeId, cwd: folder });
  });
  for (const item of cases) {
    const response = await dudu.context.request.post(`${dudu.base}/api/dudu-resume-probe`, { data: { sessionId: item.sessionId, attach: true } });
    assert.equal(response.ok(), true);
  }
});
after(async () => { await dudu?.stop(); if (folder) await rm(folder, { recursive: true, force: true }); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

for (const item of cases) test(`a ${item.kind} tool-ended turn accepts a fresh DSH message after restart`, async () => {
  const page = await dudu.openPanel({ selectPanel: false });
  const tree = page.getByRole('tree', { name: 'Sessions' });
  const workspace = tree.getByRole('treeitem').filter({ has: page.getByText(basename(folder), { exact: true }) });
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${item.sessionId}"]`).click();
  await page.getByText(item.original, { exact: true }).waitFor();
  await page.locator('[contenteditable="true"][role="textbox"]').fill(item.prompt);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('MODEL_READY', { exact: true }).waitFor({ timeout: 20_000 });
  const request = dudu.model!.requests.filter((entry: any) => entry.api === 'responses').at(-1);
  assert.equal(request.prompt.split(item.prompt).length - 1, 1, 'the new prompt reaches Codex once');
  assert.equal(request.prompt.split(item.original).length - 1, 1, 'the previous task is history, not resent input');
  let events: any[] = [];
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await dudu.context.request.post(`${dudu.base}/api/dudu-resume-probe`, { data: { sessionId: item.sessionId } });
    assert.equal(response.ok(), true);
    ({ events } = await response.json());
    if (events.some((event: any) => event.type === 'turn/end' && event.data.turn === 2)) break;
    await delay(100);
  }
  assert.equal(events.filter((event: any) => event.type === 'turn/start').length, 2);
  assert.ok(events.some((event: any) => event.type === 'turn/end' && event.data.turn === 2), 'the new turn reaches a durable end');
  assert.equal(events.findLast((event: any) => event.type === 'turn/end').data.reason.kind, 'completed');
  const reply = events.findLast((event: any) => event.type === 'assistant/message');
  assert.equal(reply.data.message.source.replayState.nativeSessionId, item.nativeId);
  await dudu.restart();
  await page.reload();
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${item.sessionId}"]`).click();
  await page.getByText('MODEL_READY', { exact: true }).waitFor();
  assert.equal(await page.getByText(item.prompt, { exact: true }).count(), 1);
});

for (const tool of ['shell', 'apply_patch']) test(`a restored Codex session records the actual native ${tool} result instead of an unknown tool error`, async () => {
  const item = cases[0];
  const prompt = `Run the native ${tool} mirror regression.`;
  const answer = `MIRROR_${tool.toUpperCase()}_RESULT_RECEIVED`;
  const changedFile = join(folder, 'native-mirror.txt');
  dudu.model!.responseReplies = [{
    when: prompt, say: answer,
    calls: [tool === 'shell'
      ? { name: 'exec_command', arguments: { cmd: 'printf NATIVE_MIRROR_OK', max_output_tokens: 100 } }
      : { name: 'apply_patch', input: `*** Begin Patch\n*** Add File: ${changedFile}\n+NATIVE_MIRROR_PATCH_OK\n*** End Patch` }],
  }];
  await dudu.restart();
  const page = await dudu.openPanel({ selectPanel: false });
  const tree = page.getByRole('tree', { name: 'Sessions' });
  const workspace = tree.getByRole('treeitem').filter({ has: page.getByText(basename(folder), { exact: true }) });
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${item.sessionId}"]`).click();
  await page.locator('[contenteditable="true"][role="textbox"]').fill(prompt);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText(answer, { exact: true }).waitFor({ timeout: 20_000 });
  const response = await dudu.context.request.post(`${dudu.base}/api/dudu-resume-probe`, { data: { sessionId: item.sessionId } });
  const inspected = await response.json();
  const current = inspected.events.slice(inspected.events.findLastIndex((event: any) => event.type === 'turn/start'));
  const call = current.find((event: any) => event.type === 'tool/call');
  const result = current.find((event: any) => event.type === 'tool/result' && event.data.message.toolCallId === call?.data.callId);
  assert.equal(call?.data.name, tool, JSON.stringify({
    current: current.filter((event: any) => ['tool/call', 'tool/result', 'assistant/message'].includes(event.type)),
    permissions: inspected.permissions,
    native: dudu.model!.requests.filter((entry: any) => entry.api === 'responses').slice(-2).map((entry: any) => ({ tools: entry.tools, toolResults: entry.toolResults, filesystem: entry.prompt.match(/<filesystem>[\s\S]*?<\/filesystem>/)?.[0] })),
  }));
  assert.ok(result, 'the mirror has a durable result');
  assert.equal(result.data.message.isError, false, JSON.stringify({ result, options: inspected.options, tools: inspected.tools }));
  if (tool === 'shell') {
    assert.ok(result.data.message.content.some((part: any) => part.type === 'text' && part.text.includes('NATIVE_MIRROR_OK')));
    assert.equal(result.data.meta.data.exitCode, 0);
  } else {
    assert.equal(await readFile(changedFile, 'utf8'), 'NATIVE_MIRROR_PATCH_OK\n');
    assert.equal(result.data.meta.data.changes.length, 1);
    assert.equal(result.data.meta.data.changes[0].path, changedFile);
  }
  assert.ok(inspected.tools.includes('shell') && inspected.tools.includes('apply_patch'));
  await page.reload();
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${item.sessionId}"]`).click();
  await page.getByText(answer, { exact: true }).waitFor();
  assert.equal(await page.getByText(`Error: unknown tool "${tool}"`, { exact: true }).count(), 0);
  await page.close();
});

for (const waiting of ['model', 'tool']) test(`stopping during a native ${waiting} wait releases the turn before the next message`, async () => {
  const item = cases[0];
  const prompt = `Stop during ${waiting} wait.`;
  const next = `Fresh instruction after ${waiting} stop.`;
  const answer = `FRESH_${waiting.toUpperCase()}_ANSWER`;
  dudu.model!.responseReplies = [
    { when: next, say: answer },
    { when: prompt, ...(waiting === 'model' ? { delay: 30_000 } : {
      calls: [{ name: 'exec_command', arguments: { cmd: 'sleep 30', yield_time_ms: 30_000, max_output_tokens: 100 } }],
    }) },
  ];
  const page = await dudu.openPanel({ selectPanel: false });
  const tree = page.getByRole('tree', { name: 'Sessions' });
  const workspace = tree.getByRole('treeitem').filter({ has: page.getByText(basename(folder), { exact: true }) });
  await workspace.waitFor();
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
  await tree.locator(`[data-row-key="session:${item.sessionId}"]`).click();
  const editor = page.locator('[contenteditable="true"][role="textbox"]');
  const source = join(dudu.folder, 'user', '.codex', 'sessions', '2026', '11', '02', `rollout-2026-11-02T01-00-00-${item.nativeId}.jsonl`);
  const readNative = async () => (await readFile(source, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const abortedBefore = (await readNative()).filter(row => row.payload?.type === 'turn_aborted').length;
  const requestsBefore = dudu.model!.requests.filter((entry: any) => entry.api === 'responses').length;
  await editor.fill(prompt);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const started = Date.now() + 15_000;
  let toolStarted = false;
  while (Date.now() < started) {
    if (waiting === 'model' && dudu.model!.requests.filter((entry: any) => entry.api === 'responses').length > requestsBefore) break;
    if (waiting === 'tool') {
      const response = await dudu.context.request.post(`${dudu.base}/api/dudu-resume-probe`, { data: { sessionId: item.sessionId } });
      const { events } = await response.json();
      const current = events.slice(events.findLastIndex((event: any) => event.type === 'turn/start'));
      toolStarted = current.some((event: any) => event.type === 'tool/call');
      if (toolStarted) break;
    }
    await delay(50);
  }
  assert.ok(dudu.model!.requests.filter((entry: any) => entry.api === 'responses').length > requestsBefore, 'Codex accepted the first instruction');
  if (waiting === 'tool') assert.ok(toolStarted, 'DSH is waiting on a real Codex tool result');
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
  const stopped = Date.now();
  let aborted = false;
  while (Date.now() - stopped < 5000) {
    aborted = (await readNative()).filter(row => row.payload?.type === 'turn_aborted').length > abortedBefore;
    if (aborted) break;
    await delay(50);
  }
  assert.ok(aborted, 'Stop reaches the native turn before a second instruction is sent');
  await editor.fill(next);
  const sent = Date.now();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText(answer, { exact: true }).waitFor({ timeout: 15_000 });
  const request = dudu.model!.requests.filter((entry: any) => entry.api === 'responses').at(-1);
  assert.ok(request.at - sent < 8000, `the fresh instruction reached the model in ${request.at - sent} ms`);
  assert.equal(request.prompt.split(next).length - 1, 1);
  assert.equal(await page.getByText(/already has an active writer/).count(), 0);
  await page.close();
});

test('real Codex compaction uses the native compact row and survives page reload without losing the new instruction', async () => {
  const config = join(dudu.folder, 'user', '.codex', 'config.toml');
  const original = await readFile(config, 'utf8');
  await writeFile(config, 'model_auto_compact_token_limit = 1\ncompact_prompt = "DUDU_NATIVE_COMPACT_REQUEST"\n' + original);
  const compactReply = Promise.withResolvers<void>();
  dudu.model!.responseReplies = [
    { when: 'DUDU_NATIVE_COMPACT_REQUEST', say: 'Native compact summary.', waitFor: compactReply.promise },
    { say: 'AFTER_NATIVE_COMPACTION' },
  ];
  const item = cases[0];
  const page = await dudu.openPanel({ selectPanel: false });
  try {
    const tree = page.getByRole('tree', { name: 'Sessions' });
    const workspace = tree.getByRole('treeitem').filter({ has: page.getByText(basename(folder), { exact: true }) });
    await workspace.waitFor();
    if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
    await tree.locator(`[data-row-key="session:${item.sessionId}"]`).click();
    await page.locator('[contenteditable="true"][role="textbox"]').fill('Instruction pending behind native compaction.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('Compacting context…', { exact: true }).waitFor({ timeout: 15_000 });
    await page.screenshot({ path: '.local/native-cancel-nov02/compaction-running.png' });
    await page.reload();
    await workspace.waitFor();
    if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click();
    await tree.locator(`[data-row-key="session:${item.sessionId}"]`).click();
    await page.getByText('Compacting context…', { exact: true }).waitFor();
    compactReply.resolve();
    await page.getByText('AFTER_NATIVE_COMPACTION', { exact: true }).waitFor({ timeout: 15_000 });
    await page.getByText('Compacting context…', { exact: true }).waitFor({ state: 'detached' });
    const response = await dudu.context.request.post(`${dudu.base}/api/dudu-resume-probe`, { data: { sessionId: item.sessionId } });
    const { events } = await response.json();
    const commands = events.filter((event: any) => event.type === 'command/run' && event.data.source?.kind === 'dudu-harness');
    assert.equal(commands.length, 1);
    assert.equal(commands[0].data.source.nativeSessionId, item.nativeId);
    assert.ok(events.some((event: any) => event.type === 'command/done' && event.data.commandId === commands[0].data.commandId && event.data.kind === 'success'));
    const request = dudu.model!.requests.filter((entry: any) => entry.api === 'responses').at(-1);
    assert.equal(request.prompt.split('Instruction pending behind native compaction.').length - 1, 1);
    assert.equal(events.filter((event: any) => event.type === 'compaction/summary').length, 0, 'native compaction never rewrites the DSH mirror');
    const nextCompaction = Promise.withResolvers<void>();
    dudu.model!.responseReplies = [{ say: 'A summary after stopping.', waitFor: nextCompaction.promise }];
    await page.locator('[contenteditable="true"][role="textbox"]').fill('Stop this native compaction.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    try {
      await page.getByText('Compacting context…', { exact: true }).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
      await page.getByText('Compacting context…', { exact: true }).waitFor({ state: 'detached', timeout: 8000 });
      let afterStop: any[] = [];
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const stopped = await dudu.context.request.post(`${dudu.base}/api/dudu-resume-probe`, { data: { sessionId: item.sessionId } });
        ({ events: afterStop } = await stopped.json());
        if (afterStop.findLast((event: any) => event.type === 'turn/end')?.seq > afterStop.findLast((event: any) => event.type === 'command/run')?.seq) break;
        await delay(50);
      }
      const compact = afterStop.findLast((event: any) => event.type === 'command/run');
      const done = afterStop.find((event: any) => event.type === 'command/done' && event.data.commandId === compact.data.commandId);
      const turnEnd = afterStop.findLast((event: any) => event.type === 'turn/end');
      assert.equal(done.data.kind, 'error');
      assert.equal(turnEnd.data.reason.kind, 'aborted');
      assert.ok(done.seq < turnEnd.seq, 'stopped compaction settles before the DSH turn ends');
    } finally {
      nextCompaction.resolve();
    }
  } finally {
    compactReply.resolve();
    await writeFile(config, original);
    await page.close();
  }
});
