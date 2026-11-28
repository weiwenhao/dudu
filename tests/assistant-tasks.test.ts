import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createTasks } from '../host/assistant/tasks/index.mjs';
import { nextOccurrence, validateSchedule } from '../host/assistant/tasks/timing.mjs';
import { createTaskHost } from '../host/assistant/tasks/host.mjs';
import { taskTools } from '../host/assistant/tasks/tools.mjs';
import { definition } from '../host/assistant/home/tools.mjs';
import { createNativeBridge } from '../host/native-bridge.mjs';

const at = Date.parse('2026-11-10T00:00:00Z');
const base = () => ({ title: '每日项目摘要', prompt: '汇总项目变更', agent: 'claude', model: null, project: { name: 'dudu', path: '/work/dudu' }, target: { mode: 'reuse' }, schedule: { kind: 'interval', minutes: 60, timezone: 'Asia/Shanghai' } });
const identity = (task: any) => ({ id: task.id, revision: task.revision });
const quiet = { warn() {} };

test('task wall-clock rules respect IANA zones, weekdays, month lengths and DST while intervals retain their anchor', () => {
  const next = (rule: any, after: string) => new Date(nextOccurrence(validateSchedule({ timezone: 'Asia/Shanghai', time: '09:00', ...rule }), Date.parse(after))).toISOString();
  assert.equal(next({ kind: 'daily' }, '2026-11-10T01:00:00Z'), '2026-11-11T01:00:00.000Z');
  assert.equal(next({ kind: 'workdays' }, '2026-11-13T01:00:00Z'), '2026-11-16T01:00:00.000Z');
  assert.equal(next({ kind: 'weekly', weekdays: [5] }, '2026-11-10T00:00Z'), '2026-11-13T01:00:00.000Z');
  assert.equal(next({ kind: 'monthly', day: 31 }, '2026-11-01T00:00Z'), '2026-12-31T01:00:00.000Z');
  assert.equal(next({ kind: 'once', date: '2026-11-11' }, '2026-11-10T00:00Z'), '2026-11-11T01:00:00.000Z');
  assert.equal(next({ kind: 'cron', expression: '0 9 * * 1-5' }, '2026-11-13T01:00Z'), '2026-11-16T01:00:00.000Z');
  assert.equal(next({ kind: 'daily', timezone: 'America/New_York', time: '09:00' }, '2026-10-31T13:00Z'), '2026-11-01T14:00:00.000Z');
  assert.equal(nextOccurrence(validateSchedule(base().schedule), at + 7_200_500, at), at + 10_800_000);
  for (const schedule of [{ kind: 'daily', time: '24:00', timezone: 'UTC' }, { kind: 'daily', time: '09:00', timezone: 'wrong' }, { kind: 'weekly', time: '09:00', timezone: 'UTC', weekdays: [] }, { kind: 'once', time: '09:00', timezone: 'UTC', date: '2026-02-30' }]) assert.throws(() => validateSchedule(schedule));
});

