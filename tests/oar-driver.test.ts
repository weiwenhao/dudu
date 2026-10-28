import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedRuntime } from '@botiverse/oar/testing';
import { ClaudeNormalizer, ENTRYPOINT, WRITING_TOOLS, createClaudeProvider, openElsewhere } from '../host/providers/drivers/claude.mjs';
import { CodexNormalizer, createCodexProvider, sandboxOf, toolCallOf, toolResultOf } from '../host/providers/drivers/codex.mjs';
import { CLAUDE_TOOLS, numberedLines } from '../host/providers/drivers/claude-tools.mjs';
import { CODEX_TOOLS } from '../host/providers/drivers/codex-tools.mjs';
import { contentText, parseInput, scrubbedEnvironment } from '../host/providers/oar.mjs';

// ---- OAR's records, as the normalizers read them ----------------------------------------------------------------

const frame = (events: any[], body: any = {}, agentPath: string[] = []) => ({ kind: 'frame', agentPath, seq: 1, body: { type: 'assistant', native: {}, events, ...body } });
const messageStop = (agentPath: string[] = []) => frame([], { type: 'stream_event', native: { type: 'stream_event', event: { type: 'message_stop' } } }, agentPath);
const said = (text: string) => frame([{ kind: 'text_delta', text, messageId: 'm1' }]);
const thought = (text: string) => frame([{ kind: 'reasoning', content: { kind: 'text', text }, messageId: 'm1' }]);
const callStarted = (callId: string, tool: string, input?: string) => frame([{ kind: 'tool_call_started', callId, tool, ...(input === undefined ? {} : { input }) }]);
const callInput = (callId: string, input: unknown) => frame([{ kind: 'tool_call_input', callId, input: JSON.stringify(input) }]);
const callEnded = (callId: string, text: string, result: 'ok' | 'failed' = 'ok', extra: any = {}) => frame([{ kind: 'tool_call_ended', callId, content: [{ type: 'text', text }], result, ...extra }]);
const turnEnded = (outcome: any) => frame([{ kind: 'turn_ended', outcome }]);

const claude = () => new ClaudeNormalizer({ name: 'Claude', login: 'Run `claude` in a terminal and sign in.' });
const codex = () => new CodexNormalizer({ name: 'ChatGPT', login: 'Run `codex login` in a terminal.' });
const run = (normalizer: any, records: any[]) => records.flatMap((record) => normalizer.feed(record));
const types = (events: any[]) => events.map((event) => event.type);

test('a Claude message is one step: reasoning and text stream in it, and the end of the message closes it', () => {
  const events = run(claude(), [thought('Let me think.'), said('Hi'), said('!'), messageStop(), turnEnded({ kind: 'completed' })]);
  assert.deepEqual(types(events), ['reasoning-delta', 'text-delta', 'text-delta', 'step-end', 'turn-end']);
  assert.equal(events.filter((event) => event.type === 'text-delta').map((event) => event.text).join(''), 'Hi!');
  assert.deepEqual(events[3], { type: 'step-end', reason: 'stop' });
  assert.deepEqual(events[4], { type: 'turn-end', ok: true });
});

test('a tool call is announced once its input is complete, the message end closes the step, and the result comes later', () => {
  const normalizer = claude();
  const first = run(normalizer, [said('Reading.'), callStarted('t1', 'Read'), callInput('t1', { file_path: '/a.ts' }), callInput('t1', { file_path: '/other' }), messageStop()]);
  assert.deepEqual(types(first), ['text-delta', 'tool-call', 'step-end']);
  assert.deepEqual(first[1], { type: 'tool-call', id: 't1', name: 'Read', input: { file_path: '/a.ts' } });
  assert.deepEqual(first[2], { type: 'step-end', reason: 'tool-calls' });
  const later = run(normalizer, [callEnded('t1', '     1→x'), said('Done.'), messageStop(), turnEnded({ kind: 'completed' })]);
  assert.deepEqual(types(later), ['tool-result', 'text-delta', 'step-end', 'turn-end']);
  assert.deepEqual(later[0], { type: 'tool-result', id: 't1', output: '     1→x', isError: false });
});

test('Claude runs a tool while its message still streams, so a result before the end of the message closes the step first', () => {
  const events = run(claude(), [callStarted('t1', 'Bash'), callInput('t1', { command: 'ls' }), callEnded('t1', 'a\nb'), messageStop()]);
  assert.deepEqual(types(events), ['tool-call', 'step-end', 'tool-result']);
});

