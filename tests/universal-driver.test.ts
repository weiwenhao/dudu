import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedRuntime } from '@dudu/oar-adapter/testing';
import { HARNESS_IDS, harnessName, isHarness } from '../host/providers/catalog.mjs';
import { AGENTS } from '../host/assistant/home/agent-sessions.mjs';
import { ClaudeNormalizer } from '../host/providers/drivers/claude.mjs';
import { UNIVERSAL_HARNESSES, UniversalNormalizer, createUniversalProvider, universalProviders } from '../host/providers/drivers/universal.mjs';
import { KINDS, canonicalInput, kindOf, mirrorName, toolSpecs } from '../host/providers/drivers/universal-tools.mjs';

// ---- the nine harnesses as the lists name them ------------------------------------------------------------------

test('every harness that shares the universal driver is a route and an agent with its own name', () => {
  assert.deepEqual(UNIVERSAL_HARNESSES.map((harness: any) => harness.id), ['grok', 'kimi', 'opencode', 'antigravity', 'codebuddy', 'devin', 'factory', 'qwen', 'qoder']);
  for (const harness of UNIVERSAL_HARNESSES as any[]) {
    assert.ok(isHarness(harness.id), harness.id);
    assert.equal(harnessName(harness.id), harness.name, 'the catalog and the driver name it alike');
    assert.equal(AGENTS[harness.id], harness.name);
    assert.equal(HARNESS_IDS.filter((id: string) => id === harness.id).length, 1);
  }
  assert.deepEqual([...HARNESS_IDS].slice(0, 3), ['claude', 'codex', 'pi'], 'the three older ones keep their place');
  assert.equal(universalProviders.length, UNIVERSAL_HARNESSES.length);
  for (const provider of universalProviders as any[]) {
    assert.equal(provider.route, provider.id);
    assert.notEqual(provider.defaultEnabled, false, 'on as soon as it is found (owner, 2026-11-24)');
    assert.equal(provider.folds, true, 'and folded away while it is not on this computer');
  }
});

// ---- what a vendor's tool is to DSH -----------------------------------------------------------------------------

test('a tool is the kind of action it does, whichever name the vendor gave it', () => {
  assert.equal(kindOf('run_command', 'run_terminal_command', ''), 'run_command', 'OAR\'s own classification comes first');
  assert.equal(kindOf('other', 'quick_thing', 'execute'), 'run_command', 'then the ACP call\'s kind');
  assert.equal(kindOf('other', 'quick_thing', 'delete'), 'edit_file');
  assert.equal(kindOf('other', 'Bash', ''), 'run_command', 'then the name, for a harness OAR has no table for yet');
  assert.equal(kindOf('other', 'str_replace', ''), 'edit_file');
  assert.equal(kindOf('other', 'mcp__lark__send', ''), 'mcp');
  assert.equal(kindOf('other', 'think_hard', ''), 'other');
  assert.equal(kindOf('web', 'anything', ''), 'web');
});

test('every vendor\'s input for the same action becomes one input that the cards read', () => {
  const shell = canonicalInput({ kind: 'run_command', tool: 'run_terminal_command', raw: { command: 'ls -la', description: 'List' }, classified: { command: 'ls -la', description: 'List' } });
  assert.deepEqual([shell.command, shell.description, shell.tool], ['ls -la', 'List', 'run_terminal_command']);
  assert.equal(canonicalInput({ kind: 'run_command', tool: 'run_command', raw: { CommandLine: 'pwd', Cwd: '/w' } }).command, 'pwd');
  const edit = canonicalInput({ kind: 'edit_file', tool: 'search_replace', raw: { file_path: '/a.txt', old_string: 'beta', new_string: 'gamma' } });
  assert.deepEqual([edit.path, edit.edits], ['/a.txt', [{ oldText: 'beta', newText: 'gamma' }]]);
  assert.deepEqual(canonicalInput({ kind: 'edit_file', tool: 'write', raw: { path: '/n.txt', content: 'hi' } }).edits, [{ oldText: null, newText: 'hi' }]);
  assert.deepEqual(canonicalInput({ kind: 'edit_file', tool: 'edit', raw: { path: '/n.txt', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }] } }).edits.length, 2);
  assert.equal(canonicalInput({ kind: 'read_file', tool: 'read_file', raw: { target_file: '/r.ts' }, classified: { paths: ['/r.ts'] } }).path, '/r.ts');
  assert.deepEqual(canonicalInput({ kind: 'search', tool: 'grep_search', raw: { pattern: 'TODO', directory: '/src' } }), { kind: 'search', tool: 'grep_search', input: { pattern: 'TODO', directory: '/src' }, pattern: 'TODO', path: '/src' });
});

