// What the Collector widget reads and does (host/assistant/inbox/api.mjs and the owner's marks in inbox/store.mjs): the two tabs, the filter,
// marking handled and restoring (one record or several), sharing records to an issue or to the session of one, and the record that became an issue.
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
const later = () => new Promise((resolve) => setImmediate(resolve));

test('more context for a record starts at once and runs in the background: the record says it is being completed, then it has grown, or says why it could not', async (t) => {
  let finish: (answer: any) => void = () => {};
  const asked: number[] = [];
  const { api, ingest } = world(t, { fill: (id: number) => { asked.push(id); return new Promise((resolve) => { finish = resolve; }); } });
  const [row] = ingest('lark', [raw('a')]);
  const status = () => (api.execute('get', { id: row.id }) as any).record;
  assert.deepEqual(api.execute('complete', { id: row.id }), { outcome: 'success', started: true });
  assert.deepEqual(api.execute('complete', { id: row.id }), { outcome: 'success', started: true }, 'asked again while it runs, nothing starts twice');
  await later();
  assert.deepEqual(asked, [row.id]);
  assert.equal(status().completing, true);
  finish({ outcome: 'error', message: 'The thread could not be read.' });
  await later();
  assert.deepEqual([status().completing, status().completeError], [false, 'The thread could not be read.']);
  assert.equal((api.execute('complete', { id: row.id }) as any).started, true);
  assert.deepEqual([status().completing, status().completeError], [true, null], 'a new try starts clean');
  await later(); // the work is asked for a moment after the answer
  finish({ outcome: 'success', added: 3 });
  await later();
  assert.deepEqual([status().completing, status().completeError], [false, null]);
  assert.equal((api.execute('complete', { id: 9999 }) as any).code, 'unknown_record');
  assert.equal((api.execute('complete', {}) as any).outcome, 'needs_clarification');
  const bare = world(t);
  const [other] = bare.ingest('lark', [raw('b')]);
  assert.equal((bare.api.execute('complete', { id: other.id }) as any).code, 'unavailable');
});

test('the tabs: waiting rows (judged or not) are To do, a row with an issue or one the owner marked handled is Done, and there is no other tab', (t) => {
  const { issues, inbox, api, ingest } = world(t);
  const [a, b, , d] = ingest('mail', [raw('a', { at: '2026-11-05T09:00:00+08:00' }), raw('b', { at: '2026-11-05T08:00:00+08:00' }), raw('c'), raw('d')]);
  const issue = issues.add({ title: '核对合同', source: 'connector', sourceRef: 'mail:a' }, { actor: 'dudu' }).issue;
  inbox.judge(a.id, { verdict: 'issue', issueId: issue.id, reason: '有人在等' });
  inbox.judge(b.id, { verdict: 'ignore', reason: '像是抄送' });
  assert.equal(api.execute('done', { id: d.id }).outcome, 'success');

  assert.deepEqual(ids(api.execute('list', { tab: 'todo' })), ['来信 c', '来信 b'], 'what was not made an issue and not handled, judged by 嘟嘟 or not; c has no time of its own, so it shows when it was collected: now');
  const done = api.execute('list', { tab: 'done' });
  assert.deepEqual(ids(done), ['来信 d', '来信 a'], 'newest first: d has no time of its own either');
  const made = done.items.find((item: any) => item.issue);
  assert.deepEqual(made.issue, { id: issue.id, ref: issue.ref, title: '核对合同', status: 'todo', statusType: 'todo' });
  assert.equal(made.connectorName, 'QQ 邮箱');
  assert.equal(api.execute('list', { tab: 'ignored' }).code, 'invalid_tab', 'the Ignored tab is gone');
});

