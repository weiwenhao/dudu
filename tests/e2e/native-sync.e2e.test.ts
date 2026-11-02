import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { withAppServer } from '../../host/providers/native/codex-store.mjs';
import { scrubbedEnvironment } from '../../host/providers/oar.mjs';
import { panelAction, startDudu } from './harness.mjs';

const claudeId = '11111111-aaaa-4111-8111-111111111111';
const codexId = '22222222-bbbb-4222-8222-222222222222';
const liveCodexId = '33333333-cccc-4333-8333-333333333333';
const claudeFile = `.claude/projects/-sync/${claudeId}.jsonl`;
const codexFile = `.codex/sessions/2026/11/01/rollout-2026-11-01T02-00-00-${codexId}.jsonl`;
const liveCodexFile = `.codex/sessions/2026/11/01/rollout-2026-11-01T02-00-00-${liveCodexId}.jsonl`;
const timestamp = '2026-11-01T02:00:00.000Z';
const lines = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';
const claudeTurn = (n: number) => lines([
  { type: 'user', uuid: `u${n}`, parentUuid: n === 1 ? null : `a${n - 1}`, cwd: process.cwd(), timestamp, message: { role: 'user', content: n === 1 ? 'Claude sync fixture' : 'Claude new question' } },
  { type: 'assistant', uuid: `a${n}`, parentUuid: `u${n}`, timestamp, message: { id: `m${n}`, role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: n === 1 ? 'Claude first answer' : 'Claude TUI update' }] } },
]);
const codexTurn = (n: number) => lines([
  { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${n}`, model_context_window: 100000, collaboration_mode_kind: 'default' } },
  { timestamp, type: 'event_msg', payload: { type: 'user_message', message: n === 1 ? 'Codex sync fixture' : 'Codex new question', images: [], local_images: [], text_elements: [] } },
  { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: n === 1 ? 'Codex sync fixture' : 'Codex new question' }] } },
  { timestamp, type: 'event_msg', payload: { type: 'agent_message', message: n === 1 ? 'Codex first answer' : 'Codex TUI update', phase: 'final_answer' } },
  { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: n === 1 ? 'Codex first answer' : 'Codex TUI update' }], phase: 'final_answer' } },
  { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${n}`, last_agent_message: n === 1 ? 'Codex first answer' : 'Codex TUI update' } },
]);
const liveCodexMessage = (role: 'user' | 'assistant', text: string) => lines([
  { timestamp, type: 'event_msg', payload: role === 'user'
    ? { type: 'user_message', message: text, images: [], local_images: [], text_elements: [] }
    : { type: 'agent_message', message: text, phase: 'commentary' } },
  { timestamp, type: 'response_item', payload: {
    type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    ...(role === 'assistant' ? { phase: 'commentary' } : {}),
  } },
]);
const growingClaude = lines([
  { type: 'user', uuid: 'u2', parentUuid: 'a1', cwd: process.cwd(), timestamp, message: { role: 'user', content: 'Claude new question' } },
  { type: 'assistant', uuid: 'working2', parentUuid: 'u2', timestamp, message: {
    id: 'working2', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use',
    content: [{ type: 'text', text: 'Claude is still working.' }, { type: 'tool_use', id: 'read2', name: 'Read', input: { file_path: '/work/example.txt' } }],
  } },
]);
const finishedClaude = lines([
  { type: 'user', uuid: 'result2', parentUuid: 'working2', timestamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read2', content: 'Contents.' }] } },
  { type: 'assistant', uuid: 'a2', parentUuid: 'result2', timestamp, message: {
    id: 'm2', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claude TUI update' }],
    usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 30 },
  } },
]);

