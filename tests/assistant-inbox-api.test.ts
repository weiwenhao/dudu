// What the Collector widget reads and does (host/assistant/inbox/api.mjs and the owner's marks in inbox/store.mjs): the three tabs, the filter,
// ignoring and restoring (one record or several), sharing records to an issue or to the session of one, and the record that became an issue.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInboxApi } from '../host/assistant/inbox/api.mjs';
import { normalizeRecords } from '../host/assistant/inbox/records.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
const NOW = new Date(2026, 10, 5, 12).getTime();
const raw = (id: string, extra: any = {}) => ({ id, title: `来信 ${id}`, text: `${id} 的原文`, from: 'Alice', url: `https://mail.test/${id}`, ...extra });

function world(t: any, options: any = {}) {
  const clock = { now: NOW };
  const issues = createIssues({ file: ':memory:', now: () => clock.now });
  t.after(() => issues.close());
  const names = new Map([['mail', 'QQ 邮箱'], ['lark', '飞书']]);
  // The connector each collector reads through, by the catalog item it was made from (the icon is the catalog's): 飞书 reads through the catalog's lark, 邮箱 through one of the owner's own.
  const via = new Map([['lark', { id: 'lark-cli', via: 'lark' }], ['mail', { id: 'imap', via: '' }]]);
  const collectors = () => ({ resolve: () => ({ outcome: 'success', collectors: [...names].map(([id, name]) => ({ id, name, via: via.get(id) ?? null })) }) });
  const api = createInboxApi({ issues, collectors, now: () => clock.now, ...options });
  const ingest = (connector: string, list: any[]) => issues.inbox.ingest(connector, normalizeRecords(list).records).added;
  return { clock, issues, inbox: issues.inbox, api, ingest };
}

const ids = (answer: any) => answer.items.map((item: any) => item.title);

test('the tabs: waiting rows (judged or not) are To do, a row with an issue is Done, an ignored one is Ignored', (t) => {
  const { issues, inbox, api, ingest } = world(t);
  const [a, b, , d] = ingest('mail', [raw('a', { at: '2026-11-05T09:00:00+08:00' }), raw('b', { at: '2026-11-05T08:00:00+08:00' }), raw('c'), raw('d')]);
  const issue = issues.add({ title: '核对合同', source: 'connector', sourceRef: 'mail:a' }, { actor: 'dudu' }).issue;
  inbox.judge(a.id, { verdict: 'issue', issueId: issue.id, reason: '有人在等' });
  inbox.judge(b.id, { verdict: 'ignore', reason: '像是抄送' });
  assert.equal(api.execute('ignore', { id: d.id }).outcome, 'success');

  assert.deepEqual(ids(api.execute('list', { tab: 'todo' })), ['来信 c', '来信 b'], 'what was not made an issue and not ignored, judged by 嘟嘟 or not; c has no time of its own, so it shows when it was collected: now');
  const done = api.execute('list', { tab: 'done' });
  assert.deepEqual(ids(done), ['来信 a']);
  assert.deepEqual(done.items[0].issue, { id: issue.id, ref: issue.ref, title: '核对合同', status: 'todo', statusType: 'todo' });
  assert.equal(done.items[0].connectorName, 'QQ 邮箱');
  assert.deepEqual(ids(api.execute('list', { tab: 'ignored' })), ['来信 d']);
  assert.equal(api.execute('list', { tab: 'ignored' }).items[0].ignored, true);
});

test('ignoring puts a row aside for 嘟嘟 too, restoring gives it back, and a row that has an issue cannot be ignored', (t) => {
  const { issues, inbox, api, ingest } = world(t);
  const [a, b] = ingest('mail', [raw('a'), raw('b')]);
  assert.equal(api.execute('ignore', { id: a.id }).outcome, 'success');
  assert.equal(api.execute('ignore', { id: a.id }).outcome, 'no_op', 'twice changes nothing');
  assert.deepEqual(inbox.pending('mail').map((row: any) => row.id), [b.id], 'a row the owner ignored is not judged');
  assert.equal(inbox.waiting('mail'), 1);
  assert.equal(inbox.judge(a.id, { verdict: 'issue', issueId: null, reason: '' }), false, 'and a judgement that was on its way to it is not written');
  assert.equal(api.execute('restore', { id: a.id }).outcome, 'success');
  assert.deepEqual(inbox.pending('mail').map((row: any) => row.id), [a.id, b.id], 'back where it was: not judged yet');
  assert.equal(api.execute('restore', { id: a.id }).outcome, 'no_op');
  const issue = issues.add({ title: '已经是事项' }, { actor: 'owner' }).issue;
  inbox.judge(b.id, { verdict: 'issue', issueId: issue.id, reason: '' });
  assert.equal(api.execute('ignore', { id: b.id }).outcome, 'no_op');
  assert.equal(api.execute('ignore', { id: 9999 }).outcome, 'needs_clarification');
});

