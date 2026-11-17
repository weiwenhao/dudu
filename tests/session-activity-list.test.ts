import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionActivity } from '../host/assistant/sessions/session-activity.mjs';
import { createReadReceipts } from '../host/assistant/sessions/read-receipts.mjs';
import { sessionActivityProjection as projection } from '../host/assistant/sessions/activity-projection.mjs';
import { createChatHome } from '../host/assistant/home/chat-home.mjs';
import { createChatHomeApi } from '../host/assistant/home/chat-home-api.mjs';

function reply(seq: number, time: number, text: string) {
  return [
    { type: 'assistant/message', surfaceOp: 'append', seq, time, data: {
      turn: 1, step: seq, message: { content: [{ type: 'text', text }] },
    } },
    { type: 'turn/end', seq: seq + 1, time, data: { turn: 1, reason: { kind: 'completed' } } },
  ].reduce((state, event) => projection.apply(state, event), projection.init());
}

test('activity lists coalesce cold-safe summaries, while acknowledgements still require an exact cut', async (t) => {
  const receipts = createReadReceipts({ file: ':memory:' });
  const old = reply(4, 1000, 'Previous reply');
  const current = reply(8, 2000, 'Current reply');
  const listed = Promise.withResolvers<any[]>();
  const live = new Map<string, any>();
  let lists = 0;
  let reads = 0;
  let exists = true;
  const activity = createSessionActivity({
    receipts, projected: (id: string) => live.get(id),
    snapshotOf: () => null, nativeSnapshotOf: () => null, liveOf: () => null,
    listProjections: () => { lists++; return listed.promise; },
    readProjection: async () => { reads++; return exists ? current : null; },
  });
  t.after(async () => { await activity.close(); receipts.close(); });
  const first = activity.refresh(['cold']);
  const second = activity.refresh(['other', 'cold']);
  listed.resolve(['cold', 'other'].map((sessionId) => ({ sessionId, projections: { kind: 'cached', values: { duduSessionActivity: old } } })));
  await Promise.all([first, second]);
  assert.equal(lists, 1);
  assert.equal(reads, 0, 'listing persisted summaries must not prepare any complete cold log');
  assert.equal(activity.statusOf('dsh:cold').unread, true);
  assert.equal(activity.attentionOf('cold').messageAt, 1000);
  assert.equal(receipts.get('dsh:cold'), null, 'loading a list cannot mark anything read');
  await assert.rejects(activity.acknowledge('cold', { seq: 20 }), /ahead/);
  assert.equal(reads, 1, 'a cached display hint cannot certify a read boundary');
  assert.equal(receipts.get('dsh:cold'), null);
  await activity.acknowledge('cold', { seq: 4 });
  assert.equal(activity.statusOf('dsh:cold').unread, true, 'the stale screen only reads its visible cut');
  await activity.refresh(['cold']);
  await activity.acknowledge('cold', { seq: 8 });
  assert.equal(reads, 1, 'older listing hints cannot downgrade the exact cached cut');
  assert.equal(activity.statusOf('dsh:cold').unread, false);
  live.set('cold', reply(12, 3000, 'Live reply'));
  await activity.refresh(['cold']);
  assert.equal(lists, 2, 'a live projection needs neither a catalog scan nor a cold read');
  assert.equal(activity.attentionOf('cold').seq, 12);
  exists = false;
  await assert.rejects(activity.acknowledge('other', { seq: 4 }), /unavailable/);
  assert.equal(receipts.get('dsh:other'), null, 'an old display hint cannot acknowledge a missing session');
  await activity.rebind('cold', 'other');
  assert.equal(receipts.get('dsh:other'), null, 'a missing journal has no exact receipt to migrate');
});