test('calls of one message share its step', () => {
  const events = run(claude(), [callStarted('a', 'Read'), callInput('a', {}), callStarted('b', 'Grep'), callInput('b', {}), messageStop()]);
  assert.deepEqual(types(events), ['tool-call', 'tool-call', 'step-end']);
});

test('a failed tool is a failed result with the exit code kept', () => {
  const events = run(claude(), [callStarted('t1', 'Bash'), callInput('t1', {}), messageStop(), callEnded('t1', 'boom', 'failed', { exitCode: 2 })]);
  assert.deepEqual(events.at(-1), { type: 'tool-result', id: 't1', output: 'boom', isError: true, data: { exitCode: 2 } });
});

test('what a subagent does inside is shown through its own call, not as steps of the turn', () => {
  const nested = [said('inside'), callStarted('x', 'Read'), messageStop(['toolu_task'])].map((record) => ({ ...record, agentPath: ['toolu_task'] }));
  assert.deepEqual(run(claude(), nested), []);
});

test('results of calls the bridge never heard of are ignored', () => {
  assert.deepEqual(run(claude(), [callEnded('ghost', 'x'), callInput('ghost', {})]), []);
});

test('how a turn ends decides its code: interrupted, not logged in, or anything else with its class', () => {
  const end = (outcome: any) => run(claude(), [turnEnded(outcome)]).at(-1);
  assert.equal(end({ kind: 'aborted' }).error.code, 'ABORTED');
  const auth = end({ kind: 'failed', failure: 'auth', reason: 'Invalid API key' }).error;
  assert.equal(auth.code, 'AUTH');
  assert.equal(auth.message, 'Claude is not logged in. Run `claude` in a terminal and sign in.');
  const quota = end({ kind: 'failed', failure: 'quota', reason: 'Usage limit reached' }).error;
  assert.deepEqual([quota.code, quota.message, quota.failure], ['HARNESS_FAILED', 'Usage limit reached', 'quota']);
});

test('a request the harness makes of its host ends the turn, because nobody can answer it', () => {
  const normalizer = claude();
  const events = run(normalizer, [said('Asking.'), { kind: 'request', direction: 'toApp', id: 'r1', body: { kind: 'native', type: 'can_use_tool', native: {} } }]);
  assert.deepEqual(types(events), ['text-delta', 'step-end', 'turn-end']);
  assert.equal(events.at(-1).error.code, 'HARNESS_UNSUPPORTED');
  assert.match(events.at(-1).error.message, /Claude asked for something DSH cannot answer here \(can_use_tool\)/);
  assert.deepEqual(run(normalizer, [said('late')]), [], 'nothing after the end of the turn');
});

test('a process that exits before the turn ends is a failed turn', () => {
  const events = run(claude(), [said('Working'), { kind: 'response', requestId: '', body: { kind: 'exited', code: 137 } }]);
  assert.equal(events.at(-1).error.code, 'HARNESS_EXITED');
  assert.match(events.at(-1).error.message, /Claude exited \(137\)/);
});

// ---- Codex ------------------------------------------------------------------------------------------------------

const item = (method: 'item/started' | 'item/completed', native: any, events: any[]) => frame(events, { type: method, native: { threadId: 't', turnId: 'u', item: native } });
const command = (status = 'inProgress', extra: any = {}) => ({ type: 'commandExecution', id: 'exec-1', command: "/bin/zsh -lc 'ls'", cwd: '/work', status, aggregatedOutput: null, exitCode: null, ...extra });

test('each Codex tool call closes its step, and the result arrives with the finished item', () => {
  const normalizer = codex();
  const first = run(normalizer, [
    said('Listing.'),
    item('item/started', command(), [{ kind: 'tool_call_started', callId: 'exec-1', tool: 'commandExecution', input: "/bin/zsh -lc 'ls'" }]),
  ]);
  assert.deepEqual(types(first), ['text-delta', 'tool-call', 'step-end']);
  assert.deepEqual(first[1], { type: 'tool-call', id: 'exec-1', name: 'shell', input: { command: "/bin/zsh -lc 'ls'", cwd: '/work' } });
  const done = run(normalizer, [
    item('item/completed', command('completed', { aggregatedOutput: 'a.txt\n', exitCode: 0, durationMs: 12 }), [{ kind: 'tool_call_ended', callId: 'exec-1', content: [{ type: 'text', text: 'a.txt\n' }], result: 'ok', exitCode: 0 }]),
    said('One file.'),
    turnEnded({ kind: 'completed' }),
  ]);
  assert.deepEqual(types(done), ['tool-result', 'text-delta', 'step-end', 'turn-end']);
  assert.deepEqual(done[0], { type: 'tool-result', id: 'exec-1', output: 'a.txt\n', isError: false, data: { exitCode: 0, durationMs: 12 } });
});

