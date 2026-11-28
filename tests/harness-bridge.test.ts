import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncQueue } from '../host/providers/async.mjs';
import { analyzeRequest, createHarnessAdapter, harnessError, HarnessBridge } from '../host/providers/harness-bridge.mjs';

type Chunk = { type: string; [key: string]: any };

const user = (id: string, text: string) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
const context = (id: string) => ({ id, role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'ctx' }] });
const assistant = (calls: string[] = [], replayState?: unknown) => ({
  role: 'assistant', source: { kind: 'model', provider: 'fake', model: 'm', replayState },
  content: [{ type: 'text', text: 'hi' }, ...calls.map((id) => ({ type: 'tool-call', id, name: 'Bash', arguments: '{}' }))],
});
const tool = (callId: string, text: string) => ({ role: 'tool', source: { kind: 'tool', callId }, content: [{ type: 'text', text }] });

function fakeDriver() {
  const started: any[] = [];
  const handles: any[] = [];
  return {
    id: 'fake', route: 'fake', name: 'Fake Harness', started, handles,
    listModels: async () => [{ provider: 'fake', id: 'm', name: 'M' }],
    resolveModel: async (model: string) => ({ id: model, name: model }),
    async start(options: any) {
      const events = new AsyncQueue();
      const handle = {
        nativeSessionId: options.resume ?? 'native-1',
        events: { async *[Symbol.asyncIterator]() { for (;;) { const next = await events.next(); if (next.done) return; yield next.value; } } },
        push: (event: any) => events.push(event),
        end: () => events.close(),
        userMessages: [] as string[], interrupted: 0, closed: 0,
        pushUserMessage(text: string) { this.userMessages.push(text); },
        async interrupt() { this.interrupted++; },
        async close() { this.closed++; events.close(); },
      };
      started.push(options);
      handles.push(handle);
      return handle;
    },
  };
}

function setup(events?: any[]) {
  const driver = fakeDriver();
  const bridge = new HarnessBridge({
    driver, agentOf: () => ({ session: { header: { cwd: '/work/project' } } }), permissionOf: () => 'workspace-write',
    ...(events ? { eventsOf: async () => events } : {}),
  });
  return { driver, bridge, adapter: createHarnessAdapter(bridge) };
}