test('the nine tools of a harness are mirrored under names of its own and drawn with the cards DSH has', () => {
  const specs = toolSpecs('grok') as any[];
  assert.deepEqual(specs.map((spec) => spec.name), KINDS.map((kind: string) => `grok_${kind}`));
  const by = (kind: string) => specs.find((spec) => spec.name === mirrorName('grok', kind));
  const shell = canonicalInput({ kind: 'run_command', tool: 'x', raw: { command: 'ls' } });
  assert.deepEqual(by('run_command').presentCall(shell), { card: 'terminal', title: 'ls' });
  assert.deepEqual(by('run_command').presentResult(shell, { output: 'out', data: { exitCode: 2 } }), { card: 'terminal', output: 'out', exitCode: 2 });
  const edit = canonicalInput({ kind: 'edit_file', tool: 'x', raw: { path: 'a.txt', old_string: 'beta', new_string: 'gamma' } });
  assert.deepEqual(by('edit_file').presentCall(edit).diffs, [{ path: 'a.txt', oldText: 'beta', newText: 'gamma' }]);
  assert.equal(by('edit_file').presentResult(edit, { output: 'no', isError: true }).card, 'generic', 'a failed edit shows what the harness said');
  const noText = canonicalInput({ kind: 'edit_file', tool: 'x', raw: { path: 'a.txt' } });
  assert.equal(by('edit_file').presentCall(noText).card, 'generic', 'an edit that carries no text is drawn as the plain card');
  assert.equal(by('mcp').presentCall(canonicalInput({ kind: 'mcp', tool: 'mcp__lark__send', raw: {} })).title, 'lark: send');
  assert.equal(by('other').presentCall(canonicalInput({ kind: 'other', tool: 'think_hard', raw: { query: 'x' } })).title, 'think_hard: x');
});

// ---- OAR's records, as the universal normalizer reads them ------------------------------------------------------

const frame = (events: any[], native: any = {}) => ({ kind: 'frame', agentPath: [], seq: 1, body: { type: 'session/update', native, events } });
const callStarted = (callId: string, tool: string, input?: unknown, kind?: string) => frame([{ kind: 'tool_call_started', callId, tool, ...(input === undefined ? {} : { input: JSON.stringify(input) }) }], kind ? { update: { kind } } : {});
const callInput = (callId: string, input: unknown) => frame([{ kind: 'tool_call_input', callId, input: JSON.stringify(input) }]);
const callEnded = (callId: string, text: string, result = 'ok', extra: any = {}) => frame([{ kind: 'tool_call_ended', callId, content: [{ type: 'text', text }], result, ...extra }]);
const said = (text: string) => frame([{ kind: 'text_delta', text }]);
const turnEnded = (outcome: any) => frame([{ kind: 'turn_ended', outcome }]);
const request = (type: string) => ({ kind: 'request', direction: 'toApp', agentPath: [], body: { kind: 'native', type } });

const normalizer = (id: string) => new UniversalNormalizer({ id, name: harnessName(id), login: 'Run it.' });
const run = (reading: any, records: any[]) => records.flatMap((record) => reading.feed(record));
const types = (events: any[]) => events.map((event) => event.type);

