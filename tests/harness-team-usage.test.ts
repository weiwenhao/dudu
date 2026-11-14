import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarnessTeams } from '../host/providers/teams.mjs';
import { ClaudeNormalizer } from '../host/providers/drivers/claude.mjs';
import { OarNormalizer } from '../host/providers/oar.mjs';
import { createClaudeChildUsageReader } from '../host/providers/native/claude-child-usage.mjs';

const origin = '00000000-0000-4000-8000-000000000001';
const taskId = 'a123456789abcdef';
const nativeUsage = (output = 5) => ({
  input_tokens: 3, output_tokens: output, cache_read_input_tokens: 7, cache_creation_input_tokens: 2,
});
const message = (id: string, output = 5, extra = {}) => ({
  type: 'assistant', isSidechain: true,
  message: { id, model: 'claude-sonnet-5-5', stop_reason: 'tool_use', usage: nativeUsage(output), content: [], ...extra },
});
const line = (value: unknown) => JSON.stringify(value) + '\n';

async function transcript(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'dudu-child-usage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'project', origin, 'subagents');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `agent-${taskId}.jsonl`);
  await writeFile(file, '');
  return { root, file };
}

test('native child usage deduplicates blocks, ignores stream-start samples and consumes partial appends once', async t => {
  const { root, file } = await transcript(t);
  const reader = createClaudeChildUsageReader({ root });
  const read = () => reader.read({ sessionId: origin, taskId });
  assert.equal(await read(), undefined);
  const unfinished = line(message('m2', 4, { content: [{ type: 'text', text: '你好' }] }));
  const split = unfinished.indexOf('好');
  await writeFile(file, line(message('m1')) + line(message('m1')) + line(message('stream', 0, { stop_reason: null }))
    + line(message('synthetic', 90, { model: '<synthetic>' }))
    + line({ type: 'api-request-blob', body: 'x'.repeat(150_000) }) + unfinished.slice(0, split));
  assert.deepEqual(await read(), { inputTokens: 3, outputTokens: 5, totalTokens: 17, cacheReadTokens: 7, cacheWriteTokens: 2 });
  await appendFile(file, unfinished.slice(split) + line(message('m1', 6)) + 'not json\n');
  const total = { inputTokens: 6, outputTokens: 10, totalTokens: 34, cacheReadTokens: 14, cacheWriteTokens: 4 };
  assert.deepEqual(await read(), total);
  assert.deepEqual(await read(), total);
  assert.deepEqual(await createClaudeChildUsageReader({ root }).read({ sessionId: origin, taskId }), total);
  assert.equal(await reader.read({ sessionId: '../outside', taskId }), undefined);
  assert.equal(await reader.read({ sessionId: origin, taskId: '../outside' }), undefined);
  reader.close();
});

// Only the DSH adapter contract is simulated: each followup settles one mirror message and persists its usage.
// No native process, DSH instance, model request, timer or browser runs here.
function teamHost() {
  const adapters = new Map<string, any>();
  const agents = new Map<string, any>();
  const sessions = new Map<string, any>();
  const openings: any[] = [];
  function session(id: string, header = {}) {
    const events: any[] = [];
    const value = {
      id, header: { cwd: '/work', createdAt: 1, ...header }, seq: 0, events,
      snapshotEvents: (from = 0) => events.slice(from),
      append(type: string, data: any) { events.push({ type, data, seq: value.seq++ }); },
    };
    sessions.set(id, value);
    return value;
  }
  const host: any = {
    adapters, sessions, openings,
    llm: { registerAdapter(routes: string[], adapter: any) {
      routes.forEach(route => adapters.set(route, adapter));
      return () => routes.forEach(route => adapters.delete(route));
    } },
    eventsOf: async (id: string) => sessions.get(id)?.snapshotEvents(),
    flushSession: async () => {},
    tokenUsageOf(s: any) {
      const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      for (const event of s.events) {
        const usage = event.type === 'assistant/message' && event.data.usage;
        if (!usage) continue;
        totals.uncachedInputTokens += usage.inputTokens;
        totals.outputTokens += usage.outputTokens;
        totals.cacheReadTokens += usage.cacheReadTokens ?? 0;
        totals.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
      }
      return totals;
    },
  };
  async function open(options: any) {
    const { sessionId, resumeSessionId, agentOptions } = options;
    openings.push(options);
    const id = sessionId ?? resumeSessionId;
    const s = sessions.get(id) ?? session(id);
    let pending = Promise.resolve();
    const tools = new Map();
    const agent = {
      id, session: s, options: agentOptions,
      ctx: { tools: { register(definition: any) {
        assert.equal(tools.has(definition.name), false);
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      } } },
      followup(prompt: any) {
        pending = pending.then(async () => {
          const turn = s.events.filter((event: any) => event.type === 'turn/start').length + 1;
          s.append('turn/start', { turn });
          s.append('user/message', prompt);
          const chunks: any[] = [];
          for await (const chunk of adapters.get(agentOptions.provider).stream({ sessionId: id, messages: [prompt] })) chunks.push(chunk);
          assert.equal(chunks.at(-1).reason.kind, 'stop');
          s.append('assistant/message', { turn, step: 1, usage: chunks.find(chunk => chunk.type === 'usage')?.usage });
          s.append('turn/end', { turn });
        });
      },
      whenIdle: () => pending,
      cancel() {},
    };
    agents.set(id, agent);
    return { agent, dispose: async () => { agents.delete(id); } };
  }
  host.agents = { get: (id: string) => agents.get(id), create: open, resume: open };
  return { host, parent: { id: 'parent', session: session('parent'), options: {} } };
}

