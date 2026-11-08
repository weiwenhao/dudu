import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { agentMarkForActivity, agentMarkForSession, agentStateForActivity, agentStateForSession, stateOfMark } from '../host/assistant/sessions/work-state.mjs';

// A store whose sessions the test moves: the state each session is in, and since when.
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-agent-state-'));
  const states = new Map<string, string>();
  const since = new Map<string, number>();
  const handled = new Map<string, number>(); // when somebody last did anything with the session (the host's `sessionHandledAt`); unknown unless a test says
  const bases = new Map<string, string[]>(); // every `state@since` a session reads as, from the places it is read from (the host's `sessionBases`); none unless a test says
  let now = 1_800_000_000_000;
  const issues = createIssues({
    file: join(dir, 'issues.db'), now: () => now,
    sessionState: (key: string) => states.get(key) ?? null, sessionSince: (key: string) => since.get(key) ?? null,
    sessionBases: (key: string) => bases.get(key), sessionHandledAt: (key: string) => handled.get(key) ?? null,
  });
  const session = (key: string, state: string, from: number) => { states.set(key, state); since.set(key, from); };
  const issue = (key: string, state: string, from: number) => {
    session(key, state, from);
    const made = issues.add({ title: key, project: { name: 'work', path: '/work' }, agent: 'claude', session: key });
    assert.equal(made.outcome, 'success');
    now += 1000;
    return made.issue.id;
  };
  const lanes = () => Object.fromEntries(issues.list({ tab: 'all', group: 'agentState' }).groups.map((group: any) => [group.key, group.items.map((item: any) => item.id)]));
  const handle = (key: string, at: number) => handled.set(key, at);
  const clock = { get: () => now, set: (at: number) => { now = at; } };
  return { issues, session, issue, lanes, handle, bases: (key: string, list: string[]) => bases.set(key, list), clock, cleanup: () => { issues.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('the boss can say what state an agent is in; lists, groups, filters and counts all follow', (t) => {
  const s = store();
  t.after(s.cleanup);
  const id = s.issue('dsh:a', 'waiting_owner', 100);
  assert.deepEqual(s.lanes(), { blocked: [id] });
  const set = s.issues.update(id, { agentState: 'idle' });
  assert.equal(set.outcome, 'success', JSON.stringify(set));
  assert.equal(set.issue.agentState, 'idle');
  assert.equal('agentStateBasis' in set.issue, false, 'the basis stays inside the store');
  assert.equal(s.issues.get(id).issue.agentState, 'idle');
  assert.deepEqual(s.lanes(), { idle: [id] });
  assert.deepEqual(s.issues.list({ tab: 'all', filter: { agentState: ['idle'] } }).items.map((item: any) => item.id), [id]);
  assert.deepEqual(s.issues.list({ tab: 'all', filter: { agentState: ['blocked'] } }).items, []);
  const office = s.issues.office();
  assert.equal(office.counts.idle, 1, 'the Office counts the state the boss gave');
  assert.equal(office.counts.blocked, 0);
});

test('a finished run, a question and a failure are all "blocked": the boss\'s turn; there is no "done" state', (t) => {
  const s = store();
  t.after(s.cleanup);
  const asked = s.issue('dsh:ask', 'waiting_owner', 100);
  const failed = s.issue('dsh:bad', 'error', 100);
  const finished = s.issue('dsh:fin', 'finished', 100);
  const resting = s.issue('dsh:rest', 'idle', 100);
  assert.deepEqual(s.lanes(), { blocked: [asked, failed, finished], idle: [resting] });
  assert.deepEqual(s.issues.list({ tab: 'all', filter: { agentState: ['blocked'] } }).items.map((item: any) => item.id).sort(), [asked, failed, finished].sort());
  assert.equal(s.issues.office().counts.blocked, 3);
  assert.equal('done' in s.issues.office().counts, false);
  const old = s.issues.list({ tab: 'all', filter: { agentState: ['done'] } });
  assert.equal(old.outcome, 'needs_clarification');
  assert.match(old.message, /idle, working, blocked/);
  // What tells them apart is the session's own state, which the reminders ask for.
  assert.deepEqual(s.issues.list({ tab: 'all', filter: { sessionState: ['waiting_owner', 'error'] } }).items.map((item: any) => item.id).sort(), [asked, failed].sort());
});

test('the session has the last word: when its state changes, or it is working, the fact shows again', (t) => {
  const s = store();
  t.after(s.cleanup);
  const id = s.issue('dsh:a', 'waiting_owner', 100);
  s.issues.update(id, { agentState: 'idle' });
  assert.deepEqual(s.lanes(), { idle: [id] });
  // The boss answers in the session and it runs: live work is never hidden, whatever was said before.
  s.session('dsh:a', 'running', 200);
  assert.deepEqual(s.lanes(), { working: [id] });
  // It ends by finishing: this is a new state (it began later), so the old word does not hide it.
  s.session('dsh:a', 'finished', 300);
  assert.deepEqual(s.lanes(), { blocked: [id] });
  // The same state and the same beginning: the word still holds.
  s.issues.update(id, { agentState: 'idle' });
  assert.deepEqual(s.lanes(), { idle: [id] });
  s.session('dsh:a', 'finished', 300);
  assert.deepEqual(s.lanes(), { idle: [id] });
  // The same kind of state, begun again: it is new.
  s.session('dsh:a', 'finished', 400);
  assert.deepEqual(s.lanes(), { blocked: [id] });
});

test('a word cannot be given over live work or to an issue without an agent, and only idle and blocked can be given', (t) => {
  const s = store();
  t.after(s.cleanup);
  const working = s.issue('dsh:w', 'running', 100);
  const refused = s.issues.update(working, { agentState: 'blocked' });
  assert.equal(refused.outcome, 'needs_clarification');
  assert.match(refused.message, /working/);
  assert.deepEqual(s.lanes(), { working: [working] });
  const bare = s.issues.add({ title: 'no agent' });
  const none = s.issues.update(bare.issue.id, { agentState: 'blocked' });
  assert.equal(none.outcome, 'needs_clarification');
  assert.match(none.message, /no agent state|without an agent/);
  const id = s.issue('dsh:a', 'finished', 100);
  for (const value of ['working', 'done', 'asleep', 3]) assert.equal(s.issues.update(id, { agentState: value }).outcome, 'needs_clarification', String(value));
  assert.equal(s.issues.update(id, { agentStateBasis: 'x' }).outcome, 'needs_clarification', 'the basis is the store\'s own');
});

test('null takes the word back, Undo puts it back, and another session forgets it', (t) => {
  const s = store();
  t.after(s.cleanup);
  const id = s.issue('dsh:a', 'error', 100);
  assert.deepEqual(s.lanes(), { blocked: [id] });
  const set = s.issues.update(id, { agentState: 'idle' });
  assert.deepEqual(s.lanes(), { idle: [id] });
  const undone = s.issues.undo(set.eventId);
  assert.equal(undone.outcome, 'success', JSON.stringify(undone));
  assert.deepEqual(s.lanes(), { blocked: [id] }, 'Undo gives the fact back');
  s.issues.update(id, { agentState: 'idle' });
  assert.deepEqual(s.lanes(), { idle: [id] });
  const cleared = s.issues.update(id, { agentState: null });
  assert.equal(cleared.outcome, 'success');
  assert.deepEqual(s.lanes(), { blocked: [id] });
  // A word about one session is not a word about the next.
  s.issues.update(id, { agentState: 'idle' });
  s.session('dsh:b', 'finished', 400);
  const moved = s.issues.update(id, { session: 'dsh:b' });
  assert.equal(moved.outcome, 'success', JSON.stringify(moved));
  assert.deepEqual(s.lanes(), { blocked: [id] }, 'the new session is a fact of its own');
});

test('a word is kept across a restart of the store', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-agent-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const options = { file: join(dir, 'issues.db'), sessionState: () => 'waiting_owner', sessionSince: () => 100 };
  const first = createIssues(options);
  const made = first.add({ title: 'a', project: { name: 'work', path: '/work' }, agent: 'claude', session: 'dsh:a' });
  first.update(made.issue.id, { agentState: 'idle' });
  first.close();
  const second = createIssues(options);
  t.after(() => second.close());
  assert.equal(second.get(made.issue.id).issue.agentState, 'idle');
});

test('what the boss said before "done" went away is kept as "blocked", once', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-agent-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'issues.db');
  const options = { file, sessionState: () => 'idle', sessionSince: () => 100 };
  const first = createIssues(options);
  const made = first.add({ title: 'a', project: { name: 'work', path: '/work' }, agent: 'claude', session: 'dsh:a' });
  first.update(made.issue.id, { agentState: 'blocked' });
  first.close();
  // The database as the last build left it: the word was "done" and the migration that follows was not there yet.
  const raw = new DatabaseSync(file);
  const before = (raw.prepare('PRAGMA user_version').get() as any).user_version;
  raw.exec("UPDATE issues SET agent_state = 'done'");
  raw.exec(`PRAGMA user_version = ${before - 8}`); // that migration, and the seven after it (the inbox's three: tables, the owner's marks, the collection's signals; the attachments; the labels; the links; the inbox's done and deleted marks), which can run twice
  raw.close();
  const second = createIssues(options);
  assert.equal(second.get(made.issue.id).issue.agentState, 'blocked', 'the session is at rest, so this is the boss\'s word');
  second.close();
  const after = new DatabaseSync(file);
  t.after(() => after.close());
  assert.equal((after.prepare('SELECT agent_state FROM issues').get() as any).agent_state, 'blocked');
  assert.equal((after.prepare('PRAGMA user_version').get() as any).user_version, before);
});