async function collect(stream: AsyncIterable<Chunk>) {
  const chunks: Chunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const finishOf = (chunks: Chunk[]) => chunks.at(-1)!;

test('model switching keeps the full DSH transcript outside native harness context pressure', async () => {
  const { driver, adapter } = setup();
  const modelId = 'codex/gpt-6.2-sol';
  // DUD-5 on 2026-11-18: DSH priced the unabridged display transcript above its
  // old 8M threshold although the native harness had already compacted its context.
  const displayTokens = 8_683_301 + 67_842;
  for (const nativeContext of [undefined, { contextWindow: 200_000 }]) {
    driver.resolveModel = async (id: string) => ({ id, name: id, ...(nativeContext ? { context: nativeContext } : {}) });
    const info = await adapter.resolveModel('fake', modelId);
    assert.equal(info.id, modelId);
    assert.ok(Number.isSafeInteger(info.context.contextWindow) && info.context.contextWindow > 0);
    assert.ok(displayTokens < info.context.contextWindow * 0.8,
      'DSH must not summarize display history that the harness never receives as context');
  }

  const prepared = await adapter.prepareCall('fake', modelId);
  const pending = collect(prepared.stream({
    sessionId: 's1', model: prepared.model.id,
    messages: [user('u1', 'old task'), assistant([], { nativeSessionId: 'native-old' }), user('u2', 'continue')],
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(driver.started[0].model, modelId);
  assert.equal(driver.started[0].resume, 'native-old');
  assert.equal(driver.started[0].prompt, 'continue');
  driver.handles[0].push({ type: 'turn-end', ok: true });
  assert.equal(finishOf(await pending).replayState.nativeSessionId, 'native-old');
});

test('a request is the opener of a turn, one more step of it, or steering that arrived on the way', () => {
  const fresh = analyzeRequest([user('u1', 'first'), assistant([], { nativeSessionId: 'n1' }), context('c'), user('u2', 'second')], 'fake');
  assert.equal(fresh.continuing, false);
  assert.equal(fresh.promptText, 'second');
  assert.deepEqual(fresh.link, { nativeSessionId: 'n1' });

  const midTurn = analyzeRequest([user('u1', 'go'), assistant(['t1']), tool('t1', 'out'), user('u2', 'also this')], 'fake');
  assert.equal(midTurn.continuing, true);
  assert.deepEqual(midTurn.prompts.map((message: any) => message.id), ['u1', 'u2']);

  assert.equal(analyzeRequest([user('u1', 'go')], 'fake').link, undefined);
  // Another route's replay state is never mistaken for this harness's session.
  const other = { ...assistant([], { nativeSessionId: 'x' }), source: { kind: 'model', provider: 'other', model: 'm', replayState: { nativeSessionId: 'x' } } };
  assert.equal(analyzeRequest([user('u1', 'go'), other, user('u2', 'again')], 'fake').link, undefined);
});

test('a cold tool-ended session starts the new turn on its native ID without resending the old task', async () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
    { type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: user('u2', 'new task') },
  ];
  const { driver, adapter } = setup(events);
  const messages = [user('u1', 'old task'), assistant(['t1'], { nativeSessionId: 'native-old' }), tool('t1', 'old result'), user('u2', 'new task')];
  const pending = collect(adapter.stream({ sessionId: 's1', messages }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(driver.started.length, 1);
  assert.equal(driver.started[0].resume, 'native-old');
  assert.equal(driver.started[0].prompt, 'new task');
  driver.handles[0].push({ type: 'text-delta', text: 'Resumed.' });
  driver.handles[0].push({ type: 'turn-end', ok: true });
  await pending;

  const missing = setup([...events, { type: 'assistant/message', data: { message: assistant(['current-tool']) } }]);
  const missingChunks = await collect(missing.adapter.stream({ sessionId: 's1', messages }));
  assert.equal(finishOf(missingChunks).reason.kind, 'error');
  assert.equal(finishOf(missingChunks).reason.failure.code, 'HARNESS_LOST');
  assert.equal(missing.driver.started.length, 0, 'a missing mid-turn process cannot be restarted by repeating work');
});

test('a turn is replayed step by step: the tool call waits for the harness result and the session id is recorded', async () => {
  const { driver, bridge, adapter } = setup();
  const first = adapter.stream({ sessionId: 's1', messages: [context('c'), user('u1', 'list files')] });
  const pending = collect(first);
  await new Promise((resolve) => setImmediate(resolve));
  const handle = driver.handles[0];
  assert.equal(driver.started[0].prompt, 'list files');
  assert.equal(driver.started[0].cwd, '/work/project');
  assert.equal(driver.started[0].resume, undefined);

  handle.push({ type: 'step-start' });
  handle.push({ type: 'reasoning-delta', text: 'Let me look.' });
  handle.push({ type: 'text-delta', text: 'I will ' });
  handle.push({ type: 'text-delta', text: 'run ls.' });
  handle.push({ type: 'tool-call', id: 't1', name: 'Bash', input: { command: 'ls' } });
  handle.push({ type: 'step-end', usage: { inputTokens: 10, outputTokens: 4 } });
  const chunks = await pending;

  assert.deepEqual(chunks.map((chunk) => chunk.type), [
    'block-start', 'reasoning-delta', 'block-end',
    'block-start', 'text-delta', 'text-delta', 'block-end',
    'block-start', 'tool-call-delta', 'block-end',
    'usage', 'finish',
  ]);
  assert.deepEqual(chunks[6].block, { type: 'text', text: 'I will run ls.' });
  assert.deepEqual(chunks[9].block, { type: 'tool-call', id: 't1', name: 'Bash', arguments: '{"command":"ls"}' });
  assert.deepEqual(finishOf(chunks), {
    type: 'finish', reason: { kind: 'tool-calls' }, replayState: { harness: 'fake', nativeSessionId: 'native-1' },
  });

  // DSH now runs the mirror tool; it returns only when the harness reports the result.
  const result = bridge.runOf('s1')!.waitTool('t1');
  let settled = false;
  result.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  handle.push({ type: 'tool-result', id: 't1', output: 'a.txt\nb.txt', isError: false });
  assert.deepEqual(await result, { type: 'tool-result', id: 't1', output: 'a.txt\nb.txt', isError: false });

  const second = collect(adapter.stream({
    sessionId: 's1',
    messages: [context('c'), user('u1', 'list files'), assistant(['t1'], { nativeSessionId: 'native-1' }), tool('t1', 'a.txt\nb.txt')],
  }));
  handle.push({ type: 'step-start' });
  handle.push({ type: 'text-delta', text: 'Two files.' });
  handle.push({ type: 'step-end' });
  handle.push({ type: 'turn-end', ok: true });
  const last = await second;
  assert.equal(driver.started.length, 1, 'the second step continues the same harness run');
  assert.deepEqual(finishOf(last).reason, { kind: 'stop' });
  assert.equal(bridge.runOf('s1')!.finished, true);
});

test('the next turn resumes the harness session the previous turn recorded', async () => {
  const { driver, adapter } = setup();
  const stream = collect(adapter.stream({
    sessionId: 's1',
    messages: [user('u1', 'one'), assistant([], { harness: 'fake', nativeSessionId: 'native-77' }), user('u2', 'two')],
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(driver.started[0].resume, 'native-77');
  assert.equal(driver.started[0].prompt, 'two');
  driver.handles[0].push({ type: 'step-end' });
  const chunks = await stream;
  assert.equal(finishOf(chunks).replayState.nativeSessionId, 'native-77');
});

test('stopping the turn interrupts the harness and rejects the step', async () => {
  const { driver, adapter } = setup();
  const controller = new AbortController();
  const stream = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'slow')], signal: controller.signal }));
  await new Promise((resolve) => setImmediate(resolve));
  driver.handles[0].push({ type: 'text-delta', text: 'working' });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new Error('stopped'));
  await assert.rejects(stream, /stopped/);
  assert.equal(driver.handles[0].interrupted, 1);
});

test('a tool still waiting when the harness stops fails, and a failed turn reaches DSH with its code', async () => {
  const { driver, bridge, adapter } = setup();
  const first = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go')] }));
  await new Promise((resolve) => setImmediate(resolve));
  const handle = driver.handles[0];
  handle.push({ type: 'tool-call', id: 't1', name: 'Bash', input: {} });
  handle.push({ type: 'step-end' });
  await first;
  const waiting = bridge.runOf('s1')!.waitTool('t1');
  handle.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } });
  handle.push({ type: 'turn-end', ok: false, error: harnessError('Not logged in', 'AUTH') });
  await assert.rejects(waiting, /ended before the tool finished/);

  const next = collect(adapter.stream({
    sessionId: 's1', messages: [user('u1', 'go'), assistant(['t1'], { nativeSessionId: 'native-1' }), tool('t1', 'x')],
  }));
  const chunks = await next;
  assert.deepEqual(chunks.find(chunk => chunk.type === 'usage')?.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  assert.deepEqual(finishOf(chunks).reason, { kind: 'error', failure: { code: 'AUTH', message: 'Not logged in' } });
});

