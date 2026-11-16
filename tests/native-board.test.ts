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

function world(t: any, { onResume, onAssign, onDelete, projects, sessionState }: { onResume?: (issue: any) => unknown; onAssign?: (issue: any) => unknown; onDelete?: (issue: any) => unknown; projects?: any; sessionState?: (key: string) => string | null } = {}) {
  const issues = createIssues({ file: ':memory:', now: () => NOW, sessionState });
  t.after(() => issues.close());
  const api = createIssuesApi({ issues, onResume, onAssign, onDelete });
  const via = new Map([['lark', { id: 'lark-cli', via: 'lark' }]]);
  const collectors = () => ({ resolve: () => ({ outcome: 'success', collectors: [{ id: 'lark', name: '飞书', via: via.get('lark') }, { id: 'mail', name: '邮箱', via: null }] }) });
  const inbox = createInboxApi({ issues, collectors, now: () => NOW, forward: async () => ({ outcome: 'success' }), fill: async () => ({ outcome: 'success', added: 0 }) });
  const board = createNativeBoard({ issues: (action: string, body: any) => api.execute(action, body), inbox: (action: string, body: any) => inbox.execute(action, body), projects, fail });
  const ingest = (connector: string, list: any[]) => issues.inbox.ingest(connector, normalizeRecords(list).records).added;
  const call = (method: string, params: any = {}) => board.dispatch(method, params);
  return { issues, api, inbox, call, ingest };
}

const GROUPS = (answer: any) => Object.fromEntries(answer.groups.map((group: any) => [group.key, group.items.map((item: any) => item.title)]));

test('the phone can ask for every one of these methods, and the bridge knows them', () => {
  for (const method of NATIVE_BOARD_METHODS) assert.ok(NATIVE_METHODS.includes(method), method);
  assert.deepEqual([...NATIVE_BOARD_METHODS], [
    'board.list', 'board.pin', 'board.read', 'issue.get', 'issue.delete', 'issue.update', 'issue.assign', 'issue.open', 'issue.pick', 'issue.options', 'issue.parents', 'issue.project.create', 'issue.label.create', 'issue.create',
    'inbox.list', 'inbox.get', 'inbox.mark', 'inbox.share', 'inbox.complete',
  ]);
});

test('the native board reads the computer color with its ordinary list request, without a separate sync command', async () => {
  let color = '#6486b8';
  let reads = 0;
  const bridge = createNativeBridge({
    rpc: { async call() { return {}; }, async open() { throw new Error('no streams'); } } as any,
    board: {
      getNeedsYouColor: () => color,
      issues: (action: string) => {
        assert.equal(action, 'list');
        reads++;
        return { outcome: 'success', groups: [], total: 0 };
      },
    },
  });
  const connection = { authenticated: true, deviceId: 'd', closed: false } as any;
  assert.equal((await bridge.dispatch('board.list', {}, connection) as any).needsYouColor, color);
  color = '#007aff';
  assert.equal((await bridge.dispatch('board.list', {}, connection) as any).needsYouColor, color);
  assert.equal(reads, 2);
});

