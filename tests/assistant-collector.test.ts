// The collector's own parts (docs/assistant.md 3.1): the records a collection session hands back and how they are checked, the inbox that keeps
// them, how often a collector runs, and the queue that does it. The flow through dispatch is in assistant-dispatch.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeMessages, normalizeRecords, RECORD_LIMITS } from '../host/assistant/inbox/records.mjs';
import { KEEP_ROW_MS, KEEP_TEXT_MS } from '../host/assistant/inbox/store.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createScheduler, DEFAULT_EVERY_MS, frequencyOf, parseFrequency } from '../host/assistant/schedule/index.mjs';

const SECRET = 'sk-test-0123456789abcdefghijklmnop';
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 4, 12).getTime();
const raw = (id: string, extra: any = {}) => ({ id, title: `来信 ${id}`, text: `${id} 的原文`, from: 'Alice', ...extra });

function inboxWorld(t: any) {
  const clock = { now: NOW };
  const issues = createIssues({ file: ':memory:', now: () => clock.now });
  t.after(() => issues.close());
  return { clock, issues, inbox: issues.inbox, ingest: (connector: string, list: any[]) => issues.inbox.ingest(connector, normalizeRecords(list).records) };
}

// ---------------------------------------------------------------- records

test('what a session read around a message stays with it when the messages of a conversation become one record: a bare mention keeps the messages it refers to, oldest first, once', () => {
  // The owner's bare @ (2026-11-11): the session knew the thread and gave the messages before it as `context`; they were dropped when the thread's messages were put in one record.
  const [talk] = normalizeRecords([{
    id: 'm9', kind: 'message', thread: 'omt_1', from: 'Frank Wang', at: '2026-11-11T04:07:00+08:00', text: '@Wenhao Wei',
    context: [
      { from: 'SigmaAI-QA', at: '2026-11-11T03:47:00+08:00', text: '两个条件不满足，14:00 就会卡住' },
      { from: 'Frank Wang', at: '2026-11-11T04:07:00+08:00', text: '@Wenhao Wei' }, // the message itself, read again: not added twice
      { from: 'Frank Wang', at: '2026-11-11T03:43:00+08:00', text: '路径和负责人定了' }, // not in order: the times put it right
    ],
  }]).records;
  assert.equal(talk.conversation, true);
  const lines = talk.text.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Frank Wang：路径和负责人定了$/);
  assert.match(lines[1], /SigmaAI-QA：两个条件不满足/);
  assert.match(lines[2], /Frank Wang：@Wenhao Wei$/);
  assert.ok(lines.every((line) => /^\d{2}-\d{2} \d{2}:\d{2} /.test(line)), 'each still begins like a message, so the conversation can take more of them later');
  // Without a time the line takes the first message's; a mail keeps its context as a context.
  const [untimed] = normalizeRecords([{ id: 'm1', kind: 'message', thread: 't', from: 'A', at: '2026-11-11T04:07:00+08:00', text: '好', context: [{ from: 'B', text: '先说' }] }]).records;
  assert.equal(untimed.text.split('\n').length, 2);
  assert.match(untimed.text.split('\n')[0], /^\d{2}-\d{2} \d{2}:\d{2} B：先说$/);
  const [mail] = normalizeRecords([{ id: 'x', kind: 'mail', title: '发票', text: '见附件', context: [{ from: 'B', text: '上一封' }] }]).records;
  assert.equal(mail.context.length, 1);
});