test('chat home returns while a missing summary is loading, isolates failures, and never scans unrelated cold histories', async (t) => {
  const receipts = createReadReceipts({ file: ':memory:' });
  const pending = Promise.withResolvers<any>();
  const started = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<void>();
  const retried = Promise.withResolvers<void>();
  const attempts: string[] = [];
  let stamp = 1;
  const activity = createSessionActivity({
    receipts, projected: () => null,
    snapshotOf: () => null, nativeSnapshotOf: () => ({ incomingAt: stamp }), liveOf: () => null,
    listProjections: async () => [
      { sessionId: 'available', projections: { values: { duduSessionActivity: reply(4, 1000, 'Saved reply') } } },
      { sessionId: 'missing' }, { sessionId: 'broken' }, { sessionId: 'unrelated' },
    ],
    readProjection: async (id: string) => {
      attempts.push(id);
      if (id === 'missing') { started.resolve(); return pending.promise; }
      if (attempts.filter((value) => value === id).length === 2) retried.resolve();
      throw new Error('Cannot read this session');
    },
    diagnostics: { record: () => failed.resolve() },
  });
  const rows = ['available', 'missing', 'broken'].map((id, index) => ({
    id: index + 1, session: `dsh:${id}`, title: id, statusType: 'todo',
  }));
  const issues = async () => ({ outcome: 'success', items: rows, counts: {}, statuses: [] });
  const home = createChatHome({
    file: ':memory:', issues, assistant: () => null,
    activity: (id: string) => activity.statusOf(`dsh:${id}`), warm: activity.refresh,
    markUnread: activity.markUnread, acknowledge: activity.acknowledge,
  });
  t.after(async () => { pending.resolve(null); home.close(); await activity.close(); receipts.close(); });
  const handle = createChatHomeApi(home, issues);
  const list = () => handle('list', new Request('https://dsh.invalid/api/dudu/home/list', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }));
  const response = await list();
  assert.equal(response.status, 200, 'a slow session does not hold the whole list response');
  const answer = await response.json();
  assert.equal(answer.conversations.length, 4);
  assert.equal(answer.conversations[0].preview, 'Saved reply');
  assert.equal(answer.unreadCount, 1);
  await started.promise;
  assert.deepEqual(attempts, ['missing'], 'cold hydration stays serial');
  pending.resolve(null);
  await failed.promise;
  assert.equal((await list()).status, 200, 'one failed hydration does not reject home/list');
  assert.deepEqual(attempts, ['missing', 'broken'], 'unchanged cache misses and failures are not retried on every poll');
  assert.equal(receipts.get('dsh:available'), null);
  stamp++;
  await activity.refresh(['broken']);
  await retried.promise;
  assert.deepEqual(attempts, ['missing', 'broken', 'broken'], 'new source evidence permits one new background attempt');
  await activity.close();
  assert.ok(attempts.every((id) => id !== 'unrelated'), 'the catalog may list unrelated sessions; their logs are never opened');
});

test('a request waits for DSH’s list of sessions only a moment, takes in what it brings later, and does not ask again at once after a failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const receipts = createReadReceipts({ file: ':memory:' });
  const slow = Promise.withResolvers<any[]>();
  let lists = 0;
  const activity = createSessionActivity({
    receipts, projected: () => null,
    snapshotOf: () => null, nativeSnapshotOf: () => null, liveOf: () => null,
    listProjections: () => { lists++; return lists === 1 ? slow.promise : Promise.reject(new Error('DSH is too busy')); },
    readProjection: async () => null,
  });
  t.after(async () => { slow.resolve([]); await activity.close(); receipts.close(); });
  // A list that DSH has not answered holds a request for 1.5 seconds, not the 12 of its own limit.
  const waiting = activity.refresh(['cold']);
  t.mock.timers.tick(1_500);
  await waiting;
  assert.equal(lists, 1);
  slow.resolve([{ sessionId: 'cold', projections: { values: { duduSessionActivity: reply(4, 1000, 'Late hint') } } }]);
  await new Promise((done) => setImmediate(done));
  assert.equal(activity.attentionOf('cold').messageAt, 1000, 'what the list brings is taken in when it comes');
  // A list that fails is recorded by the caller of record(), never thrown at a request, and not started again for 30 seconds.
  await activity.refresh(['other']);
  assert.equal(lists, 2);
  await activity.refresh(['another']);
  assert.equal(lists, 2, 'no new list right after a failure');
  t.mock.timers.tick(30_000);
  await activity.refresh(['third']);
  assert.equal(lists, 3);
});