test('the corner of an avatar tells a finished run (a check) from a question or a failure (red), and all three are the state "blocked"', (t) => {
  const s = store();
  t.after(s.cleanup);
  const asked = s.issue('dsh:ask', 'waiting_owner', 100);
  const failed = s.issue('dsh:bad', 'error', 100);
  const finished = s.issue('dsh:fin', 'finished', 100);
  const resting = s.issue('dsh:rest', 'idle', 100);
  const running = s.issue('dsh:run', 'running', 100);
  const flag = (id: number) => s.issues.get(id).issue;
  assert.deepEqual([asked, failed, finished, resting, running].map((id) => [flag(id).agentState, flag(id).agentFinished === true]),
    [['blocked', false], ['blocked', false], ['blocked', true], ['idle', false], ['working', false]]);
  // the lists, the groups and the Office carry it: it is on the issue, wherever the issue is shown
  assert.deepEqual(s.issues.list({ tab: 'all' }).items.filter((item: any) => item.agentFinished).map((item: any) => item.id), [finished]);
  assert.deepEqual(s.issues.list({ tab: 'all', group: 'agentState' }).groups.find((group: any) => group.key === 'blocked').items.filter((item: any) => item.agentFinished).map((item: any) => item.id), [finished]);
  assert.deepEqual(s.issues.office().items.filter((item: any) => item.agentFinished).map((item: any) => item.id), [finished]);
  // the boss's word is never a finished run: "blocked" over a finished session is red, "idle" is idle, and taking the word back shows the fact again
  assert.equal(s.issues.update(finished, { agentState: 'blocked' }).outcome, 'success');
  assert.deepEqual([flag(finished).agentState, flag(finished).agentFinished === true], ['blocked', false]);
  s.issues.update(finished, { agentState: 'idle' });
  assert.deepEqual([flag(finished).agentState, flag(finished).agentFinished === true], ['idle', false]);
  s.issues.update(finished, { agentState: null });
  assert.deepEqual([flag(finished).agentState, flag(finished).agentFinished === true], ['blocked', true]);
  // grouping and filtering are on the state, not the mark: a finished run is in the "blocked" lane with the questions
  assert.deepEqual(s.lanes().blocked.sort(), [asked, failed, finished].sort());
});

