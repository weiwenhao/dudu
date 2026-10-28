import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeNormalizer, childEnvironment, openElsewhere, permissionArgs, startClaude } from '../host/providers/drivers/claude.mjs';
import { CLAUDE_TOOLS, numberedLines } from '../host/providers/drivers/claude-tools.mjs';

// ---- the protocol, as captured from Claude Code 2.1.312 -------------------------------------------------------

const stream = (event: any, extra: any = {}) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: 's', ...extra });
const textStep = (text: string, stop = 'end_turn') => [
  stream({ type: 'message_start', message: { id: 'm1', usage: { input_tokens: 6, cache_read_input_tokens: 100, output_tokens: 1 } } }),
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  ...[...text].map((c) => stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } })),
  stream({ type: 'content_block_stop', index: 0 }),
  stream({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 12 } }),
  stream({ type: 'message_stop' }),
];
const toolStep = (id: string, name: string, json: string[]) => [
  stream({ type: 'message_start', message: { id: 'm2', usage: { input_tokens: 5, output_tokens: 1 } } }),
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
  stream({ type: 'content_block_stop', index: 0 }),
  stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name, input: {} } }),
  ...json.map((partial_json) => stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json } })),
  stream({ type: 'content_block_stop', index: 1 }),
  stream({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } }),
  stream({ type: 'message_stop' }),
];
const toolResult = (id: string, content: any, isError = false, result?: any) => ({
  type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, is_error: isError }] }, ...(result ? { tool_use_result: result } : {}),
});
const permission = (tool: string, input: any, extra: any = {}) => ({
  type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: tool, display_name: tool, input, tool_use_id: 'toolu_1', ...extra },
});

function run(messages: any[]) {
  const normalizer = new ClaudeNormalizer();
  return messages.flatMap((message) => normalizer.feed(message));
}

test('a text message becomes one step: deltas, then the step end with the real stop reason and usage', () => {
  const events = run([...textStep('Hi!'), { type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 6, output_tokens: 12 }, total_cost_usd: 0.01 }]);
  assert.deepEqual(events.map((event: any) => event.type), ['step-start', 'text-delta', 'text-delta', 'text-delta', 'step-end', 'turn-end']);
  assert.equal(events.filter((event: any) => event.type === 'text-delta').map((event: any) => event.text).join(''), 'Hi!');
  assert.deepEqual(events[4], { type: 'step-end', reason: 'stop', usage: { inputTokens: 106, outputTokens: 12, cacheReadTokens: 100 } });
  assert.deepEqual(events[5], { type: 'turn-end', ok: true, usage: { inputTokens: 6, outputTokens: 12 }, costUsd: 0.01 });
});

