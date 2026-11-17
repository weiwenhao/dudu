import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { listCodexThreads, readCodexThread, readCodexThreads, readCodexThreadTail, threadSummary } from '../host/providers/native/codex-store.mjs';
import { codexHistory, codexTurns } from '../host/providers/native/codex-history.mjs';
import { codexSearchText } from '../host/providers/native/content-index.mjs';

// `codex app-server` answers over JSON lines on its standard streams. This stands in for it: each request is answered by
// a handler of the test, or never (a very long thread), and every start of the program is counted.
function fakeAppServer(handlers: Record<string, (params: any) => unknown>, { slice }: { slice?: number } = {}) {
  const starts: { args: string[]; env: Record<string, string | undefined> }[] = [];
  const requests: { method: string; params: any }[] = [];
  let kills = 0;
  const spawnProcess = (_command: string, args: string[], options: { env: Record<string, string | undefined> }) => {
    starts.push({ args, env: options.env });
    const child: any = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { kills++; queueMicrotask(() => child.emit('exit', 0)); };
    let buffer = '';
    child.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (message.id === undefined) continue;
        requests.push({ method: message.method, params: message.params });
        const handler = message.method === 'initialize' ? () => ({}) : handlers[message.method];
        const result = handler?.(message.params);
        if (result === 'hang') continue;
        const line = Buffer.from(`${JSON.stringify(result instanceof Error ? { id: message.id, error: { message: result.message } } : { id: message.id, result })}\n`);
        if (slice) for (let at = 0; at < line.length; at += slice) child.stdout.write(line.subarray(at, at + slice));
        else child.stdout.write(line);
      }
    });
    return child;
  };
  return { spawnProcess, starts, requests, get kills() { return kills; } };
}

const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id, preview: `preview of ${id}`, name: null, cwd: '/work/app', ephemeral: false, parentThreadId: null, source: 'vscode',
  createdAt: 1_790_000_000, updatedAt: 1_790_000_100, model: 'gpt-x', gitInfo: { branch: 'main', sha: null, originUrl: null }, ...extra,
});

test('the threads Codex would list come back newest first, a page at a time, with no provider filter', async () => {
  const server = fakeAppServer({
    'thread/list': (params) => (params.cursor === null
      ? { data: [thread('t1'), thread('t2', { ephemeral: true }), thread('t3', { parentThreadId: 't1' })], nextCursor: 'page-2' }
      : { data: [thread('t4', { name: 'Named by the person' })], nextCursor: null }),
  });
  const threads = await listCodexThreads({ command: 'codex', env: { CODEX_THING: null, KEPT: 'yes' }, spawnProcess: server.spawnProcess });
  assert.deepEqual(threads.map((item) => item.id), ['t1', 't4'], 'ephemeral threads and subagents are not sessions to load');
  assert.equal(threads[1].title, 'Named by the person');
  assert.equal(threads[0].title, 'preview of t1');
  assert.deepEqual([threads[0].provider, threads[0].cwd, threads[0].branch, threads[0].updatedAt], ['codex', '/work/app', 'main', 1_790_000_100_000]);
  const lists = server.requests.filter((request) => request.method === 'thread/list');
  assert.equal(lists.length, 2);
  // An absent modelProviders is the stricter filter; an empty list is how "all" is spelled.
  assert.deepEqual(lists[0].params.modelProviders, []);
  assert.equal(lists[0].params.useStateDbOnly, true);
  assert.equal(lists[1].params.cursor, 'page-2');
  assert.equal(server.starts[0].args[0], 'app-server');
  assert.equal(server.starts[0].env.KEPT, 'yes');
  assert.equal('CODEX_THING' in server.starts[0].env, false, 'an overlay name set to null is removed from the environment');
});

test('a thread is read with its turns, and an error from Codex says what it was', async () => {
  const server = fakeAppServer({
    'thread/read': (params) => (params.threadId === 'gone' ? new Error('no rollout found') : { thread: { ...thread(params.threadId), turns: [] } }),
  });
  const read = await readCodexThread({ command: 'codex', spawnProcess: server.spawnProcess }, 't1');
  assert.equal(read.id, 't1');
  assert.deepEqual(server.requests.find((request) => request.method === 'thread/read')?.params, { threadId: 't1', includeTurns: true });
  await assert.rejects(readCodexThread({ command: 'codex', spawnProcess: server.spawnProcess }, 'gone'), /no rollout found/);
});

