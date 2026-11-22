import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sessionActivityProjection as projection } from '../host/assistant/sessions/activity-projection.mjs';
import { createReadReceipts, validReadPosition } from '../host/assistant/sessions/read-receipts.mjs';
import { contentDigest, hasUnread, sessionStateForActivity } from '../host/assistant/sessions/session-state.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { SCHEMA_VERSION } from '../host/assistant/issues/schema.mjs';
import { displayedReadPosition, ENGAGED_MS, mayRead } from '../host/dudu-plugin/ui/lib/session-read-receipts.js';
import { createSessionActivity } from '../host/assistant/sessions/session-activity.mjs';
import { migrateViews } from '../host/dudu-plugin/ui/issues/view.js';

const message = (seq: number, value = 'Answer', step = 1) => ({
  type: 'assistant/message', surfaceOp: 'append', seq, time: 1000 + seq,
  data: { turn: 1, step, message: { content: [{ type: 'text', text: value }] } },
});
const complete = (state: any, event: ReturnType<typeof message>) => projection.apply(projection.apply(state, event), {
  type: 'turn/end', seq: event.seq + 1, time: event.time, data: { turn: event.data.turn, reason: { kind: 'completed' } },
});

test('only completed visible answers, questions and errors advance unread; reading never answers a question', () => {
  let state = projection.init();
  for (const event of [
    { type: 'user/message', data: { content: [{ type: 'text', text: 'my words' }] } },
    { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'log' }] } } },
    { type: 'assistant/message', surfaceOp: 'append', data: { message: { content: [{ type: 'tool-call', name: 'bash' }] } } },
    { type: 'compaction/summary', data: { summary: [{ type: 'text', text: 'summary' }] } },
  ]) assert.equal(projection.apply(state, { seq: 0, time: 0, ...event }), state);
  state = complete(state, message(4));
  assert.equal(hasUnread(state, null), true);
  assert.equal(hasUnread(state, { seq: 4 }), false);
  assert.equal(projection.apply(state, { type: 'tool/call', seq: 6, time: 1006, data: { name: 'ask_user_question' } }).kind, 'question');
  const question = projection.apply(state, { type: 'approval/asked', seq: 7, time: 1007, data: {} });
  assert.equal(question.kind, 'question');
  assert.equal(hasUnread(question, { seq: 7 }), false);
  assert.equal(projection.apply(question, { type: 'turn/end', seq: 8, time: 1008, data: { reason: { kind: 'error' } } }).kind, 'error');
});

test('processing takes precedence, waiting is not processing, and background jobs cannot manufacture a foreground turn', () => {
  assert.equal(sessionStateForActivity({ running: true }, { sessionState: 'unread' }), 'processing');
  assert.equal(sessionStateForActivity({ running: true, pendingInteraction: true }, { sessionState: 'unread' }), 'unread');
  assert.equal(sessionStateForActivity({ pendingInteraction: true }, { sessionState: 'idle' }), 'idle');
  assert.equal(sessionStateForActivity({ jobs: ['running'] }, { state: 'finished', sessionState: 'idle' }), 'idle');
  assert.equal(sessionStateForActivity({ running: false }, { state: 'running', sessionState: 'idle' }), 'idle', 'a protected background shell cannot replace the derived foreground status');
  assert.equal(sessionStateForActivity(null, { state: 'running', sessionState: 'unread' }), 'unread');
});

test('read receipts survive restart, are monotonic across devices, and a delayed read does not acknowledge a newer answer', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-session-reads-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'reads.db');
  let reads = createReadReceipts({ file });
  const first = complete(projection.init(), message(4));
  reads.acknowledge('dsh:a', { seq: first.seq });
  reads.close();
  reads = createReadReceipts({ file });
  t.after(() => reads.close());
  assert.equal(reads.unread('dsh:a', first), false);
  const second = complete(first, message(8, 'New answer', 2));
  reads.acknowledge('dsh:a', { seq: 4 });
  assert.equal(reads.unread('dsh:a', second), true);
  reads.acknowledge('dsh:a', { seq: 8 });
  reads.acknowledge('dsh:a', { seq: 2 });
  assert.equal(reads.get('dsh:a').seq, 8);
  assert.equal(reads.unread('dsh:b', first), true, 'another session remains unread');
});

