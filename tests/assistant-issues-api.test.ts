import assert from 'node:assert/strict';
import test from 'node:test';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssuesApi, ISSUE_ACTIONS } from '../host/assistant/issues/api.mjs';

function setup() {
  const issues = createIssues({ file: ':memory:' });
  const api = createIssuesApi({ issues });
  const call = async (action: string, body: unknown, raw = false) => {
    const response = await api.handle(action, new Request('http://dsh.test/api/dudu/issues/x', { method: 'POST', body: raw ? String(body) : JSON.stringify(body) }));
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  return { issues, call, close: () => issues.close() };
}

test('every action of the page is served and nothing else', async () => {
  const { call, close } = setup();
  try {
    assert.deepEqual([...ISSUE_ACTIONS].sort(), ['add', 'assign', 'cancel', 'complete', 'counts', 'events', 'export', 'facets', 'get', 'list', 'log', 'reply', 'resume', 'search', 'snooze', 'undo', 'update']);
    assert.equal((await call('nope', {})).status, 404);
    assert.equal((await call('constructor', {})).status, 404, 'an action name is never looked up on the object prototype');
  } finally { close(); }
});

test('the page adds, lists, reads, edits and comments on an issue', async () => {
  const { call, close } = setup();
  try {
    const added = await call('add', { fields: { title: '回复供应商', priority: 'high', project: { name: 'docs', path: '/work/docs' } } });
    assert.equal(added.status, 200);
    assert.equal(added.body.outcome, 'success');
    assert.equal(added.headers.get('cache-control'), 'no-store');
    const id = added.body.issue.id;

    const listed = await call('list', { tab: 'active' });
    assert.deepEqual(listed.body.items.map((issue: { id: number }) => issue.id), [id]);
    assert.deepEqual(listed.body.counts.priority, { high: 1 });

    assert.equal((await call('update', { id, patch: { status: 'in_progress', dueAt: 1793318400000 } })).body.outcome, 'success');
    assert.equal((await call('log', { id, kind: 'note', text: '先看第 3 条' })).body.outcome, 'success');
    const got = await call('get', { id });
    assert.equal(got.body.issue.status, 'in_progress');
    assert.deepEqual(got.body.log.map((entry: { kind: string }) => entry.kind), ['note', 'due', 'status'], 'newest first');
    assert.equal((await call('facets', { tab: 'active' })).body.facets.project[0].key, 'docs');
    assert.equal((await call('search', { q: '供应商' })).body.items.length, 1);
  } finally { close(); }
});

test('the page is the owner: an actor in the body does not change who made the change', async () => {
  const { call, close } = setup();
  try {
    const { body: { issue } } = await call('add', { fields: { title: '一件事' }, actor: 'dudu' });
    await call('update', { id: issue.id, patch: { priority: 'urgent' }, actor: 'dudu', reason: '先做' });
    const { body: { events } } = await call('events', { issueId: issue.id });
    assert.deepEqual(events.map((event: { actor: string }) => event.actor), ['owner', 'owner']);
    assert.equal(events[0].reason, '先做', 'a reason is kept');
  } finally { close(); }
});

test('cancel keeps the reason the page sent', async () => {
  const { call, close } = setup();
  try {
    const { body: { issue } } = await call('add', { fields: { title: '重复的 CI 告警' } });
    const canceled = await call('cancel', { id: issue.id, reason: '和 DUDU-4 重复' });
    assert.equal(canceled.body.outcome, 'success');
    const { body: { log } } = await call('get', { id: issue.id });
    assert.equal(log.find((entry: { kind: string }) => entry.kind === 'status').text, '和 DUDU-4 重复');
  } finally { close(); }
});

test('a wrong value is an answer, a body that is not a JSON object is a 400', async () => {
  const { call, close } = setup();
  try {
    const wrong = await call('list', { tab: 'tomorrow' });
    assert.equal(wrong.status, 200, 'the store answers a view it cannot read; the page shows its message');
    assert.equal(wrong.body.outcome, 'needs_clarification');
    assert.match(wrong.body.message, /tab/);
    const unknown = await call('list', { tab: 'active', sort: 'x' });
    assert.equal(unknown.body.outcome, 'needs_clarification');

    for (const raw of ['not json', '[1,2]', 'null', '"text"', '']) {
      const bad = await call('list', raw, true);
      assert.equal(bad.status, 400, `body ${JSON.stringify(raw)}`);
      assert.equal(typeof bad.body.error, 'string');
    }
  } finally { close(); }
});

test('a reply goes into the log as a decision, clears the question and is handed on to the agent\'s session', async () => {
  const issues = createIssues({ file: ':memory:' });
  const handed: Array<[number, string]> = [];
  const api = createIssuesApi({ issues, onReply: (issue: { id: number }, text: string) => { handed.push([issue.id, text]); } });
  try {
    const { issue } = issues.add({ title: '归档报销单', status: 'in_progress', agent: 'deepseek', ask: '第 3 张发票缺少抬头' });
    const response = await api.handle('reply', new Request('http://dsh.test/', { method: 'POST', body: JSON.stringify({ id: issue.id, text: '抬头用公司全称' }) }));
    const answer = await response.json();
    assert.equal(answer.outcome, 'success');
    assert.equal(answer.issue.ask, '');
    assert.equal(answer.issue.agentState, 'idle', 'the Needs you mark goes with the question');
    assert.deepEqual(handed, [[issue.id, '抬头用公司全称']]);
    const { log } = issues.get(issue.id);
    assert.ok(log.some((entry: { kind: string; text: string; actor: string }) => entry.kind === 'decision' && entry.text === '抬头用公司全称' && entry.actor === 'owner'));
    const empty = await (await api.handle('reply', new Request('http://dsh.test/', { method: 'POST', body: JSON.stringify({ id: issue.id, text: '  ' }) }))).json();
    assert.equal(empty.outcome, 'needs_clarification', 'an empty reply is refused and is not handed on');
    assert.equal(handed.length, 1);
  } finally { issues.close(); }
});

test('giving an issue an agent tells the plugin, once, and only when it was given', async () => {
  const issues = createIssues({ file: ':memory:' });
  const told: Array<[number, string | null, string | null]> = [];
  const api = createIssuesApi({ issues, onAssign: (issue: { id: number; agent: string | null; session: string | null }) => { told.push([issue.id, issue.agent, issue.session]); } });
  const post = async (action: string, body: unknown) => (await api.handle(action, new Request('http://dsh.test/', { method: 'POST', body: JSON.stringify(body) }))).json();
  try {
    const { issue } = issues.add({ title: '续费服务器' });
    assert.equal((await post('assign', { id: issue.id, agent: 'claude' })).outcome, 'success');
    assert.deepEqual(told, [[issue.id, 'claude', null]]);
    assert.equal((await post('assign', { id: issue.id, agent: 'claude' })).outcome, 'no_op', 'the same agent again changes nothing');
    assert.equal((await post('assign', { id: 999, agent: 'claude' })).outcome, 'error', 'an issue that is not there is an answer');
    assert.equal((await post('assign', { agent: 'claude' })).outcome, 'needs_clarification');
    assert.equal(told.length, 1, 'only a given agent is told');

    // An issue that has a session keeps it when the page names its agent again, and gives it up when another is named.
    issues.assign(issue.id, { agent: 'claude', session: 'dsh:abc' });
    const same = await post('assign', { id: issue.id, agent: 'claude' });
    assert.equal(same.outcome, 'no_op');
    assert.equal(same.issue.session, 'dsh:abc', 'the session that works is not thrown away for a click on its own agent');
    assert.equal(told.length, 1);
    assert.equal((await post('assign', { id: issue.id, agent: 'codex' })).issue.session, null);
    assert.deepEqual(told.at(-1), [issue.id, 'codex', null]);
    assert.equal((await post('assign', { id: issue.id, agent: null })).outcome, 'success');
    assert.deepEqual(told.at(-1), [issue.id, null, null], 'taking the agent away is told too');
  } finally { issues.close(); }
});

test('a hook of the plugin that fails does not undo or fail what the owner did', async () => {
  const issues = createIssues({ file: ':memory:' });
  const warned: string[] = [];
  const origin = console.warn;
  console.warn = (line: string) => { warned.push(line); };
  const failing = () => { throw new Error('the session service is gone'); };
  const api = createIssuesApi({ issues, onAssign: failing, onReply: failing, onResume: failing });
  const post = async (action: string, body: unknown) => (await api.handle(action, new Request('http://dsh.test/', { method: 'POST', body: JSON.stringify(body) }))).json();
  try {
    const { issue } = issues.add({ title: '回访客户', agent: 'claude', ask: '约周几？' });
    assert.equal((await post('assign', { id: issue.id, agent: 'codex' })).outcome, 'success');
    assert.equal(issues.get(issue.id).issue.agent, 'codex');
    assert.equal((await post('reply', { id: issue.id, text: '周四' })).outcome, 'success');
    assert.equal(issues.get(issue.id).issue.ask, '');
    issues.assign(issue.id, { agent: 'codex', session: 'dsh:x' });
    const resumed = await post('resume', { id: issue.id });
    assert.equal(resumed.outcome, 'error', 'a session that could not be put back is said not to be');
    assert.ok(warned.length >= 3 && warned.every((line) => /session service is gone/.test(line)), warned.join('\n'));
  } finally { console.warn = origin; issues.close(); }
});

test('the page can ask for the session of an issue to be put back; what it is told is what the plugin answers', async () => {
  const issues = createIssues({ file: ':memory:' });
  const asked: number[] = [];
  const api = createIssuesApi({ issues, onResume: (issue: { id: number }) => { asked.push(issue.id); return { outcome: 'success', key: 'dsh:abc' }; } });
  const bare = createIssuesApi({ issues });
  const post = async (handler: typeof api, body: unknown) => (await handler.handle('resume', new Request('http://dsh.test/', { method: 'POST', body: JSON.stringify(body) }))).json();
  try {
    const { issue } = issues.add({ title: '续费服务器', agent: 'claude', session: 'dsh:abc' });
    const answer = await post(api, { id: issue.id });
    assert.deepEqual([answer.outcome, answer.key, answer.issue.id], ['success', 'dsh:abc', issue.id]);
    assert.deepEqual(asked, [issue.id]);
    assert.equal((await post(api, { id: 999 })).outcome, 'error');
    assert.deepEqual(asked, [issue.id], 'an issue that is not there is not asked about');
    assert.equal((await post(bare, { id: issue.id })).outcome, 'no_op', 'a plugin that keeps no sessions says so');
    // The page opens a session it holds no issue for: the key alone is enough, and the plugin is told there is no issue.
    const told: unknown[] = [];
    const byKey = createIssuesApi({ issues, onResume: (issue: unknown) => { told.push(issue); return { outcome: 'no_op' }; } });
    assert.equal((await post(byKey, { session: 'dsh:xyz' })).outcome, 'no_op');
    assert.deepEqual(told, [{ id: null, session: 'dsh:xyz' }]);
    const neither = await post(byKey, {});
    assert.equal(neither.outcome, 'needs_clarification');
    assert.equal(told.length, 1);
  } finally { issues.close(); }
});