test('reading many threads skips one that fails and goes on with a new app-server after one that never answers', async () => {
  const server = fakeAppServer({
    'thread/read': (params) => {
      if (params.threadId === 'huge') return 'hang';
      if (params.threadId === 'broken') return new Error('corrupt');
      return { thread: thread(params.threadId) };
    },
  });
  const seen: string[] = [];
  await readCodexThreads({ command: 'codex', spawnProcess: server.spawnProcess }, ['a', 'broken', 'huge', 'b', 'c'], (id: string) => { seen.push(id); }, { timeoutMs: 60 });
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(server.starts.length, 2, 'the app-server that never answered is replaced');
});

test('a thread that could not be read is reported with its reason, so that nobody has to guess why a conversation is missing from the search', async () => {
  const server = fakeAppServer({
    'thread/read': (params) => {
      if (params.threadId === 'huge') return 'hang';
      if (params.threadId === 'broken') return new Error('corrupt rollout');
      return { thread: thread(params.threadId) };
    },
  });
  const failures: Array<[string, string]> = [];
  await readCodexThreads({ command: 'codex', spawnProcess: server.spawnProcess }, ['a', 'broken', 'huge', 'b'], () => {}, {
    timeoutMs: 60, onFailure: (id: string, error: Error) => failures.push([id, error.message]),
  });
  assert.equal(failures.length, 2);
  assert.deepEqual(failures[0], ['broken', 'corrupt rollout']);
  assert.equal(failures[1][0], 'huge');
  assert.match(failures[1][1], /did not answer/, 'one that never answers says so');
});

// DSH's host died four times of its heap in ten days; a thread of a gigabyte answers `thread/read` with a hundred megabytes of JSON that the host read into a string and parsed.
test('an answer bigger than the host may hold is dropped and the app-server stopped, instead of being read into the heap', async () => {
  const server = fakeAppServer({ 'thread/read': () => ({ thread: { id: 'big', turns: [{ items: ['x'.repeat(5000)] }] } }) });
  await assert.rejects(
    readCodexThread({ command: 'codex', spawnProcess: server.spawnProcess, maxAnswerBytes: 1000 }, 'big'),
    (error: any) => error.code === 'ANSWER_TOO_LARGE' && /over/.test(error.message),
  );
  assert.ok(server.kills >= 1, 'the program that was still writing is stopped');
  // a batch goes on with a new app-server after one such answer, as after a thread that never answers
  const seen: string[] = [];
  const failures: string[] = [];
  const batch = fakeAppServer({ 'thread/read': (params) => (params.threadId === 'big' ? { thread: { id: 'big', turns: [{ items: ['x'.repeat(5000)] }] } } : { thread: thread(params.threadId) }) });
  await readCodexThreads({ command: 'codex', spawnProcess: batch.spawnProcess, maxAnswerBytes: 1000 }, ['a', 'big', 'b'], (id: string) => { seen.push(id); }, { onFailure: (id: string) => failures.push(id) });
  assert.deepEqual([seen, failures], [['a', 'b'], ['big']]);
  assert.equal(batch.starts.length, 2);
});

test('an answer that arrives in small pieces, cut in the middle of a character, is read whole', async () => {
  const server = fakeAppServer({ 'thread/read': () => ({ thread: { id: 't', name: '你好，世界：长对话', turns: [] } }) }, { slice: 5 });
  const read = await readCodexThread({ command: 'codex', spawnProcess: server.spawnProcess }, 't');
  assert.equal(read.name, '你好，世界：长对话');
});