test('persisted tasks coalesce sleep, retain history through edits, pause independently and reject stale desktop or phone revisions', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-tasks-'));
  let now = at;
  const sent: any[] = [];
  const file = join(folder, 'tasks.db');
  const open = () => createTasks({ file, now: () => now, deliver: async (task, _run, checkpoint) => { sent.push(task); await checkpoint('session-one'); return { workspaceId: 'workspace-one' }; } });
  let tasks = open();
  try {
    const created = await tasks.execute('create', { fields: base() });
    assert.equal(created.outcome, 'success');
    const task = created.task;
    now += 8 * 3600_000 + 1;
    await tasks.tick(); await tasks.idle(); await tasks.tick(); await tasks.idle();
    assert.equal(sent.length, 1, 'missed repeats are coalesced into one delivery');
    const latest = (await tasks.execute('get', { id: task.id })).task;
    assert.equal(latest.revision, task.revision, 'runtime facts do not destroy an unsaved editor revision');
    assert.equal(latest.nextRunAt, at + 9 * 3600_000);
    assert.equal(latest.sessionId, 'session-one');
    const updated = await tasks.execute('update', { ...identity(task), patch: { title: '项目摘要' } });
    assert.equal(updated.outcome, 'success');
    assert.equal((await tasks.execute('history', { id: task.id })).runs.length, 1, 'an upsert must not cascade-delete run records');
    assert.equal((await tasks.execute('pause', identity(task))).code, 'conflict');
    const paused = (await tasks.execute('pause', identity(updated.task))).task;
    now += 3 * 3600_000;
    await tasks.tick(); await tasks.idle();
    assert.equal(sent.length, 1);
    await tasks.close(); tasks = open();
    assert.equal((await tasks.execute('get', { id: task.id })).task.status, 'paused');
    const resumed = await tasks.execute('resume', identity(paused));
    assert.equal(resumed.outcome, 'success');
    assert.ok(resumed.task.nextRunAt > now);
    const history = (await tasks.execute('history', { id: task.id })).runs;
    assert.equal(history[0].task.title, '每日项目摘要', 'history retains the actual delivery snapshot');
    assert.equal(history[0].status, 'delivered');
  } finally { await tasks.close(); await rm(folder, { recursive: true, force: true }); }
});

test('manual runs keep the next occurrence, concurrent ticks cannot double-send, and changed routing gets a new conversation binding', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let sends = 0;
  const tasks = createTasks({ file: ':memory:', now: () => at, deliver: async (_task, _run, checkpoint) => { sends++; await checkpoint('task-session'); await gate; } });
  try {
    const task = (await tasks.execute('create', { fields: base() })).task;
    const run = await tasks.execute('run', identity(task));
    assert.equal(run.pending, true);
    assert.equal((await tasks.execute('run', identity(task))).code, 'busy');
    assert.equal((await tasks.execute('delete', identity(task))).code, 'busy');
    assert.equal((await tasks.execute('update', { ...identity(task), patch: { agent: 'codex' } })).code, 'busy');
    await Promise.all([tasks.tick(), tasks.tick()]);
    release(); await tasks.idle();
    assert.equal(sends, 1);
    const latest = (await tasks.execute('get', { id: task.id })).task;
    assert.equal(latest.nextRunAt, task.nextRunAt);
    assert.equal(latest.sessionId, 'task-session');
    const updated = (await tasks.execute('update', { ...identity(latest), patch: { agent: 'codex' } })).task;
    assert.equal(updated.sessionId, null);
    assert.equal((await tasks.execute('history', { id: task.id })).runs[0].task.agent, 'claude');
    const duplicate = (await tasks.execute('duplicate', identity(updated))).task;
    assert.equal(duplicate.status, 'paused'); assert.equal(duplicate.sessionId, null);
    assert.deepEqual((await tasks.execute('history', { id: duplicate.id })).runs, []);
  } finally { release(); await tasks.close(); }
});

test('once-only jobs end after one claim, failed and ambiguous delivery are separate facts, and restart never silently resends an ambiguous prompt', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-task-restart-'));
  const file = join(folder, 'tasks.db');
  let now = at;
  let sends = 0;
  let tasks = createTasks({ file, now: () => now, log: quiet, deliver: async () => { sends++; throw new Error('transport interrupted'); } });
  try {
    const task = (await tasks.execute('create', { fields: { ...base(), schedule: { kind: 'once', date: '2026-11-10', time: '09:00', timezone: 'Asia/Shanghai' } } })).task;
    now += 3600_000;
    await tasks.tick(); await tasks.idle();
    assert.equal((await tasks.execute('get', { id: task.id })).task.status, 'ended');
    assert.equal((await tasks.execute('history', { id: task.id })).runs[0].status, 'uncertain');
    await tasks.close();
    // Exact disk state of a process lost between reservation and acknowledgement.
    const db = new DatabaseSync(file);
    const row = db.prepare('SELECT id,body FROM task_runs').get()!;
    const body = JSON.parse(row.body as string); body.status = 'delivering';
    db.prepare('UPDATE task_runs SET body=? WHERE id=?').run(JSON.stringify(body), row.id as string); db.close();
    tasks = createTasks({ file, now: () => now, log: quiet, deliver: async () => { sends++; } });
    await tasks.tick(); await tasks.idle();
    assert.equal(sends, 1);
    assert.equal((await tasks.execute('history', { id: task.id })).runs[0].status, 'uncertain');
    assert.equal((await tasks.execute('resume', identity(task))).code, 'invalid_schedule');
  } finally { await tasks.close(); await rm(folder, { recursive: true, force: true }); }
  const rejected = createTasks({ file: ':memory:', now: () => at, log: quiet, deliver: async () => { throw Object.assign(new Error('not sent'), { code: 'invalid_session', beforeSend: true }); } });
  try {
    const task = (await rejected.execute('create', { fields: base() })).task;
    await rejected.execute('run', identity(task)); await rejected.idle();
    assert.equal((await rejected.execute('history', { id: task.id })).runs[0].status, 'failed');
  } finally { await rejected.close(); }
});