const frame = (events: any[], extra = {}) => ({ kind: 'frame', sessionId: origin, agentPath: [], body: { events }, ...extra });
const start = (codex: boolean) => frame([{
  kind: 'task_started', taskId, taskType: 'agent', toolCallId: 'delegate', description: 'Research',
  ...(codex ? { childSessionId: 'child-thread' } : {}),
}]);
const childFrame = (codex: boolean, events: any[], extra = {}) => frame(events, {
  ...(codex ? { sessionId: 'child-thread' } : { agentPath: ['delegate'] }), ...extra,
});

test('child stats use native totals without charging the parent or replaying saved tokens on resume', async t => {
  for (const codex of [false, true]) {
    const { root, file } = await transcript(t);
    const { host, parent } = teamHost();
    const teams = createHarnessTeams({
      host, driver: {
        id: codex ? 'codex' : 'claude', tools: [],
        normalizer: () => codex ? new OarNormalizer({ name: 'Codex' }) : new ClaudeNormalizer({ name: 'Claude' }),
        childUsage: codex ? undefined : () => createClaudeChildUsageReader({ root }),
      },
      log: { warn(message: string) { assert.fail(message); } },
    });
    t.after(() => teams.close());
    const observe = () => teams.observe(parent);
    let observer = observe();
    const emit = (record: any) => observer.record(record, origin);
    const counters = (input = 12, output = 5) => ({ kind: 'usage', usage: { tokens: { input, output, cacheRead: 7, cacheWrite: 2 } } });
    await writeFile(file, line(message('m1')) + line(message('m1')));
    emit(start(codex));
    emit(childFrame(codex, [{ kind: 'text_delta', text: 'Working.' }, ...(codex ? [counters(), counters()] : [])], {
      body: codex ? { events: [{ kind: 'text_delta', text: 'Working.' }, counters(), counters()] }
        : { events: [{ kind: 'text_delta', text: 'Working.' }], type: 'stream_event', native: { event: { type: 'message_stop' } } },
    }));
    emit(frame([{ kind: 'task_ended', taskId, status: 'completed' }, counters(9000, 9000)]));
    const facts = await observer.checkpoint();
    await observer.end({ ok: true });
    const childId = parent.session.events.find((event: any) => event.type === 'subagent/catalog').data.childId;
    const child = host.sessions.get(childId);
    assert.deepEqual(host.tokenUsageOf(child), { uncachedInputTokens: 3, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 2 });
    assert.equal(parent.session.events.some((event: any) => event.type === 'assistant/message'), false);

    // Reopening the observer and the saved DSH child cannot recharge its native lifetime total.
    observer = teams.observe(parent, facts);
    emit(frame([{ kind: 'task_updated', taskId, status: 'running' }]));
    await appendFile(file, line(message('m2', 4)));
    emit(childFrame(codex, [counters(12, 3)])); // an older Codex sample cannot lower the saved baseline
    emit(childFrame(codex, [{ kind: 'text_delta', text: 'Continued.' }, ...(codex ? [counters(24, 9)] : [])]));
    // Codex's last usage may share the terminal frame; it must be captured before closing its mirror.
    emit(codex ? childFrame(true, [counters(24, 9), { kind: 'task_ended', taskId, status: 'completed' }])
      : frame([{ kind: 'task_ended', taskId, status: 'completed' }]));
    await observer.end({ ok: true });
    assert.deepEqual(host.tokenUsageOf(child), {
      uncachedInputTokens: codex ? 15 : 6, outputTokens: 9, cacheReadTokens: codex ? 7 : 14, cacheWriteTokens: codex ? 2 : 4,
    });
    assert.equal(parent.session.events.filter((event: any) => event.type === 'subagent/catalog').length, 1);
    assert.equal(parent.session.events.some((event: any) => event.type === 'team/member'), false, 'current DSH discovers children through its catalog');
    assert.deepEqual(host.openings.map((options: any) => options.sessionId ?? options.resumeSessionId), [childId, childId]);
    assert.equal(host.openings[1].resumeSessionId, childId, 'a catalog-only child resumes its saved session');
    assert.ok(host.openings.every((options: any) => !('parentAgent' in options)), 'the new registry no longer accepts runtime parent ownership');
    await teams.close();
  }
});

test('a published native child with missing history is never recreated or recharged', async t => {
  const { host, parent } = teamHost();
  const warnings: string[] = [];
  const teams = createHarnessTeams({
    host, driver: { id: 'codex', tools: [], normalizer: () => new OarNormalizer({ name: 'Codex' }) },
    log: { warn(message: string) { warnings.push(message); } },
  });
  t.after(() => teams.close());
  let observer = teams.observe(parent);
  observer.record(start(true), origin);
  observer.record(frame([{ kind: 'task_ended', taskId, status: 'completed' }]), origin);
  const facts = await observer.checkpoint();
  await observer.end({ ok: true });
  const before = parent.session.events.length;
  const childId = parent.session.events.find((event: any) => event.type === 'subagent/catalog').data.childId;
  host.sessions.delete(childId);
  observer = teams.observe(parent, facts);
  observer.record(frame([{ kind: 'task_updated', taskId, status: 'running' }]), origin);
  await observer.end({ ok: true });
  assert.equal(host.openings.length, 1, 'missing persisted history cannot start a replacement child');
  assert.equal(parent.session.events.length, before, 'failed restoration publishes no phantom member or task');
  assert.equal(warnings.length, 1);
});