test('file changes, MCP calls and searches are tool calls with results of their own, named from the item', () => {
  const changes = [{ path: '/a.ts', kind: { type: 'add' }, diff: '+x' }];
  assert.deepEqual(toolCallOf({ type: 'fileChange', id: 'f', changes }), { name: 'apply_patch', input: { changes } });
  assert.deepEqual(toolCallOf({ type: 'mcpToolCall', id: 'm', server: 'docs', tool: 'search', arguments: { q: 'x' } }), { name: 'mcp__docs__search', input: { q: 'x' } });
  assert.deepEqual(toolCallOf({ type: 'webSearch', id: 'w', query: 'dsh' }), { name: 'web_search', input: { query: 'dsh' } });
  assert.equal(toolCallOf({ type: 'sleep', id: 's' }), undefined);
  assert.equal(toolResultOf({ type: 'fileChange', status: 'completed', changes }).output, 'Applied 1 file change: /a.ts');
  assert.equal(toolResultOf({ type: 'fileChange', status: 'declined', changes }).isError, true);
  assert.deepEqual(toolResultOf({ type: 'mcpToolCall', status: 'completed', result: { content: [{ type: 'text', text: 'found' }] } }), { output: 'found', isError: false });
  assert.equal(toolResultOf({ type: 'mcpToolCall', status: 'failed', error: { message: 'down' } }).output, 'down');
});

test('the model waiting is not a tool call, and neither is its end', () => {
  const sleep = { type: 'sleep', id: 's1', durationMs: 500 };
  const events = run(codex(), [
    item('item/started', sleep, [{ kind: 'tool_call_started', callId: 's1', tool: 'sleep', input: '{"durationMs":500}' }]),
    item('item/completed', sleep, [{ kind: 'tool_call_ended', callId: 's1' }]),
  ]);
  assert.deepEqual(events, []);
});

test('Codex failures name the login command for its own CLI', () => {
  const error = run(codex(), [turnEnded({ kind: 'failed', failure: 'auth', reason: '401' })]).at(-1).error;
  assert.equal(error.message, 'ChatGPT is not logged in. Run `codex login` in a terminal.');
});

// ---- tool cards -------------------------------------------------------------------------------------------------