test('more context for a record: its conversation takes the messages the session read, in the order of their times and once; any other record keeps the context it read; whatever the row\'s state', (t) => {
  const { inbox, ingest } = inboxWorld(t);
  const [bare] = ingest('lark', [{ id: 'm9', kind: 'message', thread: 'omt_1', from: 'Frank Wang', at: '2026-11-11T04:07:00+08:00', text: '@我' }]).added;
  assert.equal(bare.text.split('\n').length, 1);
  const read = normalizeRecords([
    { id: 'm2', kind: 'message', thread: 'omt_1', from: 'Frank Wang', at: '2026-11-11T04:30:00+08:00', text: '看到请回我' },
    { id: 'm1', kind: 'message', thread: 'omt_1', from: 'SigmaAI-QA', at: '2026-11-11T03:47:00+08:00', text: '两个条件不满足，14:00 就会卡住' },
    { id: 'm9', kind: 'message', thread: 'omt_1', from: 'Frank Wang', at: '2026-11-11T04:07:00+08:00', text: '@我' },
  ]).records;
  assert.equal(inbox.done(bare.id), true);
  assert.deepEqual(inbox.addContext(bare.id, read), { outcome: 'success', added: 2 });
  const grown = inbox.get(bare.id).record;
  assert.deepEqual(grown.text.split('\n').map((line: string) => line.replace(/^\d\d-\d\d \d\d:\d\d /, '')), ['SigmaAI-QA：两个条件不满足，14:00 就会卡住', 'Frank Wang：@我', 'Frank Wang：看到请回我']);
  assert.equal(grown.state, 'new', 'it is the same row: nothing else about it changed');
  assert.deepEqual(inbox.addContext(bare.id, read), { outcome: 'success', added: 0 }, 'again adds nothing');
  assert.equal(inbox.search('卡住').length, 1, 'and what was added can be searched');
  const [mail] = ingest('lark', [{ id: 'x', kind: 'mail', title: '发票', text: '见附件' }]).added;
  const upper = normalizeRecords([{ id: 'x', kind: 'mail', title: '发票', text: '见附件', context: [{ from: 'B', at: '2026-11-11T03:00:00+08:00', text: '上一封' }] }]).records;
  assert.deepEqual(inbox.addContext(mail.id, upper), { outcome: 'success', added: 1 });
  assert.equal(inbox.get(mail.id).record.context[0].text, '上一封');
  assert.equal(inbox.addContext(9999, read).code, 'unknown_record');
  assert.equal(inbox.list({}).items.length, 2, 'no row was made');
  // Messages that have no times cannot be put in order: the new ones go in front.
  assert.deepEqual([mergeMessages('b', 'a').text, mergeMessages('b', 'a').added], ['a\nb', 1]);
});

test('an item given again with update carries only what it gives: it is no message of a conversation, no title is made up for it, and it needs an id and something to change', () => {
  // The owner's alert collector (2026-11-14): a reply under an alert means it is over, and the alert's row is changed instead of another row written.
  const out = normalizeRecords([
    { id: 'a1', update: true, title: '已恢复 · CPU 高', text: '' },
    { id: 'a1', update: true, title: 'twice' },
    { id: 'm1', kind: 'message', thread: 'omt_1', from: 'A', at: '2026-11-11T04:07:00+08:00', text: '告警' },
    { id: 'm1', update: true, kind: 'message', thread: 'omt_1', text: '告警，已恢复' },
    { id: 'x', update: true },
    { id: 'y', update: 'true', from: 'Bob', url: 'javascript:alert(1)', at: '2026-11-11T04:07:00+08:00' },
  ]);
  assert.deepEqual(out.records.map((r: any) => (r.update ? `update:${r.sourceId}` : r.sourceId)), ['update:a1', 'thread:omt_1', 'update:m1', 'update:y']);
  assert.deepEqual(out.records[0].changes, { title: '已恢复 · CPU 高' });
  assert.equal(out.records[2].thread, 'omt_1');
  assert.equal(out.records[2].title, undefined);
  assert.deepEqual(Object.keys(out.records[3].changes).sort(), ['at', 'author'], 'a link that is not http(s) is not taken');
  assert.deepEqual(out.rejected.map((r: any) => [r.index, r.id]), [[4, 'x']]);
  assert.equal(out.duplicates, 1, 'the same item twice in one answer is one update');
});

