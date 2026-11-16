import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createChatHome } from '../host/assistant/home/chat-home.mjs';
import { createChatHomeApi } from '../host/assistant/home/chat-home-api.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createIssuesApi } from '../host/assistant/issues/api.mjs';
import { sessionActivityProjection as projection } from '../host/assistant/sessions/activity-projection.mjs';
import { createReadReceipts } from '../host/assistant/sessions/read-receipts.mjs';
import { createSessionActivity } from '../host/assistant/sessions/session-activity.mjs';
import { createNativeBoard } from '../host/native-board.mjs';
import { DEFAULT_VIEW, listRequest } from '../host/dudu-plugin/ui/issues/view.js';
import { retainedSessionIdentity } from '../host/dudu-plugin/ui/issues/use-retained-session.js';
import { chooseConversation } from '../host/dudu-plugin/ui/issues/selection.js';

const fail = (code: string) => { throw Object.assign(new Error(code), { code }); };
const project = { name: 'Dudu', path: '/project/dudu' };
const message = (seq: number, time: number, text: string) => ({
  type: 'assistant/message', surfaceOp: 'append', seq, time,
  data: { turn: 1, step: seq, message: { content: [{ type: 'text', text }] } },
});

test('a native session import and row refresh keep the current composer; reassignment and explicit retry get a new binding', () => {
  const issue = { id: 7, session: 'claude:native-thread', title: 'Before' };
  const identity = retainedSessionIdentity(issue, 0);
  const retained = { identity, issueId: issue.id, attempt: 0, reference: { sessionId: 'loaded-thread' } };
  const imported = { ...issue, session: 'dsh:loaded-thread', title: 'Renamed', sessionState: 'processing' };
  assert.equal(retainedSessionIdentity(imported, 0, retained), identity);
  assert.equal(retainedSessionIdentity({ ...imported, sessionState: 'idle' }, 0, retained), identity);
  assert.notEqual(retainedSessionIdentity({ ...imported, session: 'dsh:another-thread' }, 0, retained), identity);
  assert.notEqual(retainedSessionIdentity(imported, 1, retained), identity);
  assert.notEqual(retainedSessionIdentity({ ...imported, id: 8 }, 0, retained), identity);
});

test('entering chat opens the newest available conversation once, without starting unassigned issues or stealing a manual choice', () => {
  const unassigned = { id: 'issue:3', receivedAt: 5000, issue: { session: null } };
  const latest = { id: 'issue:2', receivedAt: 4000, issue: { session: 'claude:native-thread' } };
  const older = { id: 'issue:1', receivedAt: 3000, issue: { session: 'dsh:older' }, pinned: true };
  const assistant = { id: 'assistant', receivedAt: 2000, sessionId: 'assistant-session' };
  assert.equal(chooseConversation([]), null, 'wait for data rather than starting a conversation');
  assert.equal(chooseConversation([unassigned, latest, older, assistant]), latest.id);
  assert.equal(chooseConversation([unassigned, latest, older, assistant], older.id), older.id);
  assert.equal(chooseConversation([unassigned, { id: 'assistant', sessionId: null }]), null);
  assert.equal(chooseConversation([assistant, older]), assistant.id);
  assert.equal(chooseConversation([latest], 'issue:outside'), 'issue:outside', 'a manually opened child stays open even outside the list');
});

