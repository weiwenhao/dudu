import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexNormalizer, childEnvironment, permissionSettings, startCodex, toolCallOf, toolResultOf } from '../host/providers/drivers/codex.mjs';
import { CODEX_TOOLS } from '../host/providers/drivers/codex-tools.mjs';

// ---- the protocol, as captured from codex-cli 0.162.1 ------------------------------------------------------------

const note = (method: string, params: any) => ({ method, params });
const started = (item: any) => note('item/started', { threadId: 't', turnId: 'u', item });
const completed = (item: any) => note('item/completed', { threadId: 't', turnId: 'u', item });
const turnDone = (status: string, error: any = null) => note('turn/completed', { threadId: 't', turn: { id: 'u', status, error } });
const usage = () => note('thread/tokenUsage/updated', { threadId: 't', turnId: 'u', tokenUsage: { total: { inputTokens: 90 }, last: { inputTokens: 48230, cachedInputTokens: 27264, outputTokens: 42, reasoningOutputTokens: 5 } } });

function run(messages: any[]) {
  const normalizer = new CodexNormalizer();
  return messages.flatMap((message) => normalizer.feed(message));
}
const command = (status = 'inProgress', extra: any = {}) => ({ type: 'commandExecution', id: 'exec-1', command: "/bin/zsh -lc 'ls'", cwd: '/work', status, aggregatedOutput: null, exitCode: null, ...extra });

test('a message streams inside one step; its completed text is not repeated, and usage rides on the end', () => {
  const events = run([
    note('turn/started', { turn: { id: 'u' } }),
    started({ type: 'agentMessage', id: 'm1', text: '', phase: 'final_answer' }),
    note('item/agentMessage/delta', { itemId: 'm1', delta: 'DO' }),
    note('item/agentMessage/delta', { itemId: 'm1', delta: 'NE' }),
    completed({ type: 'agentMessage', id: 'm1', text: 'DONE' }),
    usage(), turnDone('completed'),
  ]);
  assert.deepEqual(events.map((event: any) => event.type), ['step-start', 'text-delta', 'text-delta', 'step-end', 'turn-end']);
  assert.deepEqual(events[3], { type: 'step-end', reason: 'stop', usage: { inputTokens: 48230, outputTokens: 42, cacheReadTokens: 27264, reasoningTokens: 5 } });
  assert.equal(events[4].ok, true);
});

test('text and reasoning that only arrive on completion are still shown', () => {
  const events = run([
    started({ type: 'reasoning', id: 'r1', summary: [], content: [] }),
    completed({ type: 'reasoning', id: 'r1', summary: ['Look first', 'Then act'], content: [] }),
    started({ type: 'agentMessage', id: 'm1', text: '' }), completed({ type: 'agentMessage', id: 'm1', text: 'All set.' }),
    turnDone('completed'),
  ]);
  assert.deepEqual(events.filter((event: any) => event.type.endsWith('-delta')), [
    { type: 'reasoning-delta', text: 'Look first\n\nThen act' }, { type: 'text-delta', text: 'All set.' },
  ]);
});

test('each tool call closes its step, and the result arrives with the finished item', () => {
  const events = run([
    started({ type: 'agentMessage', id: 'm1', text: '' }), note('item/agentMessage/delta', { itemId: 'm1', delta: 'Listing.' }),
    started(command()),
    note('item/commandExecution/outputDelta', { itemId: 'exec-1', delta: 'a\n' }),
    completed(command('completed', { aggregatedOutput: 'a\n', exitCode: 0, durationMs: 12 })),
    started({ type: 'agentMessage', id: 'm2', text: '' }), note('item/agentMessage/delta', { itemId: 'm2', delta: 'Done' }), turnDone('completed'),
  ]);
  assert.deepEqual(events.map((event: any) => event.type), ['step-start', 'text-delta', 'tool-call', 'step-end', 'tool-result', 'step-start', 'text-delta', 'step-end', 'turn-end']);
  assert.deepEqual(events[2], { type: 'tool-call', id: 'exec-1', name: 'shell', input: { command: "/bin/zsh -lc 'ls'", cwd: '/work' } });
  assert.equal(events[3].reason, 'tool-calls');
  assert.deepEqual(events[4], { type: 'tool-result', id: 'exec-1', output: 'a\n', isError: false, data: { exitCode: 0, durationMs: 12 } });
});

