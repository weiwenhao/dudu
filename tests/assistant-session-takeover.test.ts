import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionTakeover } from '../host/assistant/home/session-takeover.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';

const original = {
  key: 'claude:existing', provider: 'claude', id: 'existing', title: '修复导出',
  cwd: '/work/app', project: { name: 'App', path: '/work/app' },
};
const decision = { brief: '修复导出功能。' };

function world(t: any, options: any = {}) {
  const issues = createIssues({ file: ':memory:' });
  const calls: any[] = [];
  const adopted: any[] = [];
  const session = { ...original, ...options.session };
  const takeover = createSessionTakeover({
    issues,
    catalog: { get: async ({ provider, id }: any) => ({ ...session, provider, id, key: `${provider}:${id}` }) },
    read: async () => ({ outcome: 'success', messages: [
      { role: 'user', text: '修复导出。' },
      { role: 'assistant', text: '已修改代码，测试还没运行。' },
    ] }),
    llm: async (input: any, opts: any) => { calls.push(input); return JSON.stringify(await (options.decide ? options.decide(input, opts) : decision)); },
    adopt: async (issue: any) => { adopted.push(issue); },
    stateOf: () => options.state ?? 'finished',
    snapshotOf: () => options.snapshot,
  });
  t.after(async () => { await takeover.close(); issues.close(); });
  return { issues, takeover, calls, adopted, take: () => takeover.takeOver({ provider: session.provider, id: session.id }) };
}

test('takeover preserves the original conversation, title, project and agent, and summarizes only the task', async (t) => {
  const w = world(t);
  const result = await w.take();
  assert.equal(result.outcome, 'success');
  assert.deepEqual(
    [result.issue.title, result.issue.project, result.issue.agent, result.issue.session, result.issue.ref],
    [original.title, original.project, 'claude', original.key, 'APP-1'],
  );
  assert.equal(result.issue.brief, decision.brief);
  assert.equal(result.issue.status, 'todo');
  assert.equal(result.issue.sourceRef, original.key);
  assert.equal(w.adopted.length, 1);
  assert.equal(w.issues.events({ issueId: result.issue.id }).events[0].actor, 'dudu');
  assert.equal(JSON.parse(w.calls[0][1].content).messages[1].text, '已修改代码，测试还没运行。');
  assert.match(w.calls[0][0].content, /untrusted evidence/);
});

test('concurrent takeover and later repeated requests reuse one issue and one summary', async (t) => {
  const w = world(t);
  const results = await Promise.all([w.take(), w.take(), w.take()]);
  assert.equal(new Set(results.map((result) => result.issue.id)).size, 1);
  assert.equal(w.calls.length, 1);
  assert.equal((await w.take()).outcome, 'no_op');
  assert.equal(w.calls.length, 1);
  assert.equal(w.issues.counts().total, 1);
});

test('a native conversation already loaded into DSH and its DSH alias resolve to one issue', async (t) => {
  const w = world(t, { session: { dshSessionId: 'linked', agent: 'claude' } });
  const native = await w.take();
  assert.equal(native.issue.session, 'dsh:linked');
  const local = await w.takeover.takeOver({ provider: 'dsh', id: 'linked' });
  assert.equal(local.outcome, 'no_op');
  assert.equal(local.issue.id, native.issue.id);
  assert.equal(w.calls.length, 1);
});

test('takeover uses the configured new-issue status regardless of session activity or model workflow', async (t) => {
  for (const state of ['running', 'finished', 'idle', 'error', null]) {
    const w = world(t, { state, decide: () => ({ brief: '修复导出。', status: 'in_review', ask: '确认完成吗？' }) });
    const result = await w.take();
    assert.equal(result.issue.status, 'todo', state ?? 'unknown');
    assert.equal(result.issue.ask, '');
  }
  const w = world(t, { state: 'running' });
  w.issues.statusUpdate('backlog', { isDefault: true });
  assert.equal((await w.take()).issue.status, 'backlog');
});

