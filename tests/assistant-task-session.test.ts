import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskSessions, SILENT, TASK_PREFIX } from '../host/assistant/home/task-session.mjs';

// A scheduled task done by 嘟嘟 runs in a conversation of its own (not the main one, which would fill up); only its result comes into the chat. Fakes stand in for DSH.

const tick = () => new Promise((resolve) => setImmediate(resolve));
const catalog = { default: { provider: 'deepseek', model: 'flash' }, groups: [{ id: 'deepseek', models: [{ id: 'flash' }, { id: 'pro' }] }, { id: 'claude', models: [{ id: 'sonnet' }] }] };

/** `script` says how each prompt ends, in order: a text, '' for nothing, or { error } for a turn that failed; `hold` keeps the turn of the first prompt open until `release()` (or a cancel, which is what DSH does with a turn it is told to stop). */
function world(script: any[] = [], { hold = false, over = {} as any } = {}) {
  let release: () => void = () => {};
  const gate = hold ? new Promise<void>((resolve) => { release = resolve; }) : null;
  const log = { created: [] as string[], resumed: [] as string[], prompts: [] as any[], folded: [] as string[], disposed: [] as string[], said: [] as any[], cancelled: [] as string[], setups: [] as any[] };
  const stored = new Set<string>();
  const sessions = new Map<string, any>();
  const agentCtxFor = () => {
    const seen: any = { registered: [] as any[], guards: [] as any[], hooks: {} as Record<string, any>, restricted: [] as any[] };
    seen.ctx = {
      tools: { presentAs() {}, restrict: ({ allow }: any) => { seen.restricted.push(allow); return () => {}; }, guard: (fn: any) => seen.guards.push(fn), register: (tool: any) => seen.registered.push(tool) },
      systemPrompt: { suppressRuntimeContext() {}, variable() {} },
      on: (name: string, fn: any) => { seen.hooks[name] = fn; },
    };
    return seen;
  };
  const open = async (id: string, setup: any, options: any) => {
    const session: any = { id, seq: 0, events: [] as any[], append(type: string, data: any) { this.events.push({ seq: this.seq++, type, data }); }, snapshotEvents() { return this.events; } };
    let busy: Promise<void> | null = null;
    const agent: any = { session, options, status: 'idle', whenIdle: async () => { await busy; }, start(promise: Promise<void>) { busy = promise; } };
    sessions.set(id, agent);
    const seen = agentCtxFor();
    await setup(seen.ctx, agent);
    log.setups.push(seen);
    return { agent, dispose: async () => { log.disposed.push(id); } };
  };
  const ctx: any = {
    sessionController: {
      modelCatalog: async () => catalog,
      prompt: async ({ sessionId, content, requestId }: any) => {
        log.prompts.push({ sessionId, text: content[0].text, requestId });
        const agent = sessions.get(sessionId);
        const next = script.shift();
        const first = log.prompts.length === 1;
        agent.start((async () => {
          if (first && gate) await gate;
          agent.session.append('turn/start', {});
          if (next && typeof next === 'object' && next.error) agent.session.append('turn/end', { reason: { kind: 'error', error: { message: next.error } } });
          else { if (next) agent.session.append('assistant/message', { message: { content: [{ type: 'text', text: next }] } }); agent.session.append('turn/end', { reason: { kind: 'completed' } }); }
        })());
      },
      cancel: async ({ sessionId }: any) => { log.cancelled.push(sessionId); release(); },
    },
    agents: {
      create: async ({ sessionId, agentOptions, setup }: any) => { log.created.push(sessionId); stored.add(sessionId); return open(sessionId, setup, agentOptions); },
      resume: async ({ resumeSessionId, agentOptions, setup }: any) => { log.resumed.push(resumeSessionId); return open(resumeSessionId, setup, agentOptions); },
    },
    sessionPersistence: { stat: async (id: string) => { if (!stored.has(id)) throw Object.assign(new Error('gone'), { name: 'SessionPersistenceNotFoundError' }); return {}; } },
    workspaceRegistry: { archiveSession: async (id: string) => { log.folded.push(id); } },
    permissionPresets: { catalog: () => ({ defaultOptions: [{ value: 'read-only' }, { value: 'danger-full-access' }] }), set: (_session: any, preset: string) => { (log as any).permission = preset; } },
    sessionProjections: { stateOf: () => undefined },
    tools: { view: () => ({ restrictableNames: ['bash', 'read', 'web_fetch', 'not_for_dudu'] }), schemas: () => [{ name: 'bash' }, { name: 'web_fetch' }, { name: 'not_for_dudu' }] },
  };
  const assistant = { folder: '/home/dudu', settings: { value: () => ({ model: null, permission: 'danger-full-access' }) } };
  const runner = createTaskSessions({
    ctx, assistant, now: () => 1000, warn() {},
    tools: () => [{ name: 'issues_list' }, { name: 'tasks_create' }, { name: 'tasks_delete' }, { name: 'show_todo_card' }],
    context: async (task: any) => `context for ${task.title}`,
    say: async (kind: string, record: any) => { log.said.push([kind, record]); return `line-${log.said.length}`; },
    ...over,
  });
  return { runner, log, ctx, release: () => release() };
}