test('streaming prefixes acknowledge exactly the content shown; later deltas and another step remain unread', () => {
  const reads = createReadReceipts({ file: ':memory:' });
  try {
    const stream = (value: string, step = 1) => ({ turn: 1, step, digest: contentDigest([{ type: 'text', text: value }]) });
    reads.acknowledge('dsh:a', { seq: 0, stream: stream('Part') });
    assert.equal(reads.unread('dsh:a', complete(projection.init(), message(4, 'Part'))), false);
    const more = complete(projection.init(), message(4, 'Part, then more'));
    assert.equal(reads.unread('dsh:a', more), true);
    reads.acknowledge('dsh:a', { seq: 0, stream: stream('Part, then more') });
    reads.acknowledge('dsh:a', { seq: 0, stream: stream('Part') });
    assert.equal(reads.unread('dsh:a', more), false, 'an older device cannot undo the longer visible prefix');
    assert.equal(reads.unread('dsh:a', complete(more, message(6, 'Part, then more', 2))), true);
  } finally { reads.close(); }
  for (const value of [{ seq: Infinity }, { seq: -2 }, { seq: 1.5 }, { seq: 1, stream: { turn: 1, step: 1, digest: 'not a position' } }]) {
    assert.equal(validReadPosition(value), false);
  }
});

test('partial replies publish only at the matching completion; stopping and a later turn discard them without unread', async () => {
  const receipts = createReadReceipts({ file: ':memory:' });
  let attention = complete(projection.init(), message(4, 'Previous answer'));
  const activity = createSessionActivity({
    receipts, projected: () => attention, readProjection: async () => attention,
    snapshotOf: () => null, nativeSnapshotOf: () => null, liveOf: () => null,
  });
  try {
    await activity.acknowledge('a', { seq: 4 });
    const published = { seq: attention.seq, at: attention.messageAt, preview: attention.preview };
    attention = projection.apply(attention, { type: 'turn/start', seq: 6, time: 1006, data: { turn: 2 } });
    const partial = { ...message(7, 'Working on it'), data: { ...message(7).data, turn: 2 } };
    attention = projection.apply(attention, partial);
    assert.equal(activity.statusOf('dsh:a').unread, false);
    attention = projection.apply(attention, { type: 'turn/end', seq: 8, time: 1008, data: { turn: 1, reason: { kind: 'completed' } } });
    assert.equal(attention.pending?.seq, 7, 'an end for another turn cannot publish this partial reply');
    assert.deepEqual({ seq: attention.seq, at: attention.messageAt, preview: attention.preview }, published);
    attention = projection.apply(attention, { type: 'turn/end', seq: 9, time: 1009, data: { turn: 2, reason: { kind: 'aborted' } } });
    assert.equal(attention.pending, null);
    assert.deepEqual({ seq: attention.seq, at: attention.messageAt, preview: attention.preview }, published);
    await activity.acknowledge('a', { seq: 7 });
    await assert.rejects(activity.acknowledge('a', { seq: 9 }), /ahead/, 'a control event is not a readable message');
    assert.equal(activity.statusOf('dsh:a').unread, false);
    attention = projection.apply(attention, { type: 'turn/end', seq: 10, time: 1010, data: { turn: 2, reason: { kind: 'completed' } } });
    assert.deepEqual({ seq: attention.seq, at: attention.messageAt, preview: attention.preview }, published, 'a delayed completion cannot restore discarded content');
    attention = projection.apply(attention, { ...partial, seq: 11 });
    attention = projection.apply(attention, { type: 'turn/start', seq: 12, time: 1012, data: { turn: 3 } });
    attention = projection.apply(attention, { type: 'turn/end', seq: 13, time: 1013, data: { turn: 3, reason: { kind: 'completed' } } });
    assert.deepEqual({ seq: attention.seq, at: attention.messageAt, preview: attention.preview }, published, 'the next turn cannot inherit a partial reply');
  } finally { await activity.close(); receipts.close(); }
});

test('the desktop reads its rendered cut, not a projection that arrived ahead of the message', () => {
  const event = message(4);
  const next = complete(projection.init(), message(8));
  assert.equal(displayedReadPosition([{ type: 'event', event }], next).seq, 4);
  const live = (text: string) => ({ type: 'transient', event: { type: 'assistant/live-chunk', data: {
    attemptId: 'a', turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text },
  } } });
  const read = displayedReadPosition([{ type: 'event', event }, live('one'), live(' two')], next);
  assert.deepEqual(read, { seq: 4, stream: { turn: 1, step: 2, digest: contentDigest([{ type: 'text', text: 'one two' }]) } });
});