test('a task records who made it from who calls, and only the ones a conversation made with its cron tools are dropped, once they have ended and their delivery is over', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-task-origin-'));
  const file = join(folder, 'tasks.db');
  let now = at;
  const open = (deliver: any = async () => {}) => createTasks({ file, now: () => now, log: quiet, deliver });
  const once = { kind: 'once', date: '2026-11-10', time: '09:00', timezone: 'Asia/Shanghai' };
  let tasks = open();
  try {
    const make = async (context?: any, fields: any = {}) => (await tasks.execute('create', { fields: { ...base(), schedule: once, ...fields } }, context)).task;
    const session = await make({ origin: 'session' });
    const assistant = await make({ origin: 'assistant' });
    const owner = await make();
    const claimed = await make({ origin: 'owner' });
    assert.deepEqual([session.origin, assistant.origin, owner.origin, claimed.origin], ['session', 'assistant', 'app', 'app'], 'a call that says nothing, or something else, is the interface');
    assert.equal((await tasks.execute('create', { fields: { ...base(), origin: 'app' } }, { origin: 'session' })).code, 'invalid_task', 'a client cannot name its own origin');
    const recurring = await make({ origin: 'session' }, { schedule: base().schedule });
    now += 3600_000;
    await tasks.tick(); await tasks.idle();
    assert.equal((await tasks.execute('get', { id: session.id })).code, 'not_found', 'what a conversation made is gone once it has fired');
    assert.equal((await tasks.execute('history', { id: session.id })).code, 'not_found');
    for (const kept of [assistant, owner, claimed]) assert.equal((await tasks.execute('get', { id: kept.id })).task.status, 'ended', 'nobody else\'s ended task is dropped');
    assert.equal((await tasks.execute('get', { id: recurring.id })).task.status, 'active', 'a recurring job has not ended');
    await tasks.close();
    const db = new DatabaseSync(file);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM task_runs WHERE task_id=?').get(session.id)!.n, 0, 'its runs went with it');
    // What a process that stopped before it could drop the task left behind.
    const left = (id: string, origin: string) => JSON.stringify({ ...base(), origin, id, revision: 1, status: 'ended', nextRunAt: null, sessionId: null, createdAt: at, updatedAt: at, schedule: once });
    for (const [id, origin] of [['left-by-session', 'session'], ['left-by-owner', 'app']]) db.prepare('INSERT INTO tasks(id,body) VALUES(?,?)').run(id, left(id, origin));
    db.close();
    tasks = open();
    assert.equal((await tasks.execute('get', { id: 'left-by-session' })).code, 'not_found', 'dropped when the plugin starts');
    assert.equal((await tasks.execute('get', { id: 'left-by-owner' })).task.status, 'ended');
  } finally { await tasks.close(); await rm(folder, { recursive: true, force: true }); }
  // A delivery that did not go does not keep it either: nobody sees a hidden task, and the log has the reason.
  const refusing = createTasks({ file: ':memory:', now: () => now, log: quiet, deliver: async () => { throw Object.assign(new Error('not sent'), { code: 'invalid_session', beforeSend: true }); } });
  try {
    now = at;
    const task = (await refusing.execute('create', { fields: { ...base(), schedule: once } }, { origin: 'session' })).task;
    now += 3600_000;
    await refusing.tick(); await refusing.idle();
    assert.equal((await refusing.execute('get', { id: task.id })).code, 'not_found');
  } finally { await refusing.close(); }
});

