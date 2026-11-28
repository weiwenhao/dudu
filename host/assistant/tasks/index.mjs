// Durable user tasks, independent of DSH's scheduler and of collectors. A run records delivery, never agent completion.
// A task records where it was made from (`origin`, contract.mjs), set here from who calls and never taken from a client. One a conversation made with its own cron tools (origin 'session') is not the owner's to keep
// (owner, 2026-11-26: "MCP dudu 调用创建的，我不希望出现在这个定时任务列表里，结束之后，我也希望能直接清理掉，不要占用列表数据"): the tasks window leaves it out (the clients do), and once it has ended and its delivery is
// over it goes, with its runs. So does one whose conversation is gone: it is dropped when it falls due, before any run is made, since nobody can see it to delete it and every firing would add a failed run for ever (owner, 2026-11-26: 「那不需要连续三次吧……
// 执行之前就能发现会话在不在了对吧？对话不在直接跳过就行了对吧？」).
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nextOccurrence, validateSchedule } from './timing.mjs';
import { TASK_ACTIONS, TASK_ORIGINS } from './contract.mjs';
import { HARNESS_IDS } from '../../providers/catalog.mjs';

export { TASK_ACTIONS } from './contract.mjs';
const success = (extra = {}) => ({ outcome: 'success', ...extra });
const failure = (code) => ({ outcome: 'error', code });
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const invalid = (code = 'invalid_task') => { throw Object.assign(new Error(code), { code }); };
const editable = new Set(['title', 'prompt', 'agent', 'model', 'project', 'target', 'schedule']);


function fields(input) {
  if (!record(input) || Object.keys(input).some((key) => !editable.has(key))) invalid();
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 100_000) invalid();
  if (!['dudu', 'deepseek', ...HARNESS_IDS].includes(input.agent) || input.model != null && (typeof input.model !== 'string' || !input.model || input.model.length > 300)) invalid();
  // 嘟嘟 does a task in its own folder, in a conversation of its own: a task of it has no project (any that comes with it is not kept) and no existing conversation to go to.
  const dudu = input.agent === 'dudu';
  let project = null;
  if (!dudu) {
    const given = input.project;
    if (!record(given) || typeof given.path !== 'string' || !isAbsolute(given.path) || given.path.length > 4096 || typeof given.name !== 'string' || given.name.length > 200) invalid('invalid_project');
    project = { name: given.name, path: given.path, ...(typeof given.id === 'string' ? { id: given.id } : {}) };
  }
  const target = input.target;
  if (!record(target) || !(dudu ? ['reuse', 'new'] : ['reuse', 'new', 'existing']).includes(target.mode)) invalid('invalid_session');
  if (target.mode === 'existing' && (typeof target.sessionId !== 'string' || !target.sessionId || target.sessionId.length > 512 || target.sessionId.startsWith('dudu-assistant-'))) invalid('invalid_session');
  return {
    title: input.title.trim(), prompt: input.prompt.trim(), agent: input.agent, model: input.model ?? null,
    project,
    target: { mode: target.mode, ...(target.mode === 'existing' ? { sessionId: target.sessionId } : {}) },
    schedule: validateSchedule(input.schedule),
  };
}

/**
 * `deliver(task, run, checkpoint)` persists the resolved session before the adapter attempts to send. `gone(task)` says whether the conversation a task names is certainly not there any more (tasks/host.mjs);
 * it is asked, before a firing, only of the tasks a conversation made for itself.
 */