test('shared session activity distinguishes background work, native continuation and a genuinely new incoming message', async () => {
  const receipts = createReadReceipts({ file: ':memory:' });
  let native: any = { key: 'claude:a', provider: 'claude', state: 'running', foregroundActive: false, incomingAt: null };
  let live = { status: 'idle' };
  let attention = complete(projection.init(), message(4));
  const activity = createSessionActivity({
    receipts, projected: () => attention, readProjection: async () => attention,
    snapshotOf: () => native, nativeSnapshotOf: () => native, liveOf: () => live,
  });
  try {
    assert.equal(activity.statusOf('claude:a').sessionState, 'idle', 'null is not an incoming timestamp; a background shell is not foreground processing');
    native = { ...native, incomingAt: 2000 };
    assert.equal(activity.statusOf('claude:a').sessionState, 'unread', 'a native-only conversation has incoming content but no read receipt yet');
    native = { ...native, foregroundActive: true };
    assert.equal(activity.statusOf('claude:a').sessionState, 'processing');
    native = { ...native, foregroundActive: false };
    native = { ...native, dshSessionId: 'a' };
    assert.equal(activity.statusOf('dsh:a').sessionState, 'unread');
    assert.deepEqual(await activity.acknowledge('a', { seq: 4 }), { sessionState: 'idle' });
    assert.equal(activity.statusOf('claude:a').sessionState, 'idle', 'the imported native identity shares the journal receipt even when completion was later than the message');
    live = { status: 'running' };
    assert.equal(activity.statusOf('dsh:a').sessionState, 'processing');
    live = { status: 'waiting' };
    assert.equal(activity.statusOf('dsh:a').sessionState, 'idle', 'reading neither answers nor dismisses a live question');
    live = { status: 'idle' };
    attention = { ...complete(attention, message(9, 'TUI continuation', 2)), at: 2000 };
    assert.equal(activity.statusOf('dsh:a').sessionState, 'unread', 'new TUI content appended to the shared log needs a new read');
    await activity.acknowledge('a', { seq: 4 });
    assert.equal(activity.statusOf('dsh:a').sessionState, 'unread', 'an old desktop cut cannot acknowledge that TUI continuation');
    await activity.acknowledge('a', { seq: 9 });
    assert.equal(activity.statusOf('claude:a').sessionState, 'idle', 'the native identity shares the read once its content was actually shown in DSH');
    await assert.rejects(activity.acknowledge('a', { seq: 10 }), /ahead/);
  } finally { await activity.close(); receipts.close(); }
});

test('a reconciled DSH completion outranks an older native running scan, while a later TUI turn can still run', async () => {
  const receipts = createReadReceipts({ file: ':memory:' });
  let native: any = { provider: 'claude', dshSessionId: 'a', state: 'running', foregroundActive: true, lastActivityAt: 1000 };
  let resolved: any = native;
  const attention = complete(projection.init(), message(4));
  const activity = createSessionActivity({
    receipts, projected: () => attention, readProjection: async () => attention,
    snapshotOf: () => resolved, nativeSnapshotOf: () => native, liveOf: () => ({ status: 'idle' }),
  });
  try {
    assert.equal(activity.statusOf('dsh:a').sessionState, 'processing');
    resolved = { state: 'finished', lastActivityAt: 1005 };
    assert.equal(activity.statusOf('dsh:a').sessionState, 'unread', 'the completion is effective before the next native scan');
    assert.equal(activity.statusOf('claude:a').sessionState, 'unread', 'both identities use the reconciled state');
    await activity.acknowledge('a', { seq: 4 });
    assert.equal(activity.statusOf('dsh:a').sessionState, 'idle', 'a read completion cannot retain the old processing badge');
    native = { ...native, lastActivityAt: 2000 };
    resolved = native;
    assert.equal(activity.statusOf('dsh:a').sessionState, 'processing', 'newer native work remains observable');
  } finally { await activity.close(); receipts.close(); }
});