test('sharing adds the record to an open issue\'s activity as the owner\'s note and moves it to Done; a finished issue is refused', (t) => {
  const { issues, inbox, api, ingest } = world(t);
  const [a, b] = ingest('lark', [raw('a', { text: '周四前补两张票据' }), raw('b')]);
  const open = issues.add({ title: '补票据' }, { actor: 'owner' }).issue;
  const shared = api.execute('share', { id: a.id, issue: open.id });
  assert.equal(shared.outcome, 'success');
  assert.equal(shared.record.issue.id, open.id);
  assert.equal(shared.record.byOwner, true);
  const log = issues.get(open.id).log.find((entry: any) => entry.kind === 'note');
  assert.equal(log.actor, 'owner');
  assert.match(log.text, /^飞书: 来信 a\n\n周四前补两张票据\n\n来源：飞书 · https:\/\/mail\.test\/a$/);
  assert.deepEqual(log.data, { source: 'connector', ref: 'lark:a', record: a.id, url: 'https://mail.test/a' });
  assert.deepEqual(ids(api.execute('list', { tab: 'done' })), ['来信 a']);
  assert.equal(inbox.pending('lark').length, 1, 'only the other one is left for 嘟嘟');
  assert.equal(api.execute('share', { id: a.id, issue: open.id }).outcome, 'no_op', 'the same issue twice');
  const closed = issues.add({ title: '已经完成' }, { actor: 'owner' }).issue;
  issues.complete(closed.id, { outcome: '好了', actor: 'owner' });
  assert.equal(api.execute('share', { id: b.id, issue: closed.id }).code, 'not_open');
  assert.equal(api.execute('share', { id: b.id, issue: 9999 }).code, 'unknown_issue');
  assert.equal(api.execute('share', { id: 9999, issue: open.id }).code, 'unknown_record');
});

test('an unknown action and a body that is not an object are refused', async (t) => {
  const { api } = world(t);
  assert.equal(api.execute('nope', {}).code, 'unknown_action');
  assert.equal((await api.handle('nope', new Request('http://x', { method: 'POST', body: '{}' }))).status, 404);
  assert.equal((await api.handle('list', new Request('http://x', { method: 'POST', body: '[]' }))).status, 400);
  const ok = await api.handle('list', new Request('http://x', { method: 'POST', body: JSON.stringify({ tab: 'todo' }) }));
  assert.equal((await ok.json()).outcome, 'success');
});

// ---------------------------------------------------------------- several at once, and to a session

