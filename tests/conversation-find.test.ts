import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationFinder, findDocument, findOccurrences, initialFindIndex, matchDocuments, nextFindIndex, sameFindHit } from '../host/dudu-plugin/ui/lib/conversation-find.js';

const text = (value: string) => ({ type: 'text', text: value });
const user = (seq: number, value: string) => ({
  seq, type: 'user/message', surfaceOp: 'append',
  data: { source: { kind: 'user' }, content: [text(value)] },
});
const assistant = (seq: number, content: object[]) => ({
  seq, type: 'assistant/message', surfaceOp: 'append', data: { message: { content } },
});
const record = (event: object) => ({ type: 'event', event });
const reference = (events: object[], hasMore = false, sessionId = 'current') => {
  const snapshot = { entries: events.map(record), hasMore };
  return { snapshot, binding: { sessionId, eventSource: { getSnapshot: () => snapshot } } };
};
const signal = () => new AbortController().signal;
const yieldWork = async () => {};

test('conversation find treats punctuation literally and matches Unicode and rendered line breaks', () => {
  assert.deepEqual(findOccurrences('a+b [x] a.b aab', 'a+b'), [{ start: 0, end: 3 }]);
  assert.equal(findOccurrences('a+b [x] a.b aab', '[x]').length, 1);
  assert.equal(findOccurrences('a+b [x] a.b aab', 'a.b').length, 1);
  assert.equal(findOccurrences('ProxySQL proxysql PROXYSQL', 'proxysql').length, 3);
  assert.deepEqual(findOccurrences('开始 中文\n查找 结束', ' 中文 查找 '), [{ start: 3, end: 8 }]);
  assert.deepEqual(findOccurrences('anything', '  '), []);
});

test('search indexes readable Markdown and reasoning, excluding signatures, URLs, tools and compaction copies', () => {
  const event = assistant(7, [
    { type: 'reasoning', text: '<signature>private-signature</signature>\n**检查**连接' },
    text('# **连接**检查\n\n[连接说明](https://hidden.invalid) ![连接图片](hidden.png)\n\n~~已删除~~\n\n| 连接 | 状态 |\n| --- | --- |\n| 本地 | 正常 |\n\n```txt\n连接代码\n```'),
    { type: 'tool-call', arguments: { private: '连接' } },
  ]);
  const document = findDocument(event)!;
  assert.equal(matchDocuments([document], '连接').length, 5);
  assert.deepEqual(matchDocuments([document], '连接').map(hit => hit.part), ['reasoning', 'text', 'text', 'text', 'text']);
  for (const hidden of ['private-signature', 'hidden.invalid', '连接图片', '**', '~~', '|']) {
    assert.equal(matchDocuments([document], hidden).length, 0, hidden);
  }
  assert.equal(findDocument({ ...event, surfaceOp: { op: 'replace', startSeq: 0, endSeq: 6 } }), null);
  assert.equal(findDocument({ ...user(2, 'injected'), data: { source: { kind: 'system-prompt' }, content: [text('injected')] } }), null);
  assert.equal(findDocument({ seq: 3, type: 'tool/result', surfaceOp: 'append', data: { content: [text('连接')] } }), null);
  const blocks = findDocument(assistant(8, [text('first'), text('second')]))!;
  assert.equal(matchDocuments([blocks], 'first second').length, 0, 'separate rendered roots are not one hit');
  const notes = findDocument(assistant(9, [text('A note[^used].\n\n[^used]: visible footnote\n[^unused]: hidden footnote')]))!;
  assert.equal(matchDocuments([notes], 'visible footnote').length, 1);
  assert.equal(matchDocuments([notes], 'hidden footnote').length, 0, 'unreferenced definitions do not render');
  assert.equal(matchDocuments([findDocument(user(9, '**raw**'))!], '**raw**').length, 1, 'human messages are literal text');
});