test('an update changes the row that holds the item and makes none: the owner\'s marks, its issue and its number stay, a search finds the new words, and an item the inbox does not have is not added', (t) => {
  const w = inboxWorld(t);
  const [alert] = w.ingest('alerts', [raw('a1', { title: 'CPU 高 · db1', text: '告警正文', from: '监控' })]).added;
  const [other] = w.ingest('alerts', [raw('a2', { title: 'CPU 高 · db2' })]).added;
  const issue = w.issues.add({ title: '处理 db2' }).issue;
  assert.equal(w.inbox.done(alert.id), true);
  assert.equal(w.inbox.link(other.id, { issueId: issue.id, verdict: 'issue' }), true);

  const first = w.ingest('alerts', [{ id: 'a1', update: true, title: '已恢复 · CPU 高 · db1' }, { id: 'a2', update: true, title: '已恢复 · CPU 高 · db2' }]);
  assert.deepEqual([first.added.length, first.updated.length, first.seen, first.missed], [0, 2, 0, 0]);
  const now = w.inbox.get(alert.id).record;
  assert.deepEqual([now.title, now.ref, now.version, now.text, now.from], ['已恢复 · CPU 高 · db1', alert.ref, alert.version, '告警正文', '监控'], 'what is not given stays, and so does the number');
  assert.notEqual(now.doneAt, null, 'the owner\'s mark stays');
  const linked = w.inbox.get(other.id).record;
  assert.deepEqual([linked.title, linked.issueId, linked.byOwner], ['已恢复 · CPU 高 · db2', issue.id, true], 'so does the issue it became');
  assert.equal(w.inbox.list({}).items.length, 2, 'no row was made');
  assert.equal(w.inbox.search('已恢复').length, 2);
  assert.equal(w.inbox.search('db1').length, 1, 'the words that were not changed are found as before');

  const again = w.ingest('alerts', [{ id: 'a1', update: true, title: '已恢复 · CPU 高 · db1' }]);
  assert.deepEqual([again.updated.length, again.seen], [0, 1], 'the same update again changes nothing');
  const none = w.ingest('alerts', [{ id: 'zz', update: true, title: '没有的' }]);
  assert.deepEqual([none.added.length, none.updated.length, none.missed], [0, 0, 1]);
  assert.equal(w.ingest('other', [{ id: 'a1', update: true, title: '别的收集器' }]).missed, 1, 'another collector\'s item is not touched');
  assert.equal(w.inbox.list({}).items.length, 2);
});

test('an update finds a conversation by its thread and has the last word of an answer that also brings the talk; a deleted row is left alone and a cleared one keeps its text cleared', (t) => {
  const w = inboxWorld(t);
  const [talk] = w.ingest('alerts', [{ id: 'm1', kind: 'message', thread: 'omt_1', title: 'CPU 高', from: '监控', at: '2026-11-11T04:07:00+08:00', text: '告警 db1' }]).added;
  assert.equal(talk.sourceId, 'thread:omt_1');
  // The reply comes as a message of the thread, and the alert is said to be over: the talk takes the message (and its title), then the update says what the title is.
  const out = w.ingest('alerts', [
    { id: 'm2', kind: 'message', thread: 'omt_1', title: '收到', from: '张三', at: '2026-11-11T04:12:00+08:00', text: '收到，在看' },
    { id: 'm1', update: true, thread: 'omt_1', title: '已恢复 · CPU 高' },
  ]);
  assert.deepEqual([out.added.length, out.updated.length], [0, 1], 'one row changed, once');
  const row = w.inbox.get(talk.id).record;
  assert.equal(row.title, '已恢复 · CPU 高');
  assert.equal(row.text.split('\n').length, 2, 'and the talk has both messages');

  assert.equal(w.inbox.remove(talk.id), true);
  assert.equal(w.ingest('alerts', [{ id: 'm1', update: true, thread: 'omt_1', title: '又改了' }]).missed, 1, 'a row the owner deleted is not changed');
  assert.equal(w.inbox.restore(talk.id), true);

  // After 30 days the text of a row the owner marked handled is cleared; an update may still change its title, and the text stays cleared.
  assert.equal(w.inbox.done(talk.id), true);
  w.clock.now += KEEP_TEXT_MS + DAY;
  assert.deepEqual(w.inbox.prune(), { cleared: 1, deleted: 0 });
  const late = w.ingest('alerts', [{ id: 'm1', update: true, thread: 'omt_1', title: '已恢复 · CPU 高 · 补记', text: '新的正文' }]);
  assert.equal(late.updated.length, 1);
  const kept = w.inbox.get(talk.id).record;
  assert.deepEqual([kept.title, kept.text, kept.cleared], ['已恢复 · CPU 高 · 补记', '', true]);

  // The item's own id comes first: a row of that id is changed, not the newer conversation the update says the item is in.
  const [own] = w.ingest('alerts', [raw('a9', { title: '自己的行' })]).added;
  const [chat] = w.ingest('alerts', [{ id: 'c1', kind: 'message', thread: 'oc_9', title: '群聊', from: 'A', at: '2026-11-11T05:00:00+08:00', text: '聊天' }]).added;
  w.ingest('alerts', [{ id: 'a9', update: true, thread: 'oc_9', title: '改了自己的' }]);
  assert.deepEqual([w.inbox.get(own.id).record.title, w.inbox.get(chat.id).record.title], ['改了自己的', '群聊']);
});