test('a task a conversation made is dropped when it falls due and its conversation is gone, with no run made; the owner\'s task is not, and DSH\'s list says what is gone', async () => {
  let now = at;
  const gone = new Set(['deleted']);
  const sent: string[] = [];
  const tasks = createTasks({ file: ':memory:', now: () => now, log: quiet, gone: (task: any) => gone.has(task.target.sessionId), deliver: async (task: any) => { sent.push(task.target.sessionId); } });
  try {
    const into = (sessionId: string) => ({ ...base(), target: { mode: 'existing', sessionId } });
    const lost = (await tasks.execute('create', { fields: into('deleted') }, { origin: 'session' })).task;
    const there = (await tasks.execute('create', { fields: into('here') }, { origin: 'session' })).task;
    const owners = (await tasks.execute('create', { fields: into('deleted') })).task;
    now += 3600_000; await tasks.tick(); await tasks.idle();
    assert.equal((await tasks.execute('get', { id: lost.id })).code, 'not_found', 'dropped before its firing');
    assert.deepEqual(sent.sort(), ['deleted', 'here'], 'nothing was sent for it: only the owner\'s task and the one whose conversation is there');
    assert.equal((await tasks.execute('get', { id: there.id })).task.status, 'active');
    assert.equal((await tasks.execute('history', { id: owners.id })).runs.length, 1, 'the owner\'s task is never asked about: it fires and says what happens');
    assert.equal((await tasks.execute('get', { id: owners.id })).task.status, 'active');
  } finally { await tasks.close(); }
  // What is gone: no workspace of DSH's registry lists the conversation (a live or an archived one is listed); a failing registry says nothing.
  const listed = (list: () => any[]) => createTaskHost({ registry: { list }, controller: {}, agents: { get: () => undefined }, dsh: {} as any }).gone;
  const into = (target: any) => ({ target });
  const registry = () => [{ id: 'w', title: 'dudu', path: '/work/dudu', sessionIds: ['here'] }, { id: 'x', title: 'other', path: '/work/other', sessionIds: ['elsewhere'] }];
  assert.equal(listed(registry)(into({ mode: 'existing', sessionId: 'here' })), false);
  assert.equal(listed(registry)(into({ mode: 'existing', sessionId: 'elsewhere' })), false, 'in another workspace is still there');
  assert.equal(listed(registry)(into({ mode: 'existing', sessionId: 'deleted' })), true);
  assert.equal(listed(registry)(into({ mode: 'reuse' })), false, 'a task that names no conversation has none to lose');
  assert.equal(listed(() => { throw new Error('not active'); })(into({ mode: 'existing', sessionId: 'here' })), false);
});

test('schedule edits reanchor intervals and history pagination and deletion preserve their own bounds', async () => {
  let now = at;
  const tasks = createTasks({ file: ':memory:', now: () => now, deliver: async () => {} });
  try {
    let task = (await tasks.execute('create', { fields: base() })).task;
    now += 10_000;
    task = (await tasks.execute('update', { ...identity(task), patch: { schedule: { ...base().schedule, minutes: 2 } } })).task;
    now += 120_000; await tasks.tick(); await tasks.idle();
    assert.equal((await tasks.execute('get', { id: task.id })).task.nextRunAt, at + 250_000);
    for (let n = 0; n < 32; n++) { await tasks.execute('run', identity(task)); await tasks.idle(); }
    const first = await tasks.execute('history', { id: task.id });
    const second = await tasks.execute('history', { id: task.id, before: first.nextCursor });
    assert.equal(first.runs.length, 30); assert.equal(second.runs.length, 3);
    assert.equal(new Set([...first.runs, ...second.runs].map((run) => run.id)).size, 33);
    assert.equal((await tasks.execute('delete', identity(task))).outcome, 'success');
    assert.equal((await tasks.execute('get', { id: task.id })).code, 'not_found');
  } finally { await tasks.close(); }
});

