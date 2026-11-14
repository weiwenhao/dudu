// Real DSH (the Desktop's CLI: DUDU_E2E_DSH), the real `pi` of this computer started by the plugin of this checkout. Only the model is scripted.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import { panelAction, startDudu } from './harness.mjs';

let folder: string;
let project: { name: string; path: string };
let dudu: Awaited<ReturnType<typeof startDudu>>;
const BIG = 'z'.repeat(60);

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dudu-pi-e2e-'));
  const plugin = join(folder, 'probe');
  await mkdir(plugin);
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: 'dudu-pi-probe', version: '1.0.0', type: 'module', main: 'index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(plugin, 'cordis.patch.yml'), '- insert:\n    - id: dudu-pi-probe\n      name: dudu-pi-probe\n');
  await writeFile(join(plugin, 'index.mjs'), `
import { readSessionHistory } from ${JSON.stringify(new URL('../../host/dudu-plugin/dist/dsh-session-history.mjs', import.meta.url).href)};
export const name = 'dudu-pi-probe';
export const inject = ['connection', 'sessionController', 'sessionQuery', 'workspaceRegistry', 'agents', 'jobs', 'commands'];
export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dudu-pi-probe', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      const body = await request.json();
      const { action, sessionId } = body;
      const agent = () => ctx.agents.get(sessionId);
      if (action === 'catalog') {
        const catalog = await ctx.sessionController.modelCatalog();
        return Response.json({ groups: catalog.groups.map((g) => ({ id: g.id, name: g.name, models: g.models.map((m) => ({ id: m.id, name: m.name, efforts: m.reasoning?.efforts?.map((e) => e.id) })) })) });
      }
      if (action === 'create') {
        const workspace = await ctx.workspaceRegistry.create(body.cwd);
        const created = await ctx.sessionController.create({ workspaceId: workspace.id });
        const catalog = await ctx.sessionController.modelCatalog();
        const model = body.model ?? catalog.groups.find((g) => g.id === body.provider)?.models[0]?.id;
        if (!model) throw new Error('no model for ' + body.provider);
        await ctx.sessionController.selectModel({ sessionId: created.sessionId, provider: body.provider, model, ...(body.effort ? { reasoningEffort: body.effort } : {}) });
        return Response.json({ ...created, model });
      }
      if (action === 'prompt') {
        await ctx.sessionController.prompt({ requestId: crypto.randomUUID(), sessionId, mode: body.mode ?? 'queue', content: [{ type: 'text', text: body.text }] }, new AbortController().signal);
        return Response.json({ ok: true });
      }
      if (action === 'cancel') return Response.json(await ctx.sessionController.cancel({ sessionId }));
      if (action === 'commands') return Response.json({ names: ctx.commands.list(agent()).map((c) => c.name) });
      if (action === 'execute') {
        try { return Response.json(await ctx.commands.execute(agent(), body.line, [], new AbortController().signal) ?? { none: true }); }
        catch (error) { return Response.json({ threw: String(error?.message ?? error) }); }
      }
      if (action === 'jobs') return Response.json({ jobs: JSON.parse(JSON.stringify(ctx.jobs?.list?.({ ownerId: sessionId }) ?? [])) });
      return Response.json(await readSessionHistory({ controller: ctx.sessionController, query: ctx.sessionQuery }, sessionId));
    },
  }));
}
`);
  dudu = await startDudu({
    plugins: [plugin],
    model: {
      nativePi: true,
      // A small context, so that a big command output crosses Pi's own threshold; a small keep, so that a short chat can be compacted.
      piModels: [{ id: 'mock-pi', name: 'Mock Pi', contextWindow: 12000 }, { id: 'mock-pi-think', name: 'Mock Pi Think', reasoning: true, contextWindow: 12000 }],
      piSettings: { compaction: { enabled: true, reserveTokens: 4000, keepRecentTokens: 200 } },
      replies: [
        { when: (context: any) => /summariz/i.test(context.system), say: 'SUMMARY: the earlier work, kept short.' },
        { when: 'ALLTOOLS', calls: [
          { name: 'bash', arguments: { command: 'echo probe-ok' } },
          { name: 'read', arguments: { path: 'notes.txt' } },
          { name: 'edit', arguments: { path: 'notes.txt', edits: [{ oldText: '42', newText: '43' }] } },
          { name: 'write', arguments: { path: 'made.txt', content: 'made by pi\n' } },
          { name: 'bash', arguments: { command: 'echo oops 1>&2; exit 3' } },
        ], then: () => 'All tools done.' },
        { when: 'BIGOUTPUT', calls: [{ name: 'bash', arguments: { command: `yes ${BIG} | head -c 60000` } }], then: () => 'Big output done.' },
        { when: (context: any) => /<goal_round>/.test(context.prompt) && /Objective: "Finish it/.test(context.prompt) && /Round: 1\//.test(context.prompt), say: 'Working on it, not finished yet.' },
        { when: (context: any) => /<goal_round>/.test(context.prompt) && /Objective: "Finish it/.test(context.prompt), say: 'The notes say forty-three now.\n\nGOAL_COMPLETE' },
        { when: (context: any) => /<goal_round>/.test(context.prompt) && /Objective: "Stuck on it/.test(context.prompt), say: 'I cannot open the vault.\n\nGOAL_BLOCKED: the vault needs a password only the person has' },
        { when: 'FAILME', fail: { status: 400, message: 'bad request from the mock' } },
        { when: 'SLOWME', delay: 30_000, say: 'Finally answered.' },
        { when: 'STEERME', delay: 4000, say: 'First answer.' },
        { when: 'hello', say: 'Hi from the scripted Pi model.' },
        { say: 'Noted.' },
      ],
    },
  });
  await writeFile(join(dudu.folder, 'notes.txt'), 'the answer is 42\n');
  project = { name: 'Pi project', path: await realpath(dudu.folder) };
  assert.equal((await dudu.api('projects/create', project)).outcome, 'success');
});
after(async () => { try { await dudu?.stop(); } finally { if (folder) await rm(folder, { recursive: true, force: true }); } });
afterEach(async (context) => { await dudu.settle(context.name, context.passed === false); });

async function probe(body: Record<string, unknown>) {
  const response = await dudu.context.request.post(`${dudu.base}/api/dudu-pi-probe`, { data: body });
  assert.equal(response.ok(), true, `probe ${body.action}: HTTP ${response.status()}`);
  return response.json();
}
async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean, what: string, timeout = 45_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!matches(value)) {
    if (Date.now() > deadline) assert.fail(`${what} did not happen in ${timeout} ms`);
    await delay(250);
    value = await read();
  }
  return value;
}
const history = (sessionId: string) => probe({ sessionId });
const turnsEnded = (events: any[]) => events.filter((event) => event.type === 'turn/end');
/** A Pi session in DSH, its first model, and the prompt run to the end of its turn; -> the events of that turn. */
async function pi(prompt: string, { sessionId, model, effort }: { sessionId?: string; model?: string; effort?: string } = {}) {
  const id = sessionId ?? (await probe({ action: 'create', cwd: dudu.folder, provider: 'pi', model, effort })).sessionId;
  const before = turnsEnded((await history(id)).events).length;
  await probe({ action: 'prompt', sessionId: id, text: prompt });
  const { events } = await until(() => history(id), (value) => turnsEnded(value.events).length > before, `the turn of "${prompt}"`);
  return { sessionId: id, events, turn: events.slice(events.findLastIndex((event: any) => event.type === 'turn/start')) };
}
const providers = async () => (await dudu.api('providers/state')).providers as Array<{ id: string; enabled: boolean; state: string; version?: string; path?: string }>;
const group = async (id: string) => (await probe({ action: 'catalog' })).groups.find((entry: any) => entry.id === id);
const issues = (page: Page) => page.getByRole('region', { name: 'Issues' });