const task = (over: any = {}) => ({ id: 'task-1', title: '每日热点新闻', prompt: '找今天的热点新闻，挑十条', agent: 'dudu', model: null, project: null, target: { mode: 'new' }, sessionId: null, ...over });
const run = (id: string) => ({ id, at: 500, scheduledAt: 400 });
const noop = async () => {};
/** What the engine does with a checkpoint: it keeps the session on the task (a task that reuses a conversation finds it there next time). */
const binding = (t: any) => async (sessionId: string) => { t.sessionId = sessionId; };

test('a run is a conversation of its own, asked the task\'s own words, and only its result comes into the chat', async () => {
  const { runner, log } = world(['今日热点：1. …']);
  const t = task();
  const checkpoints: any[] = [];
  const delivered = await runner.deliver(t, run('r1'), async (id: string, resolved: any) => { checkpoints.push([id, resolved]); });
  assert.ok(delivered.sessionId.startsWith(TASK_PREFIX), 'it is not the main conversation, and lists of sessions leave it out');
  assert.equal(delivered.workspaceId, null);
  assert.deepEqual(checkpoints, [[delivered.sessionId, { provider: 'deepseek', model: 'flash', access: 'danger-full-access' }]]);
  assert.equal(log.prompts.length, 1);
  assert.equal(log.prompts[0].text, '找今天的热点新闻，挑十条');
  assert.equal(log.prompts[0].requestId, 'dudu-task-r1');
  await runner.idle();
  assert.equal(log.said.length, 1);
  assert.deepEqual(log.said[0], ['task', { v: 1, kind: 'task', task: { id: 'task-1', title: '每日热点新闻' }, text: '今日热点：1. …', ok: true, at: 1000 }]);
  assert.deepEqual(log.disposed, [delivered.sessionId]);
});

test('a run with nothing to tell says nothing, and one that fails says why once; a run that does not finish is stopped', async () => {
  const quiet = world(['[SILENT]', '', ' `[silent]`. ']);
  for (const id of ['a', 'b', 'c']) { await quiet.runner.deliver(task(), run(id), noop); await quiet.runner.idle(); }
  assert.equal(quiet.log.said.length, 0);
  assert.ok(SILENT.test('[SILENT]') && SILENT.test(' [silent] ') && !SILENT.test('nothing new [SILENT]'));

  const failing = world([{ error: 'The model call failed.' }]);
  await failing.runner.deliver(task(), run('x'), noop);
  await failing.runner.idle();
  assert.equal(failing.log.said.length, 1);
  assert.equal(failing.log.said[0][1].ok, false);
  assert.equal(failing.log.said[0][1].text, 'The model call failed.');

  const stuck = world([], { hold: true, over: { limitMs: 1 } });
  await stuck.runner.deliver(task(), run('y'), noop);
  await stuck.runner.idle();
  assert.equal(stuck.log.cancelled.length, 1, 'its turn is told to stop');
  assert.match(stuck.log.said[0][1].text, /took longer than/);
  assert.equal(stuck.log.said[0][1].ok, false);
});

test('no run of a task starts while the one before it is still going; every run is its own conversation and only the latest ones are kept', async () => {
  const { runner, log, release } = world(['one', 'two', 'three'], { hold: true, over: { recent: 2 } });
  const t = task();
  const first = await runner.deliver(t, run('r1'), noop);
  let secondStarted = false;
  const second = runner.deliver(t, run('r2'), noop).then((value: any) => { secondStarted = true; return value; });
  await tick(); await tick();
  assert.equal(secondStarted, false, 'it waits for the run before it');
  assert.equal(log.prompts.length, 1);
  release();
  const next = await second;
  assert.notEqual(next.sessionId, first.sessionId);
  await runner.idle();
  const third = await runner.deliver(t, run('r3'), noop);
  await runner.idle();
  assert.deepEqual(log.said.map(([, record]: any) => record.text), ['one', 'two', 'three']);
  assert.equal(log.created.length, 3);
  assert.deepEqual(log.folded, [first.sessionId], 'beyond the last two, the oldest conversation is folded away (DSH cannot delete it)');
  assert.ok(!log.folded.includes(third.sessionId));
});