test('the newest turns of a long thread are read in pages and come back oldest first, and the thread says when older ones were left', async () => {
  const all = Array.from({ length: 25 }, (_, n) => ({ id: `turn-${n + 1}`, items: [] })); // oldest first
  const server = fakeAppServer({
    'thread/read': (params) => ({ thread: { ...thread(params.threadId), turns: params.includeTurns ? all : [] } }),
    'thread/turns/list': (params) => {
      const from = params.cursor ? Number(params.cursor) : all.length;
      const page = all.slice(Math.max(0, from - params.limit), from).reverse();
      const next = from - params.limit;
      return { data: page, nextCursor: next > 0 ? String(next) : null };
    },
  });
  const tail = await readCodexThreadTail({ command: 'codex', spawnProcess: server.spawnProcess }, 'long', { turns: 15, page: 10 });
  assert.deepEqual(tail.turns.map((item: any) => item.id), Array.from({ length: 15 }, (_, n) => `turn-${n + 11}`));
  assert.equal(tail.partial, true);
  assert.equal(tail.id, 'long', 'the thread itself (folder, model, name) comes along');
  assert.deepEqual(server.requests.filter((request) => request.method === 'thread/read').map((request) => request.params.includeTurns), [false], 'the whole thread is never asked for');
  const lists = server.requests.filter((request) => request.method === 'thread/turns/list');
  assert.deepEqual(lists.map((request) => request.params.limit), [10, 5]);
  assert.ok(lists.every((request) => request.params.sortDirection === 'desc' && request.params.itemsView === 'full'));
  const whole = await readCodexThreadTail({ command: 'codex', spawnProcess: server.spawnProcess }, 'long', { turns: 40, page: 10 });
  assert.equal(whole.turns.length, 25);
  assert.equal(whole.partial, false, 'a thread that is shorter than that is read whole');
});

test('a Codex thread becomes turns: what was typed, then steps that each end at a tool call', () => {
  const read = {
    ...thread('t1'),
    turns: [{
      startedAt: 1_790_000_005,
      items: [
        { type: 'userMessage', id: 'i0', content: [{ type: 'text', text: 'what model are you?', text_elements: [] }, { type: 'localImage', path: '/x.png' }] },
        { type: 'reasoning', id: 'i1', summary: ['**Checking**', ''], content: [] },
        { type: 'agentMessage', id: 'i2', text: 'Let me check.', phase: null },
        { type: 'commandExecution', id: 'call_1', command: 'cat NOTES', cwd: '/work/app', aggregatedOutput: 'notes', exitCode: 0, durationMs: 12, status: 'completed' },
        { type: 'webSearch', id: 'call_2', query: 'codex models', status: 'completed' },
        { type: 'agentMessage', id: 'i5', text: 'I am Codex.', phase: null },
      ],
    }, {
      items: [{ type: 'userMessage', id: 'j0', content: [{ type: 'text', text: 'thanks' }] }],
    }],
  };
  const turns = codexTurns(read);
  assert.equal(turns.length, 2);
  const [first] = turns;
  assert.equal(first.prompt, 'what model are you?\n[image]');
  assert.equal(first.at, 1_790_000_005_000);
  assert.deepEqual(first.steps.map((step: { blocks: { type: string }[] }) => step.blocks.map((block) => block.type)), [['reasoning', 'text', 'tool-call'], ['tool-call'], ['text']]);
  assert.deepEqual(first.steps[0].blocks[0], { type: 'reasoning', text: '**Checking**' });
  assert.equal(first.steps[0].blocks[2].name, 'shell');
  assert.equal(first.steps[0].blocks[2].arguments, JSON.stringify({ command: 'cat NOTES', cwd: '/work/app' }));
  assert.deepEqual(first.results.get('call_1'), { output: 'notes', isError: false, data: { exitCode: 0, durationMs: 12 } });
  assert.equal(first.steps[1].blocks[0].name, 'web_search');
  const history = codexHistory(read);
  assert.deepEqual(history.turns.map((turn: { prompt: string }) => turn.prompt), ['what model are you?\n[image]'], 'a turn nothing answered is not kept');
  assert.deepEqual([history.provider, history.id, history.cwd, history.branch, history.model], ['codex', 't1', '/work/app', 'main', 'gpt-x']);
  assert.equal(history.title, 'preview of t1');
});

