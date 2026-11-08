// The board and the Collector as the phone asks for them (host/native-board.mjs), over the real issues store and the real inbox API: the rows are plain and small, a record
// made into an issue is linked to it, the owner's marks work in bulk, and a badly formed request is refused the way the bridge refuses it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInboxApi } from '../host/assistant/inbox/api.mjs';
import { normalizeRecords } from '../host/assistant/inbox/records.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssuesApi } from '../host/assistant/issues/api.mjs';
import { NATIVE_METHODS, createNativeBridge } from '../host/native-bridge.mjs';
import { createNativeBoard, NATIVE_BOARD_METHODS } from '../host/native-board.mjs';

const NOW = new Date(2026, 10, 7, 12).getTime();
const fail = (code: string) => { throw Object.assign(new Error(code), { code }); };
const raw = (id: string, extra: any = {}) => ({ id, title: `来信 ${id}`, text: `${id} 的原文`, from: 'Alice', url: `https://mail.test/${id}`, ...extra });

function world(t: any, { onResume, onAssign, projects }: { onResume?: (issue: any) => unknown; onAssign?: (issue: any) => unknown; projects?: any } = {}) {
  const issues = createIssues({ file: ':memory:', now: () => NOW });
  t.after(() => issues.close());
  const api = createIssuesApi({ issues, onResume, onAssign });
  const via = new Map([['lark', { id: 'lark-cli', via: 'lark' }]]);
  const collectors = () => ({ resolve: () => ({ outcome: 'success', collectors: [{ id: 'lark', name: '飞书', via: via.get('lark') }, { id: 'mail', name: '邮箱', via: null }] }) });
  const inbox = createInboxApi({ issues, collectors, now: () => NOW, forward: async () => ({ outcome: 'success' }) });
  const board = createNativeBoard({ issues: (action: string, body: any) => api.execute(action, body), inbox: (action: string, body: any) => inbox.execute(action, body), projects, fail });
  const ingest = (connector: string, list: any[]) => issues.inbox.ingest(connector, normalizeRecords(list).records).added;
  const call = (method: string, params: any = {}) => board.dispatch(method, params);
  return { issues, api, inbox, call, ingest };
}

const GROUPS = (answer: any) => Object.fromEntries(answer.groups.map((group: any) => [group.key, group.items.map((item: any) => item.title)]));

test('the phone can ask for every one of these methods, and the bridge knows them', () => {
  for (const method of NATIVE_BOARD_METHODS) assert.ok(NATIVE_METHODS.includes(method), method);
  assert.deepEqual([...NATIVE_BOARD_METHODS], [
    'board.list', 'issue.get', 'issue.open', 'issue.pick', 'issue.options', 'issue.parents', 'issue.project.create', 'issue.label.create', 'issue.create',
    'inbox.list', 'inbox.get', 'inbox.mark', 'inbox.share',
  ]);
});

test('the board: the issues of a tab grouped by what their agent is doing, each row small and plain, with the session the phone can open', async (t) => {
  const { issues, call } = world(t);
  const working = issues.add({ title: '写 skills', project: { name: 'ai', path: '/p/ai' }, agent: 'codex', session: 'dsh:s1', priority: 'high', dueAt: NOW + 86_400_000, brief: '很长的描述' }, { actor: 'owner' }).issue;
  const asking = issues.add({ title: '漏洞', project: { name: 'hs', path: '/p/hs' }, agent: 'claude', session: 'dsh:s2' }, { actor: 'owner' }).issue;
  issues.update(asking.id, { agentState: 'blocked' }, { actor: 'owner' });
  issues.update(working.id, { agentState: 'idle' }, { actor: 'owner' });
  issues.add({ title: '还没分配' }, { actor: 'owner' });
  issues.add({ title: '待规划的', status: 'backlog' }, { actor: 'owner' });

  const answer: any = await call('board.list', { tab: 'active' });
  assert.equal(answer.outcome, 'success');
  assert.deepEqual(GROUPS(answer), { blocked: ['漏洞'], idle: ['写 skills'], unassigned: ['还没分配'] });
  const row = answer.groups.find((group: any) => group.key === 'idle').items[0];
  assert.deepEqual(Object.keys(row).sort(), ['agent', 'agentState', 'dueAt', 'id', 'priority', 'project', 'ref', 'sessionId', 'status', 'statusType', 'title', 'updatedAt'].sort());
  assert.equal(row.sessionId, 's1');
  assert.equal(row.project, 'ai');
  assert.equal(JSON.stringify(answer).includes('很长的描述'), false, 'no description on a row');
  assert.equal(answer.groups.find((group: any) => group.key === 'unassigned').items[0].sessionId, undefined);

  assert.deepEqual(GROUPS(await call('board.list', { tab: 'backlog' })), { unassigned: ['待规划的'] });
  const all: any = await call('board.list', { tab: 'all' });
  assert.equal(all.total, 4);
});