let dudu: Awaited<ReturnType<typeof startDudu>>;
let probe: string;
const loaded: Record<string, string> = {};
before(async () => {
  // Select the scripted model through DSH's real controller. The plugin's model menu intentionally scopes harness routes.
  probe = await mkdtemp(join(tmpdir(), 'dudu-native-sync-probe-'));
  await writeFile(join(probe, 'package.json'), JSON.stringify({
    name: 'dudu-native-sync-probe', version: '1.0.0', type: 'module', main: 'index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }));
  await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - id: dudu-native-sync-probe\n      name: dudu-native-sync-probe\n');
  await writeFile(join(probe, 'index.mjs'), `
export const name = 'dudu-native-sync-probe';
export const inject = ['connection', 'sessionController'];
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dudu-native-sync-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const { sessionId, select, list } = await request.json();
      if (list) return Response.json(await ctx.sessionController.list());
      if (select) await ctx.sessionController.selectModel({ sessionId, provider: 'mock', model: 'mock-1' });
      return Response.json(await ctx.sessionController.inspect(sessionId));
    },
  }));
}
`);
  dudu = await startDudu({ plugins: [probe], model: { nativeCodex: true, replies: [{ say: 'Received.' }] }, files: {
    [claudeFile]: claudeTurn(1),
    [codexFile]: lines([{ timestamp, type: 'session_meta', payload: {
      id: codexId, timestamp, cwd: process.cwd(), originator: 'codex_cli_rs', cli_version: '0.162.1',
      source: 'cli', model_provider: 'dudu_e2e', base_instructions: { text: '' },
    } }]) + codexTurn(1),
    [liveCodexFile]: lines([{ timestamp, type: 'session_meta', payload: {
      id: liveCodexId, timestamp, cwd: process.cwd(), originator: 'codex_cli_rs', cli_version: '0.162.1',
      source: 'cli', model_provider: 'dudu_e2e', base_instructions: { text: '' },
    } }, { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'live-turn' } }])
      + liveCodexMessage('user', 'Codex live sync fixture') + liveCodexMessage('assistant', 'Codex initial progress'),
  } });
  // Register this synthetic rollout in Codex's own state DB. No prompt or model call is made, and HOME is the test's.
  const user = join(dudu.folder, 'user');
  await withAppServer({ command: 'codex', env: {
    ...scrubbedEnvironment([/^(CODEX_|ORCA_|HERDR_)/]), HOME: user, CODEX_HOME: join(user, '.codex'),
  } },
    async (request) => {
      await request('thread/resume', { threadId: codexId, cwd: process.cwd() });
      await request('thread/resume', { threadId: liveCodexId, cwd: process.cwd() });
    });
});
after(async () => { await dudu?.stop(); if (probe) await rm(probe, { recursive: true, force: true }); });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

for (const [provider, id, file, turn] of [
  ['claude', claudeId, claudeFile, claudeTurn],
  ['codex', codexId, codexFile, codexTurn],
] as const) {
  test(`${provider} sidebar logo and native TUI updates survive repeated DSH refreshes without another import`, async () => {
    const label = provider === 'claude' ? 'Claude' : 'Codex';
    await dudu.api('sessions/list', { refresh: true });
    const page = await dudu.openPanel();
    await panelAction(page, 'Sessions');
    const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
    await dialog.getByRole('searchbox').fill(`${label} sync fixture`);
    await dialog.getByRole('option', { name: new RegExp(`${label} sync fixture`) }).click();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30_000 });
    await page.getByText(`${label} first answer`, { exact: true }).waitFor({ timeout: 30_000 });
    await page.locator(`[data-agent-logo="${provider}"]`).first().waitFor();
    const listed = await dudu.api('sessions/list', { query: `${label} sync fixture` });
    loaded[provider] = listed.sessions.find((item: any) => item.id === id).dshSessionId;
    const newTurn = turn(2).trimEnd().split('\n');
    await appendFile(join(dudu.folder, 'user', file), provider === 'claude' ? growingClaude : newTurn.slice(0, -1).join('\n') + '\n');
    // The unfinished loop is visible, with one open native turn across every poll.
    for (let poll = 0; poll < 3; poll++) {
      await dudu.api('sessions/sync', { sessionIds: [loaded[provider]], fresh: true });
    }
    const inspected = await dudu.context.request.post(`${dudu.base}/api/dudu-native-sync-probe`, { data: { sessionId: loaded[provider] } });
    const pending = (await inspected.json()).events;
    assert.equal(pending.filter((event: any) => event.type === 'turn/start').length, 2);
    assert.equal(pending.filter((event: any) => event.type === 'turn/end').length, 1);
    await page.reload();
    await page.getByText(`${label} sync fixture`, { exact: true }).first().click();
    await page.getByText(`${label} first answer`, { exact: true }).waitFor();
    await page.getByText(`${label} new question`, { exact: true }).waitFor();
    const row = page.getByRole('treeitem').filter({ hasText: `${label} sync fixture` }).last();
    assert.ok(await row.evaluate((node) => parseFloat(getComputedStyle(node).paddingInlineStart) >= 24));
    const logo = row.locator(`[data-agent-logo="${provider}"]`);
    assert.equal(await logo.count(), 1);
    assert.equal(await logo.evaluate((node) => Math.round(node.getBoundingClientRect().width)), 14);
    assert.equal(await logo.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    await appendFile(join(dudu.folder, 'user', file), provider === 'claude' ? finishedClaude : newTurn.at(-1) + '\n');
    const composer = page.locator('[contenteditable="true"][role="textbox"]');
    await composer.fill(`Unsent ${provider} draft`);
    // An already-open conversation must receive external changes without a reload or another import.
    await page.getByText(`${label} TUI update`, { exact: true }).waitFor({ timeout: 12_000 });
    await dudu.api('sessions/sync', { sessionIds: [loaded[provider]], fresh: true });
    assert.equal(await composer.innerText(), `Unsent ${provider} draft`);
    assert.equal(await page.getByText(`${label} first answer`, { exact: true }).count(), 1);
    assert.equal(await page.getByText(`${label} TUI update`, { exact: true }).count(), 1);
    await page.reload();
    await page.getByText(`${label} sync fixture`, { exact: true }).first().click();
    await page.getByText(`${label} TUI update`, { exact: true }).waitFor({ timeout: 30_000 });
    const messages = await dudu.api('sessions/read', { provider, id });
    assert.equal(messages.messages.filter((message: any) => message.text === `${label} TUI update`).length, 1);
    assert.equal((await dudu.api('sessions/list', { query: `${label} sync fixture` })).sessions.find((item: any) => item.id === id).dshSessionId, loaded[provider]);
  });
}

test('a current Codex turn imports immediately, keeps mid-turn input, and finishes once after DSH restart', async () => {
  const page = await dudu.openPanel();
  await panelAction(page, 'Sessions');
  const dialog = page.getByRole('dialog', { name: 'Sessions', exact: true });
  await dialog.getByRole('searchbox').fill('Codex live sync fixture');
  await dialog.getByRole('option', { name: /Codex live sync fixture/ }).click();
  await dialog.getByText('Codex initial progress', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: 30_000 });
  await page.getByText('Codex initial progress', { exact: true }).waitFor();
  const sessionId = (await dudu.api('sessions/list', { query: 'Codex live sync fixture' })).sessions.find((item: any) => item.id === liveCodexId).dshSessionId;
  const inspect = async () => {
    const response = await dudu.context.request.post(`${dudu.base}/api/dudu-native-sync-probe`, { data: { sessionId } });
    assert.equal(response.ok(), true);
    return (await response.json()).events;
  };
  let events = await inspect();
  assert.equal(events.find((event: any) => event.surfaceOp)?.type, 'system/message');
  assert.equal(events.filter((event: any) => event.type === 'turn/start').length, 1);
  assert.equal(events.filter((event: any) => event.type === 'turn/end').length, 0);
  const composer = page.locator('[contenteditable="true"][role="textbox"]');
  await composer.fill('Unsent native draft');
  const file = join(dudu.folder, 'user', liveCodexFile);
  await appendFile(file, liveCodexMessage('user', 'Additional native instruction')
    + liveCodexMessage('assistant', 'Codex additional progress'));
  await page.getByText('Additional native instruction', { exact: true }).waitFor({ timeout: 12_000 });
  await page.getByText('Codex additional progress', { exact: true }).waitFor();
  assert.equal(await composer.innerText(), 'Unsent native draft');
  for (let poll = 0; poll < 3; poll++) await dudu.api('sessions/sync', { sessionIds: [sessionId], fresh: true });
  events = await inspect();
  assert.equal(events.filter((event: any) => event.type === 'user/message').length, 2);
  assert.equal(events.filter((event: any) => event.type === 'turn/start').length, 1);
  assert.equal(events.filter((event: any) => event.type === 'turn/end').length, 0);
  await dudu.restart();
  await page.reload();
  await page.getByRole('tree', { name: 'Sessions' }).getByText('Codex live sync fixture', { exact: true }).click();
  await page.getByText('Codex additional progress', { exact: true }).waitFor();
  await appendFile(file, liveCodexMessage('assistant', 'Codex progress after host restart'));
  await page.getByText('Codex progress after host restart', { exact: true }).waitFor({ timeout: 12_000 });
  events = await inspect();
  const starts = events.filter((event: any) => event.type === 'turn/start').length;
  assert.equal(events.filter((event: any) => event.type === 'turn/end' && event.data.reason.kind === 'completed').length, 0);
  await appendFile(file, lines([{ timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'live-turn', last_agent_message: 'Codex progress after host restart' } }]));
  await dudu.api('sessions/sync', { sessionIds: [sessionId], fresh: true });
  for (let poll = 0; poll < 3; poll++) await dudu.api('sessions/sync', { sessionIds: [sessionId], fresh: true });
  events = await inspect();
  assert.equal(events.filter((event: any) => event.type === 'turn/start').length, starts);
  assert.equal(events.filter((event: any) => event.type === 'turn/end' && event.data.reason.kind === 'completed').length, 1);
  assert.equal(events.filter((event: any) => event.type === 'user/message').length, 2);
  assert.equal((await dudu.api('sessions/read', { provider: 'codex', id: liveCodexId })).messages.filter((message: any) => message.text === 'Additional native instruction').length, 1);
  assert.equal((await dudu.api('sessions/list', { query: 'Codex live sync fixture' })).sessions.find((item: any) => item.id === liveCodexId).dshSessionId, sessionId);
  await dudu.restart();
  await page.reload();
  await page.getByRole('tree', { name: 'Sessions' }).getByText('Codex live sync fixture', { exact: true }).click();
  await page.getByText('Codex progress after host restart', { exact: true }).waitFor();
  for (const text of ['Codex initial progress', 'Additional native instruction', 'Codex additional progress']) {
    assert.equal(await page.getByText(text, { exact: true }).count(), 1);
  }
});