test('a record is checked field by field; secrets are blanked, a link must be http(s), and nothing a model wrote is trusted as it is', () => {
  const out = normalizeRecords([
    raw('m1', { text: `第 3 条请确认 ${SECRET}`, url: 'https://mail.test/m1', kind: 'MAIL', at: '2026-11-03T09:00:00+08:00', context: [{ from: 'Bob', text: '前一条', at: '2026-11-03T08:50:00+08:00' }, 'junk'] }),
    raw('m2', { url: 'javascript:alert(1)', kind: 'weird', title: 'a‮b\u0007c' }),
    raw(`https://x.test/?token=${SECRET}`, { url: `https://x.test/?token=${SECRET}` }),
  ]);
  assert.equal(out.records.length, 3);
  const [first, second, third] = out.records;
  assert.equal(first.text, '第 3 条请确认 [redacted]');
  assert.equal(first.kind, 'mail');
  assert.equal(first.url, 'https://mail.test/m1');
  assert.equal(first.at, Date.parse('2026-11-03T09:00:00+08:00'));
  assert.deepEqual(first.context.map((c: any) => c.from), ['Bob']);
  assert.equal(second.url, '', 'a link that is not http(s) is dropped');
  assert.equal(second.kind, 'other');
  assert.equal(second.title, 'abc', 'control and bidirectional characters are removed');
  assert.match(third.sourceId, /^ref-[0-9a-f]{16}$/, 'an id that holds a secret becomes a stand-in that is the same every time');
  assert.equal(third.url, '');
  assert.equal(normalizeRecords([raw(`https://x.test/?token=${SECRET}`)]).records[0].sourceId, third.sourceId);
  assert.ok(!JSON.stringify(out).includes(SECRET));
});

test('a bad record is rejected with its reason and the others stay; what was cut or left out is counted, not silent', () => {
  const list: any[] = [raw('ok'), { title: 'no id' }, { id: 'empty' }, 'text', raw('ok'), raw('long', { text: 'x'.repeat(RECORD_LIMITS.text + 500) })];
  const out = normalizeRecords(list);
  assert.deepEqual(out.records.map((r: any) => r.sourceId), ['ok', 'long']);
  assert.deepEqual(out.rejected.map((r: any) => r.index), [1, 2, 3]);
  assert.equal(out.duplicates, 1, 'the same id and version twice in one answer is one record');
  assert.equal(out.truncated, 1);
  assert.equal(out.records[1].text.length, RECORD_LIMITS.text);
  const many = normalizeRecords(Array.from({ length: RECORD_LIMITS.records + 7 }, (_, n) => raw(`m${n}`)));
  assert.equal(many.records.length, RECORD_LIMITS.records);
  assert.equal(many.dropped, 7);
  assert.deepEqual(normalizeRecords('not a list' as any).records, []);
});

test('a title the session left out is the first words of what the record says, never a blank row; a title it gave is kept', () => {
  // The Collector showed a blank row (owner, 2026-11-11, records 135, 136 and 149): the prompt never asked for a title, and the session left it out of the messages it gave.
  const said = '文豪，下午我会发布一次bff，发布之后要麻烦你将三个API转发到bff';
  const { records } = normalizeRecords([
    { id: 'm1', kind: 'message', thread: 'oc_1', from: 'Cheng', at: '2026-11-11T11:45:00+08:00', text: `https://app.notion.com/p/slug-415c ${said}` },
    { id: 'm2', kind: 'message', thread: 'oc_1', from: 'Cheng', at: '2026-11-11T11:49:00+08:00', text: said },
    { id: 'p1', kind: 'page', text: 'https://example.com/a/b?x=1' },
    { id: 'p2', kind: 'page', text: '很长'.repeat(80) },
    { id: 'n1', kind: 'mail', title: '会议纪要', text: '正文' },
  ]);
  const titleOf = (sourceId: string) => records.find((record: any) => record.sourceId === sourceId)?.title;
  assert.equal(titleOf('thread:oc_1'), said); // the newest message of the talk, the link left out
  assert.equal(titleOf('p1'), 'example.com'); // only a link: its host
  assert.equal([...titleOf('p2')].length, 60);
  assert.ok(titleOf('p2').endsWith('…'));
  assert.equal(titleOf('n1'), '会议纪要');
});