test('unfinished work waiting on an owner decision keeps the actual question', async (t) => {
  const w = world(t, {
    state: 'waiting_owner', snapshot: { state: 'waiting_owner', pending: { text: '导出 CSV 还是 JSON？' } },
    decide: () => ({ brief: '修复导出。', ask: '确认完成吗？' }),
  });
  const result = await w.take();
  assert.equal(result.issue.status, 'todo');
  assert.equal(result.issue.ask, '导出 CSV 还是 JSON？');
});

test('invalid summaries and missing authoritative project metadata create no issue', async (t) => {
  for (const response of [null, {}, { brief: '' }, { brief: 'x'.repeat(4001) }]) {
    const w = world(t, { decide: () => response });
    assert.equal((await w.take()).outcome, 'error');
    assert.equal(w.issues.counts().total, 0);
  }
  const missing = world(t, { session: { cwd: '', project: null } });
  assert.equal((await missing.take()).code, 'session_project_missing');
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.issues.counts().total, 0);
});

test('an issue created while summarizing wins; late output cannot create another association', async (t) => {
  let w: ReturnType<typeof world>;
  w = world(t, { decide: () => {
    w.issues.add({ title: '已收进来', project: original.project, agent: 'claude', session: original.key });
    return decision;
  } });
  assert.equal((await w.take()).outcome, 'no_op');
  assert.equal(w.issues.counts().total, 1);
  assert.equal(w.adopted.length, 0);
});

test('closing takeover aborts a pending summary and prevents late writes', async (t) => {
  let entered: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const w = world(t, { decide: (_input: any, { signal }: any) => new Promise((_resolve, reject) => {
    entered();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const taking = w.take();
  await started;
  await w.takeover.close();
  assert.equal((await taking).outcome, 'error');
  assert.equal(w.issues.counts().total, 0);
  assert.equal((await w.take()).code, 'takeover_closed');
});

test('a conversation only the harness has is put into DSH as part of the takeover, and the issue then follows the DSH session', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  const loaded: any[] = [];
  const adopted: any[] = [];
  const takeover = createSessionTakeover({
    issues,
    catalog: { get: async ({ provider, id }: any) => ({ ...original, provider, id, key: `${provider}:${id}` }) },
    read: async () => ({ outcome: 'success', messages: [{ role: 'user', text: '修复导出。' }] }),
    llm: async () => JSON.stringify(decision),
    adopt: async (issue: any) => { adopted.push(issue); },
    load: async (issue: any) => {
      loaded.push(issue);
      const result = issues.update(issue.id, { session: 'dsh:loaded-1' }, { actor: 'dudu' });
      return { issue: result.issue, target: { sessionId: 'loaded-1', workspaceId: 'ws-1' } };
    },
  });
  t.after(async () => { await takeover.close(); issues.close(); });
  const result = await takeover.takeOver({ provider: 'claude', id: 'existing' });
  assert.equal(result.outcome, 'success');
  assert.equal(result.issue.session, 'dsh:loaded-1', 'the issue names the DSH session');
  assert.deepEqual(result.session, { sessionId: 'loaded-1', workspaceId: 'ws-1' }, 'and the page is told which one, to put it in the sidebar');
  assert.equal(loaded.length, 1);
  assert.equal(adopted.length, 0, 'loading adopts it itself');
  // A takeover that cannot load still makes the issue, which keeps the harness session.
  const failing = createSessionTakeover({
    issues,
    catalog: { get: async ({ provider, id }: any) => ({ ...original, provider, id, key: `${provider}:${id}`, cwd: '/work/other', project: { name: 'Other', path: '/work/other' } }) },
    read: async () => ({ outcome: 'success', messages: [{ role: 'user', text: '另一件事。' }] }),
    llm: async () => JSON.stringify(decision),
    adopt: async () => {},
    load: async () => { throw new Error('This DSH cannot store a loaded session.'); },
  });
  t.after(async () => { await failing.close(); });
  const kept = await failing.takeOver({ provider: 'claude', id: 'another' });
  assert.equal(kept.outcome, 'success');
  assert.equal(kept.issue.session, 'claude:another');
  assert.equal('session' in kept, false);
});