export function createTasks({ file, deliver, options = async () => ({}), validate = async () => {}, gone = () => false, now = Date.now, log = console }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) { db.close(); throw new Error('SCHEMA_TOO_NEW'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_due ON tasks(json_extract(body,'$.status'),json_extract(body,'$.nextRunAt'));
    CREATE TABLE IF NOT EXISTS task_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS task_runs_task ON task_runs(task_id,seq DESC);
    CREATE INDEX IF NOT EXISTS task_runs_status ON task_runs(json_extract(body,'$.status'));
    PRAGMA user_version=1;`);
  let timer = null;
  let closed = false;
  let queue = Promise.resolve();
  const running = new Map();
  const locked = (fn) => {
    const work = queue.then(() => { if (closed) throw new Error('closed'); return fn(); });
    queue = work.catch(() => {});
    return work;
  };
  const read = (id) => { const row = db.prepare('SELECT body FROM tasks WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; };
  const all = () => db.prepare('SELECT body FROM tasks').all().map((row) => JSON.parse(row.body));
  const write = (task) => db.prepare('INSERT INTO tasks(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(task.id, JSON.stringify(task));
  const writeRun = (run) => db.prepare('UPDATE task_runs SET body=? WHERE id=?').run(JSON.stringify(run), run.id);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // A task a conversation made for itself goes once it has ended (the top of the file): an ended one has had its delivery. Its runs go with it (their rows cascade).
  const spent = (task) => task?.origin === 'session' && task.status === 'ended';
  const drop = (id) => db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  // A prior process could have stopped on either side of the send. Never blindly send its prompt again.
  transaction(() => {
    for (const row of db.prepare("SELECT body FROM task_runs WHERE json_extract(body,'$.status')='delivering'").all()) {
      const run = JSON.parse(row.body);
      if (run.status === 'delivering') {
        writeRun({ ...run, status: 'uncertain', finishedAt: now(), code: 'delivery_uncertain' });
        const task = read(run.taskId);
        if (task?.lastRun?.id === run.id) { task.lastRun.status = 'uncertain'; write(task); }
      }
    }
    // One still marked ended was left by a process that stopped before its delivery was over; nothing is in flight yet, and the prompt is never sent again (above).
    for (const row of db.prepare("SELECT body FROM tasks WHERE json_extract(body,'$.origin')='session' AND json_extract(body,'$.status')='ended'").all()) drop(JSON.parse(row.body).id);
  });
  function current(body) {
    if (!record(body) || typeof body.id !== 'string') invalid();
    const task = read(body.id);
    if (!task) invalid('not_found');
    if (!Number.isSafeInteger(body.revision) || task.revision !== body.revision) invalid('conflict');
    return task;
  }
  async function reserve(task, manual) {
    if (running.has(task.id)) return failure('busy');
    const run = { id: randomUUID(), taskId: task.id, at: now(), scheduledAt: manual ? null : task.nextRunAt, manual, status: 'delivering', task: structuredClone(task), sessionId: null };
    transaction(() => {
      db.prepare('INSERT INTO task_runs(id,task_id,body) VALUES(?,?,?)').run(run.id, task.id, JSON.stringify(run));
      if (!manual) {
        task.nextRunAt = nextOccurrence(task.schedule, now(), task.scheduleAnchor ?? task.createdAt);
        if (task.nextRunAt == null) task.status = 'ended';
      }
      task.lastRun = { id: run.id, at: run.at, status: run.status };
      // Runtime facts do not invalidate an editor's revision.
      write(task);
    });
    const done = (async () => {
      try {
        const target = await deliver(run.task, run, async (sessionId, resolved = {}) => {
          if (typeof sessionId !== 'string' || !sessionId) throw new Error('invalid_session');
          run.sessionId = sessionId;
          for (const key of ['provider', 'model', 'access', 'workspaceId']) if (typeof resolved[key] === 'string') run[key] = resolved[key];
          writeRun(run);
          const latest = read(task.id);
          if (latest && latest.agent === run.task.agent && latest.model === run.task.model && JSON.stringify(latest.project) === JSON.stringify(run.task.project) && JSON.stringify(latest.target) === JSON.stringify(run.task.target)) {
            latest.sessionId = sessionId;
            write(latest);
          }
        });
        run.status = 'delivered';
        if (target?.workspaceId) run.workspaceId = target.workspaceId;
      } catch (error) {
        run.status = error?.beforeSend ? 'failed' : 'uncertain';
        run.code = error?.code ?? (error?.beforeSend ? 'delivery_failed' : 'delivery_uncertain');
        log.warn?.(`[dudu] Scheduled task delivery: ${run.code}`);
      }
      run.finishedAt = now();
      transaction(() => {
        writeRun(run);
        const latest = read(task.id);
        if (!latest) return;
        latest.lastRun = { id: run.id, at: run.at, status: run.status };
        // The delivery is over: a task a conversation made for itself, which this run ended, goes now.
        if (spent(latest)) drop(latest.id); else write(latest);
      });
      return success({ run, task: read(task.id) });
    })().finally(() => running.delete(task.id));
    running.set(task.id, done);
    // If a receipt cannot be committed (for example a full disk), stop scheduling. The durable claim remains uncertain on restart.
    void done.catch(() => { clearInterval(timer); timer = null; log.warn?.('[dudu] Scheduled task receipts could not be saved; scheduling stopped.'); });
    return success({ run, task: read(task.id), pending: true });
  }
  /** `context.origin` is who calls, said by the plugin's own code (the cron tools: 'session'; 嘟嘟's tools: 'assistant'); a call that says nothing comes from the interface, through its routes: 'app'. */
  async function execute(action, body = {}, context = {}) {
    try {
      if (!record(body) || !TASK_ACTIONS.includes(action)) return failure('invalid_task');
      if (action === 'options') {
        if (body.includeSessions != null && typeof body.includeSessions !== 'boolean') invalid();
        return success(await options(body));
      }
      if (action === 'list') {
        if (body.status != null && !['active', 'paused', 'ended'].includes(body.status) || body.query != null && (typeof body.query !== 'string' || body.query.length > 1000)) invalid();
        const query = (body.query ?? '').toLocaleLowerCase();
        return success({ tasks: all().filter((task) => (!body.status || task.status === body.status) && (!query || `${task.title}\n${task.prompt}`.toLocaleLowerCase().includes(query))).sort((a, b) => b.createdAt - a.createdAt) });
      }
      if (action === 'get') { const task = typeof body.id === 'string' && read(body.id); return task ? success({ task }) : failure('not_found'); }
      if (action === 'history') {
        if (typeof body.id !== 'string' || !read(body.id)) return failure('not_found');
        if (body.before != null && (!Number.isSafeInteger(body.before) || body.before < 1)) invalid();
        const rows = db.prepare('SELECT seq,body FROM task_runs WHERE task_id=? AND seq<? ORDER BY seq DESC LIMIT 31').all(body.id, body.before ?? Number.MAX_SAFE_INTEGER);
        return success({ runs: rows.slice(0, 30).map((row) => ({ ...JSON.parse(row.body), seq: row.seq })), nextCursor: rows.length > 30 ? rows[29].seq : null });
      }
      return await locked(async () => {
        if (action === 'create' || action === 'duplicate') {
          const source = action === 'duplicate' ? current(body) : null;
          const value = fields(source ? Object.fromEntries([...editable].map((key) => [key, source[key]])) : body.fields);
          await validate(value);
          const at = now();
          const nextRunAt = nextOccurrence(value.schedule, at, at);
          if (action === 'create' && nextRunAt == null) invalid('invalid_schedule');
          const origin = TASK_ORIGINS.includes(context?.origin) ? context.origin : 'app';
          const task = { ...value, origin, id: randomUUID(), revision: 1, status: source ? 'paused' : 'active', nextRunAt, sessionId: null, createdAt: at, updatedAt: at };
          write(task);
          return success({ task });
        }
        let task = current(body);
        if (action === 'update') {
          if (!record(body.patch) || Object.keys(body.patch).some((key) => !editable.has(key))) invalid();
          const value = fields({ ...Object.fromEntries([...editable].map((key) => [key, task[key]])), ...body.patch });
          await validate(value);
          // A concurrent delivery may have checkpointed its session or completed while validation awaited DSH.
          // Keep those runtime facts; the editor only owns the requested fields.
          task = current(body);
          const timingChanged = JSON.stringify(value.schedule) !== JSON.stringify(task.schedule);
          const bindingChanged = ['agent', 'model', 'project', 'target'].some((key) => JSON.stringify(value[key]) !== JSON.stringify(task[key]));
          if ((timingChanged || bindingChanged) && running.has(task.id)) invalid('busy');
          if (timingChanged) {
            task.nextRunAt = nextOccurrence(value.schedule, now(), now());
            if (task.nextRunAt == null) invalid('invalid_schedule');
            if (task.status === 'ended') task.status = 'paused';
            task.scheduleAnchor = now();
          }
          if (bindingChanged) task.sessionId = null;
          Object.assign(task, value);
        } else if (action === 'delete') {
          if (running.has(task.id)) invalid('busy');
          db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
          return success({ id: task.id, title: task.title });
        } else if (action === 'run') {
          return reserve(task, true);
        } else if (action === 'pause') {
          if (task.status === 'ended') invalid('invalid_schedule');
          task.status = 'paused';
        } else if (action === 'resume') {
          task.nextRunAt = nextOccurrence(task.schedule, now(), task.scheduleAnchor ?? task.createdAt);
          if (task.nextRunAt == null) invalid('invalid_schedule');
          task.status = 'active';
        }
        task.revision++;
        task.updatedAt = now();
        write(task);
        return success({ task });
      });
    } catch (error) { return failure(typeof error?.code === 'string' ? error.code : 'unavailable'); }
  }
  const tick = () => locked(async () => {
    // Idle checks use the index rather than decoding every prompt each second.
    const due = db.prepare("SELECT body FROM tasks WHERE json_extract(body,'$.status')='active' AND json_extract(body,'$.nextRunAt')<=?").all(now());
    for (const row of due) {
      const task = JSON.parse(row.body);
      if (running.has(task.id)) continue;
      // Asked before the firing, so that no run is made for it: a task a conversation made for itself, whose conversation is not there any more, has nowhere to go and nobody can see it to delete it.
      if (task.origin === 'session' && gone(task)) { drop(task.id); continue; }
      await reserve(task, false);
    }
  });
  return {
    execute, tick,
    start() { if (!timer && !closed) { timer = setInterval(() => { void tick().catch(() => {}); }, 1000); timer.unref?.(); void tick().catch(() => {}); } },
    async idle() { await queue; await Promise.all([...running.values()]); },
    async close() { clearInterval(timer); timer = null; await queue; await Promise.all([...running.values()]); closed = true; db.close(); },
    async handle(action, request) {
      const body = await request.json().catch(() => null);
      const result = await execute(action, body);
      return Response.json(result, { status: result.code === 'conflict' ? 409 : result.code === 'unavailable' ? 503 : result.outcome === 'error' ? 400 : 200, headers: { 'cache-control': 'no-store' } });
    },
  };
}
