// The session a collector is run in (host/assistant/home/source-collector.mjs): one per collector, used again for the next collections,
// replaced after MAX_RUNS or after one that went wrong, the old ones folded away, and the skills of the owner's machine in reach (the agent preset).
// DSH's services are scripted here; the same flow against a real DSH is in tests/e2e/intake.e2e.test.ts.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSourceCollector, INTAKE_PREFIX, MAX_RUNS, PROMPT_VERSION, readsOnly } from '../host/assistant/home/source-collector.mjs';
import { COLLECTOR_SUBMIT } from '../host/assistant/inbox/submission.mjs';

const SOURCE: any = { id: 'lark', name: 'lark', prompt: '收集 lark 中与我相关的消息' };
const records = (...ids: string[]) => JSON.stringify({ ok: true, records: ids.map((id) => ({ id, title: `消息 ${id}`, text: id })) });

/** DSH as far as the collector touches it. `answers`: what each turn says (a string), how it fails ({ error }), or that it never ends ('hang'). */
function world(answers: any[], { listed = [] as string[], folded = [] as string[], tools = null as null | { name: string; readOnly?: boolean; writes?: boolean }[] } = {}) {
  const stored = new Map<string, any[]>(); // session id -> its events
  const live = new Map<string, any>();
  const log: any = { created: [], resumed: [], archived: [], cancelled: [], mounted: 0, access: [], prompts: [], disposed: 0, setups: [], receipts: [] };
  const queue = [...answers];
  const handleFor = async (id: string, setup: any) => {
    const events = stored.get(id)!;
    const agent: any = {
      status: 'idle', done: null as null | Promise<void>, finish: null as null | (() => void),
      session: { id, get seq() { return events.length; }, snapshotEvents: () => [...events], append: (type: string, data: any) => events.push({ type, data, seq: events.length }) },
      whenIdle: () => agent.done ?? Promise.resolve(),
    };
    live.set(id, agent);
    const calls: any = { presented: 0, suppressed: 0, hooks: [], handlers: {}, restricted: null, guard: null, registered: [] };
    log.setups.push(calls);
    await setup({
      tools: { presentAs: () => { calls.presented++; }, register: (tool: any) => { calls.registered.push(tool); }, restrict: (rule: any) => { calls.restricted = rule; }, guard: (check: any) => { calls.guard = check; } },
      systemPrompt: { suppressRuntimeContext: () => { calls.suppressed++; }, variable() {} },
      on: (name: string, handler: any) => { calls.hooks.push(name); calls.handlers[name] = handler; },
    }, agent);
    return { agent, dispose: async () => { log.disposed++; live.delete(id); } };
  };
  const ctx: any = {
    ...(tools ? { tools: { schemas: () => tools.map(({ name }) => ({ name })), get: (name: string) => { const tool = tools.find((item) => item.name === name); return { annotations: tool?.readOnly ? { readOnlyHint: true } : tool?.writes ? { readOnlyHint: false } : {} }; } } } : {}),
    sessionController: {
      modelCatalog: async () => ({ default: { provider: 'deepseek-official', model: 'deepseek-flash' }, groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] }),
      async prompt({ sessionId, content }: any) {
        const events = stored.get(sessionId)!;
        const agent = live.get(sessionId);
        log.prompts.push({ sessionId, text: content[0].text });
        events.push({ type: 'turn/start', data: {}, seq: events.length });
        agent.status = 'running';
        agent.done = new Promise<void>((resolve) => { agent.finish = () => { agent.status = 'idle'; resolve(); }; });
        const answer = queue.shift();
        if (answer === 'hang') return { accepted: true };
        const submit = log.setups.at(-1).registered.find((tool: any) => tool.name === COLLECTOR_SUBMIT);
        if (typeof answer === 'function') await answer(submit, log);
        else if (typeof answer === 'string') {
          log.receipts.push(JSON.parse(await submit.execute(JSON.parse(answer))));
          events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Submitted.' }] } }, seq: events.length });
        }
        events.push({ type: 'turn/end', data: { reason: answer?.error ? { kind: 'error', error: { message: answer.error } } : { kind: 'completed' } }, seq: events.length });
        agent.finish();
        return { accepted: true };
      },
      async cancel({ sessionId }: any) {
        log.cancelled.push(sessionId);
        const events = stored.get(sessionId)!;
        events.push({ type: 'turn/end', data: { reason: { kind: 'aborted' } }, seq: events.length });
        live.get(sessionId)?.finish?.();
      },
      list: async () => ({ items: [...listed, ...stored.keys()].map((sessionId) => ({ sessionId })) }),
    },
    agents: {
      async create({ sessionId, setup }: any) { stored.set(sessionId, []); log.created.push(sessionId); return handleFor(sessionId, setup); },
      async resume({ resumeSessionId, setup }: any) {
        if (!stored.has(resumeSessionId)) throw new Error('There is no such session.');
        log.resumed.push(resumeSessionId);
        return handleFor(resumeSessionId, setup);
      },
    },
    agentPresets: { mount: async () => { log.mounted++; return { id: 'standard' }; } },
    sessionProjections: { stateOf: () => undefined },
    permissionPresets: { set: (_session: any, mode: string) => { log.access.push(mode); }, catalog: () => ({ defaultOptions: [{ value: 'read-only' }, { value: 'workspace-write' }, { value: 'danger-full-access' }] }) },
    workspaceRegistry: {
      archiveSession: async (id: string) => { log.archived.push(id); folded.push(id); },
      get archivedSessionIds() { return folded; },
    },
    sessionPersistence: {
      stat: async (id: string) => {
        if (!stored.has(id)) throw Object.assign(new Error('not found'), { name: 'SessionPersistenceNotFoundError' });
        return {};
      },
    },
  };
  return { ctx, log, stored, left: () => queue.length };
}