test('opening a sidebar session restores missing native links and immediately checks external history', async () => {
  const linksFile = join(dudu.home, 'dudu', 'links.json');
  const links = JSON.parse(await readFile(linksFile, 'utf8'));
  delete links[`claude:${claudeId}`];
  delete links[`codex:${codexId}`];
  await writeFile(linksFile, JSON.stringify(links));
  await dudu.restart();
  const page = await dudu.openPanel({ selectPanel: false });
  // A restored window can already select Claude; make the next click a real session change.
  await page.getByRole('tree', { name: 'Sessions' }).getByText('Codex live sync fixture', { exact: true }).click();
  await page.getByText('Codex progress after host restart', { exact: true }).waitFor();
  for (const provider of ['claude', 'codex']) {
    const label = provider === 'claude' ? 'Claude' : 'Codex';
    const file = provider === 'claude' ? claudeFile : codexFile;
    const records = provider === 'claude' ? claudeTurn(3) : codexTurn(3);
    const question = `${label} sidebar refresh question`;
    const answer = `${label} sidebar refresh answer`;
    await appendFile(join(dudu.folder, 'user', file), records
      .replaceAll(`${label} new question`, question).replaceAll(`${label} TUI update`, answer));
    const checking = page.waitForRequest((request) => {
      if (!request.url().endsWith('/api/dudu/sessions/sync')) return false;
      const body = request.postDataJSON();
      return body.recover === true && body.sessionIds.length === 1 && body.sessionIds[0] === loaded[provider];
    }, { timeout: 2500 });
    await page.getByRole('tree', { name: 'Sessions' }).getByText(`${label} sync fixture`, { exact: true }).click();
    await checking;
    await page.getByText(answer, { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await page.getByText(answer, { exact: true }).count(), 1);
    const restored = JSON.parse(await readFile(linksFile, 'utf8'));
    assert.equal(restored[`${provider}:${provider === 'claude' ? claudeId : codexId}`].sessionId, loaded[provider]);
  }
});

test('an open compact conversation receives native updates and keeps its draft when expanded', async () => {
  const { issue } = await dudu.api('issues/add', { fields: {
    title: 'Native compact refresh', project: { name: 'sync', path: process.cwd() },
    agent: 'codex', session: `dsh:${loaded.codex}`,
  } });
  const page = await dudu.openPanel();
  await page.locator(`[data-issue-row="${issue.id}"]`).getByRole('button', { name: 'ChatGPT · Open session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(issue.title) });
  await dialog.getByText('Codex sidebar refresh answer', { exact: true }).waitFor();
  const composer = dialog.locator('[contenteditable="true"][role="textbox"]');
  await composer.fill('Keep this compact draft.');
  await appendFile(join(dudu.folder, 'user', codexFile), codexTurn(4)
    .replaceAll('Codex new question', 'Codex compact refresh question')
    .replaceAll('Codex TUI update', 'Codex compact refresh answer'));
  await dialog.getByText('Codex compact refresh answer', { exact: true }).waitFor({ timeout: 12_000 });
  assert.equal(await composer.innerText(), 'Keep this compact draft.');
  await dialog.getByRole('button', { name: 'Open session', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const full = page.locator(`[data-conversation-content][data-conversation-session="${loaded.codex}"]`);
  await full.getByText('Codex compact refresh answer', { exact: true }).waitFor();
  assert.equal(await full.locator('[contenteditable="true"][role="textbox"]').innerText(), 'Keep this compact draft.');
  assert.equal(await full.getByText('Codex compact refresh answer', { exact: true }).count(), 1);
});

test('imported Claude and Codex sessions can continue in DSH, restart and reopen with both histories intact', async () => {
  for (const provider of ['claude', 'codex']) {
    const label = provider === 'claude' ? 'Claude' : 'Codex';
    const page = await dudu.openPanel({ selectPanel: false });
    await page.getByRole('tree', { name: 'Sessions' }).getByText(`${label} sync fixture`, { exact: true }).click();
    await page.getByText(`${label} TUI update`, { exact: true }).waitFor();
    if (provider === 'claude') {
      const selected = await dudu.context.request.post(`${dudu.base}/api/dudu-native-sync-probe`, { data: { sessionId: loaded[provider], select: true } });
      assert.equal(selected.ok(), true, `HTTP ${selected.status()}: ${await selected.text()}\n${dudu.diagnostics()}`);
      await page.getByRole('button', { name: 'Select model, current Mock', exact: true }).waitFor();
    }
    const answer = provider === 'codex' ? 'MODEL_READY' : 'Received.';
    await page.locator('[contenteditable="true"][role="textbox"]').fill(`Continue ${provider} after import.`);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText(answer, { exact: true }).waitFor({ timeout: 60_000 });
    const inspected = await dudu.context.request.post(`${dudu.base}/api/dudu-native-sync-probe`, { data: { sessionId: loaded[provider] } });
    assert.equal(inspected.ok(), true);
    const { events } = await inspected.json();
    const head = events.find((event: any) => event.surfaceOp);
    assert.equal(head.type, 'system/message');
    assert.deepEqual(head.data.message.content, []);
    assert.ok(events.some((event: any) => event.type === 'system/message' && event.surfaceOp?.op === 'replace' && event.surfaceOp.startSeq === head.seq));
    await dudu.restart();
    await page.reload();
    await page.getByRole('tree', { name: 'Sessions' }).getByText(`${label} sync fixture`, { exact: true }).click();
    await page.getByText(`${label} first answer`, { exact: true }).waitFor();
    await page.getByText(`${label} TUI update`, { exact: true }).waitFor();
    await page.getByText(`Continue ${provider} after import.`, { exact: true }).waitFor();
    assert.equal(await page.getByText(answer, { exact: true }).count(), 1);
    assert.equal(await page.getByText(/stored session .* is corrupt/).count(), 0);
  }
});

test('assigned Properties are locked, expose the native resume command, and deleted work can be explicitly imported and taken over again', async () => {
  assert.ok(loaded.claude);
  const { issue } = await dudu.api('issues/add', { fields: {
    title: 'Native issue cleanup', project: { name: 'sync', path: process.cwd() },
    agent: 'claude', session: `dsh:${loaded.claude}`,
  } });
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: issue.title, exact: true }).click();
  const properties = page.getByRole('complementary', { name: 'Properties' });
  assert.equal(await properties.getByRole('button', { name: 'Claude', exact: true }).isDisabled(), true);
  assert.equal(await properties.getByRole('button', { name: 'sync', exact: true }).isDisabled(), true);
  const resume = `claude --resume ${claudeId}`;
  await properties.getByRole('button', { name: resume, exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), resume);
  assert.equal((await dudu.api('issues/assign', { id: issue.id, agent: 'codex' })).outcome, 'needs_clarification');
  assert.equal((await dudu.api('issues/update', { id: issue.id, patch: { project: null } })).outcome, 'needs_clarification');
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).click();
  await page.getByRole('checkbox', { name: `Select ${issue.ref}`, exact: true }).click();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  assert.equal(await bar.getByRole('button', { name: 'Agent', exact: true }).isDisabled(), true);
  await bar.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'This will be deleted' });
  await dialog.getByText(issue.title, { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await dudu.api('issues/get', { id: issue.id })).outcome, 'success');
  await bar.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal((await dudu.api('issues/get', { id: issue.id })).outcome, 'error');
  const removed = (await dudu.api('sessions/list', { refresh: true, query: 'Claude sync fixture' })).sessions;
  assert.equal(removed.length, 1, 'the original native history remains browsable');
  assert.equal(removed[0].dshSessionId, undefined, 'the archived DSH copy is gone from the catalog');
  await dudu.restart();
  const freshPage = await dudu.openPanel();
  await panelAction(freshPage, 'Sessions');
  const sessions = freshPage.getByRole('dialog', { name: 'Sessions', exact: true });
  await sessions.getByRole('searchbox').fill('Claude sync fixture');
  await sessions.getByRole('option', { name: /Claude sync fixture/ }).click();
  await sessions.getByText('Claude TUI update', { exact: true }).waitFor();
  await sessions.getByRole('button', { name: 'Import', exact: true }).click();
  await sessions.waitFor({ state: 'detached', timeout: 30_000 });
  await freshPage.getByText('Claude TUI update', { exact: true }).waitFor();
  const imported = (await dudu.api('sessions/list', { refresh: true, query: 'Claude sync fixture' })).sessions;
  assert.equal(imported.length, 1);
  assert.ok(imported[0].dshSessionId);
  assert.notEqual(imported[0].dshSessionId, loaded.claude);
  assert.equal(imported[0].issue, undefined, 'manual import does not take over the work');
  dudu.model!.replies.unshift({
    when: ({ system }: { system: string }) => system.includes('taking over an existing work conversation'),
    say: JSON.stringify({ brief: 'Continue the original task.', status: 'in_progress', ask: '' }),
  });
  const takeoverPage = await dudu.openPanel();
  await panelAction(takeoverPage, 'Sessions');
  const takeover = takeoverPage.getByRole('dialog', { name: 'Sessions', exact: true });
  await takeover.getByRole('searchbox').fill('Claude sync fixture');
  await takeover.getByRole('option', { name: /Claude sync fixture/ }).click();
  await takeover.getByRole('button', { name: 'Take over', exact: true }).click();
  await takeoverPage.getByRole('button', { name: 'Back to Issues', exact: true }).waitFor();
  const managed = (await dudu.api('sessions/list', { query: 'Claude sync fixture' })).sessions[0];
  assert.ok(managed.issue);
  assert.notEqual(managed.issue.id, issue.id);
});