test('Claude tools are drawn with DSH cards: a terminal, diffs, numbered lines and search results', () => {
  const tool = (name: string) => CLAUDE_TOOLS.find((candidate: any) => candidate.name === name)!;
  assert.deepEqual(tool('Bash').presentCall({ command: 'ls', description: 'List' }), { card: 'terminal', title: 'ls', description: 'List' });
  assert.deepEqual(tool('Bash').presentResult({}, { output: 'x', data: { stdout: 'out', stderr: 'err' } }), { card: 'terminal', output: 'out\nerr' });
  assert.deepEqual(tool('Bash').presentResult({}, { output: 'just the text' }), { card: 'terminal', output: 'just the text' });
  assert.deepEqual(tool('Edit').presentCall({ file_path: '/a.ts', old_string: 'a', new_string: 'b' }), {
    card: 'diff', title: 'Edit /a.ts', diffs: [{ path: '/a.ts', oldText: 'a', newText: 'b' }], locations: [{ path: '/a.ts' }],
  });
  assert.deepEqual(tool('Write').presentCall({ file_path: '/a.ts', content: 'hello' }).diffs, [{ path: '/a.ts', oldText: null, newText: 'hello' }]);
  assert.equal(tool('MultiEdit').presentCall({ file_path: '/a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }).diffs.length, 2);
  assert.equal(tool('Edit').presentResult({ file_path: '/a.ts', old_string: 'a', new_string: 'b' }, { output: 'denied', isError: true }).card, 'generic');
  assert.deepEqual(numberedLines('     1→first\n     2→second\n\nnote'), [{ number: 1, text: 'first' }, { number: 2, text: 'second' }]);
  assert.deepEqual(tool('Read').presentResult({ file_path: '/a.ts' }, { output: '     5→x\n     6→y' }), { card: 'read', path: '/a.ts', offset: 5, lines: [{ number: 5, text: 'x' }, { number: 6, text: 'y' }], totalLines: 6 });
  assert.equal(tool('Read').presentResult({ file_path: '/a.ts' }, { output: 'Error', isError: true }), undefined);
  assert.deepEqual(tool('Glob').presentResult({}, { output: '/a/b.ts\n/a/c.ts' }), { card: 'search', shape: 'paths', paths: ['/a/b.ts', '/a/c.ts'], truncated: false, total: 2 });
});

test('Codex tools are drawn with DSH cards', () => {
  const tool = (name: string) => CODEX_TOOLS.find((candidate: any) => candidate.name === name)!;
  assert.deepEqual(tool('shell').presentCall({ command: 'ls', cwd: '/w' }), { card: 'terminal', title: 'ls', cwd: '/w' });
  assert.deepEqual(tool('shell').presentResult({}, { output: 'x', data: { exitCode: 2 } }), { card: 'terminal', output: 'x', exitCode: 2 });
  const changes = [{ path: '/a.ts', kind: { type: 'add' }, diff: '+x' }];
  assert.equal(tool('apply_patch').presentCall({ changes }).title, 'Add /a.ts');
  assert.equal(tool('apply_patch').presentResult({ changes }, { output: '', isError: false }).title, 'Added /a.ts');
  assert.equal(tool('apply_patch').presentResult({ changes }, { output: 'declined', isError: true }).title, 'The edit was not applied');
});

// ---- helpers ----------------------------------------------------------------------------------------------------

test('OAR output is read as DSH wants it', () => {
  assert.deepEqual(parseInput('{"a":1}'), { a: 1 });
  assert.deepEqual(parseInput(undefined), {});
  assert.deepEqual(parseInput('[1]'), { value: [1] });
  assert.deepEqual(parseInput('{oops'), { _unparsed: '{oops' });
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'image', mediaType: 'image/png', data: 'x' }, { type: 'other', value: { k: 1 } }]), 'a\n[image]\n{"k":1}');
  assert.equal(contentText(undefined), '');
});

test('only what names another harness or terminal is taken out of the child environment', () => {
  const base = { PATH: '/bin', ORCA_PANE_KEY: 'p', HERDR_X: '1', CODEX_HOME: '/h/.codex', CODEX_THREAD_ID: 'x', ANTHROPIC_API_KEY: 'k' };
  assert.deepEqual(scrubbedEnvironment([/^(ORCA_|HERDR_)/], { base }), { ORCA_PANE_KEY: null, HERDR_X: null });
  assert.deepEqual(scrubbedEnvironment([/^(CODEX_|ORCA_)/], { base, keep: ['CODEX_HOME'] }), { ORCA_PANE_KEY: null, CODEX_THREAD_ID: null });
});

test('the DSH access mode becomes a Codex sandbox, and what it forbids stays forbidden', () => {
  assert.equal(sandboxOf('danger-full-access'), 'danger-full-access');
  assert.equal(sandboxOf('read-only'), 'read-only');
  for (const mode of ['workspace-write', 'auto', undefined]) assert.equal(sandboxOf(mode as string | undefined), 'workspace-write');
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

// ---- a provider on an OAR runtime --------------------------------------------------------------------------------

const BUNDLED = { kind: 'available', via: 'bundled' };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) { for (let i = 0; i < 200 && !check(); i++) await wait(5); }
async function collect(handle: any) {
  const events: any[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}
async function workDirectory(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'dudu-oar-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function scripted(turn: (turn: any) => unknown) {
  const turns: any[] = [];
  const inner = scriptedRuntime({ turn: async (current: any) => { turns.push(current); await turn(current); } });
  // The scripted runtime lists no reasoning efforts and so refuses one; what the driver asked for is recorded here.
  const asked: any[] = [];
  const runtime = { ...inner, session: (installation: any, options: any) => { asked.push(options); const { effort, ...rest } = options; return inner.session(installation, rest); } };
  return { runtime, turns, asked };
}

test('a turn through OAR streams the harness\'s words and tool calls, then ends and releases the session', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime, turns } = scripted(async (turn) => {
    turn.say('Looking.');
    await turn.tool('Bash', JSON.stringify({ command: 'ls' }), () => 'a.txt');
    turn.say('Done.');
  });
  const driver = createClaudeProvider({ runtime }).create({ installation: BUNDLED });
  const handle = await driver.start({ prompt: 'list files', cwd, signal: new AbortController().signal });
  assert.ok(handle.nativeSessionId, 'the OAR session id is the harness\'s own session id');
  const events = await collect(handle);
  assert.deepEqual(types(events), ['text-delta', 'tool-call', 'step-end', 'tool-result', 'text-delta', 'step-end', 'turn-end']);
  assert.deepEqual(events[1], { type: 'tool-call', id: events[1].id, name: 'Bash', input: { command: 'ls' } });
  assert.equal(events[3].output, 'a.txt');
  assert.equal(turns[0].input, 'list files');
  await handle.close();
});

