import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createSessionTools, sessionToolTransport } from '../host/providers/cron-tools.mjs';
import { createQuestionTool, questionInput } from '../host/providers/question-tools.mjs';
import { HARNESS_IDS } from '../host/providers/catalog.mjs';
import { createNativeQuestions } from '../host/native-questions.mjs';

const schema = {
  parameters: {
    type: 'object', properties: {
      questions: {
        type: 'array', items: {
          type: 'object', required: ['id', 'question'],
          properties: { id: { type: 'string' }, question: { type: 'string' }, multi_select: { type: 'boolean' } },
        },
      },
    },
  },
};
const input = { questions: [
  { id: 'choice', question: 'Which?', header: 'Mode', options: [{ label: 'A', description: 'First' }, { label: 'B' }], multi_select: true },
  { id: 'other', question: 'Anything else?' },
] };
const answers = [{ id: 'choice', selected: ['A', 'B'] }, { id: 'other', selected: [], custom: 'Custom answer' }];
const agent = (id: string) => ({ id, session: { id } });

function setup() {
  let listener: any;
  const requests: any[] = [];
  const bridge = createNativeQuestions({
    events: { on(_name: string, callback: any) { listener = callback; return () => {}; } },
  });
  const question = {
    schema: () => schema,
    ask: (request: any) => {
      requests.push(request);
      return listener(request, () => new Promise(() => {}));
    },
  };
  return { bridge, question, requests };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('every harness gets a question tool; only Claude gets cron replacements and Claude-specific allow flags', async () => {
  const served: any[] = [];
  let closed = 0;
  const made = setup();
  const tools = createSessionTools({
    question: made.question,
    serve: async (options: any) => {
      served.push(options);
      return { server: { name: 'dudu', type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer private' } }, close: async () => { closed++; } };
    },
  });
  try {
    for (const route of HARNESS_IDS) {
      assert.deepEqual(tools.names(route), [...(route === 'claude' ? ['CronCreate', 'CronDelete', 'CronList'] : []), 'ask_user_question']
        .map((name) => `mcp__dudu__${name}`), 'known host tools can be mirrored before DSH freezes the first step');
      const run = { agent: agent(route), signal: new AbortController().signal };
      const first = await tools.forSession(route, route, run);
      assert.equal(await tools.forSession(route, route, run), first, 'retained native processes keep exactly the same MCP settings');
      const names = served.at(-1).tools.map((tool: any) => tool.name);
      assert.deepEqual(names, route === 'claude' ? ['CronCreate', 'CronDelete', 'CronList', 'ask_user_question'] : ['ask_user_question']);
      assert.equal(first.mcpServers.length, 1);
      if (route === 'claude') assert.match(first.launchArgs[1], /mcp__dudu__ask_user_question/);
      else {
        assert.deepEqual(first.launchArgs, route === 'codex'
          ? ['-c', 'mcp_servers.dudu={url="http://127.0.0.1:1/mcp",enabled=false,tool_timeout_sec=2147483}'] : undefined);
        assert.equal(first.disallowedTools, undefined, 'no unsupported native deny option is given to other harnesses');
      }
      if (first.env) {
        const config = JSON.stringify(first.mcpServers);
        assert.ok(!config.includes('private') && !config.includes('127.0.0.1'), 'ACP config carries no credentials or endpoint');
        assert.equal(Object.values(first.env).some((value: string) => value.includes('Bearer private')), true);
        assert.equal(first.mcpServers[0].env, undefined, 'Antigravity must not persist credentials');
      }
      if (route === 'claude') assert.ok(first.mcpServers[0].command, 'Claude uses stdio, avoiding its silent HTTP response deadline');
    }
    assert.equal(served.length, HARNESS_IDS.length);
    assert.equal(await tools.forSession('dudu-assistant-own', 'claude', {}), null);
    assert.equal(await tools.forSession('unknown', 'unknown', {}), null);
  } finally { await tools.close(); made.bridge.close(); }
  assert.equal(closed, HARNESS_IDS.length);
  assert.equal(await tools.forSession('new', 'codex', {}), null, 'a closed plugin cannot start a new tool server');
});

test('answers stay in their owning conversation, preserve multi-select/custom/skips, and stopping cannot turn an unanswered question into an empty answer', async () => {
  const made = setup();
  const a = new AbortController();
  const b = new AbortController();
  const lifetime = new AbortController();
  const tool = (id: string, signal: AbortSignal) => createQuestionTool({
    schema, ask: made.question.ask, owner: () => ({ agent: agent(id), signal }), lifetime: lifetime.signal,
  });
  const releaseA = made.bridge.watch('a');
  const releaseB = made.bridge.watch('b');
  const changes: any[] = [];
  const releaseChanges = made.bridge.watch('a', undefined, () => changes.push(made.bridge.list('a')));
  try {
    const pendingA = tool('a', a.signal).handler(input, { signal: a.signal });
    const pendingB = tool('b', b.signal).handler(input, { signal: b.signal });
    const stopped = assert.rejects(pendingB, /stopped/);
    const qa = made.bridge.list('a')[0];
    const qb = made.bridge.list('b')[0];
    assert.notEqual(qa.callId, qb.callId);
    assert.equal(made.bridge.answer('b', qa.callId, answers), false);
    assert.equal(made.bridge.list('a', [qa]).length, 1, 'live requests and a projection of the same call do not duplicate the card');
    assert.equal(made.bridge.answer('a', qa.callId, answers), true);
    assert.deepEqual(JSON.parse(await pendingA), { answers });
    b.abort(new Error('stopped'));
    await stopped;
    assert.equal(made.bridge.answer('b', qb.callId, answers), false);
    assert.deepEqual(made.bridge.list('a'), []);
    assert.deepEqual(made.bridge.list('b'), []);
    assert.equal(changes.length, 2, 'open and settled questions notify their views');
    const skipped = tool('a', a.signal).handler({ questions: [input.questions[1]] }, { signal: a.signal });
    const call = made.bridge.list('a')[0];
    made.bridge.answer('a', call.callId, [{ id: 'other', selected: [] }]);
    assert.deepEqual(JSON.parse(await skipped), { answers: [{ id: 'other', selected: [] }] });
  } finally { releaseA(); releaseB(); releaseChanges(); made.bridge.close(); }
});

test('untrusted MCP arguments cannot select a session, turn a question into an approval, or submit malformed question/answer batches', async () => {
  const [safe] = questionInput({ ...input, agent: agent('victim'), signal: {}, wait: { callId: 'victim' }, questions: [{ ...input.questions[0], intent: { kind: 'approval', approve: 'A' } }] });
  assert.equal(safe.intent, undefined);
  assert.equal(safe.id, 'choice');
  assert.equal(safe.multiSelect, true);
  for (const invalid of [
    {}, { questions: [] }, { questions: [null] }, { questions: [{ id: 'x', question: '' }] },
    { questions: [{ id: 'x', question: 'Q', multi_select: 'yes' }] },
    { questions: [input.questions[0], input.questions[0]] },
    { questions: [{ id: 'x', question: 'Q', options: [{ label: 'A' }, { label: 'A' }] }] },
  ]) assert.throws(() => questionInput(invalid), /Invalid/);
  const abort = new AbortController();
  const badAnswer = createQuestionTool({
    schema, ask: async () => ({ answers: [] }), owner: () => ({ agent: agent('a'), signal: abort.signal }), lifetime: abort.signal,
  });
  await assert.rejects(badAnswer.handler(input, { signal: abort.signal }), { code: 'STALE_APPROVAL' });
});

test('a reused tool server binds each call to its current run; changing agents revokes the old server and pending questions', async () => {
  const made = setup();
  const served: any[] = [];
  let closed = 0;
  const tools = createSessionTools({
    question: made.question, serve: async (options: any) => {
      served.push(options);
      return { server: { name: 'dudu', type: 'http', url: 'http://127.0.0.1:1/mcp' }, close: async () => { closed++; } };
    },
  });
  const first = new AbortController();
  const second = new AbortController();
  const owner = agent('a');
  const release = made.bridge.watch('a');
  try {
    await tools.forSession('a', 'codex', { agent: owner, signal: first.signal });
    first.abort(new Error('old turn'));
    await tools.forSession('a', 'codex', { agent: owner, signal: second.signal });
    const pending = served[0].tools[0].handler(input, { signal: new AbortController().signal });
    const cancelled = assert.rejects(pending, { name: 'AbortError' });
    await tools.forSession('a', 'pi', { agent: owner, signal: second.signal });
    await cancelled;
    assert.equal(served.length, 2);
    assert.equal(closed, 1);
    assert.equal(made.requests.length, 1, 'the old run signal does not cancel a new call');
    assert.deepEqual(made.bridge.list('a'), []);
  } finally { release(); await tools.close(); made.bridge.close(); }
});

test('the real SDK stdio transport lists OAR host tools, returns answers, and cancels a live request on disconnect', async () => {
  const made = setup();
  const run = new AbortController();
  const release = made.bridge.watch('a');
  const tools = createSessionTools({ question: made.question });
  const options = await tools.forSession('a', 'codex', { agent: agent('a'), signal: run.signal });
  const stdio = sessionToolTransport(options.mcpServers[0], 'antigravity');
  const config = stdio.mcpServers[0];
  const client = new Client({ name: 'question-contract-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('../host/providers/mcp-stdio.mjs', import.meta.url)), config.args[1]],
    env: { ...process.env, ...stdio.env }, stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (part) => { stderr += String(part); });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ['ask_user_question']);
    let opened: () => void;
    let ready = new Promise<void>((resolve) => { opened = resolve; });
    const unwatch = made.bridge.watch('a', undefined, () => { if (made.bridge.list('a').length) opened(); });
    try {
      const called = client.callTool({ name: 'ask_user_question', arguments: input });
      await ready;
      const call = made.bridge.list('a')[0];
      made.bridge.answer('a', call.callId, answers);
      const result = await called;
      assert.deepEqual(JSON.parse(result.content[0].text), { answers });
      ready = new Promise<void>((resolve) => { opened = resolve; });
      const pending = client.callTool({ name: 'ask_user_question', arguments: input });
      const disconnected = assert.rejects(pending);
      await ready;
      const signal = made.requests.at(-1).signal;
      const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      await client.close();
      await aborted;
      await disconnected;
      await tick();
      assert.equal(made.bridge.list('a').length, 0);
    } finally { unwatch(); }
    assert.equal(stderr, '', 'no credentials or transport details are printed');
  } finally { await client.close(); release(); run.abort(); await tools.close(); made.bridge.close(); }
});