test('a tool call is emitted once its streamed input is complete, and its result arrives separately', () => {
  const events = run([
    ...toolStep('toolu_1', 'Bash', ['{"comm', 'and":"ls -la",', '"description":"List"}']),
    toolResult('toolu_1', 'a.txt', false, { stdout: 'a.txt', stderr: '', interrupted: false }),
  ]);
  assert.deepEqual(events.map((event: any) => event.type), ['step-start', 'tool-call', 'step-end', 'tool-result']);
  assert.deepEqual(events[1], { type: 'tool-call', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la', description: 'List' } });
  assert.equal(events[2].reason, 'tool-calls');
  assert.deepEqual(events[3], { type: 'tool-result', id: 'toolu_1', output: 'a.txt', isError: false, data: { stdout: 'a.txt', stderr: '', interrupted: false } });
});

test('Claude runs a tool while its message still streams, so a result may come before the step ends', () => {
  const [start, ...rest] = toolStep('toolu_1', 'Read', ['{"file_path":"/x"}']);
  const stop = rest.slice(-2);
  const events = run([start, ...rest.slice(0, -2), toolResult('toolu_1', [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }], true), ...stop]);
  assert.deepEqual(events.map((event: any) => event.type), ['step-start', 'tool-call', 'tool-result', 'step-end']);
  assert.deepEqual([events[2].output, events[2].isError], ['one[image]two', true]);
});

test('permission requests become requests on the tool call; a plan comes from the call that was just streamed', () => {
  const bash = run([permission('Bash', { command: 'rm x' }, { description: 'Remove x', title: 'ignored' })]);
  assert.deepEqual(bash, [{ type: 'permission-request', id: 'r1', toolCallId: 'toolu_1', toolName: 'Bash', input: { command: 'rm x' }, reason: 'Remove x' }]);

  const plan = run([...toolStep('toolu_1', 'ExitPlanMode', ['{"plan":"## Steps\\n1. do it"}']), permission('ExitPlanMode', {})]);
  assert.equal(plan.at(-1).reason, '## Steps\n1. do it');
  assert.equal(plan.at(-1).toolName, 'ExitPlanMode');
});

test('AskUserQuestion becomes a question request', () => {
  const input = { questions: [{ question: 'Which color?', header: 'Color', options: [{ label: 'red', description: 'warm' }, { label: 'blue' }], multiSelect: false }] };
  const [request] = run([permission('AskUserQuestion', input, { requires_user_interaction: true })]);
  assert.equal(request.type, 'question-request');
  assert.equal(request.toolCallId, 'toolu_1');
  assert.deepEqual(request.questions, [{ question: 'Which color?', header: 'Color', options: [{ label: 'red', description: 'warm' }, { label: 'blue', description: undefined }], multiSelect: false }]);
  assert.deepEqual(request.input, input);
});

test('how a turn fails decides its code: not logged in, interrupted, or anything else', () => {
  const login = run([{ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } },
    { type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error', result: 'Not logged in' }]);
  assert.equal(login[0].error.code, 'AUTH');
  const interrupted = run([{ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_tools', stop_reason: 'tool_use' }]);
  assert.equal(interrupted[0].error.code, 'ABORTED');
  const other = run([{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] }]);
  assert.equal(other[0].error.code, 'HARNESS_FAILED');
  assert.equal(other[0].error.message, 'boom');
});

test('what a subagent does inside is shown through its own Task call, not as steps of the turn', () => {
  const nested = textStep('inside').map((message: any) => ({ ...message, parent_tool_use_id: 'toolu_task' }));
  assert.deepEqual(run([...nested, { ...toolResult('toolu_x', 'inner'), parent_tool_use_id: 'toolu_task' }]), []);
});

// ---- tool cards -------------------------------------------------------------------------------------------------

test('tools are drawn with DSH cards: a terminal, diffs, numbered lines and search results', () => {
  const tool = (name: string) => CLAUDE_TOOLS.find((candidate: any) => candidate.name === name)!;
  assert.deepEqual(tool('Bash').presentCall({ command: 'ls', description: 'List' }), { card: 'terminal', title: 'ls', description: 'List' });
  assert.deepEqual(tool('Bash').presentResult({}, { output: 'x', data: { stdout: 'out', stderr: 'err' } }), { card: 'terminal', output: 'out\nerr' });
  assert.deepEqual(tool('Edit').presentCall({ file_path: '/a.ts', old_string: 'a', new_string: 'b' }), {
    card: 'diff', title: 'Edit /a.ts', diffs: [{ path: '/a.ts', oldText: 'a', newText: 'b' }], locations: [{ path: '/a.ts' }],
  });
  assert.deepEqual(tool('Write').presentCall({ file_path: '/a.ts', content: 'hello' }).diffs, [{ path: '/a.ts', oldText: null, newText: 'hello' }]);
  assert.equal(tool('MultiEdit').presentCall({ file_path: '/a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }).diffs.length, 2);
  assert.equal(tool('Edit').presentResult({ file_path: '/a.ts', old_string: 'a', new_string: 'b' }, { output: 'denied', isError: true }).card, 'generic');
  const lines = numberedLines('     1→first\n     2→second\n\nnote');
  assert.deepEqual(lines, [{ number: 1, text: 'first' }, { number: 2, text: 'second' }]);
  assert.deepEqual(tool('Read').presentResult({ file_path: '/a.ts' }, { output: '     5→x\n     6→y' }), { card: 'read', path: '/a.ts', offset: 5, lines: [{ number: 5, text: 'x' }, { number: 6, text: 'y' }], totalLines: 6 });
  assert.equal(tool('Read').presentResult({ file_path: '/a.ts' }, { output: 'Error', isError: true }), undefined);
  assert.deepEqual(tool('Glob').presentResult({}, { output: '/a/b.ts\n/a/c.ts' }), { card: 'search', shape: 'paths', paths: ['/a/b.ts', '/a/c.ts'], truncated: false, total: 2 });
});

// ---- permission mapping, environment, registry ------------------------------------------------------------------

test('the DSH access mode becomes explicit Claude permission flags', () => {
  assert.deepEqual(permissionArgs('danger-full-access'), ['--dangerously-skip-permissions']);
  assert.deepEqual(permissionArgs('workspace-write'), ['--permission-mode', 'default']);
  assert.deepEqual(permissionArgs('read-only'), ['--permission-mode', 'plan']);
  assert.deepEqual(permissionArgs('auto'), ['--permission-mode', 'auto']);
  assert.deepEqual(permissionArgs(undefined), ['--permission-mode', 'default']);
});

test('the child does not inherit another harness\'s identity and keeps its sessions visible to the terminal', () => {
  const env = childEnvironment({ PATH: '/bin', HOME: '/h', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', ORCA_PANE_KEY: 'p', HERDR_X: '1', ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_ENTRYPOINT: 'dudu' });
});

test('a session another live Claude Code process holds is found in its registry', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dudu-claude-registry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, '111.json'), JSON.stringify({ pid: 111, sessionId: 'busy-session', status: 'idle' }));
  await writeFile(join(directory, '222.json'), JSON.stringify({ pid: 222, sessionId: 'dead-session' }));
  await writeFile(join(directory, 'broken.json'), '{');
  const alive = (pid: number) => pid === 111;
  assert.equal((await openElsewhere('busy-session', { directory, alive }))?.pid, 111);
  assert.equal(await openElsewhere('dead-session', { directory, alive }), undefined);
  assert.equal(await openElsewhere('unknown', { directory, alive }), undefined);
  assert.equal(await openElsewhere('x', { directory: join(directory, 'missing'), alive }), undefined);
});

// ---- the process -------------------------------------------------------------------------------------------------

const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const out = process.env.FAKE_OUT;
const scenario = process.env.FAKE_SCENARIO || 'text';
fs.writeFileSync(out + '/argv.json', JSON.stringify({ argv: process.argv.slice(2), entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT, cwd: process.cwd(), orca: process.env.ORCA_X ?? null }));
const lines = [];
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const stream = (event) => send({ type: 'stream_event', event, parent_tool_use_id: null });
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\\n')) >= 0) { const line = buffer.slice(0, at); buffer = buffer.slice(at + 1); if (line) handle(JSON.parse(line)); }
});
process.stdin.on('end', () => process.exit(scenario === 'crash' ? 3 : 0));
function say(text) {
  stream({ type: 'message_start', message: { id: 'm', usage: { input_tokens: 1 } } });
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  stream({ type: 'content_block_stop', index: 0 });
  stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } });
  stream({ type: 'message_stop' });
}
function handle(message) {
  fs.appendFileSync(out + '/stdin.jsonl', JSON.stringify(message) + '\\n');
  if (message.type === 'user' && scenario === 'text') { say('Hello from the fake'); send({ type: 'result', subtype: 'success', is_error: false, usage: {} }); }
  if (message.type === 'user' && scenario === 'ask') {
    send({ type: 'control_request', request_id: 'req1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'touch x' }, tool_use_id: 'toolu_1', description: 'Create x' } });
  }
  if (message.type === 'user' && scenario === 'question') {
    send({ type: 'control_request', request_id: 'req2', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{ label: 'a' }, { label: 'b' }] }] }, tool_use_id: 'toolu_2' } });
  }
  if (message.type === 'control_response') { say('got it'); send({ type: 'result', subtype: 'success', is_error: false, usage: {} }); }
  if (message.type === 'control_request' && message.request.subtype === 'interrupt') { send({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_tools' }); }
  if (message.type === 'user' && scenario === 'crash') { process.stderr.write('boom: something broke\\n'); process.exit(3); }
}
`;

async function fakeClaude(t: { after: (callback: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'dudu-claude-fake-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'claude');
  await writeFile(path, FAKE);
  await chmod(path, 0o755);
  await mkdir(join(directory, 'out'));
  const registry = { directory: join(directory, 'no-sessions') };
  return { path, out: join(directory, 'out'), directory, registry };
}

async function collect(handle: any) {
  const events: any[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

async function start(fake: any, scenario: string, options: any = {}) {
  process.env.FAKE_OUT = fake.out;
  process.env.FAKE_SCENARIO = scenario;
  process.env.ORCA_X = 'leaked';
  return startClaude({ path: fake.path, cwd: fake.directory, prompt: 'hello', registry: fake.registry, ...options });
}

test('a turn starts a new session with explicit flags, the prompt, and a clean environment, and ends with the process', async (t) => {
  const fake = await fakeClaude(t);
  const handle = await start(fake, 'text', { model: 'opus', effort: 'high', permission: 'workspace-write' });
  const events = await collect(handle);
  assert.deepEqual(events.map((event) => event.type), ['step-start', 'text-delta', 'step-end', 'turn-end']);
  const seen = JSON.parse(await readFile(join(fake.out, 'argv.json'), 'utf8'));
  assert.ok(seen.argv.includes('--permission-prompt-tool') && seen.argv.includes('--include-partial-messages'));
  assert.deepEqual(seen.argv.slice(seen.argv.indexOf('--permission-mode'), seen.argv.indexOf('--permission-mode') + 2), ['--permission-mode', 'default']);
  assert.deepEqual(seen.argv.slice(seen.argv.indexOf('--model'), seen.argv.indexOf('--model') + 2), ['--model', 'opus']);
  assert.deepEqual(seen.argv.slice(seen.argv.indexOf('--effort'), seen.argv.indexOf('--effort') + 2), ['--effort', 'high']);
  assert.ok(seen.argv.includes(`--session-id=${handle.nativeSessionId}`));
  assert.equal(seen.entrypoint, 'dudu');
  assert.equal(seen.orca, null);
  assert.equal(seen.cwd.endsWith(fake.directory.split('/').pop()), true);
  const stdin = (await readFile(join(fake.out, 'stdin.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(stdin[0], { type: 'user', message: { role: 'user', content: 'hello' }, parent_tool_use_id: null });
});

test('the model picker\'s default means no model flag, and a resumed session is resumed by id', async (t) => {
  const fake = await fakeClaude(t);
  const handle = await start(fake, 'text', { model: 'default', resume: 'abc-123', permission: 'danger-full-access' });
  await collect(handle);
  const { argv } = JSON.parse(await readFile(join(fake.out, 'argv.json'), 'utf8'));
  assert.equal(argv.includes('--model'), false);
  assert.ok(argv.includes('--resume=abc-123'));
  assert.equal(argv.some((value: string) => value.startsWith('--session-id')), false);
  assert.ok(argv.includes('--dangerously-skip-permissions'));
  assert.equal(handle.nativeSessionId, 'abc-123');
});

test('a permission decision goes back in the protocol\'s shape, with the original input', async (t) => {
  const fake = await fakeClaude(t);
  const handle = await start(fake, 'ask');
  const events: any[] = [];
  for await (const event of handle.events) {
    events.push(event);
    if (event.type === 'permission-request') handle.respondPermission(event.id, { behavior: 'allow' });
  }
  assert.equal(events.find((event) => event.type === 'permission-request').reason, 'Create x');
  assert.equal(events.at(-1).ok, true);
  const stdin = (await readFile(join(fake.out, 'stdin.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(stdin.find((message) => message.type === 'control_response'), {
    type: 'control_response', response: { subtype: 'success', request_id: 'req1', response: { behavior: 'allow', updatedInput: { command: 'touch x' }, toolUseID: 'toolu_1' } },
  });
});

test('a denial carries its message, and an answered question is keyed by the question text', async (t) => {
  const denied = await fakeClaude(t);
  const first = await start(denied, 'ask');
  for await (const event of first.events) if (event.type === 'permission-request') first.respondPermission(event.id, { behavior: 'deny', message: 'No.' });
  const response = (await readFile(join(denied.out, 'stdin.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).find((message) => message.type === 'control_response');
  assert.deepEqual(response.response.response, { behavior: 'deny', message: 'No.', toolUseID: 'toolu_1' });

  const asked = await fakeClaude(t);
  const second = await start(asked, 'question');
  for await (const event of second.events) {
    if (event.type === 'question-request') second.respondQuestion(event.id, { answers: [{ question: event.questions[0], selected: ['b'], custom: 'and c' }] });
  }
  const answer = (await readFile(join(asked.out, 'stdin.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).find((message) => message.type === 'control_response');
  assert.deepEqual(answer.response.response.updatedInput.answers, { 'Which?': 'b, and c' });
  assert.equal(answer.response.response.behavior, 'allow');
});

test('stopping sends the interrupt and the turn ends as interrupted', async (t) => {
  const fake = await fakeClaude(t);
  const handle = await start(fake, 'ask');
  const events: any[] = [];
  for await (const event of handle.events) {
    events.push(event);
    if (event.type === 'permission-request') await handle.interrupt();
  }
  assert.equal(events.at(-1).error.code, 'ABORTED');
  const stdin = (await readFile(join(fake.out, 'stdin.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(stdin.some((message) => message.type === 'control_request' && message.request.subtype === 'interrupt'));
});

test('a process that dies without a result is a failed turn that says what it printed', async (t) => {
  const fake = await fakeClaude(t);
  const events = await collect(await start(fake, 'crash'));
  assert.equal(events.at(-1).error.code, 'HARNESS_EXITED');
  assert.match(events.at(-1).error.message, /exited \(3\).*boom: something broke/);
});

test('a session open in another process is refused, and a missing binary or an aborted request never spawns', async (t) => {
  const fake = await fakeClaude(t);
  const directory = join(fake.directory, 'sessions');
  await mkdir(directory);
  await writeFile(join(directory, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'taken' }));
  await assert.rejects(startClaude({ path: fake.path, cwd: fake.directory, prompt: 'x', resume: 'taken', registry: { directory } }), (error: any) => error.code === 'HARNESS_BUSY');

  const missing = await startClaude({ path: join(fake.directory, 'nowhere'), cwd: fake.directory, prompt: 'x', registry: fake.registry });
  const events = await collect(missing);
  assert.equal(events.at(-1).error.code, 'HARNESS_UNAVAILABLE');

  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(startClaude({ path: fake.path, cwd: fake.directory, prompt: 'x', signal: controller.signal }), /stopped/);
});

test('closing a running harness ends its process', async (t) => {
  const fake = await fakeClaude(t);
  const handle = await start(fake, 'ask');
  await handle.close();
  const events = await collect(handle);
  assert.equal(events.at(-1).type, 'turn-end');
});

test('a session whose folder is gone says so, instead of blaming the binary', async (t) => {
  const fake = await fakeClaude(t);
  await assert.rejects(startClaude({ path: fake.path, cwd: join(fake.directory, 'deleted'), prompt: 'x', registry: fake.registry }), (error: any) => error.code === 'HARNESS_BAD_CWD');
});