test('a command with its input at the start is one call that closes its step, and its result carries the exit code', () => {
  const reading = normalizer('grok');
  const events = run(reading, [said('Listing.'), callStarted('c1', 'run_terminal_command', { command: 'ls', description: 'List files' }), callEnded('c1', 'a.txt', 'ok', { exitCode: 0 }), said('Done.'), turnEnded({ kind: 'completed' })]);
  assert.deepEqual(types(events), ['text-delta', 'tool-call', 'step-end', 'tool-result', 'text-delta', 'step-end', 'turn-end']);
  assert.equal(events[1].name, 'grok_run_command');
  assert.deepEqual([events[1].input.command, events[1].input.description, events[1].input.tool], ['ls', 'List files', 'run_terminal_command']);
  assert.deepEqual(events[3], { type: 'tool-result', id: 'c1', output: 'a.txt', isError: false, data: { exitCode: 0 } });
});

test('a call that opens without its arguments is announced when they arrive, as an ACP agent sends them', () => {
  const reading = normalizer('kimi');
  const opened = run(reading, [callStarted('c1', 'Bash')]);
  assert.deepEqual(opened, [], 'nothing is announced before the command is known');
  const events = run(reading, [callInput('c1', { command: 'pwd' }), callEnded('c1', '/w'), turnEnded({ kind: 'completed' })]);
  assert.deepEqual(types(events), ['tool-call', 'step-end', 'tool-result', 'turn-end']);
  assert.equal(events[0].name, 'kimi_run_command');
  assert.equal(events[0].input.command, 'pwd');
  // OpenCode opens a shell call with only its folder: that is not the command.
  const opencode = normalizer('opencode');
  assert.deepEqual(run(opencode, [callStarted('c2', 'bash', { cwd: '/w' })]), []);
  assert.equal(run(opencode, [callInput('c2', { command: 'ls', cwd: '/w' })])[0].input.command, 'ls');
});

test('a call that ends without ever being given an input is still a call', () => {
  const events = run(normalizer('devin'), [callStarted('c1', 'list_things'), callEnded('c1', 'x'), turnEnded({ kind: 'completed' })]);
  assert.deepEqual(types(events), ['tool-call', 'step-end', 'tool-result', 'turn-end']);
  assert.equal(events[0].name, 'devin_other');
  assert.equal(events[0].input.tool, 'list_things');
});

test('the ACP call\'s own kind names a tool nobody mapped', () => {
  const events = run(normalizer('devin'), [callStarted('c1', 'quick_thing', { command: 'make' }, 'execute')]);
  assert.equal(events[0].name, 'devin_run_command');
});

// OAR answers these harnesses' permission and terminal requests itself, so they are no reason to end a turn; for Claude nobody answers.
test('a request OAR answers does not end the turn, and one nobody can answer still does', () => {
  const events = run(normalizer('grok'), [request('terminal/create'), request('session/request_permission'), said('ok'), turnEnded({ kind: 'completed' })]);
  assert.deepEqual(types(events), ['text-delta', 'step-end', 'turn-end']);
  assert.equal(events.at(-1).ok, true);
  const claude = run(new ClaudeNormalizer({ name: 'Claude', login: '' }), [request('can_use_tool')]);
  assert.equal(claude.at(-1).ok, false);
  assert.equal(claude.at(-1).error.code, 'HARNESS_UNSUPPORTED');
});

test('a harness that is not logged in says how to sign in', () => {
  const end = run(normalizer('opencode'), [turnEnded({ kind: 'failed', failure: 'auth', reason: 'no key' })]).at(-1);
  assert.deepEqual([end.error.code, end.error.message], ['AUTH', 'OpenCode is not logged in. Run it.']);
});

// ---- a session of the driver ------------------------------------------------------------------------------------

