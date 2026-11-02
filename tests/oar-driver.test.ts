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
import { contentText, parseInput, scrubbedEnvironment, startOarRun } from '../host/providers/oar.mjs';

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

test('a result too large for a conversation log is cut', () => {
  const big = 'x'.repeat(300 * 1024);
  const events = run(claude(), [callStarted('t1', 'Bash'), callInput('t1', {}), messageStop(), callEnded('t1', big)]);
  const output = events.at(-1).output as string;
  assert.equal(output.length, 256 * 1024 + '\n… (output truncated)'.length);
  assert.ok(output.endsWith('… (output truncated)'));
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

test('compaction lifecycle survives OAR normalization without opening or closing a model message', () => {
  for (const normalizer of [claude(), codex()]) {
    const events = run(normalizer, [
      frame([{ kind: 'compaction_started' }]),
      frame([{ kind: 'compaction_ended', outcome: 'completed' }]),
      said('After compaction.'),
      turnEnded({ kind: 'completed' }),
    ]);
    assert.deepEqual(types(events), ['compaction-start', 'compaction-end', 'text-delta', 'step-end', 'turn-end']);
    assert.equal(events[1].outcome, 'completed');
  }
  assert.deepEqual(run(codex(), [frame([{ kind: 'compaction_started' }], {}, ['child'])]), []);
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
  assert.deepEqual(types(events), ['text-delta', 'tool-call', 'step-end', 'tool-result', 'text-delta', 'usage', 'step-end', 'turn-end']);
  assert.deepEqual(events[1], { type: 'tool-call', id: events[1].id, name: 'Bash', input: { command: 'ls' } });
  assert.equal(events[3].output, 'a.txt');
  assert.equal(turns[0].input, 'list files');
  await handle.close();
});

test('usage after turn_ended in the same frame is published before closing; cumulative counters are charged once', () => {
  const normalizer = claude();
  const usage = (input: number, output: number, cacheRead: number) => ({ kind: 'usage', usage: { tokens: { input, output, cacheRead } } });
  const first = run(normalizer, [said('Working.'), frame([usage(100, 20, 40)]), frame([usage(100, 20, 40)])]);
  assert.deepEqual(first.filter((event) => event.type === 'usage').map((event) => event.usage), [
    { inputTokens: 60, outputTokens: 20, totalTokens: 120, cacheReadTokens: 40 },
  ]);
  const final = run(normalizer, [frame([{ kind: 'turn_ended', outcome: { kind: 'completed' } }, usage(130, 30, 50)])]);
  assert.deepEqual(types(final), ['usage', 'step-end', 'turn-end']);
  assert.deepEqual(final[0].usage, { inputTokens: 20, outputTokens: 10, totalTokens: 40, cacheReadTokens: 10 });
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

test('the turn signal stops OAR while DSH is waiting on a mirror tool, without another stream call', async () => {
  const controller = new AbortController();
  const disposed = Promise.withResolvers<void>();
  let interrupted = 0;
  let closing = 0;
  const session = {
    id: 'native-cancel', rawEvents: () => () => {},
    prompt: async () => ({ kind: 'accepted' }),
    abort: async () => { interrupted++; },
    dispose: async () => { closing++; await disposed.promise; },
  };
  const handle = await startRun(session, { signal: controller.signal });
  controller.abort(new Error('stopped at tool'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(interrupted, 1, 'stopping the host turn actively interrupts the native work');
  assert.equal(closing, 1, 'the old native writer is released before another prompt is needed');
  let closed = false;
  const waitForExit = handle.close().then(() => { closed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false, 'close still waits for the actual OAR disposal');
  disposed.resolve();
  await waitForExit;
  assert.equal(closing, 1);
});

test('a stop during OAR startup releases the eventual session without sending the cancelled prompt', async () => {
  const controller = new AbortController();
  const opened = Promise.withResolvers<any>();
  let prompted = 0;
  let disposed = 0;
  const pending = startOarRun({
    runtime: { session: () => opened.promise }, installation: BUNDLED, sessionOptions: {},
    prompt: 'cancelled task', normalizer: codex(), name: 'ChatGPT', signal: controller.signal,
  });
  controller.abort(new Error('stopped during startup'));
  opened.resolve({
    id: 'native-cancel', rawEvents: () => () => {},
    prompt: async () => { prompted++; return { kind: 'accepted' }; },
    abort: async () => {},
    dispose: async () => { disposed++; },
  });
  await assert.rejects(pending, /stopped during startup/);
  assert.equal(prompted, 0);
  assert.equal(disposed, 1);
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

test('image-only input and steering attachments reach the OAR prompt and steer APIs', async (t) => {
  const cwd = await workDirectory(t);
  const image = join(cwd, 'image.png');
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7P8AAAAASUVORK5CYII=', 'base64'));
  const images = [{ path: image, mediaType: 'image/png' }];
  const seen: any[] = [];
  const { runtime: inner } = scripted(async (turn) => {
    await until(() => turn.steered.length > 0);
    turn.say('Received.');
  });
  const runtime = { ...inner, session: async (...args: any[]) => {
    const session = await (inner.session as any)(...args);
    return {
      ...session,
      prompt: (text: string, options: any) => { seen.push(['prompt', text, options]); return session.prompt(text, options); },
      steer: (text: string, options: any) => { seen.push(['steer', text, options]); return session.steer(text, options); },
    };
  } };
  const handle = await createCodexProvider({ runtime }).create({ installation: BUNDLED }).start({ cwd, prompt: '', images });
  const events = collect(handle);
  await handle.pushUserMessage('Also this.', images);
  await events;
  assert.deepEqual(seen[0], ['prompt', '', { images }]);
  assert.equal(seen[1][0], 'steer');
  assert.deepEqual(seen[1][2].images, images);
  await handle.close();
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
      { id: 'haiku', displayName: 'Haiku', effortLevels: [] },
      { id: 'default', displayName: 'Default (recommended)', effortLevels: ['low', 'high'], defaultEffort: 'high', default: true },
      { id: 'old', displayName: 'Old', disabled: true },
    ],
  };
  const runtime = { listModels: async () => { calls++; if (answer instanceof Error) throw answer; return answer; } };
  const driver = createClaudeProvider({ runtime }).create({ installation: BUNDLED });
  // The harness's own default comes first, then the rest as OAR lists them; a disabled model is not offered.
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

test('closing a run whose turn just ended waits for its process to stop, so the next turn never meets it', async (t) => {
  const cwd = await workDirectory(t);
  const stopped: string[] = [];
  let observer: ((record: unknown) => void) | undefined;
  const session = {
    id: 'native-1', rawEvents: (callback: (record: unknown) => void) => { observer = callback; return () => {}; },
    prompt: async () => ({ kind: 'accepted' }),
    // The process takes a while to go, and a second `dispose()` is answered at once, as OAR does.
    dispose: (() => { let asked = false; return () => { if (asked) return Promise.resolve(); asked = true; return new Promise<void>((resolve) => setTimeout(() => { stopped.push('process'); resolve(); }, 60)); }; })(),
  };
  const driver = createClaudeProvider({ runtime: { session: async () => session } }).create({ installation: BUNDLED });
  const handle = await driver.start({ prompt: 'x', cwd });
  observer!(turnEnded({ kind: 'completed' }));
  assert.equal((await collect(handle)).at(-1).type, 'turn-end');
  await handle.close();
  assert.deepEqual(stopped, ['process'], 'close() returned only after the process had stopped');
});

// A harness whose input is a queue answers a message written during its turn with a turn of its own, after this one.
function queueingSession(steerReply: any = { kind: 'accepted' }) {
  const steered: { text: string; inputId: string }[] = [];
  let observer: (record: unknown) => void = () => {};
  const session = {
    id: 'native-1', rawEvents: (callback: (record: unknown) => void) => { observer = callback; return () => {}; },
    prompt: async () => ({ kind: 'accepted' }),
    steer: async (text: string, options: { inputId: string }) => { steered.push({ text, inputId: options.inputId }); return steerReply; },
    dispose: async () => {},
  };
  return { session, steered, emit: (record: unknown) => observer(record) };
}
const startRun = (session: unknown, options: Record<string, unknown> = {}) => startOarRun({
  runtime: { session: async () => session }, installation: BUNDLED, sessionOptions: {}, prompt: 'x', normalizer: claude(), name: 'Claude', ...options,
});
const activity = frame([{ kind: 'turn_active' }]);
const acknowledged = (inputId: string) => frame([{ kind: 'user_message', input: 'more', inputId, evidence: 'acknowledged' }]);

test('a message Claude took while it worked is answered before the turn ends, instead of being lost with the process', async () => {
  const { session, steered, emit } = queueingSession();
  const handle = await startRun(session, { queuesSteer: true });
  const seen = collect(handle);
  emit(said('First answer.'));
  await handle.pushUserMessage('and one more thing');
  emit(messageStop());
  emit(turnEnded({ kind: 'completed' }));
  await wait(20);
  // The turn it was written in has ended, but Claude still owes the message its answer: the run stays open.
  emit(activity);
  emit(acknowledged(steered[0].inputId));
  emit(said('Second answer.'));
  emit(messageStop());
  emit(turnEnded({ kind: 'completed' }));
  const events = await seen;
  assert.deepEqual(types(events), ['text-delta', 'step-end', 'text-delta', 'step-end', 'turn-end']);
  assert.deepEqual(events.filter((event) => event.type === 'text-delta').map((event) => event.text), ['First answer.', 'Second answer.']);
});

test('a message taken into the turn itself does not keep the turn open, and neither does one that was refused', async () => {
  const inside = queueingSession();
  const first = await startRun(inside.session, { queuesSteer: true });
  const done = collect(first);
  inside.emit(said('Answer.'));
  await first.pushUserMessage('adjust');
  inside.emit(acknowledged(inside.steered[0].inputId));
  inside.emit(turnEnded({ kind: 'completed' }));
  assert.equal((await done).at(-1).type, 'turn-end');

  const refused = queueingSession({ kind: 'rejected', code: 'no_active_turn', reason: 'no active turn' });
  const second = await startRun(refused.session, { queuesSteer: true });
  const finished = collect(second);
  await assert.rejects(second.pushUserMessage('too late'), (error: any) => error.code === 'HARNESS_REJECTED');
  refused.emit(turnEnded({ kind: 'completed' }));
  assert.equal((await finished).at(-1).type, 'turn-end');
});

test('a follow-up that never starts does not keep the turn open for ever, and a harness that steers inside its turn is not waited on', async () => {
  const silent = queueingSession();
  const handle = await startRun(silent.session, { queuesSteer: true, followUpMs: 30 });
  const seen = collect(handle);
  await handle.pushUserMessage('lost');
  silent.emit(turnEnded({ kind: 'completed' }));
  const started = Date.now();
  assert.equal((await seen).at(-1).type, 'turn-end');
  assert.ok(Date.now() - started >= 25, 'it waited for the follow-up');

  const joined = queueingSession();
  const direct = await startRun(joined.session, { followUpMs: 30 });
  const finished = collect(direct);
  await direct.pushUserMessage('into the turn');
  joined.emit(turnEnded({ kind: 'completed' }));
  const begun = Date.now();
  assert.equal((await finished).at(-1).type, 'turn-end');
  assert.ok(Date.now() - begun < 25, 'it did not');
});

test('a failed turn ends at once even while a message waits', async () => {
  const { session, emit } = queueingSession();
  const handle = await startRun(session, { queuesSteer: true });
  const seen = collect(handle);
  await handle.pushUserMessage('pending');
  emit(turnEnded({ kind: 'failed', failure: 'quota', reason: 'Usage limit reached' }));
  assert.equal((await seen).at(-1).error.message, 'Usage limit reached');
});

test('a native refusal of forwarded input is not silently reported as a successful turn', async () => {
  const { session, steered, emit } = queueingSession();
  const handle = await startRun(session, { queuesSteer: true });
  const seen = collect(handle);
  await handle.pushUserMessage('extra task');
  emit(acknowledged(steered[0].inputId));
  emit(frame([{ kind: 'input_dropped', inputId: steered[0].inputId, reason: 'runtime_refused', message: 'queue refused' }]));
  emit(turnEnded({ kind: 'completed' }));
  const end = (await seen).at(-1);
  assert.equal(end.ok, false);
  assert.equal(end.error.code, 'HARNESS_REJECTED');
  assert.match(end.error.message, /queue refused/);
});

test('native compaction counts as an active queued follow-up while its first text is still pending', async () => {
  const { session, steered, emit } = queueingSession();
  const handle = await startRun(session, { queuesSteer: true, followUpMs: 10 });
  const seen = collect(handle);
  await handle.pushUserMessage('extra task');
  emit(turnEnded({ kind: 'completed' }));
  emit(frame([{ kind: 'compaction_started' }]));
  await wait(20);
  emit(frame([{ kind: 'compaction_ended', outcome: 'completed' }]));
  emit(acknowledged(steered[0].inputId));
  emit(said('After native compaction.'));
  emit(turnEnded({ kind: 'completed' }));
  const events = await seen;
  assert.equal(events.find(event => event.type === 'text-delta')?.text, 'After native compaction.');
  assert.equal(events.at(-1).ok, true);
});

test('a Codex child thread with an empty agent path cannot finish its parent or publish child text and compaction there', async () => {
  const { session, emit } = queueingSession();
  const handle = await startRun(session);
  const seen = collect(handle);
  for (const record of [
    frame([{ kind: 'compaction_started' }]), said('Child text.'), turnEnded({ kind: 'completed' }),
  ]) emit({ ...record, sessionId: 'child-thread' });
  emit({ ...said('Parent text.'), sessionId: session.id });
  emit({ ...turnEnded({ kind: 'completed' }), sessionId: session.id });
  assert.deepEqual(types(await seen), ['text-delta', 'step-end', 'turn-end']);
});

test('a model alias is named with what it means today, so that what the menu shows is what runs', async () => {
  const runtime = { listModels: async () => ({ kind: 'ok', models: [
    { id: 'default', displayName: 'Default (recommended)', resolvedId: 'claude-sonnet-5-5', default: true },
    { id: 'opus', displayName: 'Opus', resolvedId: 'claude-opus-5-5' },
    { id: 'fable', displayName: 'Fable 5.1', resolvedId: 'claude-fable-5-1' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Haiku', resolvedId: 'claude-haiku-4-5-20251001' },
    { id: 'claude-opus-4-8', displayName: 'Opus 4.8' },
    { id: 'gpt', displayName: 'GPT', resolvedId: 'some-other-model' },
  ] }) };
  const driver = createClaudeProvider({ runtime }).create({ installation: BUNDLED });
  assert.deepEqual((await driver.listModels()).map((model: any) => model.name), [
    'Default (recommended) · Sonnet 5.5', 'Opus 5.5', 'Fable 5.1', 'Haiku 4.5', 'Opus 4.8', 'GPT',
  ]);
  assert.equal((await driver.resolveModel('opus')).name, 'Opus 5.5');
});