test('ignore, restore and share take several records at once: all or none by number, one change for each, and "nothing changed" when none did', (t) => {
  const { issues, api, ingest } = world(t);
  const rows = ingest('mail', [raw('a'), raw('b'), raw('c')]);
  const every = rows.map((row: any) => row.id);
  const ignored = api.execute('ignore', { ids: every.slice(0, 2) });
  assert.deepEqual([ignored.outcome, ignored.changed], ['success', 2]);
  assert.deepEqual(ids(api.execute('list', { tab: 'ignored' })).sort(), ['来信 a', '来信 b']);
  assert.deepEqual(ids(api.execute('list', { tab: 'todo' })), ['来信 c']);
  const again = api.execute('ignore', { ids: every.slice(0, 2) });
  assert.equal(again.outcome, 'no_op');
  const mixed = api.execute('ignore', { ids: every });
  assert.deepEqual([mixed.outcome, mixed.changed], ['success', 1], 'only the one that was not ignored changed');
  assert.equal(api.execute('ignore', { ids: [every[0], 9999] }).code, 'unknown_record', 'a number that is not there refuses the whole call');
  assert.equal(api.execute('ignore', { ids: [] }).code, 'unknown_record');
  const restored = api.execute('restore', { ids: every });
  assert.deepEqual([restored.outcome, restored.changed], ['success', 3]);
  assert.equal(ids(api.execute('list', { tab: 'todo' })).length, 3);

  // the same records shared to one issue: a note for each, and they are all Done
  const open = issues.add({ title: '补票据' }, { actor: 'owner' }).issue;
  const shared = api.execute('share', { ids: every, issue: open.id });
  assert.deepEqual([shared.outcome, shared.changed], ['success', 3]);
  assert.equal(issues.get(open.id).log.filter((entry: any) => entry.kind === 'note' && entry.data?.source === 'connector').length, 3);
  assert.deepEqual(ids(api.execute('list', { tab: 'done' })).sort(), ['来信 a', '来信 b', '来信 c']);
  assert.equal(api.execute('share', { ids: every, issue: open.id }).outcome, 'no_op', 'all of them are in it already');
});

test('delete: the record is in no tab, Restore brings it back to the tab it was in, and the same message is not collected again', (t) => {
  const { api, issues, inbox, ingest } = world(t);
  const [a, b, c] = ingest('mail', [raw('a'), raw('b'), raw('c')]);
  api.execute('ignore', { id: b.id });
  api.execute('done', { id: c.id });
  for (const record of [a, b, c]) assert.equal(api.execute('delete', { id: record.id }).outcome, 'success');
  for (const tab of ['todo', 'ignored', 'done']) assert.deepEqual(ids(api.execute('list', { tab })), [], `${tab} shows none of the deleted`);
  assert.equal(inbox.search('原文').length, 0, 'search does not offer them');
  assert.equal(inbox.list({}).items.length, 0, 'nor does the plain list');
  assert.equal(api.execute('get', { id: a.id }).outcome, 'success', 'by its number it is still there');

  // collecting the same messages again adds nothing
  const again = issues.inbox.ingest('mail', normalizeRecords([raw('a'), raw('b'), raw('c')]).records);
  assert.deepEqual([again.added.length, again.seen], [0, 3]);
  assert.equal(api.execute('delete', { id: a.id }).outcome, 'no_op');

  assert.equal(api.execute('restore', { id: a.id }).outcome, 'success');
  api.execute('restore', { id: b.id });
  api.execute('restore', { id: c.id });
  assert.deepEqual(ids(api.execute('list', { tab: 'todo' })), ['来信 a']);
  assert.deepEqual(ids(api.execute('list', { tab: 'ignored' })), ['来信 b'], 'b was ignored before it was deleted');
  assert.deepEqual(ids(api.execute('list', { tab: 'done' })), ['来信 c'], 'c was handled before it was deleted');
});

test('a record that became part of an issue cannot be deleted or handled, and a conversation that was handled or deleted starts a new row for new talk', (t) => {
  const { api, issues, inbox, ingest } = world(t);
  const [a] = ingest('mail', [raw('a'), raw('b')]);
  const issue = issues.add({ title: '核对合同' }, { actor: 'owner' }).issue;
  api.execute('link', { id: a.id, issue: issue.id });
  assert.equal(api.execute('delete', { id: a.id }).outcome, 'no_op');
  assert.equal(api.execute('done', { id: a.id }).outcome, 'no_op');
  assert.deepEqual(ids(api.execute('list', { tab: 'done' })), ['来信 a']);

  const talk = (text: string) => normalizeRecords([{ id: 'thread-1', title: '群聊', conversation: true, text, from: 'Bob' }]).records;
  const first = inbox.ingest('lark', talk('第一句')).added[0];
  const next = inbox.ingest('lark', talk('第一句\n第二句'));
  assert.equal(next.added.length + next.updated.length, 1, 'the talk goes on in the row that waits');
  assert.equal(api.execute('delete', { id: first.id }).outcome, 'success');
  const after = inbox.ingest('lark', talk('第一句\n第二句\n第三句'));
  assert.equal(after.updated.length, 0, 'a deleted row is not woken by new talk');
  assert.equal(after.added.length, 1, 'new talk is a new row');
});