test('phone issue deletion uses the current preview and session cleanup, preserving the issue on stale tokens or cleanup failure', async (t) => {
  let cleanupFails = true;
  const cleaned: number[] = [];
  const { issues, call } = world(t, { onDelete: (issue: any) => {
    if (cleanupFails) throw new Error('archive unavailable');
    cleaned.push(issue.id);
  } });
  const issue = issues.add({ title: '删除指定事项', brief: '不发给手机的正文', session: 'dsh:delete-me' }).issue;
  const preview: any = await call('issue.delete', { id: issue.id });
  assert.equal(preview.preview, true);
  assert.equal(preview.issue.id, issue.id);
  assert.equal(preview.issue.description, undefined);
  assert.deepEqual(cleaned, []);
  for (const params of [{ id: 0 }, { id: issue.id, token: true }, { id: issue.id, token: '' }]) {
    await assert.rejects(call('issue.delete', params), { code: 'BAD_REQUEST' });
  }
  issues.update(issue.id, { priority: 'high' });
  assert.equal((await call('issue.delete', { id: issue.id, token: preview.token }) as any).outcome, 'needs_clarification');
  const current: any = await call('issue.delete', { id: issue.id });
  assert.equal((await call('issue.delete', { id: issue.id, token: current.token }) as any).code, 'session_cleanup_failed');
  assert.equal(issues.get(issue.id).issue.status, 'todo');
  cleanupFails = false;
  assert.deepEqual(await call('issue.delete', { id: issue.id, token: current.token }), { outcome: 'success', forgotten: true, id: issue.id });
  assert.deepEqual(cleaned, [issue.id]);
  assert.equal(issues.counts().total, 0);
});