test('rows kept without a title are given one from their text, once, and are found by it; a row that has a title is left alone', (t) => {
  const { inbox } = inboxWorld(t);
  const row = (sourceId: string, extra: any) => ({ sourceId, version: 'v1', kind: 'message', title: '', author: 'Cheng', url: '', thread: '', at: NOW, context: [], more: '', truncated: false, ...extra });
  const { added } = inbox.ingest('lark', [
    row('thread:oc_1', { thread: 'oc_1', conversation: true, text: '11-11 11:45 Cheng：第一句\n11-11 11:49 Cheng：文豪，下午我会发布一次bff' }),
    row('m2', { kind: 'mail', text: '正文第一句\n第二行' }),
    row('m3', { title: '它自己的标题', text: '别的字' }),
  ]);
  assert.equal(inbox.repairTitles(), 2);
  assert.deepEqual(added.map((item: any) => inbox.get(item.id).record.title), ['文豪，下午我会发布一次bff', '正文第一句 第二行', '它自己的标题']);
  assert.equal(inbox.repairTitles(), 0);
  assert.equal(inbox.search('发布一次bff', { connector: 'lark' }).length, 1);
});

test('without a version the text is the version: an edit is a new version, the same text again is not', () => {
  const a = normalizeRecords([raw('m1')]).records[0];
  assert.equal(normalizeRecords([raw('m1')]).records[0].version, a.version);
  assert.notEqual(normalizeRecords([raw('m1', { text: 'edited' })]).records[0].version, a.version);
  assert.equal(normalizeRecords([raw('m1', { version: '2026-11-03T10:00:00Z' })]).records[0].version, '2026-11-03T10:00:00Z');
});

test('the inbox keeps one row per connector, id and version, numbers only what it keeps, and judges a record once', (t) => {
  const w = inboxWorld(t);
  const first = w.ingest('mail', [raw('m1'), raw('m2')]);
  assert.deepEqual(first.added.map((r: any) => r.ref), ['r1', 'r2']);
  const again = w.ingest('mail', [raw('m1'), raw('m2'), raw('m3')]);
  assert.equal(again.seen, 2);
  assert.deepEqual(again.added.map((r: any) => r.ref), ['r3'], 'a record that was kept already does not use up a number');
  assert.equal(w.ingest('other', [raw('m1')]).added.length, 1, 'the same id in another connector is another record');
  assert.deepEqual(w.inbox.pending('mail').map((r: any) => r.ref), ['r1', 'r2', 'r3']);
  assert.equal(w.inbox.judge(1, { verdict: 'ignore', reason: 'chat' }), true);
  assert.equal(w.inbox.judge(1, { verdict: 'issue' }), false, 'a judged record is not judged again');
  assert.deepEqual(w.inbox.pending('mail').map((r: any) => r.ref), ['r2', 'r3']);
  assert.equal(w.inbox.waiting('mail'), 2);
});

test('old text is cleared after 30 days unless the record belongs to an issue, and the row goes after a year', (t) => {
  const w = inboxWorld(t);
  const issue = (w.issues.add({ title: '合同' }) as any).issue;
  w.ingest('mail', [raw('keep', { text: '证据' }), raw('old', { text: '闲聊' }), raw('waiting', { text: '还没整理' })]);
  w.inbox.judge(1, { verdict: 'issue', issueId: issue.id });
  w.inbox.judge(2, { verdict: 'ignore' });
  w.clock.now += KEEP_TEXT_MS + DAY;
  assert.deepEqual(w.inbox.prune(), { cleared: 1, deleted: 0 });
  assert.equal(w.inbox.get(1)!.record.text, '证据');
  assert.equal(w.inbox.get(2)!.record.text, '');
  assert.equal(w.inbox.get(2)!.record.cleared, true);
  assert.equal(w.inbox.get(3)!.record.text, '还没整理');
  assert.deepEqual(w.inbox.search('闲聊'), [], 'cleared text is not searchable any more');
  assert.equal(w.ingest('mail', [raw('old', { text: '闲聊' })]).seen, 1, 'but the row still stops it from coming back as new');
  w.clock.now += KEEP_ROW_MS;
  assert.deepEqual(w.inbox.prune(), { cleared: 0, deleted: 1 });
  assert.equal(w.inbox.get(2), null);
  assert.ok(w.inbox.get(1));
});