const BUNDLED = { kind: 'available', via: 'bundled' };
async function workDirectory(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'dudu-universal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function scripted(turn: (turn: any) => unknown) {
  const inner = scriptedRuntime({ turn: async (current: any) => { await turn(current); } });
  const asked: any[] = [];
  const runtime = { ...inner, session: (installation: any, options: any) => { asked.push(options); const { effort, ...rest } = options; return inner.session(installation, rest); } };
  return { runtime, asked };
}
const providerOver = (runtime: any) => createUniversalProvider({ id: 'grok', name: 'Grok', runtime, binaryEnv: 'OAR_GROK_BIN', login: 'Run `grok login` in a terminal.' }).create({ installation: BUNDLED });
async function collect(handle: any) {
  const events: any[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

test('a turn through the universal driver draws the harness\'s tool by what it does', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime } = scripted(async (turn) => {
    turn.say('Looking.');
    await turn.tool('run_terminal_command', JSON.stringify({ command: 'ls' }), () => 'a.txt');
    turn.say('Done.');
  });
  const handle = await providerOver(runtime).start({ prompt: 'list files', cwd, permission: 'danger-full-access', signal: new AbortController().signal });
  const events = await collect(handle);
  const call = events.find((event) => event.type === 'tool-call');
  assert.equal(call.name, 'grok_run_command');
  assert.equal(call.input.command, 'ls');
  assert.equal(events.find((event) => event.type === 'tool-result').output, 'a.txt');
  assert.equal(events.at(-1).ok, true);
  await handle.close();
});

// 2026-11-27: Antigravity gives its models only in the answer to `session/new`, so reading them every five minutes left an empty conversation in its own store each time (745 in four days).
test('the universal harnesses keep what they said of their models for hours, not minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let read = 0;
  const driver = providerOver({ listModels: async () => { read++; return { kind: 'ok', models: [{ id: 'm', displayName: 'M' }] }; } });
  await driver.listModels();
  t.mock.timers.tick(5 * 60_000 + 1);
  await driver.listModels();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(read, 1);
  t.mock.timers.tick(6 * 60 * 60_000);
  await driver.listModels();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(read, 2);
});

test('read-only cannot be kept by these harnesses, so a session in it is refused; the other modes start as the harness runs and with a clean environment', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime, asked } = scripted(() => {});
  process.env.ORCA_PANE_KEY = 'pane';
  t.after(() => { delete process.env.ORCA_PANE_KEY; });
  const driver = providerOver(runtime);
  await assert.rejects(driver.start({ prompt: 'x', cwd, permission: 'read-only' }), (error: any) => error.code === 'HARNESS_UNSUPPORTED' && /Grok cannot be kept read-only/.test(error.message));
  assert.equal(asked.length, 0, 'no process was started');
  for (const permission of ['workspace-write', 'danger-full-access', 'auto', undefined]) {
    const handle = await driver.start({ prompt: 'x', cwd, model: 'grok-4.6', permission: permission as string | undefined });
    await collect(handle);
  }
  assert.equal(asked.length, 4);
  assert.equal(asked[0].model, 'grok-4.6');
  assert.equal(asked[0].env.ORCA_PANE_KEY, null);
  assert.equal(asked[0].permissionMode, undefined, 'no mode of Claude\'s reaches another harness');
  assert.equal(asked[0].disallowedTools, undefined, 'a refused option is never sent');
});

test('a message written while the harness works is not steered into it', async (t) => {
  const cwd = await workDirectory(t);
  let release: () => void = () => {};
  let working: () => void = () => {};
  const started = new Promise<void>((resolve) => { working = resolve; });
  const { runtime } = scripted(async (turn) => { turn.say('Working.'); await new Promise<void>((resolve) => { release = resolve; working(); }); });
  const handle = await providerOver(runtime).start({ prompt: 'go', cwd, permission: 'danger-full-access', signal: new AbortController().signal });
  await started;
  assert.equal(await handle.pushUserMessage('and also this', []), false, 'it waits for the next turn');
  release();
  await collect(handle);
  await handle.close();
});