test('a thread summary falls back when Codex has not named or previewed a thread', () => {
  assert.equal(threadSummary({ id: 'x', preview: '', name: null, cwd: '/w', updatedAt: 1, createdAt: 1 }).title, 'Untitled');
  assert.equal(threadSummary({ id: 'x', preview: 'multi\nline   preview', cwd: null, updatedAt: 1 }).title, 'multi line preview');
  assert.equal(threadSummary({ id: 'x', preview: 'p', updatedAt: 1 }).cwd, null);
});

test('ongoing Codex turns remain visible and open when another app-server calls them interrupted', () => {
  const done = { id: 'one', completedAt: 10, startedAt: 1, items: [
    { type: 'userMessage', content: [{ type: 'text', text: 'first' }] },
    { type: 'agentMessage', text: 'done' },
  ] };
  const working = { id: 'two', completedAt: null, startedAt: 11, status: 'interrupted', items: [
    { type: 'userMessage', content: [{ type: 'text', text: 'next' }] },
    { type: 'reasoning', id: 'r', summary: [], content: ['Real native reasoning.'] },
    { type: 'agentMessage', text: 'still working' },
  ] };
  const pending = codexHistory({ ...thread('t'), turns: [done, working] });
  assert.equal(pending.turns.length, 2);
  assert.equal(pending.turns[1].complete, false);
  assert.equal(pending.turns[1].interrupted, undefined);
  const metrics = new Map([['two', { endedAt: 20000, items: new Map(), usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } }]]);
  const history = codexHistory({ ...thread('t'), turns: [done, { ...working, status: 'completed' }] }, { metrics });
  assert.equal(history.turns.length, 2);
  assert.equal(history.turns[1].endedAt, 20000);
  assert.deepEqual(history.turns[1].steps[0].blocks[0], { type: 'reasoning', text: 'Real native reasoning.' });
  assert.equal(history.turns[1].steps[0].usage.totalTokens, 100);
});

test('Codex preserves mid-turn user messages and waits for a running tool result', () => {
  const history = codexHistory({ ...thread('t'), turns: [{
    id: 'live', startedAt: 11, completedAt: null, items: [
      { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'first instruction' }] },
      { type: 'agentMessage', id: 'a1', text: 'Checking.' },
      { type: 'userMessage', id: 'u2', content: [{ type: 'text', text: 'additional instruction' }] },
      { type: 'agentMessage', id: 'a2', text: 'Following up.' },
      { type: 'commandExecution', id: 'tool', command: 'ls', cwd: '/work', status: 'inProgress', aggregatedOutput: 'partial' },
    ],
  }] });
  assert.equal(history.turns.length, 1);
  assert.equal(history.turns[0].id, 'live');
  assert.deepEqual(history.turns[0].steps.map((step: any) => step.input?.prompt), [undefined, 'additional instruction']);
  assert.equal(history.turns[0].results.size, 0);
  assert.equal(history.turns[0].steps.flatMap((step: any) => step.blocks).some((block: any) => block.type === 'tool-call'), false);
});

test('Codex content search includes all message text and mid-turn input without indexing tool output or reasoning', () => {
  const thread = { turns: [{ items: [
    { type: 'userMessage', content: [{ type: 'text', text: 'Initial prompt' }] },
    { type: 'agentMessage', text: 'x'.repeat(270000) + '本轮巡检（北京时间 12:47）正常' },
    { type: 'userMessage', content: [{ type: 'text', text: '补充检查 runner' }, { type: 'image', url: 'not-text' }] },
    { type: 'reasoning', summary: ['not searchable'] },
    { type: 'commandExecution', aggregatedOutput: 'not searchable' },
  ] }] };
  const text = codexSearchText(thread);
  assert.match(text.user, /补充检查 runner/);
  assert.match(text.assistant, /12:47/);
  assert.doesNotMatch(JSON.stringify(text), /not searchable|not-text/);
  const preview = codexSearchText(thread, { includeMessages: true });
  assert.deepEqual(preview.messages.map((message: any) => message.role), ['user', 'assistant', 'user']);
  assert.equal(preview.messages[2].text, '补充检查 runner\n[image]');
  assert.doesNotMatch(JSON.stringify(preview), /not searchable|not-text/);
});