test('a harness session starts where the DSH session works, with the mode, model and effort it was given and a clean environment', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime, asked } = scripted(() => {});
  process.env.ORCA_PANE_KEY = 'pane';
  t.after(() => { delete process.env.ORCA_PANE_KEY; });
  const driver = createClaudeProvider({ runtime }).create({ installation: BUNDLED });
  await collect(await driver.start({ prompt: 'x', cwd, model: 'opus', effort: 'high', permission: 'read-only' }));
  const options = asked[0];
  assert.equal(options.cwd, cwd);
  assert.equal(options.model, 'opus');
  assert.equal(options.effort, 'high');
  assert.equal(options.resume, undefined);
  assert.equal(options.env.CLAUDE_CODE_ENTRYPOINT, ENTRYPOINT, 'sessions stay in the terminal\'s resume list');
  assert.equal(options.env.ORCA_PANE_KEY, null);
  assert.deepEqual(options.disallowedTools, [...WRITING_TOOLS, 'AskUserQuestion']);

  await collect(await driver.start({ prompt: 'again', cwd, model: 'default', resume: 'native-1', permission: 'danger-full-access' }));
  const next = asked[1];
  assert.equal(next.model, undefined, 'the picker\'s default means no model');
  assert.equal(next.resume, 'native-1');
  assert.deepEqual(next.disallowedTools, ['AskUserQuestion']);
});

test('Codex gets the sandbox of the access mode and keeps the user\'s CODEX_HOME', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime, turns } = scripted(() => {});
  process.env.CODEX_THREAD_ID = 'parent';
  t.after(() => { delete process.env.CODEX_THREAD_ID; });
  const driver = createCodexProvider({ runtime }).create({ installation: BUNDLED });
  await collect(await driver.start({ prompt: 'x', cwd, permission: 'read-only' }));
  await collect(await driver.start({ prompt: 'x', cwd }));
  assert.deepEqual(turns[0].options.launchArgs, ['-c', 'sandbox_mode="read-only"']);
  assert.deepEqual(turns[1].options.launchArgs, ['-c', 'sandbox_mode="workspace-write"']);
  assert.equal(turns[0].options.env.CODEX_THREAD_ID, null);
  assert.equal('CODEX_HOME' in turns[0].options.env, false);
});

test('stopping interrupts the turn and it ends as interrupted', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime } = scripted(async (turn) => {
    turn.say('working');
    await new Promise((resolve) => turn.signal.addEventListener('abort', resolve));
  });
  const handle = await createClaudeProvider({ runtime }).create({ installation: BUNDLED }).start({ prompt: 'slow', cwd });
  const events = collect(handle);
  await wait(20);
  await handle.interrupt();
  const seen = await events;
  assert.equal(seen.at(-1).error.code, 'ABORTED');
  await handle.close();
});

test('input typed while the harness works is steered into the turn', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime } = scripted(async (turn) => {
    await until(() => turn.steered.length > 0);
    turn.say(`got: ${turn.steered[0]}`);
  });
  const handle = await createClaudeProvider({ runtime }).create({ installation: BUNDLED }).start({ prompt: 'go', cwd });
  const events = collect(handle);
  await wait(10);
  await handle.pushUserMessage('use tabs');
  assert.equal((await events).find((event) => event.type === 'text-delta').text, 'got: use tabs');
});

test('a turn that fails reaches DSH as a failed turn with the harness\'s words', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime } = scripted(() => { throw new Error('model overloaded'); });
  const events = await collect(await createClaudeProvider({ runtime }).create({ installation: BUNDLED }).start({ prompt: 'x', cwd }));
  assert.deepEqual([events.at(-1).error.code, events.at(-1).error.message], ['HARNESS_FAILED', 'model overloaded']);
});