test('file changes, MCP calls and searches are tool calls with results of their own', () => {
  const change = { path: '/a.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-a\n+b' };
  assert.deepEqual(toolCallOf({ type: 'fileChange', id: 'f', changes: [change] }), { name: 'apply_patch', input: { changes: [change] } });
  assert.deepEqual(toolResultOf({ type: 'fileChange', id: 'f', changes: [change], status: 'completed' }), { output: 'Applied 1 file change: /a.ts', isError: false, data: { changes: [change] } });
  assert.equal(toolResultOf({ type: 'fileChange', id: 'f', changes: [change], status: 'declined' }).isError, true);
  assert.deepEqual(toolCallOf({ type: 'mcpToolCall', id: 'x', server: 'notion', tool: 'search', arguments: { query: 'q' } }), { name: 'mcp__notion__search', input: { query: 'q' } });
  assert.deepEqual(toolResultOf({ type: 'mcpToolCall', id: 'x', status: 'completed', result: { content: [{ type: 'text', text: 'found' }] } }), { output: 'found', isError: false });
  assert.deepEqual(toolResultOf({ type: 'mcpToolCall', id: 'x', status: 'failed', error: { message: 'timeout' } }), { output: 'timeout', isError: true });
  assert.deepEqual(toolCallOf({ type: 'webSearch', id: 'w', query: 'dsh' }), { name: 'web_search', input: { query: 'dsh' } });
  assert.equal(toolCallOf({ type: 'plan', id: 'p', text: 'x' }), undefined);
  assert.equal(toolResultOf(command('failed', { aggregatedOutput: 'no' })).isError, true);
});

test('approval, file approval and user-input requests become requests on the item; others are answered at once', () => {
  const [shell] = run([{ id: 0, method: 'item/commandExecution/requestApproval', params: { itemId: 'exec-1', command: 'rm x', reason: 'Needs write', availableDecisions: ['accept', 'cancel'] } }]);
  assert.deepEqual(shell, { type: 'permission-request', id: 0, toolCallId: 'exec-1', toolName: 'shell', input: { command: 'rm x' }, reason: 'Needs write', decisions: ['accept', 'cancel'] });
  const [patch] = run([{ id: 1, method: 'item/fileChange/requestApproval', params: { itemId: 'f1' } }]);
  assert.equal(patch.toolName, 'apply_patch');
  const [ask] = run([{ id: 2, method: 'item/tool/requestUserInput', params: { itemId: 'i1', isBlocking: true, questions: [{ id: 'color', header: 'Color', question: 'Red or blue?', options: [{ label: 'Red', description: 'warm' }, { label: 'Blue' }] }] } }]);
  assert.equal(ask.type, 'question-request');
  assert.deepEqual(ask.questions, [{ question: 'Red or blue?', header: 'Color', ids: 'color', options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: undefined }] }]);
  assert.deepEqual(run([{ id: 3, method: 'item/permissions/requestApproval', params: {} }]), [{ type: 'reply', id: 3, result: { permissions: {}, scope: 'turn' } }]);
  assert.deepEqual(run([{ id: 4, method: 'mcpServer/elicitation/request', params: {} }]), [{ type: 'reply', id: 4, result: { action: 'decline', content: null, _meta: null } }]);
  assert.equal(run([{ id: 5, method: 'item/tool/call', params: {} }])[0].error.code, -32601);
});

test('how a turn ends decides its code: interrupted, not logged in, or failed', () => {
  assert.equal(run([turnDone('interrupted')]).at(-1).error.code, 'ABORTED');
  assert.equal(run([turnDone('failed', { message: 'Reconnecting... 5/5', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } } })]).at(-1).error.code, 'AUTH');
  const failed = run([note('error', { error: { message: 'retrying' }, willRetry: true }), note('error', { error: { message: 'model overloaded' }, willRetry: false }), turnDone('failed')]).at(-1);
  assert.equal(failed.error.code, 'HARNESS_FAILED');
  assert.equal(failed.error.message, 'model overloaded');
});

test('tools are drawn with DSH cards', () => {
  const tool = (name: string) => CODEX_TOOLS.find((candidate: any) => candidate.name === name)!;
  assert.deepEqual(tool('shell').presentCall({ command: 'ls', cwd: '/w' }), { card: 'terminal', title: 'ls', cwd: '/w' });
  assert.deepEqual(tool('shell').presentResult({}, { output: 'x', data: { exitCode: 2 } }), { card: 'terminal', output: 'x', exitCode: 2 });
  const changes = [{ path: '/a.ts', kind: { type: 'add' }, diff: '+x' }];
  assert.equal(tool('apply_patch').presentCall({ changes }).title, 'Add /a.ts');
  assert.equal(tool('apply_patch').presentResult({ changes }, { output: '', isError: false }).title, 'Added /a.ts');
  assert.equal(tool('apply_patch').presentResult({ changes }, { output: 'declined', isError: true }).title, 'The edit was not applied');
});