test('the board: the issues of a tab grouped by what their agent is doing, each row small and plain, with the session the phone can open', async (t) => {
  const { issues, call } = world(t, { sessionState: (key) => key === 'dsh:s2' ? 'unread' : 'idle' });
  const working = issues.add({ title: '写 skills', project: { name: 'ai', path: '/p/ai' }, agent: 'codex', session: 'dsh:s1', priority: 'high', dueAt: NOW + 86_400_000, brief: '很长的描述' }, { actor: 'owner' }).issue;
  const asking = issues.add({ title: '漏洞', project: { name: 'hs', path: '/p/hs' }, agent: 'claude', session: 'dsh:s2' }, { actor: 'owner' }).issue;
  issues.add({ title: '还没分配' }, { actor: 'owner' });
  issues.add({ title: '待规划的', status: 'backlog' }, { actor: 'owner' });

  const answer: any = await call('board.list', { tab: 'active' });
  assert.equal(answer.outcome, 'success');
  assert.deepEqual(GROUPS(answer), { unread: ['漏洞'], idle: ['写 skills'], unassigned: ['还没分配'] });
  const row = answer.groups.find((group: any) => group.key === 'idle').items[0];
  assert.deepEqual(Object.keys(row).sort(), ['agent', 'sessionState', 'dueAt', 'id', 'priority', 'project', 'ref', 'sessionId', 'status', 'statusType', 'title', 'updatedAt'].sort());
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

test('phone issue rows retain parent titles and completion counts; detail alone returns plain child rows', async (t) => {
  const { issues, call } = world(t);
  const parent = issues.add({ title: 'desktop 插件', brief: '父事项完整描述' }).issue;
  const child = issues.add({ title: '子事项自己的标题', parent: parent.id, brief: '子事项完整描述', session: 'dsh:child' }).issue;
  const finished = issues.add({ title: '已完成的子事项', parent: parent.id, status: 'done' }).issue;
  const list: any = await call('board.list', { tab: 'all' });
  const rows = list.groups.flatMap((group: any) => group.items);
  const parentRow = rows.find((item: any) => item.id === parent.id);
  const childRow = rows.find((item: any) => item.id === child.id);
  assert.deepEqual(parentRow.subIssues, { total: 2, done: 1 });
  assert.equal(parentRow.children, undefined, 'no child list or descriptions in homepage rows');
  assert.equal(childRow.title, child.title, 'the original title is never overwritten by a joined presentation title');
  assert.deepEqual(childRow.parent, {
    id: parent.id, ref: parent.ref, title: parent.title, status: parent.status, statusType: parent.statusType,
  });
  assert.equal(JSON.stringify(list).includes('完整描述'), false);
  const full: any = await call('issue.get', { id: parent.id });
  assert.deepEqual(full.issue.children.map((item: any) => item.id), [child.id, finished.id]);
  assert.equal(full.issue.children[0].sessionId, 'child');
  assert.equal(full.issue.children[0].description, undefined);
  issues.update(parent.id, { title: '新的父事项标题' });
  issues.update(child.id, { status: 'done' });
  const updated: any = await call('issue.get', { id: parent.id });
  assert.deepEqual(updated.issue.subIssues, { total: 2, done: 2 });
  assert.equal(updated.issue.children[0].parent.title, '新的父事项标题');
});

test('phone quick actions persist Desktop properties and detail metadata, including unchanged choices', async (t) => {
  const { issues, call } = world(t);
  const issue = issues.add({ title: '继续调研', brief: '保留现有描述' }, { actor: 'owner' }).issue;
  const custom = issues.statusAdd({ name: '调研', category: 'backlog', color: '#123456' }).status;
  const label = issues.labelAdd({ name: '手机', color: 'teal' }).label;
  const project = { name: 'Dudu', path: '/p/dudu' };
  const patch = { status: custom.id, priority: 'high', dueAt: NOW + 86_400_000, labels: [label.id, label.id], project };
  const changed: any = await call('issue.update', { id: issue.id, patch });
  assert.equal(changed.outcome, 'success');
  assert.deepEqual(
    [changed.issue.status, changed.issue.statusType, changed.issue.priority, changed.issue.dueAt, changed.issue.labels, changed.issue.projectInfo],
    [custom.id, 'backlog', 'high', patch.dueAt, [label], project],
  );
  assert.equal(changed.issue.description, '保留现有描述');
  const { children, ...metadata } = (await call('issue.get', { id: issue.id }) as any).issue;
  assert.deepEqual(children, []);
  assert.deepEqual(metadata, changed.issue);
  assert.deepEqual((await call('issue.update', { id: issue.id, patch }) as any).issue, changed.issue, 'an unchanged choice is a successful save');
  const child: any = await call('issue.create', { title: '下一步', parent: issue.id, project });
  assert.equal(issues.get(child.issue.id).issue.parent.id, issue.id);
  assert.deepEqual(issues.get(child.issue.id).issue.project, project);
  const cleared: any = await call('issue.update', { id: issue.id, patch: { labels: [], dueAt: null, project: null } });
  assert.equal(cleared.outcome, 'success');
  assert.deepEqual([cleared.issue.labels, cleared.issue.projectInfo, cleared.issue.dueAt], [[], null, undefined]);
});

test('phone quick actions keep assignment and working-state locks without moving the manual workflow', async (t) => {
  const assigned: number[] = [];
  let state = 'unread';
  const { issues, call } = world(t, { onAssign: (issue: any) => { assigned.push(issue.id); }, sessionState: () => state });
  const issue = issues.add({ title: '先探索', status: 'backlog' }, { actor: 'owner' }).issue;
  const project = { name: 'Dudu', path: '/p/dudu' };
  await assert.rejects(call('issue.update', { id: issue.id, patch: { sessionState: 'idle' } }), { code: 'BAD_REQUEST' });
  assert.notEqual((await call('issue.assign', { id: issue.id, agent: 'codex', project: { name: 'relative', path: 'relative' } }) as any).outcome, 'success');
  assert.deepEqual(assigned, []);
  const result: any = await call('issue.assign', { id: issue.id, agent: 'codex', project, session: 'dsh:injected', actor: 'dudu' });
  assert.equal(result.outcome, 'success');
  assert.deepEqual([result.issue.agent, result.issue.projectInfo, result.issue.status, result.issue.sessionId], ['codex', project, 'backlog', undefined]);
  assert.deepEqual(assigned, [issue.id]);
  issues.update(issue.id, { session: 'dsh:real' }, { actor: 'owner' });
  assert.equal((await call('issue.assign', { id: issue.id, agent: 'codex', project }) as any).outcome, 'success');
  assert.deepEqual(assigned, [issue.id], 'resubmission must not start another session');
  assert.notEqual((await call('issue.assign', { id: issue.id, agent: 'claude', project }) as any).outcome, 'success');
  assert.notEqual((await call('issue.update', { id: issue.id, patch: { project: { name: 'Other', path: '/p/other' } } }) as any).outcome, 'success');
  assert.notEqual((await call('issue.update', { id: issue.id, patch: { project: null } }) as any).outcome, 'success');
  state = 'processing';
  await assert.rejects(call('issue.update', { id: issue.id, patch: { sessionState: 'idle' } }), { code: 'BAD_REQUEST' });
  state = 'unread';
  assert.deepEqual(GROUPS(await call('board.list', { tab: 'backlog' })), { unread: ['先探索'] });
});

test('phone quick actions reject unsafe or malformed patches without side effects', async (t) => {
  const { issues, call } = world(t);
  const issue = issues.add({ title: '原样保留', status: 'backlog' }, { actor: 'owner' }).issue;
  const before = issues.get(issue.id);
  for (const patch of [
    {}, [], null, { status: '' }, { priority: 'critical' }, { sessionState: 'working' }, { sessionState: 'done' },
    { dueAt: -1 }, { dueAt: 1.5 }, { labels: ['1'] }, { labels: Array(51).fill(1) },
    { project: [] }, { project: { name: 'x', path: 42 } }, { project: { name: ' ' } },
    { priority: 'high', session: 'dsh:injected' }, { actor: 'dudu' }, { agent: 'claude' }, { source: 'session' },
  ]) {
    await assert.rejects(call('issue.update', { id: issue.id, patch }), { code: 'BAD_REQUEST' });
  }
  for (const patch of [{ status: 'missing' }, { labels: [4242] }]) {
    assert.notEqual((await call('issue.update', { id: issue.id, patch }) as any).outcome, 'success');
  }
  for (const params of [{ id: 0, patch: { priority: 'high' } }, { id: '1', patch: { priority: 'high' } }]) {
    await assert.rejects(call('issue.update', params), { code: 'BAD_REQUEST' });
  }
  for (const params of [
    { id: issue.id, agent: 'codex' }, { id: issue.id, agent: 'other', project: { name: 'x', path: '/p/x' } },
    { id: issue.id, agent: 'claude', project: { name: 'x', path: '' } }, { id: -1, agent: 'codex', project: { name: 'x', path: '/p/x' } },
  ]) {
    await assert.rejects(call('issue.assign', params), { code: 'BAD_REQUEST' });
  }
  assert.deepEqual(issues.get(issue.id), before);
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
  const quarter = issues.statusAdd({ name: '实施', category: 'started', color: '#f2994a', iconProgress: 0.25 }).status;
  const label: any = await call('issue.label.create', { name: '手机', color: 'teal' });
  assert.equal(label.outcome, 'success');
  const parent = issues.add({ title: '原生 App', status: 'done' }, { actor: 'owner' }).issue;
  const options: any = await call('issue.options');
  assert.equal(options.statuses.find((entry: any) => entry.isDefault).id, custom.id);
  assert.equal(options.statuses.find((entry: any) => entry.id === custom.id).color, '#123456');
  assert.deepEqual(options.statuses.find((entry: any) => entry.id === quarter.id), {
    id: quarter.id, type: 'in_progress', name: '实施', color: '#f2994a', iconProgress: 0.25, isDefault: false,
  });
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

test('the phone can ask for more context for a record, and the record says whether it is being completed', async (t) => {
  const { call, ingest } = world(t);
  const [a] = ingest('lark', [raw('a')]);
  assert.deepEqual(await call('inbox.complete', { id: a.id }), { outcome: 'success', started: true });
  const got: any = await call('inbox.get', { id: a.id });
  assert.equal(typeof got.record.completing, 'boolean');
  assert.ok('completeError' in got.record);
  assert.equal(((await call('inbox.complete', { id: 9999 })) as any).outcome, 'needs_clarification');
  await assert.rejects(call('inbox.complete', { id: 'x' }), { code: 'BAD_REQUEST' });
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