test('marking a row handled takes it away from 嘟嘟 too, restoring gives it back, and a row that has an issue cannot be marked', (t) => {
  const { issues, inbox, api, ingest } = world(t);
  const [a, b] = ingest('mail', [raw('a'), raw('b')]);
  assert.equal(api.execute('done', { id: a.id }).outcome, 'success');
  assert.equal(api.execute('done', { id: a.id }).outcome, 'no_op', 'twice changes nothing');
  assert.deepEqual(inbox.pending('mail').map((row: any) => row.id), [b.id], 'a row the owner marked handled is not judged');
  assert.equal(inbox.waiting('mail'), 1);
  assert.equal(inbox.judge(a.id, { verdict: 'issue', issueId: null, reason: '' }), false, 'and a judgement that was on its way to it is not written');
  assert.equal(api.execute('restore', { id: a.id }).outcome, 'success');
  assert.deepEqual(inbox.pending('mail').map((row: any) => row.id), [a.id, b.id], 'back where it was: not judged yet');
  assert.equal(api.execute('restore', { id: a.id }).outcome, 'no_op');
  const issue = issues.add({ title: '已经是事项' }, { actor: 'owner' }).issue;
  inbox.judge(b.id, { verdict: 'issue', issueId: issue.id, reason: '' });
  assert.equal(api.execute('done', { id: b.id }).outcome, 'no_op');
  assert.equal(api.execute('done', { id: 9999 }).outcome, 'needs_clarification');
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

test('done, restore and share take several records at once: all or none by number, one change for each, and "nothing changed" when none did', (t) => {
  const { issues, api, ingest } = world(t);
  const rows = ingest('mail', [raw('a'), raw('b'), raw('c')]);
  const every = rows.map((row: any) => row.id);
  const handled = api.execute('done', { ids: every.slice(0, 2) });
  assert.deepEqual([handled.outcome, handled.changed], ['success', 2]);
  assert.deepEqual(ids(api.execute('list', { tab: 'done' })).sort(), ['来信 a', '来信 b']);
  assert.deepEqual(ids(api.execute('list', { tab: 'todo' })), ['来信 c']);
  const again = api.execute('done', { ids: every.slice(0, 2) });
  assert.equal(again.outcome, 'no_op');
  const mixed = api.execute('done', { ids: every });
  assert.deepEqual([mixed.outcome, mixed.changed], ['success', 1], 'only the one that was not handled changed');
  assert.equal(api.execute('done', { ids: [every[0], 9999] }).code, 'unknown_record', 'a number that is not there refuses the whole call');
  assert.equal(api.execute('done', { ids: [] }).code, 'unknown_record');
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
  api.execute('done', { id: c.id });
  for (const record of [a, b, c]) assert.equal(api.execute('delete', { id: record.id }).outcome, 'success');
  for (const tab of ['todo', 'done']) assert.deepEqual(ids(api.execute('list', { tab })), [], `${tab} shows none of the deleted`);
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
  assert.deepEqual(ids(api.execute('list', { tab: 'todo' })).sort(), ['来信 a', '来信 b']);
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

test('owner marks read only summaries, without loading message bodies or scanning nearby thread records', (t) => {
  const { inbox, api, ingest } = world(t);
  const rows = ingest('mail', [raw('a', { thread: 'room' }), raw('b', { thread: 'room' })]);
  const detail = inbox.get(rows[0].id);
  assert.equal(detail.record.text, 'a 的原文');
  assert.equal(detail.thread.length, 1, 'the normal detail read keeps its thread');
  const summary = inbox.get(rows[0].id, { summary: true });
  assert.equal(Object.hasOwn(summary.record, 'text'), false);
  assert.deepEqual(summary.thread, []);

  const get = inbox.get;
  const reads: any[] = [];
  inbox.get = (id: number, options: any) => {
    assert.equal(options?.summary, true, 'a mark must not load full details');
    reads.push(id);
    return get(id, options);
  };
  const ids = rows.map((record: any) => record.id);
  for (const action of ['done', 'delete', 'restore', 'restore', 'done', 'restore']) {
    reads.length = 0;
    const result = api.execute(action, { ids });
    assert.equal(result.outcome, 'success');
    assert.equal(result.changed, 2);
    assert.equal(reads.length, 3, 'validate each id, then read only the single response card');
    assert.equal(Object.hasOwn(result.record, 'text'), false);
  }
});

test('a removed collector takes with it what the owner never dealt with; what they marked or made an issue of, and other collectors\' rows, stay', (t) => {
  const { issues, inbox, api, ingest } = world(t);
  const [open1, open2, handled, linked, deleted] = ingest('mail', [raw('open1'), raw('open2'), raw('handled'), raw('linked'), raw('deleted')]);
  const [other] = ingest('lark', [raw('other')]);
  assert.equal(api.execute('done', { id: handled.id }).outcome, 'success');
  assert.equal(api.execute('delete', { id: deleted.id }).outcome, 'success');
  const issue = issues.add({ title: '核对', source: 'connector', sourceRef: 'mail:linked' }, { actor: 'dudu' }).issue;
  inbox.judge(linked.id, { verdict: 'issue', issueId: issue.id, reason: 'x' });
  assert.equal(inbox.search('open1', { connector: 'mail' }).length, 1);

  assert.equal(inbox.dropUntouched('mail'), 2, 'the two nobody touched');
  assert.equal(inbox.get(open1.id), null);
  assert.equal(inbox.get(open2.id), null);
  assert.deepEqual(inbox.search('open1', { connector: 'mail' }), [], 'and they are not found by search either');
  for (const kept of [handled, linked, other]) assert.ok(inbox.get(kept.id), `row ${kept.id} stays`);
  assert.deepEqual(ids(api.execute('list', { tab: 'done' })).sort(), ['来信 handled', '来信 linked']);
  assert.equal(inbox.dropUntouched('mail'), 0, 'a second time changes nothing');
  assert.equal(inbox.dropUntouched('nothing'), 0);
});
