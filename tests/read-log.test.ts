import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanReadSource, readLine } from '../host/read-log.mjs';
import { sessionActivityProjection as projection } from '../host/assistant/sessions/activity-projection.mjs';
import { createReadReceipts } from '../host/assistant/sessions/read-receipts.mjs';
import { createSessionActivity } from '../host/assistant/sessions/session-activity.mjs';

const message = (seq: number, value = 'Answer') => ({
  type: 'assistant/message', surfaceOp: 'append', seq, time: 1000 + seq,
  data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: value }] } },
});
const complete = (state: any, event: ReturnType<typeof message>) => projection.apply(projection.apply(state, event), {
  type: 'turn/end', seq: event.seq + 1, time: event.time, data: { turn: event.data.turn, reason: { kind: 'completed' } },
});

test('the read log says which screen made a conversation read and how, whether it was unread before and after, and says nothing of a read that moved nothing', async () => {
  const receipts = createReadReceipts({ file: ':memory:' });
  const lines: any[] = [];
  let attention: any = complete(projection.init(), message(4));
  const activity = createSessionActivity({
    receipts, projected: () => attention, readProjection: async () => attention, snapshotOf: () => null, nativeSnapshotOf: () => null, liveOf: () => ({ status: 'idle' }),
    readLog: { record: (entry: any) => lines.push(readLine(entry, 1)) }, now: () => 10_000,
  });
  try {
    activity.noteContent('a', attention);
    assert.deepEqual(lines, [], 'the first answer seen is only the baseline');
    attention = complete(attention, message(8));
    activity.noteContent('a', attention);
    assert.deepEqual(lines.splice(0).map((line) => [line.event, line.seq, line.nowUnread]), [['content', 8, true]], 'a published answer says that it is unread now');

    await activity.acknowledge('a', { seq: 8 }, { screen: 'desktop', how: 'press', panes: 2, pane: 1, embedded: false, sinceTouchMs: 120, unreadForMs: 3400 });
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], { timestamp: 1, event: 'read', session: 'a', screen: 'desktop', how: 'press', panes: 2, pane: 1, embedded: false, sinceTouchMs: 120, unreadForMs: 3400,
      seq: 8, previousSeq: -1, stream: false, wasUnread: true, nowUnread: false, changed: true, ageMs: 10_000 - attention.at, kind: 'message' });
    await activity.acknowledge('a', { seq: 8 }, { screen: 'desktop', how: 'press' });
    assert.equal(lines.length, 1, 'the same position again moves nothing and is not logged');

    attention = complete(attention, message(12));
    await activity.acknowledge('a', { seq: 12 }, { screen: 'iphone', how: 'visible', device: 'abcd1234', pane: 3 });
    assert.deepEqual([lines[1].screen, lines[1].how, lines[1].device, 'pane' in lines[1], lines[1].wasUnread, lines[1].nowUnread], ['iphone', 'visible', 'abcd1234', false, true, false],
      'a phone is named with its device; the desktop-only pane is dropped from it');
    await activity.markUnread('a', { screen: 'dudu', how: 'tool' });
    assert.deepEqual([lines[2].event, lines[2].screen, lines[2].wasUnread, lines[2].nowUnread], ['unread-mark', 'dudu', false, true]);
  } finally { await activity.close(); receipts.close(); }
});

test('what a caller says about itself is cleaned to a few words and bounded numbers, the route\'s own knowledge wins, and cleaning twice changes nothing', () => {
  const body = { screen: 'iphone', how: 'rm -rf', pane: 99_999, panes: -3, sinceTouchMs: 'x', unreadForMs: 2500.7, embedded: 'yes', title: 'a private prompt' };
  const cleaned = cleanReadSource(body, { screen: 'desktop' });
  assert.deepEqual(cleaned, { screen: 'desktop', how: 'unknown', panes: 0, pane: 64, unreadForMs: 2501 });
  assert.deepEqual(cleanReadSource(cleaned), cleaned);
  assert.equal(readLine({ event: 'read', session: '../../etc', source: cleaned }), null, 'a session that is not an id is not written');
});