test('the work-state helpers: a mark is one of four, and its state one of three', () => {
  assert.deepEqual(['running', 'waiting_owner', 'error', 'stopped', 'finished', 'idle', null, 'nonsense'].map((state) => agentMarkForSession(state)), ['working', 'blocked', 'blocked', 'blocked', 'done', 'idle', 'idle', 'idle']);
  assert.deepEqual(['running', 'waiting_owner', 'error', 'stopped', 'finished', 'idle', null].map((state) => agentStateForSession(state)), ['working', 'blocked', 'blocked', 'blocked', 'blocked', 'idle', 'idle']);
  assert.deepEqual(['idle', 'working', 'blocked', 'done'].map((mark) => stateOfMark(mark)), ['idle', 'working', 'blocked', 'blocked']);
  // live work wins; then the session's own facts when they are newer than what was saved; then what was saved (a saved "done" is a finished run)
  const now = 1000; // the facts of this test are a few milliseconds old: the clock stands next to them, or a day would have gone since
  const markAt = (live: any, savedCopy: any, index: any) => agentMarkForActivity(live, savedCopy, index, { now });
  const stateAt = (live: any, savedCopy: any, index: any) => agentStateForActivity(live, savedCopy, index, { now });
  const saved = (state: string, at = 100) => ({ state, at });
  const indexed = (state: string, lastActivityAt: number) => ({ state, lastActivityAt });
  assert.equal(markAt({ pendingInteraction: true, running: true }, saved('done'), indexed('finished', 200)), 'blocked', 'a question is red even over a finished run');
  assert.equal(markAt({ running: true }, saved('done'), null), 'working');
  assert.equal(markAt({}, saved('done'), indexed('waiting_owner', 50)), 'done', 'saved is newer than the index: it wins');
  assert.equal(markAt({}, saved('done'), indexed('error', 200)), 'blocked', 'the index is newer: a failure');
  assert.equal(markAt({}, saved('blocked'), null), 'blocked');
  assert.equal(markAt({}, saved('idle'), null), 'idle');
  assert.equal(markAt({}, null, indexed('finished', 5)), 'done', 'a finished run waits for its look (until it has been left for a day: the test after this one)');
  assert.equal(markAt({}, saved('done', 1), indexed('finished', 1)), 'done');
  assert.equal(markAt({ completionUnread: true }, null, null), 'done', 'a finished run nobody has read');
  assert.equal(markAt({}, null, null), 'idle');
  // the state is the mark folded into three, for everything that groups, filters and counts
  for (const [live, savedState, index] of [[{ pendingInteraction: true }, null, null], [{}, saved('done'), null], [{}, null, indexed('finished', 1)], [{ completionUnread: true }, null, null], [{ running: true }, null, null], [{}, null, null]] as any[]) {
    assert.equal(stateAt(live, savedState, index), stateOfMark(markAt(live, savedState, index)));
  }
});