test('whole-history find pages text without mounting it, reuses the cache and includes live messages', async () => {
  const ref = reference([user(80, 'recent needle'), assistant(90, [text('tail')])], true);
  const cursors: object[] = [];
  const find = createConversationFinder(async (id, page) => {
    assert.equal(id, 'current');
    cursors.push(page);
    return cursors.length === 1
      ? { records: [record(user(40, 'middle needle'))], hasMore: true }
      : { records: [record(user(1, 'old needle needle'))], hasMore: false };
  }, { yieldWork });
  const found = await find(ref, 'needle', signal());
  assert.deepEqual(found.map(hit => [hit.seq, hit.ordinal]), [[1, 0], [1, 1], [40, 0], [80, 0]]);
  assert.deepEqual(cursors, [{ throughSeq: 90, beforeSeq: 80 }, { throughSeq: 90, beforeSeq: 40 }]);
  assert.equal(ref.snapshot.entries.length, 2, 'passive search never writes older events into the visible window');
  await find(ref, 'middle', signal());
  assert.equal(cursors.length, 2, 'typing reuses completed text history');
  ref.snapshot.entries.push(record(assistant(100, [text('new needle')])));
  assert.deepEqual((await find(ref, 'needle', signal())).map(hit => hit.seq), [1, 1, 40, 80, 100]);
  assert.equal(cursors.length, 2, 'live messages are merged without rereading old pages');
  const distinct = reference([user(2, 'other needle')]);
  assert.deepEqual((await find(distinct, 'needle', signal())).map(hit => hit.seq), [2], 'bindings cannot share conversation text');
});

test('a cancelled page cannot publish its cursor or matches into the next query', async () => {
  const ref = reference([user(20, 'recent')], true);
  const cancelled = new AbortController();
  let reply!: (page: object) => void;
  let calls = 0;
  const find = createConversationFinder(async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { reply = resolve; });
    return { records: [record(user(1, 'replacement'))], hasMore: false };
  }, { yieldWork });
  const old = find(ref, 'obsolete', cancelled.signal);
  cancelled.abort();
  const rejected = assert.rejects(old, { name: 'AbortError' });
  const next = find(ref, 'replacement', signal());
  const concurrent = find(ref, 'replacement', signal());
  reply({ records: [record(user(1, 'obsolete'))], hasMore: false });
  await rejected;
  assert.deepEqual((await next).map(hit => hit.seq), [1]);
  assert.deepEqual((await concurrent).map(hit => hit.seq), [1], 'two surfaces share one history read');
  assert.equal(calls, 2);
  assert.deepEqual(await find(ref, 'obsolete', signal()), []);
});

test('cached scans yield for cancellation and a paging error never becomes a complete cache', async () => {
  const ref = reference(Array.from({ length: 65 }, (_, index) => user(index, 'needle')));
  const cancelled = new AbortController();
  let yielded = 0;
  const scan = createConversationFinder(async () => { throw new Error('already loaded'); }, {
    yieldWork: async () => { if (++yielded === 2) cancelled.abort(); },
  });
  await assert.rejects(scan(ref, 'needle', cancelled.signal), { name: 'AbortError' });
  const incomplete = reference([user(10, 'recent')], true);
  let calls = 0;
  const find = createConversationFinder(async () => {
    if (++calls === 1) throw new Error('read refused');
    return { records: [record(user(1, 'needle'))], hasMore: false };
  }, { yieldWork });
  await assert.rejects(find(incomplete, 'needle', signal()), /read refused/);
  assert.equal((await find(incomplete, 'needle', signal())).length, 1);
  const stuck = createConversationFinder(async () => ({ records: [record(user(10, 'same page'))], hasMore: true }), { yieldWork });
  await assert.rejects(stuck(incomplete, 'needle', signal()), /did not advance/);
});

test('match navigation wraps in transcript order and preserves only the exact occurrence', () => {
  assert.equal(nextFindIndex(0, 3, -1), 2);
  assert.equal(nextFindIndex(2, 3, 1), 0);
  assert.equal(nextFindIndex(-1, 0, 1), -1);
  const hits = matchDocuments([findDocument(user(10, 'needle'))!, findDocument(user(1, 'needle needle'))!], 'needle');
  assert.deepEqual(hits.map(hit => hit.seq), [1, 1, 10]);
  assert.equal(initialFindIndex(hits, 9), 2, 'start near the current window rather than loading the oldest match automatically');
  assert.equal(initialFindIndex(hits, undefined), 2);
  assert.equal(initialFindIndex([], 9), -1);
  assert.equal(sameFindHit(hits[0], { ...hits[0] }), true);
  assert.equal(sameFindHit(hits[0], hits[1]), false);
});
