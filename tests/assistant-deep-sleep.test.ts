import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeepSleep, withDeepSleep } from '../host/assistant/home/deep-sleep.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { DEEP_SLEEP_MS, handledAtOf, inDeepSleep, waitFor } from '../host/assistant/sessions/deep-sleep.mjs';
const MINUTE = 60_000;
const quiet = { warn() {}, info() {}, error() {} };

test('idle sleeps after thirty minutes, unread after an hour; sleeping never clears unread or changes workflow', () => {
  assert.equal(DEEP_SLEEP_MS, 30 * MINUTE);
  for (const state of ['idle', 'unread']) {
    const wait = state === 'idle' ? 30 : 60;
    const base = { key: 'dsh:a', agentMark: state, state: 'finished', turnActive: false, handledAt: 0 };
    assert.equal(waitFor(state), wait * MINUTE);
    assert.equal(inDeepSleep({ ...base, now: wait * MINUTE - 1 }), false);
    assert.equal(inDeepSleep({ ...base, now: wait * MINUTE }), true);
  }
  let now = 0;
  let state = 'unread';
  const issues = createIssues({ file: ':memory:', now: () => now, lifecycleState: () => 'finished',
    sessionState: () => state, sessionHandledAt: () => 0, sessionTurnActive: () => false });
  try {
    const issue = issues.add({ title: 'Unseen', status: 'backlog', agent: 'claude', project: { name: 'Work', path: '/work' }, session: 'dsh:a' }).issue;
    now = 60 * MINUTE;
    const asleep = issues.get(issue.id).issue;
    assert.equal(asleep.deepSleep, true);
    assert.equal(asleep.sessionState, 'unread');
    now = 10 * 24 * 60 * MINUTE;
    assert.equal(issues.get(issue.id).issue.sessionState, 'unread', 'no 72-hour automatic read');
    state = 'idle';
    assert.equal(issues.get(issue.id).issue.deepSleep, true);
    assert.equal(issues.get(issue.id).issue.status, 'backlog');
    assert.equal(issues.get(issue.id).issue.updatedAt, issue.updatedAt);
  } finally { issues.close(); }
});

test('real work and active dialogs cannot be released; inactive historical questions may sleep', () => {
  const base = { key: 'dsh:a', agentMark: 'unread', handledAt: 0, now: 90 * MINUTE };
  for (const state of ['idle', 'finished', 'error', 'stopped', 'waiting_owner']) {
    assert.equal(inDeepSleep({ ...base, state, turnActive: true }), false);
    assert.equal(inDeepSleep({ ...base, state, turnActive: false }), true);
  }
  assert.equal(inDeepSleep({ ...base, state: 'running', turnActive: false }), false);
  assert.equal(inDeepSleep({ ...base, state: 'waiting_owner', turnActive: null }), false);
  assert.equal(inDeepSleep({ ...base, state: 'finished', agentMark: 'processing' }), false);
  assert.equal(inDeepSleep({ ...base, key: 'claude:native', state: 'idle' }), false);
  assert.equal(inDeepSleep({ ...base, state: 'idle', handledAt: null }), false);
});

test('a session was last handled when its state began, when it last did anything, or when the owner last spoke to it or opened it: the latest of them', () => {
  assert.equal(handledAtOf({ stateSince: 100, lastActivityAt: 300, touchedAt: 200 }), 300);
  assert.equal(handledAtOf({ stateSince: 100, lastActivityAt: 50, touchedAt: 200 }), 200);
  assert.equal(handledAtOf({ stateSince: 100, lastActivityAt: null, touchedAt: null }), 100);
  assert.equal(handledAtOf({ stateSince: undefined, lastActivityAt: 0, touchedAt: undefined }), 0);
  assert.equal(handledAtOf({}), null);
  assert.equal(handledAtOf(null), null);
});

test('a session that falls asleep is let go of once, and again after it was awake', async () => {
  const flags = new Map<string, boolean>([['dsh:a', false], ['dsh:b', false]]);
  const released: string[] = [];
  const sleep = createDeepSleep({
    sessions: { keys: () => [...flags.keys()] }, asleep: (key: string) => flags.get(key) === true,
    release: async (key: string) => { released.push(key); return true; }, intervalMs: 0, log: quiet,
  });
  try {
    assert.deepEqual(await sleep.tick(), [], 'nobody sleeps');
    flags.set('dsh:a', true);
    assert.deepEqual(await sleep.tick(), ['dsh:a']);
    assert.equal(sleep.isAsleep('dsh:a'), true);
    assert.deepEqual(await sleep.tick(), [], 'not again while it sleeps');
    // the owner handles it: awake; the next time it is asleep it is let go of again
    flags.set('dsh:a', false);
    assert.deepEqual(await sleep.tick(), []);
    assert.equal(sleep.isAsleep('dsh:a'), false);
    flags.set('dsh:a', true);
    flags.set('dsh:b', true);
    assert.deepEqual(await sleep.tick(), ['dsh:a', 'dsh:b']);
    assert.deepEqual(released, ['dsh:a', 'dsh:a', 'dsh:b']);
  } finally { await sleep.close(); }
});

test('a release that fails does not stop the others, and is not tried again for the same sleep', async () => {
  const warnings: string[] = [];
  const attempts: string[] = [];
  const sleep = createDeepSleep({
    sessions: { keys: () => ['dsh:a', 'dsh:b'] }, asleep: () => true, intervalMs: 0, log: { warn: (message: string) => warnings.push(message) },
    release: async (key: string) => { attempts.push(key); if (key === 'dsh:a') throw new Error('refused'); return true; },
  });
  try {
    assert.deepEqual(await sleep.tick(), ['dsh:a', 'dsh:b']);
    assert.deepEqual(await sleep.tick(), []);
    assert.deepEqual(attempts, ['dsh:a', 'dsh:b']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /refused/);
  } finally { await sleep.close(); }
});

