import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE, createSessionTools, scheduleOf } from '../host/providers/cron-tools.mjs';

// The cron tools Claude is given in place of its own CronCreate, CronDelete and CronList (owner, 2026-11-17: "我希望让 claude 无感知的替换 croncreate"): jobs are tasks of Dudu that send their prompt into the
// conversation that made them. What must hold: what a job becomes as a task, that a conversation sees and cancels only its own, that the server is made once for a conversation, and that Claude's own tools are the ones denied.

const day = Date.UTC(2026, 10, 17, 0, 0);
const project = { id: 'w1', name: 'devops-gateway', path: '/work/devops-gateway' };

test('a recurring job is a cron schedule in the computer\'s zone and a one-shot one is the next time its fields name, written as a date and a time', () => {
  assert.deepEqual(scheduleOf({ cron: '*/5 * * * *' }, { timeZone: 'Asia/Shanghai', now: day }), { schedule: { kind: 'cron', timezone: 'Asia/Shanghai', expression: '*/5 * * * *' } });
  assert.deepEqual(scheduleOf({ cron: '  0 9   * * 1-5 ', recurring: true }, { timeZone: 'UTC', now: day }), { schedule: { kind: 'cron', timezone: 'UTC', expression: '0 9 * * 1-5' } });
  assert.deepEqual(scheduleOf({ cron: '30 14 28 2 *', recurring: false }, { timeZone: 'UTC', now: day }), { schedule: { kind: 'once', timezone: 'UTC', date: '2027-02-28', time: '14:30' } });
  // In another zone the same wall-clock time is another moment, and the date and the time are those of that zone.
  assert.deepEqual(scheduleOf({ cron: '0 9 18 11 *', recurring: false }, { timeZone: 'Asia/Shanghai', now: day }), { schedule: { kind: 'once', timezone: 'Asia/Shanghai', date: '2026-11-18', time: '09:00' } });
  assert.match(scheduleOf({ cron: 'every day' }, { timeZone: 'UTC', now: day }).problem!, /five fields/);
  assert.match(scheduleOf({ cron: '0 9 * * MON' }, { timeZone: 'UTC', now: day }).problem!, /numbers/);
  assert.equal(typeof scheduleOf({ cron: 7 as any }, { timeZone: 'UTC', now: day }).problem, 'string');
});

