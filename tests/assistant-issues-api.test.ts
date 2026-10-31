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
    assert.deepEqual([...ISSUE_ACTIONS].sort(), ['add', 'assign', 'cancel', 'complete', 'counts', 'events', 'export', 'facets', 'get', 'list', 'log', 'search', 'snooze', 'undo', 'update']);
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