test('Pi is found, is a harness group of DSH\'s catalog with its own models and thinking levels', async () => {
  const found = (await providers()).find((entry) => entry.id === 'pi')!;
  assert.deepEqual([found.enabled, found.state], [true, 'ready']);
  assert.match(found.version ?? '', /^\d+\.\d+\.\d+$/);
  assert.match(found.path ?? '', /\/pi$/);
  const models = (await group('pi')).models;
  assert.deepEqual(models.map((model: any) => model.id), ['dudu_e2e/mock-pi', 'dudu_e2e/mock-pi-think']);
  assert.equal(models[0].efforts, undefined, 'a model that does not think has no levels');
  assert.ok(models[1].efforts.includes('high') && models[1].efforts.includes('low'), `thinking levels of the model: ${JSON.stringify(models[1].efforts)}`);
});

test('the places that offer agents follow the switch of Pi in Settings > Providers', async () => {
  const page = await dudu.openPanel();
  const agentsOfNewIssue = async () => {
    await issues(page).getByRole('button', { name: 'New issue', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New issue', exact: true });
    await dialog.getByRole('button', { name: 'Choose a project', exact: true }).click();
    await page.getByRole('option', { name: /Pi project/ }).click();
    await dialog.getByRole('button', { name: 'No agent', exact: true }).click();
    await page.getByRole('option', { name: 'No agent', exact: true }).waitFor();
    const names = (await page.locator('[data-slot="popover-content"] [role="option"]').allInnerTexts()).map((text) => text.trim());
    await page.getByRole('option', { name: 'No agent', exact: true }).click();   // closes the list and keeps the dialog
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    return names;
  };
  const setPi = async (on: boolean) => {
    await page.getByRole('button', { name: 'Dudu', exact: true }).first().click();
    await panelAction(page, 'Settings');
    const settings = page.getByRole('dialog', { name: 'Dudu settings', exact: true });
    await settings.getByRole('button', { name: 'Providers', exact: true }).click();
    const row = settings.getByRole('listitem', { name: 'Pi', exact: true });
    await row.waitFor();
    const toggle = row.getByRole('switch', { name: 'Enable: Pi' });
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
    await until(providers, (list) => list.find((entry) => entry.id === 'pi')?.enabled === on, `Pi switched ${on ? 'on' : 'off'}`);
    await page.keyboard.press('Escape');
  };
  try {
    assert.deepEqual(await agentsOfNewIssue(), ['No agent', 'Claude', 'ChatGPT', 'Pi', 'DeepSeek']);
    await setPi(false);
    assert.equal(await group('pi'), undefined, 'DSH has no Pi route and no Pi models any more');
    assert.equal((await dudu.api('tasks/options', { includeSessions: false })).providers.find((entry: any) => entry.id === 'pi').available, false);
    assert.deepEqual(await agentsOfNewIssue(), ['No agent', 'Claude', 'ChatGPT', 'DeepSeek'], 'the New issue window offers no Pi');
    const issue = (await dudu.api('issues/add', { fields: { project, title: 'Pi is off', brief: 'hello' } })).issue;
    await dudu.api('issues/assign', { id: issue.id, agent: 'pi' });
    const refused = (await dudu.api('issues/get', { id: issue.id })).issue;
    assert.ok(!refused.session, 'no session starts for a Pi that is switched off');
    assert.match(refused.ask, /Pi is not available/, `the issue says why: ${refused.ask}`);
    await setPi(true);
    assert.deepEqual((await group('pi')).models.map((model: any) => model.id), ['dudu_e2e/mock-pi', 'dudu_e2e/mock-pi-think']);
    assert.equal((await dudu.api('tasks/options', { includeSessions: false })).providers.find((entry: any) => entry.id === 'pi').available, true);
    assert.deepEqual(await agentsOfNewIssue(), ['No agent', 'Claude', 'ChatGPT', 'Pi', 'DeepSeek'], 'and offers it again');
  } finally {
    await dudu.api('providers/save', { id: 'pi', enabled: true });
    await page.close();
  }
});

test('an issue given to Pi runs in a Pi session and ends as Needs you with Pi\'s answer', async () => {
  const issue = (await dudu.api('issues/add', { fields: { project, title: 'Say hello with Pi', brief: 'hello from the issue' } })).issue;
  assert.equal((await dudu.api('issues/assign', { id: issue.id, agent: 'pi' })).outcome, 'success');
  const done = await until(async () => (await dudu.api('issues/get', { id: issue.id })).issue,
    (now: any) => Boolean(now.session) && now.agentState === 'blocked' && now.ask === '' && Boolean(now.sessions?.some((one: any) => one.key === now.session && one.state === 'finished')), 'the issue to finish');
  assert.equal(done.agent, 'pi');
  const sessionId = String(done.session).replace(/^dsh:/, '');
  const { events } = await history(sessionId);
  const answer = events.findLast((event: any) => event.type === 'assistant/message');
  assert.equal(answer.data.message.source.provider, 'pi');
  assert.match(answer.data.message.source.replayState.nativeSessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(answer.data.message.content, [{ type: 'text', text: 'Hi from the scripted Pi model.' }]);
});

test('every Pi tool is drawn, a failing command is an error, steps and tokens are counted once, and nothing runs in the background', async () => {
  const { sessionId, turn } = await pi('ALLTOOLS please');
  const calls = turn.filter((event: any) => event.type === 'tool/call');
  assert.deepEqual(calls.map((event: any) => event.data.name), ['pi_bash', 'pi_read', 'pi_edit', 'pi_write', 'pi_bash']);
  const results = turn.filter((event: any) => event.type === 'tool/result');
  assert.equal(results.length, 5);
  assert.match(JSON.stringify(results[0].data), /probe-ok/);
  assert.match(JSON.stringify(results[1].data), /the answer is 42/);
  assert.match(JSON.stringify(results.at(-1)!.data), /oops|exited with code 3/);
  assert.equal(await readFile(join(dudu.folder, 'notes.txt'), 'utf8'), 'the answer is 43\n', 'the edit happened');
  assert.equal(await readFile(join(dudu.folder, 'made.txt'), 'utf8'), 'made by pi\n', 'the write happened');
  const steps = turn.filter((event: any) => event.type === 'step/end');
  assert.equal(steps.length, 6, 'a step for each tool call and one for the answer');
  const messages = turn.filter((event: any) => event.type === 'assistant/message');
  assert.equal(messages.length, 6);
  for (const message of messages) assert.deepEqual([message.data.usage.inputTokens, message.data.usage.outputTokens, message.data.usage.totalTokens], [20, 5, 25], 'each model request is counted once');
  assert.deepEqual(turn.at(-1).data.reason, { kind: 'completed' });
  assert.deepEqual((await probe({ action: 'jobs', sessionId })).jobs, [], 'Pi has no background tasks, and a foreground command is no job');
  assert.equal(JSON.stringify((await probe({ action: 'commands', sessionId })).names), JSON.stringify(['compact', 'export', 'feedback', 'goal', 'permission', 'plan']));
});

test('the thinking level chosen in DSH reaches Pi\'s model', async () => {
  const { turn } = await pi('thinking please', { model: 'dudu_e2e/mock-pi-think', effort: 'high' });
  assert.equal(turn.findLast((event: any) => event.type === 'turn/end').data.reason.kind, 'completed');
  assert.equal(dudu.model!.requests.findLast((request: any) => /thinking please/.test(request.prompt)).reasoningEffort, 'high');
});

test('a model error ends the Pi turn with its message, and the session goes on', async () => {
  const { sessionId, turn } = await pi('FAILME please');
  const reason = turn.findLast((event: any) => event.type === 'turn/end').data.reason;
  assert.equal(reason.kind, 'error');
  assert.match(JSON.stringify(reason), /bad request from the mock/, 'Pi\'s own words reach the person');
  const after = await pi('hello after the failure', { sessionId });
  assert.equal(turnsEnded(after.events).at(-1).data.reason.kind, 'completed');
});

test('Stop ends a Pi turn, and the next message, also after DSH restarts, goes on in the same Pi session', async () => {
  const created = await probe({ action: 'create', cwd: dudu.folder, provider: 'pi' });
  const sessionId = created.sessionId;
  await probe({ action: 'prompt', sessionId, text: 'SLOWME please' });
  await until(() => history(sessionId), (value) => value.events.some((event: any) => event.type === 'step/start'), 'the slow step to start');
  await delay(1500);
  await probe({ action: 'cancel', sessionId });
  const stopped = await until(() => history(sessionId), (value) => turnsEnded(value.events).length === 1, 'the stopped turn to end', 15_000);
  assert.equal(turnsEnded(stopped.events)[0].data.reason.kind, 'aborted');
  const first = await pi('hello again', { sessionId });
  const nativeId = first.events.findLast((event: any) => event.type === 'assistant/message').data.message.source.replayState.nativeSessionId;
  assert.ok(nativeId);
  await dudu.restart();
  const second = await pi('hello after the restart', { sessionId });
  assert.equal(second.events.findLast((event: any) => event.type === 'assistant/message').data.message.source.replayState.nativeSessionId, nativeId, 'the same Pi session');
  // Pi saw its own earlier messages: the first request after the restart carries them.
  const request = dudu.model!.requests.findLast((entry: any) => /hello after the restart/.test(entry.prompt));
  assert.ok(request.messages.some((message: any) => /hello again/.test(JSON.stringify(message))), 'the history of the Pi session is resumed');
});

test('a message written while Pi works is taken into the same turn', async () => {
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder, provider: 'pi' });
  await probe({ action: 'prompt', sessionId, text: 'STEERME first' });
  await until(() => history(sessionId), (value) => value.events.some((event: any) => event.type === 'step/start'), 'the turn to start');
  await probe({ action: 'prompt', sessionId, mode: 'steer', text: 'and then this, please' });
  const { events } = await until(() => history(sessionId), (value) => turnsEnded(value.events).length >= 1, 'the turn to end', 60_000);
  const sent = JSON.stringify(dudu.model!.requests.map((entry: any) => entry.messages));
  assert.match(sent, /and then this, please/, 'Pi was told');
  assert.equal(events.filter((event: any) => event.type === 'user/message' && JSON.stringify(event.data).includes('and then this, please')).length, 1, 'once');
});

test('/compact compacts a Pi session by Pi itself, and a session too small to compact says so', async () => {
  const small = await probe({ action: 'create', cwd: dudu.folder, provider: 'pi' });
  const tiny = await probe({ action: 'execute', sessionId: small.sessionId, line: '/compact' });
  assert.equal(tiny.result?.kind ?? 'none', 'success', JSON.stringify(tiny));   // nothing was said yet: DSH's own "no history" answer
  const { sessionId } = await pi('one hello');
  for (const text of ['two hello', 'three hello', 'four hello']) await pi(`${text} ${'and some more words '.repeat(30)}`, { sessionId });
  const done = await probe({ action: 'execute', sessionId, line: '/compact' });
  assert.equal(done.result?.kind, 'success', JSON.stringify(done));
  const after = await pi('hello after compacting', { sessionId });
  assert.equal(turnsEnded(after.events).at(-1).data.reason.kind, 'completed');
  const request = dudu.model!.requests.findLast((entry: any) => /hello after compacting/.test(entry.prompt));
  assert.match(JSON.stringify(request.messages), /SUMMARY: the earlier work/, 'what Pi sends afterwards starts from its summary');
});

test('Pi compacts by itself when its context fills, and DSH shows the compaction', async () => {
  const { sessionId } = await pi('hello first');
  const run = await pi('BIGOUTPUT please', { sessionId });
  assert.equal(turnsEnded(run.events).at(-1).data.reason.kind, 'completed');
  const commands = run.events.filter((event: any) => event.type === 'command/run' && event.data.name === 'compact');
  assert.ok(commands.length >= 1, 'a compact row in the conversation');
  assert.equal(run.events.filter((event: any) => event.type === 'command/done' && event.data.kind === 'error').length, 0);
});

// DSH's goal driver writes each round as a user message of the source "goal"; the harness gets it like anything a person writes, and, having no update_goal, says in its
// last lines whether the goal is done (GOAL_COMPLETE, GOAL_BLOCKED: why), which the bridge turns into what update_goal would do.
const goalStatus = async (sessionId: string) => String((await probe({ action: 'execute', sessionId, line: '/goal' })).result?.text ?? '');
test('a goal runs in a Pi session round by round and is completed when Pi says it is', async () => {
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder, provider: 'pi' });
  const set = await probe({ action: 'execute', sessionId, line: '/goal Finish it: make the notes file say forty-three' });
  assert.equal(set.result?.kind, 'success', JSON.stringify(set));
  await until(() => goalStatus(sessionId), (text) => /Status: complete/.test(text), 'the goal to be complete', 60_000);
  const { events } = await history(sessionId);
  assert.equal(turnsEnded(events).length, 2, 'two rounds: the first said it was not done');
  assert.deepEqual(turnsEnded(events).map((event: any) => event.data.reason.kind), ['completed', 'completed']);
  assert.match(JSON.stringify(dudu.model!.requests.map((entry: any) => entry.prompt)), /GOAL_COMPLETE/, 'Pi was told how to say it is done');
  await delay(3000);
  assert.equal(turnsEnded((await history(sessionId)).events).length, 2, 'no round after the goal is complete');
});

