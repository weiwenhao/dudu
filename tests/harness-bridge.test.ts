import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncQueue } from '../host/providers/async.mjs';
import { analyzeRequest, createHarnessAdapter, HarnessBridge } from '../host/providers/harness-bridge.mjs';

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
        permissions: [] as any[], questions: [] as any[], userMessages: [] as string[], interrupted: 0, closed: 0,
        respondPermission(id: string, decision: any) { this.permissions.push({ id, decision }); },
        respondQuestion(id: string, answer: any) { this.questions.push({ id, answer }); },
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

function setup() {
  const driver = fakeDriver();
  const bridge = new HarnessBridge({ driver, agentOf: () => ({ session: { header: { cwd: '/work/project' } } }) });
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

test('a permission question for a tool call reaches the answerer and the decision goes back to the harness', async () => {
  const { driver, bridge, adapter } = setup();
  const stream = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'rm it')] }));
  await new Promise((resolve) => setImmediate(resolve));
  const handle = driver.handles[0];
  handle.push({ type: 'tool-call', id: 't1', name: 'Bash', input: { command: 'rm x' } });
  handle.push({ type: 'step-end' });
  await stream;

  const seen: any[] = [];
  const waiting = bridge.runOf('s1')!.waitTool('t1', {
    onInteraction: async (request: any, run: any) => { seen.push(request); run.respondPermission(request.id, { behavior: 'allow' }); },
  });
  handle.push({ type: 'permission-request', id: 'p1', toolCallId: 't1', toolName: 'Bash', input: { command: 'rm x' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(handle.permissions, [{ id: 'p1', decision: { behavior: 'allow' } }]);
  handle.push({ type: 'tool-result', id: 't1', output: 'removed', isError: false });
  assert.equal((await waiting).output, 'removed');
  assert.equal(seen.length, 1);
});

test('with nobody to answer, a permission question is denied instead of leaving the harness hanging', async () => {
  const { driver, bridge, adapter } = setup();
  const stream = collect(adapter.stream({ sessionId: 's1', messages: [user('u1', 'go')] }));
  await new Promise((resolve) => setImmediate(resolve));
  const handle = driver.handles[0];
  handle.push({ type: 'tool-call', id: 't1', name: 'Bash', input: {} });
  handle.push({ type: 'step-end' });
  await stream;
  // The question arrives before any tool starts waiting, and is answered once one does.
  handle.push({ type: 'permission-request', id: 'p1', toolCallId: 't1', toolName: 'Bash', input: {} });
  const waiting = bridge.runOf('s1')!.waitTool('t1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handle.permissions[0].decision.behavior, 'deny');
  handle.push({ type: 'tool-result', id: 't1', output: 'denied', isError: true });
  assert.equal((await waiting).isError, true);
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
  const chunks = await collect(adapter.stream({
    sessionId: 's1', purpose: 'session-title',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix the flaky   login test\nit fails on CI' }] }],
  }));
  assert.equal(driver.started.length, 0);
  assert.equal(chunks[1].text, 'Fix the flaky login test it fails on CI');
  const compaction = await collect(adapter.stream({ sessionId: 's1', purpose: 'compaction', messages: [] }));
  assert.equal(driver.started.length, 0);
  assert.equal(compaction[1].text, '');
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