test('cold activity reads coalesce, cannot overwrite newer events, transfer only identical read content on replacement, and stop on disposal', async () => {
  const receipts = createReadReceipts({ file: ':memory:' });
  const pending = Promise.withResolvers<any>();
  let calls = 0;
  let stamp = 2000;
  const attention = complete(projection.init(), message(4));
  const activity = createSessionActivity({
    receipts, projected: () => null, snapshotOf: () => null, nativeSnapshotOf: () => ({ incomingAt: stamp }), liveOf: () => null,
    readProjection: async (id: string) => { calls++; return id === 'pending' ? pending.promise : attention; },
  });
  try {
    await Promise.all([activity.warm(['a']), activity.warm(['a', 'a'])]);
    assert.equal(calls, 1);
    await activity.warm(['a']);
    assert.equal(calls, 1, 'unchanged source evidence does not reread cold history');
    stamp++;
    await activity.warm(['a']);
    assert.equal(calls, 2, 'new source evidence invalidates the cached cold projection once');
    activity.observe('a', complete(attention, message(8, 'Newer')));
    await activity.acknowledge('a', { seq: 4 });
    assert.equal(activity.statusOf('dsh:a').sessionState, 'unread');
    activity.observe('a', attention);
    assert.equal(activity.attentionOf('a').seq, 8, 'an older cold load cannot regress the live event');
    await activity.acknowledge('a', { seq: 8 });
    activity.observe('b', { ...activity.attentionOf('a'), seq: 16 });
    await activity.rebind('a', 'b');
    assert.equal(receipts.get('dsh:b').seq, 16);
    activity.observe('c', { ...attention, seq: 16 });
    await activity.rebind('a', 'c');
    assert.equal(receipts.get('dsh:c'), null, 'different content retains its unread status');
    const loading = activity.warm(['pending']);
    await Promise.resolve();
    await activity.close();
    await assert.rejects(loading, { name: 'AbortError' });
  } finally { pending.resolve(attention); await activity.close(); receipts.close(); }
});

test('completion invalidates cold pending activity without another message timestamp, including a source change during a read', async () => {
  const receipts = createReadReceipts({ file: ':memory:' });
  const waiting = projection.apply(projection.init(), message(4));
  const ended = projection.apply(waiting, { type: 'turn/end', seq: 5, time: 2000, data: { turn: 1, reason: { kind: 'completed' } } });
  let source = { incomingAt: 1004, lastActivityAt: 1004, foregroundActive: true };
  let loaded = waiting;
  let calls = 0;
  const deferred = Promise.withResolvers<any>();
  const activity = createSessionActivity({
    receipts, projected: () => null, snapshotOf: () => null, nativeSnapshotOf: () => source, liveOf: () => null,
    readProjection: async (id: string) => { calls++; return id === 'racing' && calls === 3 ? deferred.promise : loaded; },
  });
  try {
    await activity.warm(['a']);
    await activity.acknowledge('a', { seq: 4 });
    assert.equal(activity.attentionOf('a').seq, -1);
    assert.equal(activity.statusOf('dsh:a').unread, false);
    loaded = ended;
    source = { ...source, lastActivityAt: 2000, foregroundActive: false };
    await activity.warm(['a']);
    assert.equal(calls, 2);
    assert.equal(activity.attentionOf('a').seq, 4);
    assert.equal(activity.attentionOf('a').messageAt, 2000);
    assert.equal(activity.statusOf('dsh:a').unread, false, 'the final message was actually read before completion');
    await activity.warm(['a']);
    assert.equal(calls, 2, 'the completed source stays cached');
    activity.observe('a', waiting);
    assert.equal(activity.attentionOf('a').through, 5, 'an older pending result cannot overwrite completion with the same published seq');

    source = { incomingAt: 1004, lastActivityAt: 1004, foregroundActive: true };
    const racing = activity.warm(['racing']);
    await Promise.resolve();
    await Promise.resolve();
    source = { ...source, lastActivityAt: 2000, foregroundActive: false };
    deferred.resolve(waiting);
    await racing;
    await activity.warm(['racing']);
    assert.equal(calls, 4, 'a source change while loading is not stamped as already observed');
    assert.equal(activity.statusOf('dsh:racing').unread, true);
    assert.equal(activity.attentionOf('racing').messageAt, 2000);
  } finally { deferred.resolve(waiting); await activity.close(); receipts.close(); }
});