function world(t: any, file = ':memory:') {
  const projected = new Map<string, any>();
  const live = new Map<string, any>();
  const receipts = createReadReceipts({ file: ':memory:' });
  const activity = createSessionActivity({
    receipts, projected: (id: string) => projected.get(id) ?? projection.init(),
    readProjection: async () => { throw new Error('A live projection must not reload history'); },
    snapshotOf: () => null, nativeSnapshotOf: () => null, liveOf: (id: string) => live.get(id),
  });
  let now = 1_000;
  let home: ReturnType<typeof createChatHome>;
  const issues = createIssues({ file: ':memory:', now: () => now, sessionState: (key: string) => activity.statusOf(key).sessionState,
    sessionReceivedAt: (key: string) => activity.statusOf(key).attention?.messageAt ?? 0,
    issuePinned: (id: number) => home?.isPinned(`issue:${id}`) === true });
  const api = createIssuesApi({ issues });
  const options = {
    file, issues: (action: string, body: any) => api.execute(action, body),
    assistant: () => ({ sessionId: 'assistant-session' }),
    activity: (id: string) => activity.statusOf(`dsh:${id}`), warm: activity.warm,
    markUnread: activity.markUnread, acknowledge: activity.acknowledge, now: () => 2_000,
  };
  home = createChatHome(options);
  const bridge = createNativeBoard({ issues: options.issues, home: {
    list: (...args: any[]) => home.list(...args), pin: (...args: any[]) => home.pin(...args), read: (...args: any[]) => home.read(...args),
  }, fail });
  t.after(async () => { home.close(); await activity.close(); receipts.close(); issues.close(); });
  return {
    issues, receipts, activity, setTime: (time: number) => { now = time; },
    say(id: string, seq: number, time: number, text: string) {
      projected.set(id, [message(seq, time, text), {
        type: 'turn/end', seq: seq + 1, time, data: { turn: 1, reason: { kind: 'completed' } },
      }].reduce((state, event) => projection.apply(state, event), projected.get(id) ?? projection.init()));
    },
    event(id: string, event: any) {
      projected.set(id, projection.apply(projected.get(id) ?? projection.init(), event));
      if (event.type === 'turn/start' || event.type === 'turn/end') live.set(id, { status: event.type === 'turn/start' ? 'running' : 'idle' });
    },
    call: (method: string, params: any = {}) => bridge.dispatch(method, params),
    desktop: (action: string, body: any = {}) => createChatHomeApi(home, options.issues)(action, new Request('https://dsh.invalid/api/dudu/home/' + action, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })),
    reopen() { home.close(); home = createChatHome(options); },
  };
}

test('chat home pages every issue, scopes only workflow, and sorts by the last incoming message without reading it', async (t) => {
  const { issues, receipts, say, call } = world(t);
  for (let index = 0; index < 201; index++) issues.add({ title: `Issue ${index}` });
  const first = issues.add({ title: 'First', project, agent: 'claude', session: 'dsh:first', brief: 'Private description' }).issue;
  const second = issues.add({ title: 'Second', project, agent: 'codex', session: 'dsh:second' }).issue;
  const backlog = issues.add({ title: 'Backlog', project, status: 'backlog', agent: 'codex', session: 'dsh:backlog' }).issue;
  const done = issues.add({ title: 'Done', project, status: 'done', agent: 'claude', session: 'dsh:done' }).issue;
  say('first', 1, 3_000, 'First paragraph.\n\nLast paragraph.\nWith a new line.');
  say('second', 2, 4_000, 'Second answer');
  say('backlog', 3, 5_000, 'Hidden backlog answer');
  say('done', 4, 6_000, 'Completed answer');
  const list = (tab: string) => call('board.list', { layout: 'chat', tab }) as Promise<any>;
  const active = await list('active');
  assert.equal(active.conversations.length, 204, 'all pages and the single Dudu entry are present');
  assert.deepEqual(active.conversations.slice(0, 2).map((entry: any) => entry.issue.id), [second.id, first.id]);
  assert.equal(active.conversations[1].preview, 'Last paragraph. With a new line.');
  assert.equal(active.groups, undefined, 'the chat contract is flat');
  assert.equal(JSON.stringify(active).includes('Private description'), false);
  assert.equal(active.unreadCount, 4, 'offscreen scopes still contribute once to the badge');
  assert.equal(receipts.get('dsh:first'), null, 'listing or pinning never acknowledges a message');
  issues.update(first.id, { title: 'Renamed', priority: 'high' });
  assert.deepEqual((await list('active')).conversations.slice(0, 2).map((entry: any) => entry.issue.id), [second.id, first.id]);
  const planned = await list('backlog');
  assert.deepEqual(planned.conversations.map((entry: any) => entry.issue.id), [backlog.id], 'Dudu is absent from both the list and pinned shelf in planning');
  assert.equal(planned.pins.includes('assistant'), false);
  assert.equal(planned.unreadCount, 4, 'scope changes do not drop unread messages from the App badge');
  assert.equal((await list('all')).conversations[0].issue.id, done.id);
  assert.equal((await list('all')).conversations.filter((entry: any) => entry.id === 'assistant').length, 1);
});