function build(overrides: any = {}) {
  const created: any[] = [];
  const origins: any[] = [];
  const listed: any[] = [];
  const served: any[] = [];
  let closed = 0;
  const service = {
    execute: async (action: string, body: any, context?: any) => {
      if (action === 'create') { created.push(body.fields); origins.push(context?.origin); return { outcome: 'success', task: { id: 'task-1', revision: 1, nextRunAt: Date.UTC(2026, 10, 18, 1, 0), ...body.fields } }; }
      if (action === 'list') return { outcome: 'success', tasks: listed };
      if (action === 'get') { const task = listed.find((item) => item.id === body.id); return task ? { outcome: 'success', task } : { outcome: 'error', code: 'not_found' }; }
      if (action === 'delete') { const at = listed.findIndex((item) => item.id === body.id); if (listed[at].revision !== body.revision) return { outcome: 'error', code: 'conflict' }; listed.splice(at, 1); return { outcome: 'success', id: body.id }; }
      throw new Error(action);
    },
  };
  const tools = createSessionTools({
    tasks: () => service, describe: (id: string) => (id === 'in-no-workspace' ? null : { project }), timeZone: () => 'Asia/Shanghai', now: () => day,
    serve: async (options: any) => { served.push(options); return { server: { name: options.name, type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer t' } }, close: async () => { closed += 1; } }; },
    log: { warn: () => {} }, ...overrides,
  });
  return { tools, created, origins, listed, served, closed: () => closed, handlers: async (id = 's1') => { await tools.forSession(id, 'claude'); return Object.fromEntries(served.at(-1).tools.map((tool: any) => [tool.name, tool.handler])); } };
}
const say = (result: any) => result.content.map((part: any) => part.text).join('\n');

test('CronCreate makes a task that sends its prompt into this conversation, on whatever model the conversation has, and says its id and its real next run', async () => {
  const { handlers, created, origins } = await Promise.resolve(build()).then(async (made) => ({ ...made, handlers: await made.handlers() }));
  const result = await handlers.CronCreate({ cron: '7 * * * *', prompt: 'Check the deploy.\nTell me what changed.', durable: true });
  assert.equal(result.isError, undefined);
  assert.deepEqual(origins, ['session'], 'the task says it was made by a conversation\'s tools (the owner\'s list leaves such tasks out)');
  assert.deepEqual(created[0], {
    title: 'Check the deploy.', prompt: 'Check the deploy.\nTell me what changed.', agent: 'claude', model: null, project,
    target: { mode: 'existing', sessionId: 's1' }, schedule: { kind: 'cron', timezone: 'Asia/Shanghai', expression: '7 * * * *' },
  });
  assert.match(say(result), /job task-1/);
  assert.match(say(result), /Next run: 2026-11-18 09:00 \(Asia\/Shanghai\)/, 'the engine\'s own next run, in the computer\'s zone');
  const once = await handlers.CronCreate({ cron: '30 14 28 2 *', prompt: 'Remind me.', recurring: false });
  assert.deepEqual(created[1].schedule, { kind: 'once', timezone: 'Asia/Shanghai', date: '2027-02-28', time: '14:30' });
  assert.match(say(once), /one-shot/);
  for (const bad of [{ cron: 'nope', prompt: 'x' }, { cron: '7 * * * *', prompt: '  ' }]) assert.equal((await handlers.CronCreate(bad)).isError, true);
  assert.equal(created.length, 2, 'a call that is refused makes no task');
});

test('a conversation that is in no workspace, or a task service that refuses, is told so and makes no job', async () => {
  const made = build();
  assert.equal((await (await made.handlers('in-no-workspace')).CronCreate({ cron: '7 * * * *', prompt: 'x' })).isError, true);
  const refusing = build({ tasks: () => ({ execute: async () => ({ outcome: 'error', code: 'session_model_mismatch' }) }) });
  const refused = await (await refusing.handlers()).CronCreate({ cron: '7 * * * *', prompt: 'x' });
  assert.equal(refused.isError, true);
  assert.match(say(refused), /session_model_mismatch/);
  const unavailable = build({ tasks: () => null });
  assert.match(say(await (await unavailable.handlers()).CronCreate({ cron: '7 * * * *', prompt: 'x' })), /not available/);
});

test('CronList and CronDelete see only the jobs of their own conversation, and a job that has ended is not listed', async () => {
  const made = build();
  const schedule = { kind: 'cron', expression: '0 9 * * *' };
  made.listed.push(
    { id: 'mine', revision: 3, status: 'active', createdAt: 1, nextRunAt: Date.UTC(2026, 10, 18, 1, 0), prompt: 'Good morning', schedule, target: { mode: 'existing', sessionId: 's1' } },
    { id: 'paused', revision: 1, status: 'paused', createdAt: 2, prompt: 'Later', schedule: { kind: 'once', date: '2026-12-01', time: '08:30' }, target: { mode: 'existing', sessionId: 's1' } },
    { id: 'done', revision: 1, status: 'ended', createdAt: 3, prompt: 'Over', schedule, target: { mode: 'existing', sessionId: 's1' } },
    { id: 'theirs', revision: 1, status: 'active', createdAt: 4, nextRunAt: 1, prompt: 'Not mine', schedule, target: { mode: 'existing', sessionId: 's2' } },
    { id: 'plain', revision: 1, status: 'active', createdAt: 5, nextRunAt: 1, prompt: 'A task of the window', schedule, target: { mode: 'new' } },
    // Made for this same conversation, but by the owner in the window or by 嘟嘟: theirs, not the conversation's.
    { id: 'owner-made', origin: 'app', revision: 1, status: 'active', createdAt: 6, nextRunAt: 1, prompt: 'Made in the window', schedule, target: { mode: 'existing', sessionId: 's1' } },
    { id: 'dudu-made', origin: 'assistant', revision: 1, status: 'active', createdAt: 7, nextRunAt: 1, prompt: 'Made by 嘟嘟', schedule, target: { mode: 'existing', sessionId: 's1' } },
  );
  const handlers = await made.handlers();
  const lines = say(await handlers.CronList({})).split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^mine \| 0 9 \* \* \* \(recurring\) \| next run: 2026-11-18 09:00 .* \| Good morning$/);
  assert.match(lines[1], /^paused \| once 2026-12-01 08:30 \(one-shot, paused\) \| next run: — \| Later$/);
  assert.equal((await handlers.CronDelete({ id: 'theirs' })).isError, true, 'another conversation\'s job cannot be cancelled');
  assert.equal((await handlers.CronDelete({ id: 'plain' })).isError, true);
  assert.equal((await handlers.CronDelete({ id: 'owner-made' })).isError, true, 'a task the owner made for this conversation is not cancelled from inside it');
  assert.equal((await handlers.CronDelete({ id: 'dudu-made' })).isError, true);
  assert.equal((await handlers.CronDelete({ id: 'nope' })).isError, true);
  assert.equal((await handlers.CronDelete({ id: 'mine' })).isError, undefined);
  assert.deepEqual(made.listed.map((task) => task.id), ['paused', 'done', 'theirs', 'plain', 'owner-made', 'dudu-made']);
  const empty = build();
  assert.equal(say(await (await empty.handlers()).CronList({})), 'No scheduled jobs.');
});

test('a Claude conversation gets one served set, which is given with every start, names Claude\'s own tools to deny, and goes when the conversation\'s agent does', async () => {
  const made = build();
  const first = await made.tools.forSession('s1', 'claude');
  const again = await made.tools.forSession('s1', 'claude');
  assert.deepEqual(first, again);
  assert.equal(made.served.length, 1, 'the set stays the same between starts: a process that is still alive must see the same options');
  assert.deepEqual(first!.disallowedTools, [...NATIVE]);
  assert.deepEqual(first!.launchArgs, ['--allowedTools', 'mcp__dudu__CronCreate,mcp__dudu__CronDelete,mcp__dudu__CronList'], 'the new tools are allowed without a question: in a session whose permission is not wide open a question is refused');
  assert.deepEqual(first!.mcpServers.map((server: any) => server.name), ['dudu']);
  assert.deepEqual(made.served[0].tools.map((tool: any) => tool.name), ['CronCreate', 'CronDelete', 'CronList']);
  for (const tool of made.served[0].tools) assert.equal(tool.inputSchema.type, 'object');
  assert.equal(await made.tools.forSession('s1', 'codex'), null, 'a harness with no cron tool of its own has nothing to replace');
  assert.equal(await made.tools.forSession('dudu-assistant-main', 'claude'), null);
  await made.tools.forSession('s2', 'claude');
  assert.equal(made.served.length, 2);
  await made.tools.forget('s1');
  assert.equal(made.closed(), 1);
  await made.tools.forSession('s1', 'claude');
  assert.equal(made.served.length, 3, 'after the agent is gone a new set is made');
  await made.tools.close();
  assert.equal(made.closed(), 3);
});

test('tools that cannot be served never keep a conversation from starting: the session runs with Claude\'s own', async () => {
  const warned: string[] = [];
  const made = build({ serve: async () => { throw new Error('no port'); }, log: { warn: (line: string) => warned.push(line) } });
  assert.equal(await made.tools.forSession('s1', 'claude'), null);
  assert.equal(warned.length, 1);
  assert.equal(await made.tools.forSession('s1', 'claude'), null, 'and it is tried again at the next start');
});

test('over a real MCP connection the three tools are listed and CronCreate makes the task (the served set is OAR\'s own server: http on 127.0.0.1 with a bearer token)', async () => {
  const created: any[] = [];
  const tools = createSessionTools({
    tasks: () => ({ execute: async (_action: string, body: any) => { created.push(body.fields); return { outcome: 'success', task: { id: 'task-9', nextRunAt: Date.UTC(2026, 10, 18, 1, 0) } }; } }),
    describe: () => ({ project }), timeZone: () => 'UTC', now: () => day, log: { warn: () => {} },
  });
  try {
    const { mcpServers, disallowedTools, env } = (await tools.forSession('s1', 'claude'))!;
    // Claude receives the stdio helper; its private environment names the same
    // authenticated OAR HTTP server, whose task/security contract we check here.
    const server = JSON.parse(env[mcpServers[0].args[1]]);
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.deepEqual(disallowedTools, ['CronCreate', 'CronDelete', 'CronList']);
    const rpc = async (body: unknown, token = server.headers.Authorization) => fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: token }, body: JSON.stringify(body) });
    const denied = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer wrong');
    assert.equal(denied.status, 401, 'without the token nothing is served');
    const listed = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.deepEqual(listed.result.tools.map((tool: any) => tool.name), ['CronCreate', 'CronDelete', 'CronList']);
    assert.deepEqual(listed.result.tools[0].inputSchema.required, ['cron', 'prompt']);
    const called = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'CronCreate', arguments: { cron: '0 9 * * *', prompt: 'Good morning' } } })).json();
    assert.match(called.result.content[0].text, /job task-9/);
    assert.equal(created[0].target.sessionId, 's1');
  } finally { await tools.close(); }
});