test('an asynchronous rules validation cannot overwrite a simultaneous delivery checkpoint or receipt', async () => {
  let delayValidation = false;
  let allowValidation: () => void = () => {};
  let allowDelivery: () => void = () => {};
  let enteredValidation: () => void = () => {};
  let completedCheckpoint: () => void = () => {};
  const validation = new Promise<void>((resolve) => { allowValidation = resolve; });
  const delivery = new Promise<void>((resolve) => { allowDelivery = resolve; });
  const entered = new Promise<void>((resolve) => { enteredValidation = resolve; });
  const checkpointed = new Promise<void>((resolve) => { completedCheckpoint = resolve; });
  const tasks = createTasks({ file: ':memory:', now: () => at,
    validate: async () => { if (delayValidation) { enteredValidation(); await validation; } },
    deliver: async (_task, _run, checkpoint) => { await delivery; await checkpoint('durable-session', { provider: 'claude', model: 'actual-model' }); completedCheckpoint(); },
  });
  try {
    const task = (await tasks.execute('create', { fields: base() })).task;
    await tasks.execute('run', identity(task));
    delayValidation = true;
    const update = tasks.execute('update', { ...identity(task), patch: { title: '更名' } });
    await entered;
    allowDelivery(); await checkpointed;
    allowValidation(); await update; await tasks.idle();
    const latest = (await tasks.execute('get', { id: task.id })).task;
    assert.equal(latest.title, '更名'); assert.equal(latest.sessionId, 'durable-session'); assert.equal(latest.lastRun.status, 'delivered');
    const run = (await tasks.execute('history', { id: task.id })).runs[0];
    assert.equal(run.task.title, task.title); assert.equal(run.model, 'actual-model');
  } finally { allowDelivery(); allowValidation(); await tasks.close(); }
});