const HOUR = 60 * 60_000;

test('an issue without an agent is "unassigned", and it is the state it starts in; assigning an agent moves it to what the agent\'s work is doing', (t) => {
  const s = store();
  t.after(s.cleanup);
  const made = s.issues.add({ title: 'nobody yet' });
  assert.equal(made.outcome, 'success');
  assert.equal(made.issue.agentState, 'unassigned');
  assert.deepEqual(s.lanes(), { unassigned: [made.issue.id] });
  assert.deepEqual(s.issues.list({ tab: 'all', filter: { agentState: ['unassigned'] } }).items.map((item: any) => item.id), [made.issue.id]);
  assert.deepEqual(s.issues.list({ tab: 'all', filter: { agentState: ['idle', 'working', 'blocked'] } }).items, [], 'idle is an agent with nothing to do, not no agent');
  const working = s.issue('dsh:w', 'running', 100);
  const resting = s.issue('dsh:r', 'idle', 100);
  assert.deepEqual(s.lanes(), { working: [working], idle: [resting], unassigned: [made.issue.id] }, 'the lanes: working, blocked, idle, then unassigned');
  assert.deepEqual(Object.keys(s.lanes()), ['working', 'idle', 'unassigned']);
});

test('a session that was stopped, a question, a failure and a finished run all need the owner; an idle one does not', (t) => {
  const s = store();
  t.after(s.cleanup);
  const stopped = s.issue('dsh:stop', 'stopped', 100);
  const asked = s.issue('dsh:ask', 'waiting_owner', 100);
  const failed = s.issue('dsh:bad', 'error', 100);
  const finished = s.issue('dsh:fin', 'finished', 100);
  const resting = s.issue('dsh:rest', 'idle', 100);
  assert.deepEqual(s.lanes(), { blocked: [stopped, asked, failed, finished], idle: [resting] });
  const flag = (id: number) => s.issues.get(id).issue;
  assert.deepEqual([stopped, asked, failed].map((id) => flag(id).agentFinished === true), [false, false, false], 'a stop is red, not a check');
  assert.equal(flag(stopped).deepSleep, undefined, 'and a session that needs the owner never sleeps');
});