function folder(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-collect-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const make = (ctx: any, dir: string, options: any = {}) => {
  const service = createSourceCollector(ctx, { folder: () => dir, file: join(dir, 'collect-sessions.json'), warn: () => {}, ...options });
  const submit = options.submit ?? (async (raw: any[]) => ({ ok: true, added: raw.length }));
  return Object.assign((source: any, input: any = {}) => service(source, { submit, ...input }), {
    fill: (source: any, record: any, input: any = {}) => service.fill(source, record, { submit, ...input }),
    tidy: service.tidy,
  });
};

test('a connector is collected in one session, opened again for each collection', async (t) => {
  const dir = folder(t);
  const dsh = world([records('a'), records('b')]);
  const collect = make(dsh.ctx, dir);
  const first = await collect(SOURCE, { since: null });
  const second = await collect(SOURCE, { since: 1_793_000_000_000 });
  assert.deepEqual(first.records.map((record: any) => record.id), ['a']);
  assert.deepEqual(second.records.map((record: any) => record.id), ['b'], 'the answer of this collection, not of the one before');
  assert.equal(dsh.log.created.length, 1);
  assert.deepEqual(dsh.log.resumed, dsh.log.created, 'the second collection resumed the session the first one made');
  assert.ok(dsh.log.created[0].startsWith(INTAKE_PREFIX));
  assert.equal(dsh.log.archived.length, 0);
  assert.equal(dsh.log.disposed, 2, 'the agent is let go of after each collection; the session stays');
  assert.match(dsh.log.prompts[1].text, /Last collection: 2026-/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'collect-sessions.json'), 'utf8')).sessions.lark.runs, 2);
});