test('homepage pins survive restart and unpinning Dudu, without taking pinned conversations out of the main list', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-chat-home-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const { issues, call, desktop, reopen } = world(t, join(folder, 'home.db'));
  const issue = issues.add({ title: 'Pinned', project, session: 'dsh:pinned', agent: 'claude' }).issue;
  const target = `issue:${issue.id}`;
  assert.deepEqual((await call('board.list', { layout: 'chat' }) as any).pins, ['assistant']);
  await call('board.pin', { target, pinned: true });
  assert.equal((await desktop('pin', { target, pinned: true })).status, 200);
  assert.equal((await desktop('pin', { target: 'assistant', pinned: false })).status, 200);
  reopen();
  const answer: any = await call('board.list', { layout: 'chat' });
  assert.deepEqual(answer.pins, [target]);
  assert.equal(answer.conversations.find((entry: any) => entry.id === target).pinned, true);
  assert.equal(answer.conversations.filter((entry: any) => entry.id === target).length, 1);
  assert.equal(answer.conversations.find((entry: any) => entry.id === 'assistant').pinned, false);
  const desktopList = await desktop('list');
  assert.equal(desktopList.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await desktopList.json()).pins, answer.pins, 'Desktop and phone use the persisted home, including a manually unpinned Dudu');
  assert.equal(issues.get(issue.id).issue.pinned, true, 'ordinary Desktop issue rows read the same pin');
  assert.equal((await desktop('pin', { target, pinned: false })).status, 200);
  assert.deepEqual((await call('board.list', { layout: 'chat' }) as any).pins, []);
  await assert.rejects(call('board.pin', { target: 'issue:0', pinned: true }), { code: 'BAD_REQUEST' });
  await assert.rejects(call('board.pin', { target: 'issue:9999', pinned: true }), { code: 'NOT_FOUND' });
  await assert.rejects(call('board.pin', { target, pinned: 'yes' }), { code: 'BAD_REQUEST' });
  assert.equal((await desktop('pin', { target: 'issue:0', pinned: true })).status, 400);
  assert.equal((await desktop('pin', { target: 'issue:9999', pinned: true })).status, 404);
});