test('what waits for the owner and has not been handled for 24 hours reads Idle by itself; before that, and when nobody can say when it was handled, it stays with the owner (owner, 2026-11-07: "超过 24 小时没有处理的会话也自动进入到空闲中")', (t) => {
  const s = store();
  t.after(s.cleanup);
  const flag = (id: number) => s.issues.get(id).issue;
  const at = (hours: number) => s.clock.get() - hours * HOUR;
  const aged = (key: string, state: string, hours: number) => { const id = s.issue(key, state, at(hours)); s.handle(key, at(hours)); return id; };
  const finished = aged('dsh:fin', 'finished', 40);
  const asked = aged('dsh:ask', 'waiting_owner', 40);
  const failed = aged('dsh:bad', 'error', 40);
  const stopped = aged('dsh:stop', 'stopped', 40);
  const fresh = aged('dsh:new', 'finished', 23);
  const unknown = s.issue('dsh:unknown', 'finished', at(40)); // nobody can say when it was handled: that is not guessed
  const resting = aged('dsh:rest', 'idle', 40);
  const sorted = (list: number[]) => [...list].sort((a, b) => a - b);
  const lanes = () => Object.fromEntries(Object.entries(s.lanes()).map(([key, ids]) => [key, sorted(ids as number[])]));
  assert.deepEqual(lanes(), { blocked: sorted([fresh, unknown]), idle: sorted([finished, asked, failed, stopped, resting]) }, 'a day and more unhandled: Idle; 23 hours, and a time nobody knows: still the owner\'s');
  assert.deepEqual([flag(finished).agentState, flag(finished).agentFinished === true], ['idle', false], 'and the green check is gone with it');
  assert.deepEqual([flag(fresh).agentState, flag(fresh).agentFinished === true], ['blocked', true]);
  // an agent that is idle by the clock is in deep sleep at once if its turn has ended (nobody handled it for far longer than the half hour), but not one that still waits for an answer
  assert.deepEqual([finished, failed, stopped].map((id) => flag(id).deepSleep === true), [true, true, true]);
  assert.equal(flag(asked).deepSleep, undefined, 'a question that is alive is not asleep: its turn has not ended');
  // time passing: the 23 hours become 24, and the one nobody can date never does
  s.clock.set(s.clock.get() + 2 * HOUR);
  assert.deepEqual(lanes(), { blocked: [unknown], idle: sorted([finished, asked, failed, stopped, resting, fresh]) });
  // the owner's word beats the clock: a finished run put in "needs you" by hand stays there, however long it is left
  assert.equal(s.issues.update(finished, { agentState: 'blocked' }).outcome, 'success');
  s.clock.set(s.clock.get() + 100 * HOUR);
  assert.equal(flag(finished).agentState, 'blocked', 'the owner\'s word holds while the session\'s state does not change');
  // and being handled (a new word from the session) starts the day again
  s.handle('dsh:rest', s.clock.get());
  s.session('dsh:rest', 'finished', s.clock.get());
  assert.equal(flag(resting).agentState, 'blocked');
});

test('the boss\'s word holds whichever of the places a session is read from answers: it does not jump between Idle and Needs you with it (owner, 2026-11-07: "空闲和需要你会来回替换")', (t) => {
  const s = store();
  t.after(s.cleanup);
  // DSH says the turn ended at 200, the harness's transcript says 100: two places, two "since", one session
  const id = s.issue('dsh:two', 'finished', 100);
  s.bases('dsh:two', ['finished@100', 'finished@200']);
  assert.equal(s.issues.update(id, { agentState: 'idle' }).outcome, 'success'); // given while the harness answered (100)
  const lane = () => s.issues.get(id).issue.agentState;
  assert.equal(lane(), 'idle');
  for (const asked of [200, 100, 200, 200, 100]) { // what is asked changes with whatever either place last did
    s.session('dsh:two', 'finished', asked);
    assert.equal(lane(), 'idle', `asked for since ${asked}: the word holds`);
  }
  // a turn that ended since is a new state, in both places: the word is gone
  s.session('dsh:two', 'finished', 500);
  s.bases('dsh:two', ['finished@500', 'finished@510']);
  assert.equal(lane(), 'blocked');
  // a store that is told of one place only (no `sessionBases`) holds the word by that one, as it always did
  const lone = store();
  t.after(lone.cleanup);
  const one = lone.issue('dsh:one', 'finished', 100);
  assert.equal(lone.issues.update(one, { agentState: 'idle' }).outcome, 'success');
  lone.session('dsh:one', 'finished', 100);
  assert.equal(lone.issues.get(one).issue.agentState, 'idle');
  lone.session('dsh:one', 'finished', 101);
  assert.equal(lone.issues.get(one).issue.agentState, 'blocked');
});

test('the marks of the sidebar and the phone age the same way: a state that waits for the owner and has not been handled for a day is Idle', () => {
  const day = 24 * HOUR;
  const now = 10 * day;
  const old = { state: 'finished', lastActivityAt: now - day - 1, stateSince: now - day - 1 };
  assert.equal(agentMarkForActivity(undefined, undefined, old, { now }), 'idle');
  assert.equal(agentMarkForActivity(undefined, undefined, { ...old, lastActivityAt: now - day + 1000, stateSince: now - day + 1000 }, { now }), 'done', 'a minute short of the day');
  assert.equal(agentMarkForActivity(undefined, { state: 'blocked', at: now - 3 * day }, undefined, { now }), 'idle', 'what the session saved of itself ages too');
  assert.equal(agentMarkForActivity({ running: true }, undefined, old, { now }), 'working', 'work that runs is never aged');
  assert.equal(agentMarkForActivity({ pendingInteraction: true }, undefined, old, { now }), 'blocked', 'nor is a question that is live');
  assert.equal(agentMarkForActivity(undefined, undefined, { state: 'finished' }, { now }), 'done', 'a time nobody has is not guessed');
});