test('a step that needs a harness run that is gone fails instead of starting another run for the same prompt', async () => {
  const { driver, adapter } = setup();
  const chunks = await collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go'), assistant(['t1']), tool('t1', 'x')] }));
  assert.equal(finishOf(chunks).reason.kind, 'error');
  assert.equal(finishOf(chunks).reason.failure.code, 'HARNESS_LOST');
  assert.equal(driver.started.length, 0);
});

test('a harness that exits without a result is a failed turn', async () => {
  const { driver, adapter } = setup();
  const stream = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go')] }));
  await new Promise((resolve) => setImmediate(resolve));
  driver.handles[0].end();
  assert.equal(finishOf(await stream).reason.failure.code, 'HARNESS_EXITED');
});

test('a rejected opening prompt reaches DSH as a structured failure without retrying or losing its reason', async () => {
  const { driver, adapter } = setup();
  let starts = 0;
  driver.start = async () => {
    starts++;
    throw harnessError('ChatGPT did not take the message: runtime exited', 'HARNESS_REJECTED');
  };
  const chunks = await collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go')] }));
  assert.deepEqual(chunks, [{
    type: 'finish',
    reason: { kind: 'error', failure: { code: 'HARNESS_REJECTED', message: 'ChatGPT did not take the message: runtime exited' } },
  }]);
  assert.equal(starts, 1, 'an error must not silently repeat the instruction');
});

