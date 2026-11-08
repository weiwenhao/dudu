// The collector's own parts (docs/assistant.md 3.1): the records a collection session hands back and how they are checked, the inbox that keeps
// them, how often a collector runs, and the queue that does it. The flow through dispatch is in assistant-dispatch.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRecords, RECORD_LIMITS } from '../host/assistant/inbox/records.mjs';
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