// ---------------------------------------------------------------- how often

test('how often is 15m, 2h, 1d or five-field cron; shorter than five minutes and anything else is refused with a reason', () => {
  for (const [text, ms] of [['15m', 900_000], ['2h', 7_200_000], ['1d', DAY], ['5M', 300_000]] as const) {
    const parsed: any = parseFrequency(text);
    assert.deepEqual([parsed.ok, parsed.frequency.kind, parsed.frequency.ms], [true, 'every', ms], text);
  }
  assert.equal((parseFrequency('0 9-18 * * 1-5') as any).frequency.kind, 'cron');
  for (const bad of ['', '4m', '10', '0 9 * *', '@daily', '61 * * * *', '*/2 * * * *', '0,2 * * * *', 'soon']) assert.equal(parseFrequency(bad).ok, false, bad);
  assert.match((parseFrequency('4m') as any).message, /5 minutes/);
  assert.equal(frequencyOf(null).ms, DEFAULT_EVERY_MS);
  assert.equal(frequencyOf('nonsense').ms, DEFAULT_EVERY_MS, 'a frequency that cannot be read is collected at the default rate');
});

// ---------------------------------------------------------------- the queue

function queue(list: any[], { started = {}, runs = [] as string[], run }: any = {}) {
  const clock = { now: NOW };
  const log = { warn() {} };
  const last: Record<string, number | null> = { ...started };
  const scheduler = createScheduler({
    list: () => list, lastStarted: (id: string) => last[id] ?? null, now: () => clock.now, log,
    run: run ?? (async (id: string) => { runs.push(id); last[id] = clock.now; return { outcome: 'success', id }; }),
  });
  return { scheduler, clock, runs, last };
}

test('only what is due is collected, one at a time, and a restart finds the overdue ones and runs each once', async () => {
  const q = queue([{ id: 'fast', frequency: '15m' }, { id: 'slow', frequency: '1d' }, { id: 'plain', frequency: null }, { id: 'never', frequency: '1h' }], {
    started: { fast: NOW - 10 * 60_000, slow: NOW - 2 * 3_600_000, plain: NOW - 40 * 60_000 },
  });
  await q.scheduler.tick();
  assert.deepEqual(q.runs, ['plain', 'never'], 'fast is 10 minutes in, slow is not a day in; plain is past 30 minutes; never has not run');
  q.clock.now += 6 * 60_000;
  await q.scheduler.tick();
  assert.deepEqual(q.runs, ['plain', 'never', 'fast']);
  await q.scheduler.tick();
  assert.deepEqual(q.runs, ['plain', 'never', 'fast'], 'a second tick at once collects nothing again');
  await q.scheduler.dispose();
});

test('collections never overlap, one that is asked for twice is one, and a failure does not stop the next', async () => {
  let active = 0;
  let most = 0;
  const order: string[] = [];
  const q = queue([{ id: 'a', frequency: '5m' }, { id: 'b', frequency: '5m' }, { id: 'c', frequency: '5m' }], {
    run: async (id: string) => {
      active++; most = Math.max(most, active);
      await new Promise((done) => setTimeout(done, 5));
      active--; order.push(id);
      if (id === 'b') throw new Error('offline');
      return { outcome: 'success' };
    },
  });
  const both = [q.scheduler.runNow('a'), q.scheduler.runNow('a'), q.scheduler.runNow('b'), q.scheduler.runNow('c')];
  const results: any[] = await Promise.all(both);
  assert.equal(most, 1);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.strictEqual(results[0], results[1], 'asking for a connector that is waiting gives the same answer');
  assert.deepEqual([results[2].outcome, results[3].outcome], ['error', 'success']);
  await q.scheduler.dispose();
  assert.equal((await q.scheduler.runNow('a') as any).outcome, 'no_op');
});
