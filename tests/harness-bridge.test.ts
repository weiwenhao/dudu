import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncQueue } from '../host/providers/async.mjs';
import { analyzeRequest, createHarnessAdapter, HarnessBridge, titleOf } from '../host/providers/harness-bridge.mjs';

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

test('persisted turn boundaries distinguish new Claude/Codex input from stopped tool-ended history', () => {
  for (const route of ['claude', 'codex']) for (const kind of ['completed', 'aborted', 'error']) {
    const old = { ...assistant(['t1']), source: { kind: 'model', provider: route, model: 'm', replayState: { harness: route, nativeSessionId: 'native-old' } } };
    const messages = [user('u1', 'old task'), old, tool('t1', 'old result'), context('ctx'), user('u2', 'new task')];
    const events = [
      { type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: user('u1', 'old task') },
      { type: 'assistant/message', data: { message: old } }, { type: 'turn/end', data: { turn: 1, reason: { kind } } },
      { type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: user('u2', 'new task') },
    ];
    const fresh = analyzeRequest(messages, route, events);
    assert.equal(fresh.continuing, false, `${route}: ${kind} history has ended`);
    assert.equal(fresh.promptText, 'new task');
    assert.deepEqual(fresh.link, { harness: route, nativeSessionId: 'native-old' });
    events.push(
      { type: 'assistant/message', data: { message: old } },
      { type: 'user/message', data: user('u3', 'steer this turn') },
    );
    const continuing = analyzeRequest([...messages, old, tool('t1', 'new result'), user('u3', 'steer this turn')], route, events);
    assert.equal(continuing.continuing, true);
    assert.deepEqual(continuing.prompts.map((message: any) => message.id), ['u2', 'u3']);
  }
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
  await assert.rejects(collect(missing.adapter.stream({ sessionId: 's1', messages })),
    (error: any) => error.code === 'HARNESS_LOST');
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
  handle.push({ type: 'turn-end', ok: false, error: Object.assign(new Error('Not logged in'), { code: 'AUTH' }) });
  await assert.rejects(waiting, /ended before the tool finished/);

  const next = collect(adapter.stream({
    sessionId: 's1', messages: [user('u1', 'go'), assistant(['t1'], { nativeSessionId: 'native-1' }), tool('t1', 'x')],
  }));
  await assert.rejects(next, (error: any) => error.code === 'AUTH' && /Not logged in/.test(error.message));
});

test('a step that needs a harness run that is gone fails instead of starting another run for the same prompt', async () => {
  const { driver, adapter } = setup();
  await assert.rejects(
    collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go'), assistant(['t1']), tool('t1', 'x')] })),
    (error: any) => error.code === 'HARNESS_LOST',
  );
  assert.equal(driver.started.length, 0);
});

test('a harness that exits without a result is a failed turn', async () => {
  const { driver, adapter } = setup();
  const stream = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go')] }));
  await new Promise((resolve) => setImmediate(resolve));
  driver.handles[0].end();
  await assert.rejects(stream, (error: any) => error.code === 'HARNESS_EXITED');
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

test('titles and other auxiliary calls never start the harness', async () => {
  const { driver, adapter } = setup();
  const wrapped = 'Generate the session title from this JSON array of human messages:\n[{"seq":10,"text":"Fix the flaky   login test\\nit fails on CI"},{"seq":14,"text":"and the retry"}]';
  const chunks = await collect(adapter.stream({
    sessionId: 's1', purpose: 'session-title', messages: [{ role: 'user', source: { kind: 'dsh-session-title-llm' }, content: [{ type: 'text', text: wrapped }] }],
  }));
  assert.equal(driver.started.length, 0);
  assert.equal(chunks[1].text, 'Fix the flaky login test it fails on CI');
  const compaction = await collect(adapter.stream({ sessionId: 's1', purpose: 'compaction', messages: [] }));
  assert.equal(driver.started.length, 0);
  assert.equal(compaction[1].text, '');
});

test('a title is the first prompt, short, in the language it was written in', () => {
  const ask = (text: string) => [{ role: 'user', content: [{ type: 'text', text }] }];
  assert.equal(titleOf(ask('Just a plain request')), 'Just a plain request');
  assert.equal(titleOf(ask('x'.repeat(100))), `${'x'.repeat(59)}…`);
  assert.equal(titleOf(ask('Generate the session title from this JSON array of human messages:\n[{"seq":1,"text":"帮我把登录页的测试修好，并且检查一下重试逻辑和超时设置"}]')), `${'帮我把登录页的测试修好，并且检查一下重试逻辑和超时设置'.slice(0, 23)}…`);
  assert.equal(titleOf(ask('Generate the session title from this JSON array of human messages:\n[not json')), 'Generate the session title from this JSON array of human messages: [not json'.slice(0, 59) + '…');
  assert.equal(titleOf([]), 'New session');
});

test('an empty prompt is refused rather than sent to the harness', async () => {
  const { driver, adapter } = setup();
  await assert.rejects(collect(adapter.stream({ sessionId: 's1', messages: [context('c')] })), (error: any) => error.code === 'HARNESS_NO_PROMPT');
  assert.equal(driver.started.length, 0);
});

test('the model catalog always declares a context window large enough that DSH never compacts', async () => {
  const { adapter } = setup();
  const info = await adapter.resolveModel('fake', 'm');
  assert.ok(info.context.contextWindow >= 1_000_000);
  assert.equal(info.provider, 'fake');
  assert.deepEqual(adapter.providerInfo('fake'), { id: 'fake', name: 'Fake Harness' });
});

test('starting a run says which DSH session runs which harness session, and a listener that fails changes nothing', async () => {
  const driver = fakeDriver();
  const links: any[] = [];
  const bridge = new HarnessBridge({ driver, agentOf: () => undefined, onLink: (link: any) => links.push(link) });
  await bridge.begin('s1', { prompts: [user('u1', 'hi')], promptText: 'hi', link: { nativeSessionId: 'native-9' } });
  await bridge.begin('s2', { prompts: [user('u2', 'hi')], promptText: 'hi' });
  assert.deepEqual(links, [
    { route: 'fake', nativeSessionId: 'native-9', sessionId: 's1' },
    { route: 'fake', nativeSessionId: 'native-1', sessionId: 's2' },
  ]);
  const careless = new HarnessBridge({ driver: fakeDriver(), agentOf: () => undefined, onLink: () => { throw new Error('bookkeeping failed'); } });
  assert.ok(await careless.begin('s3', { prompts: [user('u3', 'hi')], promptText: 'hi' }), 'the run still starts');
  assert.ok(await new HarnessBridge({ driver: fakeDriver(), agentOf: () => undefined }).begin('s4', { prompts: [user('u4', 'hi')], promptText: 'hi' }));
});