test('a group has pages: the next page of one group, by its cursor', async (t) => {
  const { issues, call } = world(t);
  for (let n = 0; n < 60; n++) issues.add({ title: `事项 ${n}` }, { actor: 'owner' });
  const first: any = await call('board.list', { tab: 'active' });
  const group = first.groups.find((item: any) => item.key === 'unassigned');
  assert.equal(group.items.length, 50);
  assert.equal(group.count, 60);
  assert.ok(group.nextCursor);
  const next: any = await call('board.list', { tab: 'active', groupKey: 'unassigned', cursor: group.nextCursor });
  assert.equal(next.groups.length, 1);
  assert.equal(next.groups[0].items.length, 10);
  assert.equal(next.groups[0].nextCursor, null);
  const seen = new Set([...group.items, ...next.groups[0].items].map((item: any) => item.id));
  assert.equal(seen.size, 60, 'no row twice');
  await assert.rejects(call('board.list', { tab: 'active', groupKey: 'nowhere', cursor: 'x' }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('board.list', { tab: 'wishes' }), { code: 'BAD_REQUEST' });
});

test('one issue with its description, and opening it brings back the session it holds', async (t) => {
  const resumed: number[] = [];
  const { issues, call } = world(t, { onResume: (issue: any) => { resumed.push(issue.id); return { outcome: 'success' }; } });
  const issue = issues.add({ title: '读资料', brief: '先读第一章', project: { name: 'ai', path: '/p/ai' }, agent: 'claude', session: 'dsh:abc' }, { actor: 'owner' }).issue;
  const bare = issues.add({ title: '没有会话' }, { actor: 'owner' }).issue;
  const got: any = await call('issue.get', { id: issue.id });
  assert.equal(got.issue.description, '先读第一章');
  assert.equal(got.issue.hasSession, true);
  assert.equal((await call('issue.get', { id: bare.id }) as any).issue.hasSession, false);
  assert.notEqual((await call('issue.get', { id: 9999 }) as any).outcome, 'success', 'there is no such issue');

  assert.deepEqual(await call('issue.open', { id: issue.id }), { outcome: 'success', sessionId: 'abc' });
  assert.deepEqual(resumed, [issue.id], 'it was put back in DSH\'s sidebar');
  assert.deepEqual(await call('issue.open', { id: bare.id }), { outcome: 'success', sessionId: null });
  await assert.rejects(call('issue.open', { id: 'one' }), { code: 'BAD_REQUEST' });
});

test('the open issues for sharing: the one touched last first, only those with a session when sharing to a session, nothing finished', async (t) => {
  const { issues, call } = world(t);
  const a = issues.add({ title: '甲', project: { name: 'ai', path: '/p/ai' }, agent: 'claude', session: 'dsh:a' }, { actor: 'owner' }).issue;
  issues.add({ title: '乙' }, { actor: 'owner' });
  const done = issues.add({ title: '丙' }, { actor: 'owner' }).issue;
  issues.complete(done.id, { outcome: 'ok', actor: 'owner' });
  const all: any = await call('issue.pick');
  assert.deepEqual(all.items.map((item: any) => item.title).sort(), ['乙', '甲']);
  const withSession: any = await call('issue.pick', { withSession: true });
  assert.deepEqual(withSession.items.map((item: any) => item.id), [a.id]);
});

test('a new issue from the phone has a title and may have a description; one made of a record is marked with its source and the record is linked to it', async (t) => {
  const { issues, call, ingest } = world(t);
  const made: any = await call('issue.create', { title: '  回电话  ', description: '周五前' });
  assert.equal(made.outcome, 'success');
  assert.equal(made.issue.title, '回电话');
  assert.equal(issues.get(made.issue.id).issue.brief, '周五前');
  await assert.rejects(call('issue.create', { title: '   ' }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('issue.create', { title: 'x', description: 5 }), { code: 'BAD_REQUEST' });

  const [record] = ingest('lark', [raw('a', { title: '补两张票据' })]);
  const fromRecord: any = await call('issue.create', { title: '补两张票据', record: record.id });
  assert.equal(fromRecord.outcome, 'success');
  const stored = issues.get(fromRecord.issue.id).issue;
  assert.equal(stored.source, 'connector');
  assert.equal(stored.sourceRef, 'lark:a');
  const handled: any = await call('inbox.list', { tab: 'done' });
  assert.deepEqual(handled.items.map((card: any) => card.title), ['补两张票据']);
  assert.equal(handled.items[0].issue.id, fromRecord.issue.id);
  assert.equal((await call('issue.create', { title: 'x', record: 4242 }) as any).outcome, 'needs_clarification');
});

test('phone creation reads the real default and custom statuses and saves Desktop values without moving the workflow when assigning', async (t) => {
  const assigned: number[] = [];
  const project = { name: 'Dudu', path: '/p/dudu' };
  const { issues, call, ingest } = world(t, {
    projects: { list: () => ({ outcome: 'success', projects: [{ id: 'w1', ...project }] }) },
    onAssign: (issue: any) => { assigned.push(issue.id); },
  });
  const custom = issues.statusAdd({ name: '调研', category: 'backlog', color: '#123456' }).status;
  issues.statusUpdate(custom.id, { isDefault: true });
  const label: any = await call('issue.label.create', { name: '手机', color: 'teal' });
  assert.equal(label.outcome, 'success');
  const parent = issues.add({ title: '原生 App', status: 'done' }, { actor: 'owner' }).issue;
  const options: any = await call('issue.options');
  assert.equal(options.statuses.find((entry: any) => entry.isDefault).id, custom.id);
  assert.equal(options.statuses.find((entry: any) => entry.id === custom.id).color, '#123456');
  assert.deepEqual(options.projects, [project]);
  assert.deepEqual(options.labels, [label.label]);
  const [record] = ingest('lark', [raw('draft')]);
  const fields = { title: '选择模型', description: '保留来源', project, agent: 'claude', priority: 'high', labels: [label.label.id], parent: parent.id, dueAt: NOW + 86_400_000, record: record.id };
  const made: any = await call('issue.create', fields);
  assert.equal(made.outcome, 'success');
  const stored = issues.get(made.issue.id).issue;
  assert.equal(stored.status, custom.id, 'an omitted status uses the configured new-issue default');
  assert.deepEqual([stored.project, stored.agent, stored.priority, stored.labels, stored.parent.id, stored.dueAt],
    [project, 'claude', 'high', [label.label], parent.id, fields.dueAt]);
  assert.deepEqual([stored.source, stored.sourceRef], ['connector', 'lark:draft']);
  assert.deepEqual(assigned, [made.issue.id], 'the existing Desktop assignment hook runs');
  assert.equal((await call('inbox.list', { tab: 'done' }) as any).items[0].issue.id, made.issue.id);
  const manual: any = await call('issue.create', { ...fields, record: undefined, status: 'backlog', agent: 'codex' });
  assert.equal(manual.issue.status, 'backlog', 'an explicit workflow selection also survives assignment');

  const recent: any = await call('issue.parents');
  assert.ok(recent.items.some((item: any) => item.id === parent.id), 'finished issues can be parents, as on Desktop');
  assert.deepEqual((await call('issue.parents', { q: parent.ref ?? `#${parent.id}` }) as any).items.map((item: any) => item.id), [parent.id]);
});

test('invalid creation choices have no issue, assignment or collector side effects, and cannot inject a session or source', async (t) => {
  let assigned = 0;
  const { issues, call, ingest } = world(t, { onAssign: () => { assigned++; } });
  const [record] = ingest('mail', [raw('safe')]);
  for (const choice of [
    { status: '' }, { priority: 'critical' }, { project: [] }, { project: { name: 'x', path: 42 } },
    { agent: 'some-process' }, { labels: ['1'] }, { labels: Array(51).fill(1) }, { dueAt: -1 }, { dueAt: 1.5 }, { parent: '1' },
  ]) {
    await assert.rejects(call('issue.create', { title: 'x', record: record.id, ...choice }), { code: 'BAD_REQUEST' });
  }
  for (const choice of [{ agent: 'claude' }, { status: 'gone' }, { labels: [4242] }, { parent: 4242 }]) {
    assert.notEqual((await call('issue.create', { title: 'x', record: record.id, ...choice }) as any).outcome, 'success');
  }
  assert.equal(issues.list({ tab: 'all' }).total, 0);
  assert.equal(assigned, 0);
  assert.equal((await call('inbox.list', { tab: 'todo' }) as any).items.length, 1);
  const made: any = await call('issue.create', { title: 'owner', session: 'dsh:injected', source: 'session', actor: 'dudu' });
  const stored = issues.get(made.issue.id).issue;
  assert.equal(stored.session, null);
  assert.equal(stored.source, 'owner');
});

test('the native bridge wires only explicit project creation, stripping unrelated commands', async () => {
  const seen: any[] = [];
  const bridge = createNativeBridge({
    rpc: { async call() { throw new Error('not a DSH RPC'); }, async open() { throw new Error('no streams'); } } as any,
    board: {
      projects: {
        list: () => ({ outcome: 'success', projects: [] }),
        create: (body: any) => { seen.push(body); return { outcome: 'success', project: { id: 'w', name: 'Work', path: '/work' } }; },
      },
    },
  });
  const params = { name: 'Work', path: '/work', createDirectory: true, deleteDirectory: true, action: 'delete' };
  const owner = { authenticated: true, deviceId: 'owner', closed: false } as any;
  assert.deepEqual(await bridge.dispatch('issue.project.create', params, owner), { outcome: 'success', project: { name: 'Work', path: '/work' } });
  assert.deepEqual(seen, [{ name: 'Work', path: '/work', createDirectory: true }]);
  await assert.rejects(bridge.dispatch('issue.project.create', { path: '/work', createDirectory: 'yes' }, owner), { code: 'BAD_REQUEST' });
  assert.equal(seen.length, 1);
});

test('the Collector: the cards of a tab with the connector\'s icon, a total, a cursor; one record in full with the draft of an issue; a filter by collector', async (t) => {
  const { call, ingest } = world(t);
  ingest('lark', [raw('l1', { title: '飞书来的', from: 'Finance' })]);
  ingest('mail', [raw('m1', { title: '邮箱来的' })]);
  const todo: any = await call('inbox.list', { tab: 'todo' });
  assert.equal(todo.total, 2);
  assert.equal(todo.nextCursor, null);
  assert.deepEqual(todo.names, { lark: '飞书', mail: '邮箱' });
  const lark = todo.items.find((card: any) => card.connector === 'lark');
  assert.equal(lark.connectorIcon, 'lark');
  assert.equal(lark.connectorName, '飞书');
  assert.equal(todo.items.find((card: any) => card.connector === 'mail').connectorIcon, null);
  const only: any = await call('inbox.list', { tab: 'todo', connector: ['mail'] });
  assert.deepEqual(only.items.map((card: any) => card.title), ['邮箱来的']);
  assert.equal(only.total, 2, 'the total is the tab\'s, not the filter\'s');

  const full: any = await call('inbox.get', { id: lark.id });
  assert.equal(full.record.text, 'l1 的原文');
  assert.match(full.draft.brief, /l1 的原文/);
  assert.equal(full.draft.sourceRef, 'lark:l1');
  await assert.rejects(call('inbox.list', { tab: 'later' }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('inbox.get', { id: 0 }), { code: 'BAD_REQUEST' });
  assert.equal((await call('inbox.get', { id: 9999 }) as any).outcome, 'needs_clarification');
});

test('the owner\'s marks work on several records at once, and Restore takes them off', async (t) => {
  const { call, ingest } = world(t);
  const [a, b, c] = ingest('mail', [raw('a'), raw('b'), raw('c')]);
  assert.deepEqual(await call('inbox.mark', { action: 'done', ids: [a.id, b.id] }), { outcome: 'success', changed: 2 });
  assert.deepEqual((await call('inbox.list', { tab: 'todo' }) as any).items.map((card: any) => card.title), ['来信 c']);
  assert.deepEqual((await call('inbox.list', { tab: 'done' }) as any).items.length, 2);
  assert.deepEqual(await call('inbox.mark', { action: 'delete', ids: [c.id] }), { outcome: 'success', changed: 1 });
  assert.equal((await call('inbox.list', { tab: 'todo' }) as any).total, 0);
  assert.deepEqual(await call('inbox.mark', { action: 'restore', ids: [a.id, b.id, c.id] }), { outcome: 'success', changed: 3 });
  assert.equal((await call('inbox.list', { tab: 'todo' }) as any).total, 3);
  assert.deepEqual(await call('inbox.mark', { action: 'ignore', ids: [a.id] }), { outcome: 'success', changed: 1 });
  assert.equal((await call('inbox.mark', { action: 'ignore', ids: [a.id] }) as any).outcome, 'no_op');
  assert.equal((await call('inbox.mark', { action: 'done', ids: [9999] }) as any).outcome, 'needs_clarification');
  await assert.rejects(call('inbox.mark', { action: 'burn', ids: [1] }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('inbox.mark', { action: 'done', ids: [] }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('inbox.mark', { action: 'done', ids: ['1'] }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('inbox.mark', { action: 'done', ids: Array.from({ length: 201 }, (_, i) => i + 1) }), { code: 'BAD_REQUEST' });
});

test('sharing records to an issue, or to the session of one, says which issue and how many', async (t) => {
  const { issues, call, ingest } = world(t);
  const [a, b] = ingest('lark', [raw('a'), raw('b')]);
  const plain = issues.add({ title: '收票据' }, { actor: 'owner' }).issue;
  const withSession = issues.add({ title: '和 agent', project: { name: 'ai', path: '/p/ai' }, agent: 'claude', session: 'dsh:abc' }, { actor: 'owner' }).issue;
  const shared: any = await call('inbox.share', { ids: [a.id], issue: plain.id });
  assert.deepEqual([shared.outcome, shared.changed, shared.issue.id], ['success', 1, plain.id]);
  assert.equal(issues.get(plain.id).log.filter((entry: any) => entry.kind === 'note').length, 1);
  const toSession: any = await call('inbox.share', { ids: [b.id], issue: withSession.id, to: 'session' });
  assert.deepEqual([toSession.outcome, toSession.changed], ['success', 1]);
  const refused: any = await call('inbox.share', { ids: [b.id], issue: plain.id, to: 'session' });
  assert.equal(refused.outcome, 'needs_clarification');
  assert.equal(refused.code, 'no_session');
  await assert.rejects(call('inbox.share', { ids: [a.id], issue: 'x' }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('inbox.share', { ids: [a.id], issue: plain.id, to: 'elsewhere' }), { code: 'BAD_REQUEST' });
});

test('a plugin whose issues are not open yet, and a request that is not an object, are answered the way the bridge answers', async () => {
  const idle = createNativeBoard({ fail });
  await assert.rejects(idle.dispatch('board.list', {}), { code: 'UPSTREAM_UNAVAILABLE' });
  await assert.rejects(idle.dispatch('board.list', null as any), { code: 'BAD_REQUEST' });
  await assert.rejects(idle.dispatch('board.nope', {}), { code: 'UNSUPPORTED' });
  const bridge = createNativeBridge({ rpc: { async call() { return {}; }, async open() { throw new Error('no streams'); } } as any, board: { issues: () => ({ outcome: 'success', items: [], groups: [], total: 0 }), inbox: () => ({ outcome: 'success', items: [], facets: { connector: [] } }) } });
  const connection = { authenticated: true, deviceId: 'd', closed: false } as any;
  assert.deepEqual(await bridge.dispatch('board.list', { tab: 'active' }, connection), { outcome: 'success', tab: 'active', total: 0, groups: [] });
  assert.deepEqual(await bridge.dispatch('inbox.list', { tab: 'todo' }, connection), { outcome: 'success', tab: 'todo', items: [], nextCursor: null, names: {}, total: 0 });
});
