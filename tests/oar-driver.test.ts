import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedRuntime } from '@dudu/oar-adapter/testing';
import { ClaudeNormalizer, ENTRYPOINT, WRITING_TOOLS, createClaudeProvider } from '../host/providers/drivers/claude.mjs';
import { sandboxOf } from '../host/providers/drivers/codex.mjs';
import { compactOarSession, startOarRun } from '../host/providers/oar.mjs';

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

test('how a turn ends decides its code: interrupted, not logged in, or anything else with its class', () => {
  const end = (outcome: any) => run(claude(), [turnEnded(outcome)]).at(-1);
  assert.equal(end({ kind: 'aborted' }).error.code, 'ABORTED');
  const auth = end({ kind: 'failed', failure: 'auth', reason: 'Invalid API key' }).error;
  assert.equal(auth.code, 'AUTH');
  assert.equal(auth.message, 'Claude is not logged in. Run `claude` in a terminal and sign in.');
  const quota = end({ kind: 'failed', failure: 'quota', reason: 'Usage limit reached' }).error;
  assert.deepEqual([quota.code, quota.message, quota.failure], ['HARNESS_FAILED', 'Usage limit reached', 'quota']);
});

test('a process that exits before the turn ends is a failed turn', () => {
  const events = run(claude(), [said('Working'), { kind: 'response', requestId: '', body: { kind: 'exited', code: 137 } }]);
  assert.equal(events.at(-1).error.code, 'HARNESS_EXITED');
  assert.match(events.at(-1).error.message, /Claude exited \(137\)/);
});

test('the DSH access mode becomes a Codex sandbox, and what it forbids stays forbidden', () => {
  assert.equal(sandboxOf('danger-full-access'), 'danger-full-access');
  assert.equal(sandboxOf('read-only'), 'read-only');
  for (const mode of ['workspace-write', 'auto', undefined]) assert.equal(sandboxOf(mode as string | undefined), 'workspace-write');
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

test('a harness session starts where the DSH session works, with the mode, model and effort it was given and a clean environment', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime, asked } = scripted(() => {});
  process.env.ORCA_PANE_KEY = 'pane';
  t.after(() => { delete process.env.ORCA_PANE_KEY; });
  const driver = createClaudeProvider({ runtime }).create({ installation: BUNDLED });
  await collect(await driver.start({ prompt: 'x', cwd, model: 'opus', effort: 'high', permission: 'read-only' }));
  const options = asked[0];
  assert.equal(options.cwd, cwd);
  assert.equal(options.retainedBytes, 8 * 1024 * 1024, 'resident OAR sessions retain only a bounded tail of native/tool payloads');
  assert.equal(options.model, 'opus');
  assert.equal(options.effort, 'high');
  assert.equal(options.resume, undefined);
  assert.equal(options.env.CLAUDE_CODE_ENTRYPOINT, ENTRYPOINT, 'sessions stay in the terminal\'s resume list');
  assert.equal(options.env.ORCA_PANE_KEY, null);
  assert.equal(options.permissionMode, 'dontAsk');
  assert.deepEqual(options.disallowedTools, [...WRITING_TOOLS, 'AskUserQuestion']);

  await collect(await driver.start({ prompt: 'again', cwd, model: 'default', resume: 'native-1', permission: 'danger-full-access' }));
  const next = asked[1];
  assert.equal(next.model, undefined, 'the picker\'s default means no model');
  assert.equal(next.resume, 'native-1');
  assert.equal(next.permissionMode, 'bypassPermissions');
  assert.deepEqual(next.disallowedTools, ['AskUserQuestion']);
  await collect(await driver.start({ prompt: 'native settings', cwd, permission: 'workspace-write' }));
  assert.equal(asked[2].permissionMode, 'inherit');
  assert.deepEqual(asked[2].disallowedTools, ['AskUserQuestion'], 'native permissions retain Bash and native rules');
  await collect(await driver.start({ prompt: 'auto', cwd, permission: 'auto' }));
  assert.equal(asked[3].permissionMode, 'auto');
});