test('a conversation kept for a task serves its runs, then another takes over; one whose run went wrong is not used again', async () => {
  const { runner, log } = world(['a', 'b', 'c', { error: 'broke' }, 'e'], { over: { maxRuns: 2 } });
  const t: any = task({ target: { mode: 'reuse' } });
  const deliver = async (id: string) => { const delivered = await runner.deliver(t, run(id), binding(t)); await runner.idle(); return delivered.sessionId; };
  const one = await deliver('r1');
  const two = await deliver('r2');
  assert.equal(two, one, 'the same conversation is used again');
  assert.deepEqual(log.resumed, [one]);
  const three = await deliver('r3');
  assert.notEqual(three, one, 'after its runs another takes over');
  assert.deepEqual(log.folded, [one], 'and the old one is folded away');
  const four = await deliver('r4'); // this one fails
  assert.equal(four, three);
  const five = await deliver('r5');
  assert.notEqual(five, three, 'a conversation whose run went wrong is replaced');
  assert.equal(log.said.length, 5);
  assert.equal(log.said[3][1].ok, false);
  // The engine forgets the binding when the task's provider, model or target changes: the old conversation is not used again.
  t.sessionId = null;
  const six = await deliver('r6');
  assert.notEqual(six, five);
  assert.ok(log.folded.includes(five));
});

test('what a run has: the assistant\'s tools without any that change the owner\'s tasks, a conversation model, no approvals, and the full prompt', async () => {
  const { runner, log } = world(['done']);
  await runner.deliver(task({ model: 'pro' }), run('r1'), noop);
  await runner.idle();
  const seen = log.setups[0];
  assert.deepEqual(seen.registered.map((tool: any) => tool.name), ['issues_list', 'show_todo_card'], 'a run that reads untrusted pages cannot make or change tasks');
  assert.deepEqual(seen.restricted, [['bash', 'read', 'web_fetch']], 'of the DSH tools only the conversation ones');
  assert.equal(seen.guards[0]({ name: 'issues_list' }), undefined);
  assert.equal(seen.guards[0]({ name: 'bash', agent: {} }), undefined);
  assert.match(seen.guards[0]({ name: 'tasks_create' }), /not available/);
  assert.match(seen.guards[0]({ name: 'not_for_dudu' }), /not available/);
  assert.equal(seen.hooks['approval/request'](), 'rejected', 'nobody is there to approve');
  await assert.rejects(seen.hooks['agent/request'](null, async () => ({ provider: 'claude', model: 'sonnet' })), /conversation model/);
  assert.deepEqual(await seen.hooks['agent/request'](null, async () => ({ provider: 'deepseek', model: 'pro' })), { provider: 'deepseek', model: 'pro', cwd: '/home/dudu' });
  assert.equal(log.prompts.length, 1);
  assert.equal((log as any).permission, 'danger-full-access');
});

test('a model that is not a conversation model is refused before anything is sent, and a task of 嘟嘟 cannot go to an existing conversation', async () => {
  const { runner, log } = world([]);
  await assert.rejects(runner.deliver(task({ model: 'sonnet' }), run('r1'), noop), (error: any) => error.code === 'provider_unavailable' && error.beforeSend === true);
  assert.equal(log.created.length, 0);
  await assert.rejects(runner.validate(task({ model: 'sonnet' })), (error: any) => error.code === 'provider_unavailable');
  await assert.rejects(runner.validate(task({ target: { mode: 'existing', sessionId: 's' } })), (error: any) => error.code === 'invalid_session');
  await runner.validate(task({ model: 'pro' }));
  assert.equal(await runner.available(), true);
});

test('shutting down stops the run in flight and says nothing in the chat for it', async () => {
  const { runner, log } = world(['late'], { hold: true });
  const delivered = await runner.deliver(task(), run('r1'), noop);
  await runner.close(); // the cancel ends the turn, as DSH's does
  assert.deepEqual(log.cancelled, [delivered.sessionId]);
  assert.equal(log.said.length, 0);
  await assert.rejects(runner.deliver(task(), run('r2'), noop), (error: any) => error.code === 'unavailable');
});