test('what stops a turn from starting is said before anything runs', async (t) => {
  const cwd = await workDirectory(t);
  const driver = (runtime: any, registry?: any) => createClaudeProvider({ runtime, registry }).create({ installation: BUNDLED });
  const { runtime } = scripted(() => {});

  await assert.rejects(driver(runtime).start({ prompt: 'x', cwd: join(cwd, 'gone') }), (error: any) => error.code === 'HARNESS_BAD_CWD');
  await assert.rejects(driver(runtime).start({ prompt: 'x', cwd, signal: AbortSignal.abort(new Error('stopped')) }), /stopped/);

  const directory = join(cwd, 'sessions');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(directory));
  await writeFile(join(directory, '9.json'), JSON.stringify({ pid: 9, sessionId: 'held' }));
  await assert.rejects(driver(runtime, { directory, alive: () => true }).start({ prompt: 'x', cwd, resume: 'held' }), (error: any) => error.code === 'HARNESS_BUSY');

  const broken = { session: async () => { throw new Error('spawn claude ENOENT'); } };
  await assert.rejects(driver(broken).start({ prompt: 'x', cwd }), (error: any) => error.code === 'HARNESS_UNAVAILABLE' && /spawn claude ENOENT/.test(error.message));

  let disposed = 0;
  const refusing = { session: async () => ({ id: 'n', rawEvents: () => () => {}, prompt: async () => ({ kind: 'rejected', code: 'busy', reason: 'busy' }), dispose: async () => { disposed++; } }) };
  await assert.rejects(driver(refusing).start({ prompt: 'x', cwd }), (error: any) => error.code === 'HARNESS_REJECTED' && /busy/.test(error.message));
  assert.equal(disposed, 1, 'a session that took nothing is released');
});

test('the harness on this computer is found by OAR, and a path the user configured is handed to it', async () => {
  const seen: any[] = [];
  const probe = (snapshot: any) => createClaudeProvider({ runtime: { installation: async (options: any) => { seen.push(options); if (snapshot instanceof Error) throw snapshot; return snapshot; } } }).probe;
  const found = await probe({ kind: 'available', via: 'executable', command: '/home/u/.local/bin/claude', version: '2.1.312 (Claude Code)' })({});
  assert.deepEqual([found.state, found.path, found.version], ['ready', '/home/u/.local/bin/claude', '2.1.312']);
  assert.equal(seen[0], undefined);

  const missing = await probe({ kind: 'not_found' })({ override: '/nope/claude' });
  assert.deepEqual(seen[1], { env: { OAR_CLAUDE_BIN: '/nope/claude' } });
  assert.deepEqual([missing.state, missing.reason], ['missing', '/nope/claude is not an executable file.']);
  assert.equal((await probe({ kind: 'not_found' })({})).reason, 'Claude was not found.');

  const unsupported = await probe({ kind: 'unsupported', reason: 'codex has no app-server' })({});
  assert.deepEqual([unsupported.state, unsupported.reason], ['unsupported', 'codex has no app-server']);
  assert.equal((await probe(new Error('boom'))({})).state, 'broken');
});

test('models come from the harness through OAR, with the efforts each one supports, and a fallback when it cannot say', async () => {
  let calls = 0;
  let answer: any = {
    kind: 'ok',
    models: [
      { id: 'default', displayName: 'Default (recommended)', effortLevels: ['low', 'high'], defaultEffort: 'high' },
      { id: 'haiku', displayName: 'Haiku', effortLevels: [] },
      { id: 'old', displayName: 'Old', disabled: true },
    ],
  };
  const runtime = { listModels: async () => { calls++; if (answer instanceof Error) throw answer; return answer; } };
  const driver = createClaudeProvider({ runtime }).create({ installation: BUNDLED });
  assert.deepEqual(await driver.listModels(), [
    { provider: 'claude', id: 'default', name: 'Default (recommended)' },
    { provider: 'claude', id: 'haiku', name: 'Haiku' },
  ]);
  assert.deepEqual((await driver.resolveModel('default')).reasoning, { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' });
  assert.equal('reasoning' in (await driver.resolveModel('haiku')), false);
  assert.equal((await driver.resolveModel('unknown')).name, 'unknown');
  assert.equal(calls, 1, 'the list is kept for a while');

  driver.refreshModels();
  answer = { kind: 'unauthenticated' };
  assert.deepEqual((await driver.listModels()).map((model: any) => model.id), ['default', 'opus', 'sonnet', 'haiku']);
  driver.refreshModels();
  answer = new Error('claude hung');
  assert.equal((await driver.listModels()).length, 4);
  assert.equal(calls, 3);
});