test('the tools the host serves are given to the harness session with every start: its server joins the options and the tools of Claude\'s own they replace join the denied ones', async (t) => {
  const cwd = await workDirectory(t);
  const { runtime, asked } = scripted(() => {});
  const driver = createClaudeProvider({ runtime }).create({ installation: BUNDLED });
  const hostTools = { mcpServers: [{ name: 'dudu', type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer t' } }], disallowedTools: ['CronCreate', 'AskUserQuestion'], launchArgs: ['--allowedTools', 'mcp__dudu__CronCreate'] };
  await collect(await driver.start({ prompt: 'x', cwd, permission: 'danger-full-access', hostTools }));
  assert.deepEqual(asked[0].mcpServers, hostTools.mcpServers);
  assert.deepEqual(asked[0].disallowedTools, ['AskUserQuestion', 'CronCreate'], 'a tool that is denied twice is denied once');
  assert.deepEqual(asked[0].launchArgs, ['--allowedTools', 'mcp__dudu__CronCreate']);
  await collect(await driver.start({ prompt: 'again', cwd, resume: 'native-1', permission: 'danger-full-access', hostTools }));
  assert.deepEqual(asked[1].mcpServers, hostTools.mcpServers, 'OAR does not remember the server: every start gives it again');
  await collect(await driver.start({ prompt: 'none', cwd, permission: 'danger-full-access' }));
  assert.equal(asked[2].mcpServers, undefined);
  assert.deepEqual(asked[2].disallowedTools, ['AskUserQuestion']);
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
  const observers = new Set<(record: unknown) => void>();
  const session = {
    id: 'native-1', rawEvents: (callback: (record: unknown) => void) => { observers.add(callback); return () => { observers.delete(callback); }; },
    prompt: async () => ({ kind: 'accepted' }),
    steer: async (text: string, options: { inputId: string }) => { steered.push({ text, inputId: options.inputId }); return steerReply; },
    abort: async () => ({ kind: 'accepted' }),
    dispose: async () => {},
  };
  return { session, steered, emit: (record: unknown) => { for (const observer of observers) observer(record); } };
}
const startRun = (session: unknown, options: Record<string, unknown> = {}) => startOarRun({
  runtime: { session: async () => session }, installation: BUNDLED, sessionOptions: {}, prompt: 'x', normalizer: claude(), name: 'Claude', ...options,
});
const activity = frame([{ kind: 'turn_active' }]);
const acknowledged = (inputId: string) => frame([{ kind: 'user_message', input: 'more', inputId, evidence: 'acknowledged' }]);

test('input admission records the durable write boundary before OAR prompt and its acknowledgement after it', async () => {
  const states: string[] = [];
  const { session } = queueingSession();
  session.prompt = async () => {
    assert.deepEqual(states, ['submitting']);
    return { kind: 'accepted' };
  };
  const handle = await startRun(session, { onInput: async ({ state }: any) => { states.push(state); } });
  assert.deepEqual(states, ['submitting', 'accepted']);
  const steering: string[] = [];
  await handle.pushUserMessage('More.', undefined, { onInput: async ({ state }: any) => { steering.push(state); } });
  assert.deepEqual(steering, ['submitting', 'accepted']);
  assert.deepEqual(states, ['submitting', 'accepted'], 'steering has its own input receipt');
  await handle.close();
});

test('native refusal returns input ownership, while a transport exception leaves admission uncertain', async () => {
  for (const outcome of [{ kind: 'rejected', code: 'busy', reason: 'busy' }, { kind: 'rejected', code: 'error', reason: 'connection lost' }, new Error('transport lost')]) {
    const states: string[] = [];
    const { session } = queueingSession();
    session.prompt = async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome as any;
    };
    await assert.rejects(startRun(session, { onInput: async ({ state }: any) => { states.push(state); } }),
      (error: any) => error.code === 'HARNESS_REJECTED');
    assert.deepEqual(states, outcome instanceof Error || outcome.code === 'error'
      ? ['submitting', 'submitting'] : ['submitting', 'undelivered']);
  }
});

function manualCompactionSession(outcome?: any) {
  const { session, emit } = queueingSession();
  const completion = Promise.withResolvers<any>();
  if (outcome) completion.resolve(outcome);
  const manual = {
    ...session, interrupted: 0, disposed: 0,
    compact: async (_options?: unknown) => completion.promise,
    abort: async () => { manual.interrupted++; },
    dispose: async () => { manual.disposed++; },
  };
  return { session: manual, complete: completion.resolve, emit: (record: any) => emit({ sessionId: manual.id, ...record }) };
}
const compactSession = (session: unknown, options: Record<string, unknown> = {}) => compactOarSession({
  runtime: { session: async () => session }, installation: BUNDLED, sessionOptions: {}, name: 'Harness', ...options,
});

test('manual compaction waits for OAR native completion and actual writer release', async () => {
  const { session, emit, complete } = manualCompactionSession();
  const released = Promise.withResolvers<void>();
  session.dispose = async () => { session.disposed++; await released.promise; };
  let finished = false;
  const pending = compactSession(session).then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'OAR has not yet reported native completion');
  emit({ ...frame([{ kind: 'compaction_ended', outcome: 'completed' }]), sessionId: 'child-thread' });
  emit({ ...turnEnded({ kind: 'completed' }), agentPath: ['child'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.disposed, 0, 'child boundaries cannot finish the parent');
  emit(frame([{ kind: 'compaction_ended', outcome: 'completed' }]));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'a frame alone cannot replace the official completion outcome');
  emit(turnEnded({ kind: 'completed' }));
  complete({ kind: 'completed' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'the next writer must not start before disposal completes');
  assert.equal(session.disposed, 1);
  released.resolve();
  await pending;
  assert.equal(finished, true);
  assert.equal(session.interrupted, 0);
});

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

test('a resumed Claude session first answers the notice of what the cut process left running: that end is not the end of the prompt\'s turn', async () => {
  // 2026-11-18: after a forced update and a new login, "继续" showed "已完成，用时 4 秒" with nothing in it, while Claude went on working out of sight.
  const { session: base, emit } = queueingSession();
  const prompted: string[] = [];
  const session = { ...base, prompt: async (_text: string, options: { inputId: string }) => { prompted.push(options.inputId); return { kind: 'accepted' }; } };
  const handle = await startRun(session, { queuesSteer: true, sessionOptions: { resume: 'native-1' } });
  const seen = collect(handle);
  // "Background shell command didn't finish before the previous session ended": a turn of its own, with no model call, over before the prompt is taken up
  emit(turnEnded({ kind: 'completed' }));
  await new Promise((resolve) => setImmediate(resolve));
  emit(acknowledged(prompted[0]));
  emit(said('The real answer.'));
  emit(messageStop());
  emit(turnEnded({ kind: 'completed' }));
  const events = await seen;
  assert.deepEqual(types(events), ['text-delta', 'step-end', 'turn-end']);
  assert.equal(events[0].text, 'The real answer.');
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

test('native background agents keep OAR alive after the root answer and are observed outside the parent stream', async () => {
  const { session, emit } = queueingSession();
  const records: any[] = [];
  let disposed = 0;
  session.dispose = async () => { disposed++; };
  const handle = await startRun(session, { followUpMs: 10, onRecord: (record: any) => records.push(record) });
  const published: any[] = [];
  const seen = (async () => { for await (const event of handle.events) published.push(event); return published; })();
  emit(frame([{ kind: 'task_started', taskId: 'research', taskType: 'agent', childSessionId: 'child', background: true }]));
  emit(said('Research started.'));
  emit(turnEnded({ kind: 'completed' }));
  await wait(25);
  assert.equal(disposed, 0, 'the first root answer cannot kill its research');
  assert.equal(published.some(event => event.type === 'step-end' || event.type === 'turn-end'), false, 'DSH must not receive an early stop boundary');
  emit({ ...said('Research result.'), sessionId: 'child' });
  emit(frame([{ kind: 'task_ended', taskId: 'research', status: 'completed' }]));
  emit(frame([{ kind: 'turn_active' }]));
  emit(said('Research collected.'));
  emit(turnEnded({ kind: 'completed' }));
  assert.equal((await seen).filter(event => event.type === 'text-delta').map(event => event.text).join(''), 'Research started.\n\nResearch collected.');
  assert.ok(records.some(record => record.sessionId === 'child'), 'the team observer receives actual child records');
  await handle.close();
  assert.equal(disposed, 1);
});

test('native process failure still ends a held root, while foreground shell and ambient tasks do not hold it', async () => {
  const broken = queueingSession();
  const handle = await startRun(broken.session);
  const seen = collect(handle);
  broken.emit(frame([{ kind: 'task_started', taskId: 'a', taskType: 'agent' }]));
  broken.emit(turnEnded({ kind: 'completed' }));
  broken.emit({ kind: 'response', sessionId: broken.session.id, agentPath: [], body: { kind: 'exited', code: 9 } });
  assert.equal((await seen).at(-1).error.code, 'HARNESS_EXITED');
  for (const task of [{ taskType: 'shell', background: false }, { taskType: 'shell', ambient: true }, { taskType: 'agent', ambient: true }]) {
    const next = queueingSession();
    const current = await startRun(next.session);
    const finished = collect(current);
    next.emit(frame([{ kind: 'task_started', taskId: 'ignored', ...task }]));
    next.emit(turnEnded({ kind: 'completed' }));
    assert.equal((await finished).at(-1).ok, true);
    await current.close();
  }
});