test('a goal Pi cannot go on with is blocked with Pi\'s reason, and rounds stop', async () => {
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder, provider: 'pi' });
  await probe({ action: 'execute', sessionId, line: '/goal Stuck on it: open the vault' });
  const text = await until(() => goalStatus(sessionId), (value) => /Status: blocked/.test(value), 'the goal to be blocked', 60_000);
  assert.match(text, /the vault needs a password/);
  await delay(2500);
  assert.equal(turnsEnded((await history(sessionId)).events).length, 1);
});

test('pausing a goal stops the round that runs, and the Pi session goes on', async () => {
  const { sessionId } = await probe({ action: 'create', cwd: dudu.folder, provider: 'pi' });
  await probe({ action: 'execute', sessionId, line: '/goal SLOWME keep trying' });
  await until(() => history(sessionId), (value) => value.events.some((event: any) => event.type === 'step/start'), 'a round to start');
  await delay(1500);
  const paused = await probe({ action: 'execute', sessionId, line: '/goal pause' });
  assert.equal(paused.result?.kind, 'success', JSON.stringify(paused));
  await until(() => history(sessionId), (value) => turnsEnded(value.events).length >= 1, 'the round to stop', 20_000);
  const after = await pi('hello after the goal', { sessionId });
  assert.equal(turnsEnded(after.events).at(-1).data.reason.kind, 'completed');
  await probe({ action: 'execute', sessionId, line: '/goal clear' });
});