test('mentions remain coloured plain text, dudu is available on assigned work, and only explicit mentions forward messages', async () => {
  const { issue } = await dudu.api('issues/add', { fields: {
    title: 'Mention forwarding check', brief: 'Say received.', project: { name: 'checks', path: dudu.folder }, agent: 'deepseek',
  } });
  const page = await dudu.openPanel();
  await page.getByRole('button', { name: issue.title, exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Leave a comment…', exact: true });
  await input.fill('@');
  await page.getByRole('option', { name: '@Dudu', exact: true }).waitFor();
  await page.getByRole('option', { name: '@DeepSeek', exact: true }).click();
  await input.pressSequentially('Forward exactly this.');
  const colour = await input.locator('..').locator('[aria-hidden="true"] span').first().evaluate((node) => getComputedStyle(node).color);
  assert.equal(colour, 'rgb(50, 107, 255)');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await input.waitFor();
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Leave a comment…"]') as HTMLTextAreaElement)?.value === '');
  const deadline = Date.now() + 10_000;
  while (!dudu.model?.requests.some((request: any) => request.prompt === 'Forward exactly this.' && request.tools.length) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(dudu.model?.requests.some((request: any) => request.prompt === 'Forward exactly this.' && request.tools.length),
    JSON.stringify({ issue: (await dudu.api('issues/get', { id: issue.id })).issue, requests: dudu.model?.requests.slice(-12).map(({ prompt, tools }: any) => ({ prompt, tools: tools?.length ?? 0 })) }));
  await input.fill('@dudu Browse this issue.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Leave a comment…"]') as HTMLTextAreaElement)?.value === '');
  const marker = 'A comment that stays only in this issue.';
  await input.fill(marker);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('textarea[aria-label="Leave a comment…"]') as HTMLTextAreaElement)?.value === '');
  const { log } = await dudu.api('issues/get', { id: issue.id });
  assert.ok(log.some((entry: any) => entry.text === marker && !entry.data?.mention));
  assert.ok(!dudu.model?.requests.some((request: any) => request.prompt === marker));
  await page.getByRole('button', { name: 'Back to Issues', exact: true }).click();
  await panelAction(page, 'Edit layout');
  const toolbar = page.getByRole('toolbar', { name: 'Edit layout', exact: true });
  const done = toolbar.getByRole('button', { name: 'Done', exact: true });
  assert.equal(await done.innerText(), '');
  assert.ok(await toolbar.evaluate((node) => parseFloat(getComputedStyle(node).borderRadius) >= 20));
  await done.click();
  await toolbar.waitFor({ state: 'detached' });
});