test('saved status views migrate without restoring removed overrides or losing explicit no-grouping choices', () => {
  const migrated = migrateViews({
    old: { group: 'agentState', subGroup: null, filter: { agentState: ['working', 'blocked', 'done', 'idle'], priority: ['high'] } },
    ungrouped: { group: null, sessionGroupingVersion: 1, filter: { sessionState: ['unread'] } },
    legacyUngrouped: { group: null, agentGroupingVersion: 1 },
    formerDefault: { group: 'sessionState', sessionGroupingVersion: 1, subGroup: 'status' },
    workflow: { group: 'status', filter: { priority: ['low'] } },
    explicitSession: { group: 'sessionState', workflowGroupingVersion: 1 },
    missing: {},
  });
  assert.equal(migrated.old.group, 'status');
  assert.deepEqual(migrated.old.filter, { priority: ['high'], sessionState: ['processing', 'unread', 'idle'] });
  assert.equal(migrated.ungrouped.group, null);
  assert.equal(migrated.legacyUngrouped.group, null);
  assert.equal(migrated.formerDefault.group, 'status');
  assert.equal(migrated.formerDefault.subGroup, null);
  assert.equal(migrated.workflow.group, 'status');
  assert.equal(migrated.explicitSession.group, 'sessionState');
  assert.equal(migrated.missing.group, 'status');
  assert.deepEqual(migrateViews(migrated), migrated, 'migration is stable when the view is read or changed again');
});

test('grouping, filters and counts use automatic session status, with no workflow writes or manual overrides', () => {
  let state = 'unread';
  const issues = createIssues({ file: ':memory:', sessionState: () => state });
  try {
    const issue = issues.add({ title: 'Keep workflow', status: 'backlog', agent: 'claude', project: { name: 'Work', path: '/work' }, session: 'dsh:a' }).issue;
    const updatedAt = issue.updatedAt;
    for (const next of ['unread', 'processing', 'idle']) {
      state = next;
      const row = issues.get(issue.id).issue;
      assert.equal(row.sessionState, next);
      assert.equal(row.status, 'backlog');
      assert.equal(row.updatedAt, updatedAt);
      assert.equal(issues.list({ tab: 'backlog', group: 'sessionState' }).groups[0].key, next);
      assert.equal(issues.list({ tab: 'backlog', filter: { sessionState: [next] } }).total, 1);
      assert.equal(issues.update(issue.id, { sessionState: next }).outcome, 'needs_clarification');
      assert.equal(issues.update(issue.id, { agentState: 'idle' }).outcome, 'needs_clarification');
    }
    assert.equal(issues.add({ title: 'No conversation' }).issue.sessionState, 'unassigned');
    issues.add({ title: 'Assigned without conversation', agent: 'claude', project: { name: 'Work', path: '/work' } });
    assert.equal(issues.office().counts.unassigned, 1, 'an assigned issue without a conversation has an exact association count');
  } finally { issues.close(); }
});

test('schema migration removes only old manual overrides and preserves issues and activity', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-state-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'issues.db');
  let issues = createIssues({ file, now: () => 1000 });
  const made = issues.add({ title: 'Preserved', brief: 'Original', status: 'backlog' }).issue;
  issues.log(made.id, { kind: 'note', text: 'Owner note' });
  issues.close();
  const db = new DatabaseSync(file);
  db.exec(`ALTER TABLE issues ADD COLUMN agent_state TEXT; ALTER TABLE issues ADD COLUMN agent_state_basis TEXT;
    UPDATE issues SET agent_state='idle'; PRAGMA user_version = ${SCHEMA_VERSION - 1};`);
  db.close();
  issues = createIssues({ file, now: () => 1000 });
  try {
    const after = issues.get(made.id);
    assert.equal(after.issue.title, 'Preserved');
    assert.equal(after.issue.brief, 'Original');
    assert.equal(after.issue.status, 'backlog');
    assert.equal(after.issue.updatedAt, made.updatedAt);
    assert.ok(after.log.length);
  } finally { issues.close(); }
});

// Owner, 2026-11-22: a conversation that is open and in front was read at once, so two on screen were both read and a reply finished while nobody was there never lit a red dot.
test('the person must have a part in a read: a press after the content came, or just before it; shown and untouched, or touched long ago, stays unread', () => {
  assert.equal(mayRead({ unreadSince: 1000, touchedAt: undefined }), false, 'in front and at the bottom, but nobody touched it');
  assert.equal(mayRead({ unreadSince: 1000, touchedAt: 1500 }), true, 'pressed, scrolled or typed after it came');
  assert.equal(mayRead({ unreadSince: 20_000, touchedAt: 20_000 - ENGAGED_MS }), true, 'still working in it when it came');
  assert.equal(mayRead({ unreadSince: 20_000, touchedAt: 20_000 - ENGAGED_MS - 1 }), false, 'worked in it a while ago');
  assert.equal(mayRead({ unreadSince: null, touchedAt: 5 }), false, 'nothing unread to read');
});