// 2026-11-27: every collection began by asking DSH for its whole model catalog, which asks every harness too, and Antigravity left a conversation behind each time (the owner's
// collector runs every five minutes). 嘟嘟's model is saved in its settings; a collection uses that and asks for nothing.
test('a collection runs on the model saved for 嘟嘟 and asks for no catalog; with none saved it picks one of the plain routes', async (t) => {
  const dir = folder(t);
  const dsh = world([records('a'), records('b')]);
  let asked = 0;
  const opened: any[] = [];
  const create = dsh.ctx.agents.create;
  dsh.ctx.agents.create = async (input: any) => { opened.push(input.agentOptions); return create(input); };
  dsh.ctx.sessionController.modelCatalog = async () => {
    asked++;
    return { default: { provider: 'claude', model: 'default' }, groups: [{ id: 'claude', models: [{ id: 'default' }] }, { id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }] };
  };
  const saved = make(dsh.ctx, dir, { model: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }) });
  assert.deepEqual((await saved(SOURCE, { since: null })).records.map((record: any) => record.id), ['a']);
  assert.equal(asked, 0, 'no catalog was asked for');
  assert.deepEqual(opened, [{ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' }]);
  const none = make(dsh.ctx, folder(t));
  assert.deepEqual((await none({ ...SOURCE, id: 'other' }, { since: null })).records.map((record: any) => record.id), ['b']);
  assert.equal(asked, 1);
  assert.deepEqual(opened[1], { provider: 'deepseek-official', model: 'deepseek-flash' }, 'DSH\'s default is a harness: the first plain model is taken');
});

test('the agent preset is mounted, so that the skills of the machine can be read, and the session stays read only', async (t) => {
  const dsh = world([records('a'), records('b')]);
  const collect = make(dsh.ctx, folder(t));
  await collect(SOURCE);
  await collect(SOURCE);
  assert.equal(dsh.log.mounted, 2, 'mounted when the session is made and again when it is resumed');
  assert.deepEqual(dsh.log.access, ['read-only', 'read-only']);
  for (const setup of dsh.log.setups) assert.ok(setup.hooks.includes('system-prompt/assemble') && setup.hooks.includes('approval/request'));
});

test('another session takes over after MAX_RUNS collections, and the old one is folded away', async (t) => {
  assert.ok(MAX_RUNS >= 10);
  const dsh = world([records('a'), records('b'), records('c')]);
  const collect = make(dsh.ctx, folder(t), { maxRuns: 2 });
  await collect(SOURCE);
  await collect(SOURCE);
  assert.equal(dsh.log.created.length, 1);
  await collect(SOURCE);
  assert.equal(dsh.log.created.length, 2);
  assert.notEqual(dsh.log.created[0], dsh.log.created[1]);
  assert.deepEqual(dsh.log.archived, [dsh.log.created[0]]);
});

test('a connector has a session of its own', async (t) => {
  const dsh = world([records('a'), records('b'), records('c')]);
  const collect = make(dsh.ctx, folder(t));
  await collect(SOURCE);
  await collect({ ...SOURCE, id: 'mail', name: 'mail' });
  await collect(SOURCE);
  assert.equal(dsh.log.created.length, 2);
  assert.deepEqual(dsh.log.resumed, [dsh.log.created[0]]);
});

test('a source that cannot be read keeps the session; a turn that failed does not', async (t) => {
  const dsh = world([JSON.stringify({ ok: false, error: 'not signed in' }), { error: 'The model call failed.' }, records('a'), records('b')]);
  const collect = make(dsh.ctx, folder(t));
  await assert.rejects(collect(SOURCE), /not signed in/);
  await assert.rejects(collect(SOURCE), /The model call failed/);
  assert.equal(dsh.log.created.length, 1, 'the model answered the first time: the same session served the second');
  assert.equal(dsh.log.archived.length, 0);
  await collect(SOURCE);
  assert.equal(dsh.log.created.length, 2, 'after a turn that failed, the next collection starts another session');
  assert.deepEqual(dsh.log.archived, [dsh.log.created[0]]);
  await collect(SOURCE);
  assert.equal(dsh.log.created.length, 2);
});

test('a collection that is stopped cancels its turn and is not used again', async (t) => {
  const dsh = world(['hang', records('a')]);
  const collect = make(dsh.ctx, folder(t));
  const stop = new AbortController();
  const pending = collect(SOURCE, { signal: stop.signal });
  const started = Date.now();
  while (dsh.log.prompts.length === 0) {
    if (Date.now() - started > 2000) assert.fail('the collection never asked');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  stop.abort(new Error('The collection did not finish in 10 minutes.'));
  await assert.rejects(pending, /did not finish/);
  assert.deepEqual(dsh.log.cancelled, [dsh.log.created[0]]);
  assert.equal(dsh.log.disposed, 1);
  await collect(SOURCE);
  assert.equal(dsh.log.created.length, 2);
  assert.deepEqual(dsh.log.archived, [dsh.log.created[0]]);
});

test('a session that cannot be opened again is replaced', async (t) => {
  const dir = folder(t);
  const first = world([records('a')]);
  await make(first.ctx, dir)(SOURCE);
  // DSH no longer has the session (it was removed): the file still names it
  const second = world([records('b')]);
  second.stored.set(first.log.created[0], []); // known to the persistence, but not resumable
  second.ctx.agents.resume = async () => { throw new Error('damaged'); };
  const result = await make(second.ctx, dir)(SOURCE);
  assert.deepEqual(result.records.map((record: any) => record.id), ['b']);
  assert.deepEqual(second.log.archived, [first.log.created[0]]);
  assert.equal(second.log.created.length, 1);
  assert.notEqual(second.log.created[0], first.log.created[0]);
});

test('the file remembers the session across restarts', async (t) => {
  const dir = folder(t);
  const dsh = world([records('a'), records('b')]);
  await make(dsh.ctx, dir)(SOURCE);
  await make(dsh.ctx, dir)(SOURCE);
  assert.equal(dsh.log.created.length, 1);
  assert.equal(dsh.log.resumed.length, 1);
});

test('tidy folds away only the collection sessions made before, and leaves every other session alone', async (t) => {
  const dsh = world([records('a')], {
    listed: [`${INTAKE_PREFIX}old-1`, `${INTAKE_PREFIX}old-2`, `${INTAKE_PREFIX}old-3`, 'dudu-assistant-0000conversation', 'dsh-session', `${INTAKE_PREFIX}old-3b`],
    folded: [`${INTAKE_PREFIX}old-3`],
  });
  const collect = make(dsh.ctx, folder(t));
  await collect(SOURCE);
  const kept = dsh.log.created[0];
  assert.equal(await collect.tidy(), 3);
  assert.deepEqual(dsh.log.archived.sort(), [`${INTAKE_PREFIX}old-1`, `${INTAKE_PREFIX}old-2`, `${INTAKE_PREFIX}old-3b`].sort());
  assert.ok(!dsh.log.archived.includes(kept), 'the session of the connector stays where it is');
  assert.equal(await collect.tidy(), 0, 'nothing is left to put away the second time');
});

test('the question names the collector, the connector it reads through and what to collect', async (t) => {
  const dsh = world([records('a')]);
  const collect = make(dsh.ctx, folder(t));
  await collect({ ...SOURCE, name: '飞书 @我', prompt: '收集 @ 我的消息。', via: { id: 'acc', name: '飞书', kind: 'prompt', prompt: '用 lark CLI 读，我已经登录好了。', server: '' } }, { since: null });
  // all of it: the owner's words (the connector's and the collector's) and when it last ran; nothing the collection wrote for itself is added to it
  assert.equal(dsh.log.prompts[0].text, 'Collector: 飞书 @我\nConnector: 飞书.\nHow to reach the service:\n用 lark CLI 读，我已经登录好了。\n\nWhat to collect:\n收集 @ 我的消息。\n\nLast collection: first collection\nCollect what is new or changed since then.');
  // a connector with no prompt yet (one made when the two were one) leaves that part out; a collector with no connector at all still asks
  const bare = world([records('b'), records('c')]);
  const again = make(bare.ctx, folder(t));
  await again({ ...SOURCE, via: { id: 'acc', name: '飞书', kind: 'prompt', prompt: '', server: '' } });
  await again({ ...SOURCE, id: 'other' });
  assert.match(bare.log.prompts[0].text, /^Collector: lark\nConnector: 飞书\.\n\nWhat to collect:\n收集 lark/);
  assert.match(bare.log.prompts[1].text, /^Collector: lark\nWhat to collect:\n收集 lark/);
});

test('more context for a record is asked of the collector\'s own session, with what is kept of the record and how to read more of it; it is not a collection', async (t) => {
  const dsh = world([records('a'), records('b')]);
  const collect = make(dsh.ctx, folder(t));
  await collect.fill({ ...SOURCE, name: '飞书 @我' }, { id: 143, sourceId: 'thread:omt_1', title: '@我 · Project Channel', from: 'Frank Wang', at: Date.UTC(2026, 10, 10, 20, 7), thread: 'omt_1', url: 'https://x.test/t', text: '11-11 04:07 Frank Wang：@我', more: 'lark-cli im +threads-messages-list --thread omt_1' });
  const asked = dsh.log.prompts[0].text as string;
  assert.match(asked, /^Collector: 飞书 @我\n/);
  assert.match(asked, /- thread: omt_1\n- link: https:\/\/x\.test\/t/);
  assert.match(asked, /Frank Wang：@我/);
  assert.match(asked, /how to read more of it: lark-cli im \+threads-messages-list --thread omt_1/);
  assert.doesNotMatch(asked, /Last collection/);
  assert.match(asked, /one record for each message of that conversation/);
  // Any other row (a mail, a message that came with no thread) is asked for the item again with its context, as one record: that is what the inbox keeps for it.
  await collect.fill({ ...SOURCE, name: '飞书 @我' }, { id: 7, sourceId: 'om_42', title: '单聊', from: 'Alice', text: '好的', more: 'lark-cli im +chat-messages-list --chat-id oc_1' });
  assert.match(dsh.log.prompts[1].text, /holds ONE record: the item itself, the same id and the same words, with its context filled in/);
  assert.doesNotMatch(dsh.log.prompts[1].text, /one record for each message/);
});

test('what the model is told: to give only what the prompt names, and no notes to write: a collection hands back records and nothing else', async (t) => {
  const dsh = world([records('a')]);
  await make(dsh.ctx, folder(t))(SOURCE);
  const [setup] = dsh.log.setups;
  const told = (await setup.handlers['system-prompt/assemble']({}, {}, async () => ({ sections: [], contexts: [] }))).sections[0].text as string;
  assert.doesNotMatch(told, /notes/i, 'nothing is asked for, and nothing is said of notes');
  assert.doesNotMatch(told, /may not write files/, 'what is written is the tools\' own: a login they renew, temporary files');
  assert.match(told, /except what the tools you use write for themselves/);
  assert.match(told, /an item that does not match is left out/);
  assert.match(told, /"especially" or "mainly"/);
  assert.match(told, /When you cannot tell whether an item matches, leave it out/);
  assert.match(told, /Submit the result with collector_submit/);
  // A legacy prose answer, even valid JSON, cannot claim it saved anything.
  const chatty = world([async (_submit: any, log: any) => { log.prose = records('a'); }]);
  await assert.rejects(make(chatty.ctx, folder(t))(SOURCE), /no usable source records/);
});

test('a collection runs with the permission the owner chose for 嘟嘟\'s sessions when DSH offers it, and read only otherwise', async (t) => {
  const run = async (permission: any, mutate: (ctx: any) => void = () => {}) => {
    const dsh = world([records('a')]);
    mutate(dsh.ctx);
    await make(dsh.ctx, folder(t), { permission })(SOURCE);
    return dsh.log.access;
  };
  assert.deepEqual(await run(undefined), ['read-only'], 'nothing chosen: read only');
  assert.deepEqual(await run(() => 'read-only'), ['read-only']);
  assert.deepEqual(await run(() => 'danger-full-access'), ['danger-full-access'], 'the owner gives full access: so does the collection');
  assert.deepEqual(await run(() => 'workspace-write'), ['workspace-write']);
  assert.deepEqual(await run(() => 'a-preset-DSH-does-not-have'), ['read-only'], 'a name DSH does not offer is not used');
  assert.deepEqual(await run(() => 'danger-full-access', (ctx) => { ctx.permissionPresets.catalog = () => { throw new Error('no list'); }; }), ['read-only'], 'no list from DSH: read only');
  assert.deepEqual(await run(() => { throw new Error('settings are not open yet'); }), ['read-only'], 'settings that cannot be read: read only');
});

test('a session that was told the old way is not used again: the next collection starts another, and the file remembers which words a session was made with', async (t) => {
  const dir = folder(t);
  const first = world([records('a')]);
  await make(first.ctx, dir)(SOURCE);
  const file = join(dir, 'collect-sessions.json');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).sessions.lark.v, PROMPT_VERSION);
  // the file as an earlier plugin wrote it: no word of which question it asked, and a conversation that holds that question
  const old = JSON.parse(readFileSync(file, 'utf8'));
  delete old.sessions.lark.v;
  writeFileSync(file, JSON.stringify(old));
  const second = world([records('b'), records('c')]);
  second.stored.set(first.log.created[0], []);
  const collect = make(second.ctx, dir);
  assert.deepEqual((await collect(SOURCE) as any).records.map((record: any) => record.id), ['b']);
  assert.equal(second.log.resumed.length, 0, 'the old conversation is not opened');
  assert.deepEqual(second.log.archived, [first.log.created[0]], 'and it is put away');
  assert.equal(second.log.created.length, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).sessions.lark.v, PROMPT_VERSION);
  // the new one is used again, as before
  await collect(SOURCE);
  assert.equal(second.log.created.length, 1);
  assert.deepEqual(second.log.resumed, second.log.created);
});