test('issue session buttons open the stored conversation without creating a different blank session', async () => {
  for (const provider of ['claude', 'codex']) {
    const label = provider === 'claude' ? 'Claude' : 'Codex';
    const session = (await dudu.api('sessions/list', { query: `${label} sync fixture` })).sessions[0];
    assert.ok(session.dshSessionId);
    const { issue } = session.issue
      ? await dudu.api('issues/get', { id: session.issue.id })
      : await dudu.api('issues/add', { fields: {
        title: `Open the existing ${label} issue conversation`, project: { name: 'sync', path: process.cwd() },
        agent: provider, session: `dsh:${session.dshSessionId}`,
      } });
    const page = await dudu.openPanel({ views: { active: { layout: 'board', group: 'status' } } });
    const list = async () => {
      const response = await dudu.context.request.post(`${dudu.base}/api/dudu-native-sync-probe`, { data: { list: true } });
      assert.equal(response.ok(), true);
      const result = await response.json();
      return (result.items ?? result).map((item: any) => item.sessionId ?? item.id).sort();
    };
    const before = await list();
    await page.getByRole('article', { name: issue.title, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open session', exact: true }).click();
    await page.getByText(`${label} TUI update`, { exact: true }).waitFor();
    assert.deepEqual(await list(), before, 'the hosted Board opens the existing conversation');
    await page.getByRole('button', { name: 'Dudu', exact: true }).first().click();
    await page.getByRole('button', { name: issue.title, exact: true }).click();
    await page.getByRole('button', { name: 'Open session', exact: true }).click();
    await page.getByText(`${label} TUI update`, { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Back to Issues', exact: true }).count(), 0);
    assert.deepEqual(await list(), before, 'opening does not create an extra blank conversation');
    await page.close();
  }
});