// 2026-11-27: only an issue's session was let go of; the process of any other conversation (130 to 400 MB with Claude or Codex) stayed until DSH exited.
function otherConversations(overrides: any = {}) {
  const clock = { now: 0 };
  const state = { held: [{ key: 'dsh:c', endedAt: 0 }] as { key: string; endedAt: number }[], mark: 'idle', on: true };
  const released: string[] = [];
  const sleep = createDeepSleep({
    sessions: { keys: () => ['dsh:issue'] }, asleep: () => false, intervalMs: 0, log: quiet, now: () => clock.now,
    held: () => state.held, markOf: () => state.mark, enabled: () => state.on,
    release: async (key: string) => { released.push(key); return true; }, ...overrides,
  });
  return { sleep, clock, state, released };
}

test('a conversation that is no issue\'s is let go of after the same waits, counted from the end of its turn; a working one, or an issue\'s, never by this', async () => {
  const { sleep, clock, state, released } = otherConversations();
  try {
    clock.now = 30 * MINUTE - 1; await sleep.tick();
    assert.deepEqual(released, [], 'idle: not before thirty minutes');
    clock.now = 30 * MINUTE; await sleep.tick();
    assert.deepEqual(released, ['dsh:c']);
    state.held = [{ key: 'dsh:c', endedAt: 100 * MINUTE }];
    state.mark = 'unread';
    clock.now = 160 * MINUTE - 1; await sleep.tick();
    assert.deepEqual(released, ['dsh:c'], 'unread: not before an hour');
    clock.now = 160 * MINUTE; await sleep.tick();
    assert.deepEqual(released, ['dsh:c', 'dsh:c']);
    state.held = [{ key: 'dsh:c', endedAt: 200 * MINUTE }, { key: 'dsh:issue', endedAt: 200 * MINUTE }];
    state.mark = 'processing';
    clock.now = 500 * MINUTE; await sleep.tick();
    assert.deepEqual(released, ['dsh:c', 'dsh:c'], 'a session that works or waits for the owner is never let go of, and an issue\'s session is left to its issue');
  } finally { await sleep.close(); }
});

test('reading the answer or a new turn starts the wait again, and the owner\'s switch turns it off', async () => {
  const { sleep, clock, state, released } = otherConversations();
  try {
    state.mark = 'unread'; state.held = [{ key: 'dsh:c', endedAt: 0 }];
    clock.now = 40 * MINUTE; await sleep.tick();
    state.mark = 'idle'; // read at minute 40
    await sleep.tick();
    clock.now = 69 * MINUTE; await sleep.tick();
    assert.deepEqual(released, [], 'thirty minutes after it was read, not at once');
    clock.now = 70 * MINUTE; await sleep.tick();
    assert.deepEqual(released, ['dsh:c']);
    state.held = [{ key: 'dsh:c', endedAt: 80 * MINUTE }]; // another turn ended
    clock.now = 109 * MINUTE; await sleep.tick();
    assert.equal(released.length, 1, 'counted from the end of the new turn');
    state.on = false;
    clock.now = 300 * MINUTE; await sleep.tick();
    assert.equal(released.length, 1, 'switched off: nothing is let go of');
  } finally { await sleep.close(); }
});

test('a release that is refused is asked again at the next look; one that fails is not asked again for the same turn', async () => {
  let answer: boolean | Error = false;
  const attempts: string[] = [];
  const warnings: string[] = [];
  const { sleep, clock } = otherConversations({
    log: { warn: (message: string) => warnings.push(message) },
    release: async (key: string) => { attempts.push(key); if (answer instanceof Error) throw answer; return answer; },
  });
  try {
    clock.now = 31 * MINUTE;
    await sleep.tick(); await sleep.tick();
    assert.equal(attempts.length, 2, 'it still has background work: tried at each look');
    answer = new Error('refused');
    await sleep.tick(); await sleep.tick(); await sleep.tick();
    assert.equal(attempts.length, 3, 'a failure is not tried again');
    assert.equal(warnings.length, 1);
  } finally { await sleep.close(); }
});

test('the sidebar and the phone are told which sessions sleep; only a session whose turn has ended is even looked up', () => {
  const asked: string[] = [];
  const asleep = (key: string) => { asked.push(key); return key === 'dsh:a'; };
  const snapshot = (state: string) => ({ state, lastActivityAt: 1 });
  for (const state of ['idle', 'finished', 'error']) assert.deepEqual(withDeepSleep(snapshot(state), 'dsh:a', asleep), { ...snapshot(state), deepSleep: true }, `${state}: it sleeps`);
  assert.deepEqual(withDeepSleep(snapshot('idle'), 'dsh:b', asleep), snapshot('idle'), 'one that is awake is as it was');
  for (const state of ['running', 'waiting_owner']) assert.deepEqual(withDeepSleep(snapshot(state), 'dsh:a', asleep), snapshot(state), `${state}: alive, not asleep`);
  assert.equal(withDeepSleep(null, 'dsh:a', asleep), null);
  assert.equal(withDeepSleep(undefined, 'dsh:a', asleep), undefined);
  assert.deepEqual(asked, ['dsh:a', 'dsh:a', 'dsh:a', 'dsh:b'], 'a running or waiting session, and one nobody knows, cost no lookup');
});