test('access modes become explicit approval and sandbox settings, and the child keeps the user\'s CODEX_HOME', () => {
  assert.deepEqual(permissionSettings('danger-full-access'), { approvalPolicy: 'never', sandbox: 'danger-full-access', sandboxPolicy: { type: 'dangerFullAccess' } });
  assert.equal(permissionSettings('read-only').sandbox, 'read-only');
  assert.equal(permissionSettings('auto').approvalsReviewer, 'auto_review');
  assert.deepEqual([permissionSettings(undefined).approvalPolicy, permissionSettings(undefined).sandbox], ['on-request', 'workspace-write']);
  assert.deepEqual(childEnvironment({ PATH: '/bin', CODEX_HOME: '/h/.codex', CODEX_THREAD_ID: 'x', CODEX_SANDBOX: '1', ORCA_PANE_KEY: 'p' }), { PATH: '/bin', CODEX_HOME: '/h/.codex' });
});

// ---- the process ---------------------------------------------------------------------------------------------------

const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const out = process.env.FAKE_OUT;
const scenario = process.env.FAKE_SCENARIO || 'text';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('end', () => process.exit(0));
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\\n')) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (line) handle(JSON.parse(line)); }
});
const item = (value) => ({ threadId: 'thread-1', turnId: 'turn-1', item: value });
function say(text) {
  send({ method: 'item/started', params: item({ type: 'agentMessage', id: 'm1', text: '' }) });
  send({ method: 'item/agentMessage/delta', params: { itemId: 'm1', delta: text } });
  send({ method: 'item/completed', params: item({ type: 'agentMessage', id: 'm1', text }) });
  send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } } });
}
function handle(message) {
  fs.appendFileSync(out + '/stdin.jsonl', JSON.stringify(message) + '\\n');
  if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake', codexHome: '/h' } });
  else if (message.method === 'account/read') send({ id: message.id, result: scenario === 'login' ? { account: null, requiresOpenaiAuth: true } : { account: { type: 'chatgpt' }, requiresOpenaiAuth: false } });
  else if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-1' } } });
  else if (message.method === 'thread/resume') {
    if (scenario === 'busy') send({ id: message.id, error: { code: -32600, message: 'thread thread-9 already has an active writer' } });
    else send({ id: message.id, result: { thread: { id: message.params.threadId } } });
  } else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    if (scenario === 'text' || scenario === 'busy') say('Hello from the fake');
    if (scenario === 'approve') {
      send({ method: 'item/started', params: item({ type: 'commandExecution', id: 'exec-1', command: 'touch x', cwd: '/w', status: 'inProgress', aggregatedOutput: null, exitCode: null }) });
      send({ id: 0, method: 'item/commandExecution/requestApproval', params: { itemId: 'exec-1', command: 'touch x', availableDecisions: ['accept', 'decline', 'cancel'] } });
    }
    if (scenario === 'question') send({ id: 7, method: 'item/tool/requestUserInput', params: { itemId: 'q1', isBlocking: true, questions: [{ id: 'color', header: 'Color', question: 'Which?', options: [{ label: 'red' }, { label: 'blue' }] }] } });
  } else if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', error: null } } });
  } else if (message.method === 'turn/steer') send({ id: message.id, result: { turnId: 'turn-1' } });
  else if (message.id === 0 || message.id === 7) say('got it');
}
`;

async function fakeCodex(t: { after: (callback: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'dudu-codex-fake-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'codex');
  await writeFile(path, FAKE);
  await chmod(path, 0o755);
  await mkdir(join(directory, 'out'));
  return { path, out: join(directory, 'out'), directory };
}

const sent = async (fake: any) => (await readFile(join(fake.out, 'stdin.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

async function begin(fake: any, scenario: string, options: any = {}) {
  process.env.FAKE_OUT = fake.out;
  process.env.FAKE_SCENARIO = scenario;
  return startCodex({ path: fake.path, cwd: fake.directory, prompt: 'hello', permission: 'workspace-write', ...options });
}

async function collect(handle: any, onEvent?: (event: any) => void) {
  const events: any[] = [];
  for await (const event of handle.events) { events.push(event); onEvent?.(event); }
  return events;
}

test('a turn starts a thread with explicit settings, sends the prompt, and ends with the process', async (t) => {
  const fake = await fakeCodex(t);
  const handle = await begin(fake, 'text', { model: 'codex/gpt-6-luna', effort: 'low' });
  assert.equal(handle.nativeSessionId, 'thread-1');
  const events = await collect(handle);
  assert.deepEqual(events.map((event) => event.type), ['step-start', 'text-delta', 'step-end', 'turn-end']);
  const requests = await sent(fake);
  assert.deepEqual(requests.map((message) => message.method), ['initialize', 'initialized', 'account/read', 'thread/start', 'turn/start']);
  assert.deepEqual(requests[3].params, { cwd: fake.directory, model: 'codex/gpt-6-luna', approvalPolicy: 'on-request', sandbox: 'workspace-write', ephemeral: false, serviceName: 'dudu' });
  assert.equal(requests[4].params.threadId, 'thread-1');
  assert.deepEqual(requests[4].params.input, [{ type: 'text', text: 'hello', text_elements: [] }]);
  assert.equal(requests[4].params.effort, 'low');
  assert.equal(requests[4].params.sandboxPolicy.type, 'workspaceWrite');
  assert.equal(requests[1].method === 'initialized' && requests[0].params.capabilities.experimentalApi, true);
});

test('a later turn resumes the thread, and settings are passed again because they stick to a thread', async (t) => {
  const fake = await fakeCodex(t);
  const handle = await begin(fake, 'text', { resume: 'thread-42', permission: 'danger-full-access' });
  await collect(handle);
  const requests = await sent(fake);
  const resume = requests.find((message) => message.method === 'thread/resume');
  assert.deepEqual(resume.params, { threadId: 'thread-42', cwd: fake.directory, approvalPolicy: 'never', sandbox: 'danger-full-access' });
  assert.equal(requests.some((message) => message.method === 'thread/start'), false);
  assert.equal(requests.find((message) => message.method === 'turn/start').params.approvalPolicy, 'never');
});

test('a decision goes back to the server request that asked, as one of the offered decisions', async (t) => {
  const allowed = await fakeCodex(t);
  const first = await begin(allowed, 'approve');
  const events = await collect(first, (event) => { if (event.type === 'permission-request') first.respondPermission(event.id, { behavior: 'allow' }); });
  assert.equal(events.find((event) => event.type === 'permission-request').toolCallId, 'exec-1');
  assert.deepEqual((await sent(allowed)).find((message) => message.id === 0 && message.result), { id: 0, result: { decision: 'accept' } });

  const refused = await fakeCodex(t);
  const second = await begin(refused, 'approve');
  await collect(second, (event) => { if (event.type === 'permission-request') second.respondPermission(event.id, { behavior: 'deny' }); });
  assert.deepEqual((await sent(refused)).find((message) => message.id === 0 && message.result), { id: 0, result: { decision: 'decline' } });
});

test('answers to a question are sent keyed by the question id', async (t) => {
  const fake = await fakeCodex(t);
  const handle = await begin(fake, 'question');
  await collect(handle, (event) => {
    if (event.type === 'question-request') handle.respondQuestion(event.id, { answers: [{ question: event.questions[0], selected: ['blue'], custom: 'maybe teal' }] });
  });
  assert.deepEqual((await sent(fake)).find((message) => message.id === 7 && message.result), { id: 7, result: { answers: { color: { answers: ['blue', 'maybe teal'] } } } });
});

test('stopping interrupts the turn by its id and the turn ends as interrupted; steering names the turn it joins', async (t) => {
  const fake = await fakeCodex(t);
  const handle = await begin(fake, 'approve');
  handle.pushUserMessage('also run the tests');
  const events = await collect(handle, (event) => { if (event.type === 'permission-request') void handle.interrupt(); });
  assert.equal(events.at(-1).error.code, 'ABORTED');
  const requests = await sent(fake);
  assert.deepEqual(requests.find((message) => message.method === 'turn/interrupt').params, { threadId: 'thread-1', turnId: 'turn-1' });
  assert.deepEqual(requests.find((message) => message.method === 'turn/steer').params, { threadId: 'thread-1', expectedTurnId: 'turn-1', input: [{ type: 'text', text: 'also run the tests', text_elements: [] }] });
});

test('a thread another process writes, a missing login and a missing binary are refused before any turn', async (t) => {
  const fake = await fakeCodex(t);
  await assert.rejects(begin(fake, 'busy', { resume: 'thread-9' }), (error: any) => error.code === 'HARNESS_BUSY');
  const login = await fakeCodex(t);
  await assert.rejects(begin(login, 'login'), (error: any) => error.code === 'AUTH');
  assert.equal((await sent(login)).some((message) => message.method === 'thread/start'), false);
  await assert.rejects(startCodex({ path: join(fake.directory, 'nowhere'), cwd: fake.directory, prompt: 'x' }), (error: any) => error.code === 'HARNESS_UNAVAILABLE');
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(startCodex({ path: fake.path, cwd: fake.directory, prompt: 'x', signal: controller.signal }), /stopped/);
});

test('a session whose folder is gone says so, instead of blaming the binary', async (t) => {
  const fake = await fakeCodex(t);
  await assert.rejects(startCodex({ path: fake.path, cwd: join(fake.directory, 'deleted'), prompt: 'x' }), (error: any) => error.code === 'HARNESS_BAD_CWD' && /folder is not available/.test(error.message));
});
