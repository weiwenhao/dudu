import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssueCommands } from '../host/assistant/issues/api.mjs';
import { createSessionCleanup } from '../host/assistant/home/session-cleanup.mjs';
import { createLinkStore } from '../host/providers/native/index.mjs';
import { createSessionInbox } from '../host/assistant/home/inbox.mjs';
import { createAgentSessions } from '../host/assistant/home/agent-sessions.mjs';
import { createAssignment } from '../host/assistant/home/assign.mjs';
import { fakeDsh } from './fake-dsh.mjs';

test('deletion requires a current preview, cleans all linked sessions, and a waiting native source cannot recreate the issue after restart', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-delete-'));
  const issues = createIssues({ file: ':memory:', sessionState: () => 'running' });
  let links = await createLinkStore(folder);
  t.after(async () => { issues.close(); await links.flush(); await rm(folder, { recursive: true, force: true }); });
  const issue = issues.add({ title: 'work', agent: 'claude', project: { name: 'work', path: '/work' }, session: 'dsh:one' }).issue;
  links.record({ route: 'claude', nativeSessionId: 'native-1', sessionId: 'one' });
  const archived: string[] = [];
  const cleanup = createSessionCleanup({
    issues, links, forget: () => {}, registry: () => ({ archiveSession: async (id: string, options: any) => {
      assert.equal(options.stopActivity, true); archived.push(id);
    } }),
  });
  const commands = createIssueCommands({ issues, onDelete: cleanup });
  const preview = await commands.execute('delete', { id: issue.id });
  assert.equal(preview.preview, true);
  assert.deepEqual(archived, []);
  assert.equal((await commands.execute('delete', { id: issue.id, token: 'wrong' })).outcome, 'needs_clarification');
  assert.deepEqual(archived, []);
  assert.equal((await commands.execute('delete', { id: issue.id, token: preview.token })).forgotten, true);
  assert.deepEqual(archived, ['one']);
  links = await createLinkStore(folder);
  assert.equal(links.get('claude', 'native-1'), undefined);
  assert.equal(links.hidden('claude', 'native-1'), true);
  assert.equal(links.removed('one'), true);
  links.record({ route: 'claude', nativeSessionId: 'native-1', sessionId: 'one' });
  assert.equal(links.hidden('claude', 'native-1'), true, 'a late provider event cannot restore it');
  const inbox = createSessionInbox({ issues, links });
  assert.equal(await inbox.accept({ key: 'claude:native-1', provider: 'claude', state: 'waiting_owner', cwd: '/work', pending: { text: 'answer?' } }), null);
  assert.equal(issues.counts().total, 0);
  links.record({ route: 'claude', nativeSessionId: 'native-1', sessionId: 'new-copy' });
  const native = { key: 'claude:native-1', provider: 'claude', state: 'waiting_owner', cwd: '/work', pending: { text: 'answer?' } };
  const local = { ...native, key: 'dsh:new-copy', provider: 'dsh' };
  assert.equal(await inbox.accept(native), null, 'import alone does not create another issue from native observations');
  assert.equal(await inbox.accept(local), null, 'import alone does not create another issue from DSH observations');
  const taken = issues.add({ title: 'Explicit takeover', agent: 'claude', project: { name: 'work', path: '/work' }, session: 'dsh:new-copy' }).issue;
  assert.equal((await inbox.accept(native)).id, taken.id, 'a new explicit takeover is still observed');
  assert.equal((await inbox.accept(local)).id, taken.id);
  assert.equal(await inbox.accept({ ...local, key: 'dsh:one' }), null, 'the archived copy stays retired');
  await inbox.close();
});

test('failed cleanup keeps the issue, while a session shared by another issue stays available', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-delete-'));
  const links = await createLinkStore(folder);
  const issues = createIssues({ file: ':memory:' });
  t.after(async () => { issues.close(); await links.flush(); await rm(folder, { recursive: true, force: true }); });
  const one = issues.add({ title: 'one', session: 'dsh:shared' }).issue;
  links.record({ route: 'claude', nativeSessionId: 'shared-native', sessionId: 'shared' });
  const two = issues.add({ title: 'two', session: 'claude:shared-native' }).issue;
  const failing = createIssueCommands({ issues, onDelete: () => { throw new Error('unavailable'); } });
  const preview = await failing.execute('delete', { id: one.id });
  assert.equal((await failing.execute('delete', { id: one.id, token: preview.token })).code, 'session_cleanup_failed');
  assert.equal(issues.get(one.id).outcome, 'success');
  const cleanup = createSessionCleanup({
    links, issues, forget: () => {}, registry: () => ({ archiveSession: () => { throw new Error('shared session must not close'); } }),
  });
  const commands = createIssueCommands({ issues, onDelete: cleanup });
  assert.equal((await commands.execute('delete', { id: one.id, token: preview.token })).forgotten, true);
  assert.equal(issues.get(two.id).outcome, 'success');
  assert.equal(links.removed('shared'), false);
});

test('an archive failure restores following without discarding the pending question', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-delete-'));
  const links = await createLinkStore(folder);
  const fake = fakeDsh();
  const sessions = createAgentSessions({ dsh: fake.dsh });
  const issues = createIssues({ file: ':memory:', sessionState: sessions.stateOf });
  const assignment = createAssignment({ issues, agentSessions: sessions });
  t.after(async () => { await assignment.dispose(); sessions.dispose(); issues.close(); await links.flush(); await rm(folder, { recursive: true, force: true }); });
  const issue = issues.add({ title: 'waiting', agent: 'deepseek', project: { name: 'work', path: '/work' } }).issue;
  await assignment.onAssign(issue);
  const asked = fake.say.ask('s1', 'Choose one')!;
  await assignment.observe(issues.get(issue.id).issue, sessions.snapshotOf('dsh:s1'));
  const cleanup = createSessionCleanup({
    issues, links, suspend: assignment.suspend, forget: assignment.forget,
    registry: () => ({ archiveSession: () => { throw new Error('unavailable'); } }),
  });
  const commands = createIssueCommands({ issues, onDelete: cleanup });
  const preview = await commands.execute('delete', { id: issue.id });
  assert.equal((await commands.execute('delete', { id: issue.id, token: preview.token })).code, 'session_cleanup_failed');
  assert.equal(sessions.stateOf('dsh:s1'), 'waiting_owner');
  assert.equal(issues.get(issue.id).issue.ask, 'Choose one');
  assert.equal((await sessions.send('dsh:s1', 'First')).kind, 'answer');
  assert.equal(await asked.answer, 'First', 'the original question still takes an answer after cleanup failed');
});