test('Desktop pinned issue paging keeps pins first in each group and sort direction without changing phone chronology', async (t) => {
  const { issues, say, desktop, call } = world(t);
  for (let index = 1; index <= 15; index++) {
    issues.add({ title: `Issue ${index}`, project, agent: 'claude', session: `dsh:session-${index}`,
      status: index % 5 === 0 ? 'done' : index % 3 === 0 ? 'in_progress' : 'todo' });
    say(`session-${index}`, 1, index % 3 === 0 ? 4_000 : 3_000, `Answer ${index}`);
  }
  const before: any = await call('board.list', { layout: 'chat', tab: 'all' });
  const pinned = new Set([2, 8, 10, 15]);
  for (const id of pinned) assert.equal((await desktop('pin', { target: `issue:${id}`, pinned: true })).status, 200);
  for (const reverse of [false, true]) {
    for (const group of [null, 'status']) {
      const request = listRequest('all', { ...DEFAULT_VIEW, group, order: 'updated', reverse });
      assert.equal(request.pinnedFirst, true);
      const baseline = issues.list({ ...request, pinnedFirst: false, limit: 200 });
      const groups = group ? baseline.groups : [{ key: null, items: baseline.items }];
      for (const leaf of groups) {
        const expected = [...leaf.items].sort((a: any, b: any) => Number(pinned.has(b.id)) - Number(pinned.has(a.id))).map((row: any) => row.id);
        const walked: number[] = [];
        let cursor: string | null = null;
        do {
          const page = issues.list({ ...request, limit: 2, cursor, ...(group ? { groupFilter: { key: leaf.key } } : {}) });
          assert.equal(page.outcome, 'success');
          walked.push(...page.items.map((row: any) => row.id));
          for (const row of page.items) assert.equal(row.pinned === true, pinned.has(row.id));
          cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(walked, expected, 'a cursor crosses from pinned to ordinary rows once, even for equal completion times');
      }
    }
  }
  const chatRequest = listRequest('all', {
    ...DEFAULT_VIEW, layout: 'chat', group: 'status', subGroup: 'priority', order: 'created', reverse: true, recency: true,
  });
  assert.deepEqual(chatRequest, { tab: 'all', order: 'received', completedLast: false }, 'the phone-style layout always stays flat and chronological');
  const chat = await (await desktop('list', { tab: chatRequest.tab })).json();
  assert.deepEqual(chat.conversations.map((entry: any) => entry.id), before.conversations.map((entry: any) => entry.id));
  assert.deepEqual(chat.pins, ['assistant', ...[...pinned].map((id: number) => `issue:${id}`).sort()]);
  assert.deepEqual(issues.list(listRequest('active', { ...DEFAULT_VIEW, layout: 'board' })).groups.map((group: any) => group.items.map((row: any) => row.id)),
    issues.list({ tab: 'active', group: 'status', order: 'received' }).groups.map((group: any) => group.items.map((row: any) => row.id)), 'board lane order stays independent of pins');
});

test('Desktop conversation scopes reuse issue filters and facet counts without reading or starting a session', async (t) => {
  const { issues, say, desktop, receipts } = world(t);
  const first = issues.add({ title: 'First', project, agent: 'claude', priority: 'high', session: 'dsh:first' }).issue;
  issues.add({ title: 'Second', project, agent: 'codex', priority: 'low', session: 'dsh:second' });
  issues.add({ title: 'Backlog', project, status: 'backlog', agent: 'claude', session: 'dsh:backlog' });
  say('first', 1, 3_000, 'Completed answer');
  const filter = { priority: ['high'] };
  const response = await desktop('list', { tab: 'active', filter });
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.deepEqual(answer.conversations.map((row: any) => row.issue.id), [first.id]);
  assert.deepEqual(answer.counts, issues.list({ tab: 'active', filter }).counts);
  assert.equal(answer.counts.priority.low, 1, 'a priority facet leaves out its own filter');
  assert.equal(answer.unreadCount, 1);
  assert.equal(receipts.get('dsh:first'), null);
  assert.equal((await desktop('list', { tab: 'invalid' })).status, 400);
  assert.equal((await desktop('list', { filter: [] })).status, 400);
  assert.equal((await desktop('list', { filter: { unknown: true } })).status, 400);
  assert.equal((await desktop('read', {})).status, 404, 'Desktop exposes only the list and pin actions it needs');
  const unfinished = await (await desktop('list', { tab: 'active', filter: { completedFrom: Number.MAX_SAFE_INTEGER } })).json();
  assert.equal(unfinished.conversations.some((row: any) => row.id === 'assistant'), true, 'the completed-issue display option does not hide Dudu');
});

test('working replies keep their previous position, time, preview and unread count until the turn completes', async (t) => {
  const { issues, activity, say, event, call } = world(t);
  issues.add({ title: 'First', project, agent: 'claude', session: 'dsh:first' });
  issues.add({ title: 'Second', project, agent: 'codex', session: 'dsh:second' });
  say('first', 4, 3000, 'Previous answer');
  say('second', 4, 4000, 'Other answer');
  await activity.acknowledge('first', { seq: 4 });
  await activity.acknowledge('second', { seq: 4 });
  const list = () => call('board.list', { layout: 'chat' }) as Promise<any>;
  const row = (answer: any) => answer.conversations.find((entry: any) => entry.sessionId === 'first');
  const before = await list();
  const published = row(before);
  event('first', { type: 'turn/start', seq: 6, time: 5000, data: { turn: 1 } });
  event('first', message(7, 5500, 'Checking the files'));
  event('first', { type: 'tool/call', seq: 8, time: 6000, data: { name: 'bash' } });
  event('first', { type: 'tool/result', seq: 9, time: 6500, data: { output: 'Done' } });
  event('first', message(10, 7000, 'Details.\n\nFinal summary'));
  const working = await list();
  assert.deepEqual(working.conversations.map((entry: any) => entry.id), before.conversations.map((entry: any) => entry.id));
  assert.deepEqual(row(working), { ...published, sessionState: 'processing', issue: { ...published.issue, sessionState: 'processing' } });
  assert.equal(working.unreadCount, 0);
  event('first', { type: 'turn/end', seq: 11, time: 8000, data: { turn: 1, reason: { kind: 'completed' } } });
  const completed = await list();
  assert.equal(completed.conversations[0].sessionId, 'first');
  assert.equal(row(completed).preview, 'Final summary');
  assert.equal(row(completed).receivedAt, 8000);
  assert.equal(row(completed).readSeq, 10, 'the read boundary is the actual final message, not the end control event');
  assert.equal(row(completed).unread, true);
  assert.equal(completed.unreadCount, 1);
  await activity.acknowledge('first', { seq: 10 });
  event('first', { type: 'turn/start', seq: 12, time: 9000, data: { turn: 1 } });
  event('first', message(13, 9500, 'Another final summary'));
  await activity.acknowledge('first', { seq: 13 });
  assert.equal(row(await list()).receivedAt, 8000);
  event('first', { type: 'turn/end', seq: 14, time: 10000, data: { turn: 1, reason: { kind: 'completed' } } });
  assert.equal((await list()).unreadCount, 0, 'content read during generation stays read after completion');
  assert.equal(row(await list()).receivedAt, 10000);
});

test('desktop Updated shares phone completion times, ordering, ranges and cursor ties without rewriting issue metadata', async (t) => {
  const { issues, say, event, call, setTime } = world(t);
  for (let index = 1; index <= 12; index++) {
    issues.add({ title: `Issue ${index}`, project, agent: 'claude', session: `dsh:session-${index}` });
    if (index !== 5) say(`session-${index}`, 1, index % 3 === 0 ? 4_000 : 3_000, `Answer ${index}`);
  }
  const request = listRequest('active', { ...DEFAULT_VIEW, group: null });
  assert.equal(request.order, 'received');
  const list = () => issues.list({ ...request, limit: 200 });
  const phone = async () => (await call('board.list', { layout: 'chat' }) as any).conversations.filter((row: any) => row.issue);
  const match = async () => {
    const mobile = await phone();
    assert.deepEqual(list().items.map((row: any) => [row.id, row.receivedAt]), mobile.map((row: any) => [row.issue.id, row.receivedAt]));
  };
  await match();
  const before = list().items.map((row: any) => row.id);
  const last = issues.get(1).issue.receivedAt;
  setTime(90_000);
  issues.update(1, { title: 'Renamed', priority: 'urgent', status: 'in_progress' });
  issues.log(1, { kind: 'note', text: 'A comment is not an incoming Agent reply' });
  assert.equal(issues.get(1).issue.updatedAt, 90_000, 'the audit clock retains its independent meaning');
  assert.equal(issues.get(1).issue.receivedAt, last);
  event('session-1', { type: 'turn/start', seq: 3, time: 5_000, data: { turn: 2 } });
  event('session-1', { ...message(4, 6_000, 'Still working'), data: { turn: 2, step: 4, message: { content: [{ type: 'text', text: 'Still working' }] } } });
  assert.deepEqual(list().items.map((row: any) => row.id), before);
  await match();
  event('session-1', { type: 'turn/end', seq: 5, time: 7_000, data: { turn: 2, reason: { kind: 'completed' } } });
  assert.equal(list().items[0].id, 1);
  assert.equal(list().items[0].receivedAt, 7_000);
  assert.equal(issues.get(1).issue.updatedAt, 90_000, 'completion reads the shared projection without touching the issue');
  await match();
  for (const reverse of [false, true]) {
    const expected = list().items.map((row: any) => row.id);
    if (reverse) expected.reverse();
    const walked: number[] = [];
    let cursor: string | null = null;
    do {
      const page = issues.list({ ...request, reverse, limit: 3, cursor });
      assert.equal(page.outcome, 'success');
      walked.push(...page.items.map((row: any) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(walked, expected, 'equal times including two-digit IDs page once in phone order');
  }
  const grouped = issues.list({ ...request, group: 'status' });
  assert.deepEqual(grouped.groups.find((group: any) => group.key === 'in_progress').items.map((row: any) => row.id), [1]);
  assert.deepEqual(grouped.groups.find((group: any) => group.key === 'todo').items.map((row: any) => row.id), before.filter((id: number) => id !== 1));
  const ranged = listRequest('active', { ...DEFAULT_VIEW, order: 'updated', filter: { updated: ['day'] } }, 86_406_000);
  assert.deepEqual(ranged.filter, { receivedFrom: 0 });
  assert.deepEqual(issues.list({ ...ranged, group: null, filter: { receivedFrom: 3_600 } }).items.map((row: any) => row.id), [1, 12, 3, 6, 9]);
  const upper = listRequest('active', { ...DEFAULT_VIEW, filter: { updatedTo: 3_500 } });
  assert.deepEqual(upper.filter, { receivedTo: 3_500 });
  assert.deepEqual(issues.list({ ...request, filter: { receivedTo: 0 } }).items.map((row: any) => row.id), [5]);
  setTime(100_000);
  issues.update(9, { status: 'done' });
  const all = listRequest('all', { ...DEFAULT_VIEW, group: null, order: 'updated' });
  assert.equal(all.completedLast, false, 'an implicit completion-date sort must not replace the message clock');
  const mobileAll = (await call('board.list', { layout: 'chat', tab: 'all' }) as any).conversations.filter((row: any) => row.issue);
  assert.deepEqual(issues.list(all).items.map((row: any) => [row.id, row.receivedAt]), mobileAll.map((row: any) => [row.issue.id, row.receivedAt]));
});

test('manual unread and clearing use shared receipts, preserve newer answers, and reject a reassigned session', async (t) => {
  const { issues, activity, receipts, say, call } = world(t);
  const issue = issues.add({ title: 'Research', project, status: 'backlog', session: 'dsh:one', agent: 'claude' }).issue;
  const target = `issue:${issue.id}`;
  say('one', 4, 3_000, 'First answer');
  await call('board.read', { target, sessionId: 'one', seq: 4, unread: false });
  assert.equal(activity.statusOf('dsh:one').unread, false);
  await call('board.read', { target, sessionId: 'one', unread: true });
  assert.equal(activity.statusOf('dsh:one').unread, true, 'an already read answer can be marked unread');
  say('one', 8, 4_000, 'New answer');
  await call('board.read', { target, sessionId: 'one', seq: 4, unread: false });
  assert.equal(activity.statusOf('dsh:one').unread, true, 'an old swipe action cannot read a newer message');
  await call('board.read', { target, sessionId: 'one', seq: 8, unread: false });
  assert.equal(activity.statusOf('dsh:one').unread, false);
  await assert.rejects(call('board.read', { target, sessionId: 'one', seq: 9, unread: false }), /ahead/);
  issues.update(issue.id, { session: 'dsh:two' });
  await assert.rejects(call('board.read', { target, sessionId: 'one', seq: 8, unread: false }), { code: 'BAD_REQUEST' });
  assert.equal(receipts.get('dsh:two'), null);
  assert.equal(issues.get(issue.id).issue.status, 'backlog', 'read state never changes the issue workflow');
  assert.equal((await call('issue.update', { id: issue.id, patch: { title: 'Renamed from home' } }) as any).issue.title, 'Renamed from home');
  await call('issue.update', { id: issue.id, patch: { status: 'done' } });
  assert.equal((await call('board.list', { layout: 'chat' }) as any).conversations.some((entry: any) => entry.issue?.id === issue.id), false);
});