test('which tools of an MCP server a collection may call: the annotation when DSH has it, otherwise a name that reads and says nothing of changing', () => {
  // DSH does not carry a server's own readOnlyHint into its registry (checked on a real DSH), so the name decides when the annotation is not there.
  for (const name of ['search', 'fetch', 'get-comments', 'notion-get-users', 'list_issues', 'getIssue', 'query-data-sources', 'view-version', 'memory-search']) assert.equal(readsOnly(name), true, name);
  for (const name of ['create-pages', 'update-page', 'delete-databases', 'send-message-to-session', 'add_issue_comment', 'search-and-save', 'get_or_create', 'wait-session', 'run', 'draft', '']) assert.equal(readsOnly(name), false, name);
  assert.equal(readsOnly('draft', { readOnlyHint: true }), true, 'what the server says of itself counts when DSH has it');
  assert.equal(readsOnly('search', { readOnlyHint: false }), false, 'and so does its saying that a tool changes something');
  assert.equal(readsOnly('search', { destructiveHint: true }), false);
});

test('a collector that reads through an MCP connector is given the tools of the server 嘟嘟 connected that read, and nothing else, and the server is closed after it', async (t) => {
  const closed: string[] = [];
  const calls: any[] = [];
  const connections = () => ({
    session: async (id: string) => ({
      tools: [
        { name: 'search', description: 'finds', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
        { name: 'get-comments', description: 'reads', inputSchema: { type: 'object' }, annotations: {} },
        { name: 'create-pages', description: 'makes', inputSchema: { type: 'object' }, annotations: {} },
        { name: 'search-and-save', description: 'both', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
        { name: 'wait.session now', description: 'waits', inputSchema: { type: 'object' }, annotations: {} },
        { name: 'x'.repeat(80), description: 'long', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      ],
      call: async (name: string, args: any) => { calls.push([id, name, args]); return { isError: false, content: [{ type: 'text', text: `${name} done` }] }; },
      close: async () => { closed.push(id); },
    }),
  });
  const dsh = world([records('a')]);
  const collect = make(dsh.ctx, folder(t), { connections });
  await collect({ ...SOURCE, via: { id: 'notion', name: 'Notion', kind: 'mcp', prompt: '', server: '', spec: { url: 'https://mcp.notion.com/mcp' } } });
  const [setup] = dsh.log.setups;
  const names = setup.registered.map((tool: any) => tool.name).filter((name: string) => name !== COLLECTOR_SUBMIT);
  assert.deepEqual(names.slice(0, 2), ['mcp__notion__search', 'mcp__notion__get-comments'], 'a tool that reads by its annotation or by its name');
  assert.equal(names.length, 3);
  assert.ok(names[2].length <= 64 && /^mcp__notion__x+_[0-9a-f]{8}$/.test(names[2]), 'a name that is too long keeps its start and gets a hash');
  assert.deepEqual(setup.restricted, { allow: [] }, 'every global tool of DSH is hidden: DSH masks global tools only, and what the session registered stays visible');
  assert.equal(setup.guard({ name: 'mcp__notion__search' }), undefined);
  assert.equal(setup.guard({ name: COLLECTOR_SUBMIT }), undefined);
  for (const name of ['mcp__notion__create-pages', 'mcp__notion__search-and-save', 'mcp__github__search', 'bash']) assert.match(setup.guard({ name }), /only read through its MCP server/, name);
  assert.match(dsh.log.prompts[0].text, /Read through its MCP tools, named mcp__notion__/);
  assert.deepEqual(dsh.log.access, ['read-only'], 'and the session stays read only');
  assert.equal(await setup.registered.find((tool: any) => tool.name === 'mcp__notion__search').execute({ q: 'x' }), 'search done');
  assert.deepEqual(calls, [['notion', 'search', { q: 'x' }]]);
  assert.deepEqual(closed, ['notion'], 'the connection to the server ends with the collection');

  // a server with no tool that reads fails the collection with the reason; no question is asked, and the connection is closed
  const shut: string[] = [];
  const none = world([records('b')]);
  const nothing = () => ({ session: async () => ({ tools: [{ name: 'create-pages', description: '', inputSchema: { type: 'object' }, annotations: {} }], call: async () => ({}), close: async () => { shut.push('closed'); } }) });
  await assert.rejects(make(none.ctx, folder(t), { connections: nothing })({ ...SOURCE, via: { id: 'n', name: 'Notion', kind: 'mcp', prompt: '', server: '', spec: { url: 'https://mcp.notion.com/mcp' } } }), /MCP server "Notion" has no tool that reads/);
  assert.deepEqual([none.log.prompts.length, shut], [0, ['closed']]);
  // a connector that cannot be reached says why
  const down = world([records('c')]);
  await assert.rejects(make(down.ctx, folder(t), { connections: () => ({ session: async () => { throw new Error('Unauthorized'); } }) })({ ...SOURCE, via: { id: 'n', name: 'Notion', kind: 'mcp', prompt: '', server: '', spec: {} } }), /Unauthorized/);
  await assert.rejects(make(down.ctx, folder(t), { connections: () => null })({ ...SOURCE, via: { id: 'n', name: 'Notion', kind: 'mcp', prompt: '', server: '', spec: {} } }), /connectors are not available/);
  // a prompt connector is not limited
  const free = world([records('d')]);
  await make(free.ctx, folder(t))({ ...SOURCE, via: { id: 'a', name: '飞书', kind: 'prompt', prompt: 'x', server: '' } });
  assert.equal(free.log.setups[0].restricted, null);
});

test('submission errors reach the model for correction, success is a committed receipt, and duplicate calls do not write again', async (t) => {
  let writes = 0;
  const dsh = world([async (tool: any) => {
    assert.equal(JSON.parse(await tool.execute('{"ok":true,"records":[')).code, 'invalid_arguments', 'a malformed string is rejected without repairing or storing it');
    assert.equal(JSON.parse(await tool.execute({ ok: true, records: [{ id: 'a', title: 't', collector: 'another' }] })).code, 'invalid_arguments');
    const first = JSON.parse(await tool.execute(JSON.parse(records('a'))));
    assert.deepEqual(first, { ok: false, code: 'storage_failed' });
    const saved = JSON.parse(await tool.execute(JSON.parse(records('a'))));
    assert.deepEqual(saved, { ok: true, recordIds: [7], added: 1 });
    assert.deepEqual(JSON.parse(await tool.execute(JSON.parse(records('different')))), saved, 'one accepted result per turn');
  }]);
  const result = await make(dsh.ctx, folder(t), {
    submit: async () => (++writes === 1 ? { ok: false, code: 'storage_failed' } : { ok: true, recordIds: [7], added: 1 }),
  })(SOURCE);
  assert.equal(writes, 2, 'invalid arguments never reach the write service');
  assert.equal(result.records[0].id, 'a');
  const tool = dsh.log.setups[0].registered.find((item: any) => item.name === COLLECTOR_SUBMIT);
  assert.equal(JSON.parse(await tool.execute(JSON.parse(records('late')))).code, 'collection_stopped', 'released scopes cannot write later');
});