test('task delivery uses only configured workspaces/models, checkpoints before send, and never reconfigures an existing conversation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-task-host-'));
  const calls: string[] = [];
  const task: any = { ...base(), project: { name: 'dudu', path: folder }, sessionId: null };
  let selected = 'default';
  let accessError: Error | null = null;
  const host = createTaskHost({
    registry: { list: () => [{ id: 'w', title: 'dudu', path: folder, sessionIds: ['s'] }] },
    controller: {}, agents: { get: () => ({ options: { provider: 'claude', model: selected } }) },
    access: () => { if (accessError) throw accessError; return 'workspace-write'; },
    dsh: {
      models: async () => ({ groups: [{ id: 'claude', models: [{ id: 'default' }] }] }),
      createSession: async () => { calls.push('create'); return { sessionId: 's' }; },
      selectModel: async () => { calls.push('model'); }, setAccess: async (_id: any, value: any) => { calls.push(value); },
      prompt: async (_id: any, _text: any, options: any) => { assert.equal(options.requestId, 'dudu-task-run'); calls.push('send'); },
      workspaceOf: async () => 'w', unarchive: async () => { calls.push('unarchive'); },
      archive: async () => { calls.push('archive'); },
    },
  });
  try {
    await host.validate(task);
    await host.deliver(task, { id: 'run' }, async () => { calls.push('checkpoint'); });
    assert.deepEqual(calls, ['create', 'model', 'workspace-write', 'checkpoint', 'send']);
    calls.length = 0;
    await host.deliver({ ...task, sessionId: 's' }, { id: 'run' }, async () => { calls.push('checkpoint'); });
    assert.deepEqual(calls, ['unarchive', 'checkpoint', 'send']);
    calls.length = 0;
    accessError = new Error('Settings are unavailable');
    await assert.rejects(host.deliver(task, { id: 'run' }, async () => { calls.push('checkpoint'); }),
      (error: any) => error === accessError && error.beforeSend);
    assert.deepEqual(calls, ['create', 'model', 'archive'], 'unreadable permission never selects a default or sends a prompt');
    selected = 'different';
    await assert.rejects(host.deliver({ ...task, target: { mode: 'existing', sessionId: 's' } }, { id: 'run' }, async () => {}), (error: any) => error.beforeSend && error.code === 'session_model_mismatch');
    await assert.rejects(host.validate({ ...task, project: { name: 'elsewhere', path: '/not-registered' } }));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('a reused conversation is checked against the model it recorded, not the default options DSH resumes it with', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-task-host-'));
  const task: any = { ...base(), project: { name: 'dudu', path: folder }, sessionId: 's' };
  const build = (modelOf?: (agent: any) => any) => createTaskHost({
    registry: { list: () => [{ id: 'w', title: 'dudu', path: folder, sessionIds: ['s'] }] },
    controller: {}, agents: { get: () => ({ options: { provider: 'claude', model: 'the-default' } }) }, // what DSH gives a resumed session
    ...(modelOf ? { modelOf } : {}),
    dsh: {
      models: async () => ({ groups: [{ id: 'claude', models: [{ id: 'chosen' }] }] }),
      prompt: async () => {}, workspaceOf: async () => 'w', unarchive: async () => {},
    },
  });
  try {
    // Without the session's own record the resumed agent's default options are all there is: the task's model is "another" one (the old behaviour).
    await assert.rejects(build().deliver(task, { id: 'run' }, async () => {}), (error: any) => error.code === 'session_model_mismatch');
    // With it, the conversation is on the model the task chose: it is delivered.
    const delivered = await build((agent) => ({ provider: 'claude', model: 'chosen', from: agent.options.model })).deliver(task, { id: 'run' }, async () => {});
    assert.equal(delivered.sessionId, 's');
    // And a conversation that really is on another model is still refused.
    await assert.rejects(build(() => ({ provider: 'claude', model: 'someone-elses' })).deliver(task, { id: 'run' }, async () => {}), (error: any) => error.beforeSend && error.code === 'session_model_mismatch');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('a task that goes into an existing conversation and names no model goes in on the model the conversation has, and one that names a model is still checked', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-task-host-'));
  const task: any = { ...base(), project: { name: 'dudu', path: folder }, target: { mode: 'existing', sessionId: 's' }, sessionId: null };
  let on = 'other';
  const host = createTaskHost({
    registry: { list: () => [{ id: 'w', title: 'dudu', path: folder, sessionIds: ['s'] }] },
    controller: {}, agents: { get: () => ({ options: { provider: 'claude', model: 'the-default' } }) }, modelOf: () => ({ provider: 'claude', model: on }),
    dsh: { models: async () => ({ groups: [{ id: 'claude', models: [{ id: 'default' }, { id: 'other' }] }] }), prompt: async () => {}, workspaceOf: async () => 'w', unarchive: async () => {} },
  });
  const records: any[] = [];
  const checkpoint = async (_id: string, record: any) => { records.push(record); };
  try {
    await host.validate(task);
    await host.deliver(task, { id: 'run' }, checkpoint);
    on = 'default';
    await host.deliver(task, { id: 'run' }, checkpoint);
    assert.deepEqual(records.map((record) => record.model), ['other', 'default'], 'the record says the model the conversation really has, whichever it is when the time comes');
    on = 'other';
    await assert.rejects(host.deliver({ ...task, model: 'default' }, { id: 'run' }, checkpoint), (error: any) => error.beforeSend && error.code === 'session_model_mismatch');
    on = 'one-the-plugin-does-not-list';
    await assert.rejects(host.deliver(task, { id: 'run' }, checkpoint), (error: any) => error.beforeSend && error.code === 'session_model_mismatch');
    on = 'other';
    await assert.rejects(host.deliver({ ...task, target: { mode: 'reuse' }, sessionId: 's' }, { id: 'run' }, checkpoint), (error: any) => error.code === 'session_model_mismatch',
      'a conversation the task made itself is still checked against the model the task chose');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('opening task creation does not wait for the DSH conversation catalog', async () => {
  let scans = 0;
  const host = createTaskHost({
    registry: { list: () => [{ id: 'workspace', title: 'dudu', path: '/work/dudu', sessionIds: ['session'] }] },
    controller: {}, agents: new Map(),
    dsh: {
      models: async () => ({ groups: [{ id: 'claude', models: [{ id: 'default' }] }] }),
      list: async () => {
        scans++;
        return [{
          sessionId: 'session', updatedAt: 1700000000000,
          projections: { values: { title: { title: '项目摘要会话' }, modelSelection: { lastUsed: { provider: 'claude', model: 'default' } } } },
        }];
      },
    },
  });
  const tasks = createTasks({ file: ':memory:', deliver: host.deliver, options: host.options });
  try {
    const compact = await tasks.execute('options', { includeSessions: false });
    assert.equal(compact.outcome, 'success');
    assert.equal(compact.providers.find((provider: any) => provider.id === 'claude').available, true);
    assert.equal(compact.projects[0].id, 'workspace');
    assert.deepEqual(compact.sessions, []);
    assert.equal(scans, 0, 'new tasks must not scan all of the owner’s conversations');
    const [session] = (await tasks.execute('options')).sessions;
    assert.equal(session.title, '项目摘要会话', 'the existing-session picker uses DSH’s persisted title projection');
    assert.deepEqual([session.agent, session.model, session.updatedAt], ['claude', 'default', 1700000000000],
      'picking a session can set the task’s own provider/model to what the conversation is already on, instead of leaving a mismatch for validate to reject later');
    assert.equal(scans, 1, 'the assistant and existing-target picker can still request sessions');
    const tool = taskTools(definition, () => tasks).find((item) => item.name === 'tasks_options')!;
    await tool.execute({});
    assert.equal(scans, 1, 'Dudu also opens ordinary creation without a conversation scan');
    await tool.execute({ includeSessions: true });
    assert.equal(scans, 2);
    assert.equal((await tasks.execute('options', { includeSessions: 'yes' })).code, 'invalid_task');
  } finally { await tasks.close(); }
  const timedOut = createTasks({ file: ':memory:', deliver: async () => {}, options: async () => { throw new DOMException('Timed out', 'TimeoutError'); } });
  try {
    assert.equal((await timedOut.handle('options', new Request('http://test/tasks/options', { method: 'POST', body: '{}' }))).status, 503);
    assert.equal((await timedOut.execute('options')).code, 'unavailable', 'numeric DOMException codes are not task error codes');
  } finally { await timedOut.close(); }
});

test('assistant tools and authenticated native task methods share one revisioned store; the App list works without the DSH scheduler', async () => {
  const tasks = createTasks({ file: ':memory:', now: () => at, deliver: async () => {} });
  const bridge = createNativeBridge({ assistant: { tasks: (action, body) => tasks.execute(action, body) }, rpc: { call: async () => { throw new Error('no DSH timer plugin'); }, open: async () => { throw new Error('no stream'); } } });
  const tools = taskTools(definition, () => tasks);
  const call = async (name: string, args: any) => JSON.parse(await tools.find((tool) => tool.name === name)!.execute(args));
  try {
    const task = (await call('tasks_create', { fields: base() })).task;
    const read = await bridge.dispatch('tasks.get', { id: task.id }, {});
    assert.equal(read.task.id, task.id);
    const paused = await bridge.dispatch('tasks.pause', identity(task), {});
    assert.equal(paused.task.status, 'paused');
    assert.equal((await call('tasks_update', { ...identity(task), patch: { title: 'stale' } })).code, 'conflict');
    const list = await bridge.dispatch('schedule.list', {}, {});
    assert.equal(list[0].id, `dudu:${task.id}`); assert.equal(list[0].enabled, false);
    const resumed = await bridge.dispatch('tasks.resume', identity(paused.task), {});
    assert.equal(resumed.task.status, 'active');
    assert.equal(resumed.task.revision, paused.task.revision + 1);
    assert.ok(resumed.task.nextRunAt > at);
    await assert.rejects(bridge.dispatch('tasks.proxy', { action: 'anything' }, {}), (error: any) => error.code === 'UNSUPPORTED');
    const response = await tasks.handle('create', new Request('http://test/tasks/create', { method: 'POST', body: '{bad' }));
    assert.equal(response.status, 400);
    assert.equal((await tasks.execute('list')).tasks.length, 1);
  } finally { await tasks.close(); }
});

test('a task of 嘟嘟 needs no project and no existing conversation, whatever project comes with it is not kept, and every other provider still needs one', async () => {
  const tasks = createTasks({ file: ':memory:', now: () => at, log: quiet, deliver: async () => ({}) });
  try {
    const dudu = { ...base(), agent: 'dudu', project: null, target: { mode: 'new' } };
    const made = await tasks.execute('create', { fields: dudu });
    assert.equal(made.outcome, 'success');
    assert.equal(made.task.project, null);
    assert.equal((await tasks.execute('create', { fields: { ...dudu, project: { name: 'x', path: '/work/x' } } })).task.project, null);
    assert.equal((await tasks.execute('create', { fields: { ...dudu, target: { mode: 'existing', sessionId: 's' } } })).code, 'invalid_session');
    assert.equal((await tasks.execute('create', { fields: { ...base(), project: null } })).code, 'invalid_project');
    // Changing who does it: the binding goes, and a workspace is needed (or not) as the provider says.
    const moved = await tasks.execute('update', { id: made.task.id, revision: 1, patch: { agent: 'claude', project: { name: 'dudu', path: '/work/dudu' }, target: { mode: 'reuse' } } });
    assert.equal(moved.outcome, 'success');
    assert.equal((await tasks.execute('update', { id: made.task.id, revision: moved.task.revision, patch: { agent: 'dudu', project: null, target: { mode: 'reuse' } } })).task.project, null);
  } finally { await tasks.close(); }
});

test('嘟嘟 is the first provider of the task options, and its tasks go to its own runner and not to a workspace', async () => {
  let runner: any = {
    validate: async () => {},
    deliver: async (_task: any, _run: any, checkpoint: any) => { await checkpoint('dudu-assistant-task-1', { provider: 'deepseek', model: 'flash' }); return { sessionId: 'dudu-assistant-task-1', workspaceId: null }; },
  };
  const host = createTaskHost({
    registry: { list: () => [] }, controller: {}, agents: { get: () => undefined }, dudu: () => runner,
    dsh: { models: async () => ({ default: { provider: 'deepseek', model: 'flash' }, groups: [{ id: 'deepseek', models: [{ id: 'flash' }] }, { id: 'claude', models: [{ id: 'sonnet' }] }] }), list: async () => [] },
  });
  const options = await host.options({ includeSessions: false });
  assert.deepEqual(options.providers.map((provider: any) => [provider.id, provider.available]), [['dudu', true], ['claude', true], ['codex', false], ['pi', false], ['deepseek', true]]);
  assert.deepEqual(options.providers[0].models, ['flash'], 'the models of the conversation routes, never Claude Code or Codex');
  const task: any = { ...base(), agent: 'dudu', project: null, target: { mode: 'new' } };
  await host.validate(task);
  const checkpoints: any[] = [];
  assert.deepEqual(await host.deliver(task, { id: 'r1' }, async (...args: any[]) => { checkpoints.push(args); }), { sessionId: 'dudu-assistant-task-1', workspaceId: null });
  assert.equal(checkpoints.length, 1);
  runner = null; // the conversation is not open: nothing of 嘟嘟 can run
  assert.equal((await host.options({ includeSessions: false })).providers[0].available, false);
  await assert.rejects(host.deliver(task, { id: 'r2' }, async () => {}), (error: any) => error.code === 'provider_unavailable' && error.beforeSend === true);
  await assert.rejects(host.validate(task), (error: any) => error.code === 'provider_unavailable');
});