test('input typed while the harness works is handed over once, as steering', async () => {
  const { driver, bridge, adapter } = setup();
  const first = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go')] }));
  await new Promise((resolve) => setImmediate(resolve));
  const handle = driver.handles[0];
  handle.push({ type: 'tool-call', id: 't1', name: 'Bash', input: {} });
  handle.push({ type: 'step-end' });
  await first;
  handle.push({ type: 'tool-result', id: 't1', output: 'ok', isError: false });
  const messages = [user('u1', 'go'), assistant(['t1']), tool('t1', 'ok'), user('u2', 'actually use tabs')];
  for (let i = 0; i < 2; i++) {
    const again = collect(adapter.stream({ sessionId: 's1', messages }));
    handle.push({ type: 'step-end' });
    await again;
    handle.push({ type: 'tool-call', id: `t${i + 2}`, name: 'Bash', input: {} });
  }
  assert.deepEqual(handle.userMessages, ['actually use tabs']);
  assert.equal(bridge.runOf('s1')!.forwarded.has('u2'), true);
});

// A harness that cannot take a message while it works (no steering) must not be told it was handed one: it would be lost.
test('input typed while a harness that cannot steer works is not marked as handed over, and the next turn carries it', async () => {
  const { driver, bridge, adapter } = setup();
  const first = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go')] }));
  await new Promise((resolve) => setImmediate(resolve));
  const handle = driver.handles[0];
  handle.pushUserMessage = function pushUserMessage(text: string) { this.userMessages.push(text); return false; };
  handle.push({ type: 'tool-call', id: 't1', name: 'Bash', input: {} });
  handle.push({ type: 'step-end' });
  await first;
  handle.push({ type: 'tool-result', id: 't1', output: 'ok', isError: false });
  const messages = [user('u1', 'go'), assistant(['t1']), tool('t1', 'ok'), user('u2', 'actually use tabs')];
  const again = collect(adapter.stream({ sessionId: 's1', messages }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bridge.runOf('s1')!.forwarded.has('u2'), false, 'nothing was sent, so it is not forwarded');
  handle.push({ type: 'text-delta', text: 'Done.' });
  handle.push({ type: 'step-end', reason: 'stop' });
  handle.push({ type: 'turn-end', ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(driver.started.length, 2, 'a turn of its own starts for the message');
  assert.equal(driver.started[1].prompt, 'actually use tabs');
  driver.handles[1].push({ type: 'step-end', reason: 'stop' });
  driver.handles[1].push({ type: 'turn-end', ok: true });
  await again;
  await bridge.dispose();
});

test('input admitted after the native answer resumes the same session once instead of steering a disposed writer', async () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: user('u1', 'first instruction') },
  ];
  const { driver, bridge, adapter } = setup(events);
  const first = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'first instruction')] }));
  await new Promise(resolve => setImmediate(resolve));
  driver.handles[0].push({ type: 'text-delta', text: 'First answer.' });
  driver.handles[0].push({ type: 'step-end', reason: 'stop' });
  driver.handles[0].push({ type: 'turn-end', ok: true });
  await first;
  const previous = assistant([], { nativeSessionId: 'native-1' });
  events.push(
    { type: 'assistant/message', data: { message: previous } },
    { type: 'user/message', data: user('u2', 'next instruction') },
  );
  const next = collect(adapter.stream({
    sessionId: 's1', messages: [user('u1', 'first instruction'), previous, user('u2', 'next instruction')],
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(driver.started.length, 2);
  assert.equal(driver.started[1].resume, 'native-1');
  assert.equal(driver.started[1].prompt, 'next instruction');
  assert.deepEqual(driver.handles[0].userMessages, []);
  driver.handles[1].push({ type: 'text-delta', text: 'Second answer.' });
  driver.handles[1].push({ type: 'step-end', reason: 'stop' });
  driver.handles[1].push({ type: 'turn-end', ok: true });
  assert.equal(finishOf(await next).reason.kind, 'stop');
  assert.deepEqual([...bridge.runOf('s1')!.forwarded].sort(), ['u1', 'u2']);
  assert.equal(driver.started.length, 2, 'completed native work is never submitted again');
  await bridge.dispose();
});

test('the runs deep sleep may look at are those whose turn has ended, with when it ended', async () => {
  const { driver, bridge } = setup();
  await bridge.begin('s1', { prompts: [user('u1', 'work')], link: { nativeSessionId: 'native-9' } });
  assert.deepEqual(bridge.heldRuns(), [], 'it works');
  driver.handles[0].push({ type: 'turn-end', ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  const [held, ...rest] = bridge.heldRuns();
  assert.equal(rest.length, 0);
  assert.deepEqual([held.sessionId, held.route], ['s1', 'fake']);
  assert.ok(Number.isFinite(held.finishedAt) && held.finishedAt >= bridge.runOf('s1')!.startedAt);
  assert.equal(await bridge.release('s1'), true);
  assert.deepEqual(bridge.heldRuns(), [], 'what was let go of is no longer kept');
});

test('deep sleep lets go of a run whose turn has ended and never of one that works; the next turn starts a harness again on the same native session', async () => {
  const { driver, bridge, adapter } = setup();
  const run = await bridge.begin('s1', { prompts: [user('u1', 'work')], link: { nativeSessionId: 'native-9' } });
  assert.equal(bridge.hasActiveWork('s1'), true);
  assert.equal(await bridge.release('s1'), false, 'it works');
  assert.equal(bridge.runOf('s1'), run);
  assert.equal(driver.handles[0].closed, 0);
  driver.handles[0].push({ type: 'turn-end', ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.finished, true);
  driver.handles[0].backgroundActive = true;
  assert.equal(bridge.hasActiveWork('s1'), true, 'a finished foreground turn can still own background work');
  assert.equal(await bridge.release('s1'), false, 'that background work keeps its native process');
  driver.handles[0].backgroundActive = false;
  assert.equal(bridge.hasActiveWork('s1'), false);

  assert.equal(await bridge.release('s1'), true, 'the turn has ended');
  assert.equal(bridge.runOf('s1'), undefined, 'the run, with what it kept of the turn, is gone');
  assert.equal(driver.handles[0].closed, 1, 'and closed');
  assert.equal(await bridge.release('s1'), false, 'nothing is left to let go of');
  assert.equal(await bridge.release('somewhere else'), false);

  const next = collect(adapter.stream({
    sessionId: 's1', messages: [user('u1', 'work'), assistant([], { harness: 'fake', nativeSessionId: 'native-9' }), user('u2', 'again')],
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(driver.started.length, 2, 'a harness is started again');
  assert.equal(driver.started[1].resume, 'native-9', 'on the session the first one recorded');
  assert.equal(driver.started[1].prompt, 'again');
  driver.handles[1].push({ type: 'step-end' });
  assert.equal(finishOf(await next).reason.kind, 'stop');
});
