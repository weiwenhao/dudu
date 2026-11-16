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
