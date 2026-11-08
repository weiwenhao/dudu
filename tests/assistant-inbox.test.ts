import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createSessionFolding, createSessionInbox } from '../host/assistant/home/inbox.mjs';

const waiting = (extra = {}) => ({
  key: 'claude:one', provider: 'claude', state: 'waiting_owner', title: 'Contract', cwd: '/work/app',
  excerpt: 'Reading clause 3.', pending: { text: 'Accept clause 3?', kind: 'question' }, ...extra,
});

test('a waiting session follows an explicitly managed issue without creating another one', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  const observed: any[] = [];
  const made = issues.add({ title: 'Contract', session: 'claude:one', source: 'session', sourceRef: 'claude:one', agent: 'claude', project: { name: 'app', path: '/work/app' } }).issue;
  const inbox = createSessionInbox({ issues, observe: (issue: any, snapshot: any) => observed.push([issue.id, snapshot.state]) });
  t.after(async () => { await inbox.close(); issues.close(); });
  const first = await inbox.accept(waiting());
  await inbox.accept(waiting({ state: 'finished', pending: null }));
  assert.equal(issues.counts().total, 1);
  assert.deepEqual([first.id, first.source, first.sourceRef, first.agent, first.project], [
    made.id, 'session', 'claude:one', 'claude', { name: 'app', path: '/work/app' },
  ]);
  assert.deepEqual(observed, [[first.id, 'waiting_owner'], [first.id, 'finished']]);
  assert.equal(issues.list({ tab: 'active' }).items[0].id, first.id, 'session lookup does not break the view parser');
});

test('native and DSH observations of a linked session share one issue even when they arrive together', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  issues.add({ title: 'Managed', session: 'claude:one' });
  const inbox = createSessionInbox({ issues, links: { get: () => 'loaded' } });
  t.after(async () => { await inbox.close(); issues.close(); });
  const [native, dsh] = await Promise.all([
    inbox.accept(waiting({ dshSessionId: 'loaded' })),
    inbox.accept(waiting({ key: 'dsh:loaded', provider: 'dsh' })),
  ]);
  assert.equal(native.id, dsh.id);
  assert.equal(native.session, 'dsh:loaded');
  assert.equal(issues.counts().total, 1);
  assert.equal(issues.findBySession('dsh:loaded').issue.id, native.id);
});

test('observing a linked native session finds an existing DSH issue; completed issues stay completed', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  const made = issues.add({ title: 'Existing', session: 'dsh:loaded' }).issue;
  let adopted = 0;
  const inbox = createSessionInbox({ issues, adopt: () => { adopted++; } });
  t.after(async () => { await inbox.close(); issues.close(); });
  assert.equal((await inbox.accept(waiting({ dshSessionId: 'loaded' }))).id, made.id);
  issues.complete(made.id, { outcome: 'done' });
  const done = await inbox.accept(waiting({ dshSessionId: 'loaded' }));
  assert.equal(done.status, 'done');
  assert.equal(adopted, 1);
  assert.equal(issues.counts().total, 1);
});

test('a question after loading a native session through the Sessions widget rebinds its existing issue', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  const made = issues.add({ title: 'Existing native issue', session: 'claude:one' }).issue;
  const inbox = createSessionInbox({ issues, links: {
    get: () => 'loaded', nativeKey: () => 'claude:one',
  } });
  t.after(async () => { await inbox.close(); issues.close(); });
  const accepted = await inbox.accept(waiting({ key: 'dsh:loaded', provider: 'dsh' }));
  assert.equal(accepted.id, made.id);
  assert.equal(accepted.session, 'dsh:loaded');
  assert.equal(issues.counts().total, 1);
});

test('discovered native and DSH sessions never create issues, including questions, approvals and failures', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  const inbox = createSessionInbox({ issues });
  t.after(async () => { await inbox.close(); issues.close(); });
  for (const extra of [
    {}, { state: 'running' }, { state: 'error' }, { state: 'finished' }, { pending: null }, { pending: { text: ' ' } },
    { key: 'codex:one', provider: 'codex' }, { key: 'dsh:imported', provider: 'dsh', agent: 'claude' },
    { pending: { text: 'Approve this tool?', kind: 'approval' } },
    { key: 'dsh:dudu-assistant-one' }, { dshSessionId: 'dudu-assistant-one' },
  ]) assert.equal(await inbox.accept(waiting(extra)), null);
  assert.equal(issues.counts().total, 0);
});

test('a failed observation does not block the next one, and closing drains queued work', async (t) => {
  const issues = createIssues({ file: ':memory:' });
  issues.add({ title: 'Managed', session: 'dsh:one', agent: 'codex', project: { name: 'app', path: '/work/app' } });
  let calls = 0;
  const inbox = createSessionInbox({ issues, adopt: () => { if (!calls++) throw new Error('temporary'); } });
  t.after(() => issues.close());
  await assert.rejects(inbox.accept(waiting({ key: 'dsh:one', provider: 'dsh', agent: 'codex' })), /temporary/);
  const accepted = inbox.accept(waiting({ key: 'dsh:one', provider: 'dsh' }));
  await inbox.close();
  assert.equal((await accepted).agent, 'codex');
  assert.equal(await inbox.accept(waiting({ key: 'claude:two' })), null);
  assert.equal(issues.counts().total, 1);
});

test('only waiting or failed sessions past the folding threshold are archived; a waiting turn is stopped explicitly', async () => {
  const states = ['waiting_owner', 'error', 'running', 'finished', 'idle', 'waiting_owner'];
  const calls: any[] = [];
  const closed: string[] = [];
  const snapshots = states.map((state, id) => ({ state, stateSince: id === 5 ? 95 : 0, closed: false }));
  const sessions = {
    keys: () => snapshots.map((_, id) => String(id)),
    snapshotOf: (key: string) => snapshots[Number(key)],
    async close(key: string, options: any) { calls.push([key, options]); snapshots[Number(key)].closed = true; return { outcome: 'success' }; },
  };
  const folding = createSessionFolding({ sessions, onClose: (key: string) => { closed.push(key); }, now: () => 100, afterMs: 10, intervalMs: 0 });
  await Promise.all([folding.tick(), folding.tick()]);
  await folding.tick();
  assert.deepEqual(calls, [['0', { stop: true }], ['1', { stop: false }]]);
  assert.deepEqual(closed, ['0', '1']);
  await folding.close();
  await folding.tick();
  assert.equal(calls.length, 2);
});
