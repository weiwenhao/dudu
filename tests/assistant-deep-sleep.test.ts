import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAgentSessions } from '../host/assistant/home/agent-sessions.mjs';
import { createAssignment } from '../host/assistant/home/assign.mjs';
import { createDeepSleep, withDeepSleep } from '../host/assistant/home/deep-sleep.mjs';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { DEEP_SLEEP_MS, handledAtOf, inDeepSleep, waitFor } from '../host/assistant/sessions/deep-sleep.mjs';
import { createSessions } from '../host/assistant/sessions/index.mjs';
import { fakeDsh } from './fake-dsh.mjs';

// Deep sleep (docs/assistant.md 3.4): an agent that is idle, or whose run finished and waits for a look (its turn has ended, and it is not one that asks,
// fails or was stopped: a red dot) and that nobody has handled for half an hour has nothing running, so what 嘟嘟 holds for it is let go of; the issue, its
// status and the agent's state are not touched, and the owner speaking to the session or opening it wakes it.

const MINUTE = 60_000;
const quiet = { warn() {}, info() {}, error() {} };

test('an idle agent sleeps after half an hour and a finished run that waits for a look after an hour: a session 嘟嘟 can start again, a turn that has ended, and nobody who handled it', () => {
  assert.equal(DEEP_SLEEP_MS, 30 * MINUTE);
  const base = { key: 'dsh:a', agentMark: 'idle', handledAt: 1_000_000 };
  const at = (minutes: number) => 1_000_000 + minutes * MINUTE;
  // idle by the session's own state, or by the owner's word over a run that finished or failed
  for (const state of ['idle', 'finished', 'error']) {
    assert.equal(inDeepSleep({ ...base, state, now: at(29.99) }), false, `${state}: not yet`);
    assert.equal(inDeepSleep({ ...base, state, now: at(30) }), true, `${state}: asleep at half an hour`);
    assert.equal(inDeepSleep({ ...base, state, now: at(600) }), true, `${state}: and still asleep`);
  }
  // A run that finished and waits for a look (the green check, the Needs-you stage) sleeps too, but only after an hour with nothing new (owner, 2026-11-07: "in the
  // Needs-you stage more than an hour, in the idle area keep thirty minutes"); one that asks, fails or was stopped (a red dot, the mark "blocked"), or works, does
  // not, and nor does anything that is not a mark.
  for (const state of ['finished', 'idle']) {
    assert.equal(inDeepSleep({ ...base, agentMark: 'done', state, now: at(30) }), false, `done / ${state}: half an hour is not enough`);
    assert.equal(inDeepSleep({ ...base, agentMark: 'done', state, now: at(59.99) }), false, `done / ${state}: nor is a minute short of an hour`);
    assert.equal(inDeepSleep({ ...base, agentMark: 'done', state, now: at(60) }), true, `done / ${state}: an hour is`);
  }
  for (const agentMark of ['idle', 'done']) for (const state of ['finished', 'idle']) assert.equal(inDeepSleep({ ...base, agentMark, state, now: at(600) }), true, `${agentMark} / ${state}`);
  assert.deepEqual([waitFor('idle'), waitFor('done'), waitFor('done', 5 * MINUTE), waitFor('blocked')], [30 * MINUTE, 60 * MINUTE, 10 * MINUTE, 30 * MINUTE], 'a finished run waits twice what an idle agent does');
  for (const agentMark of ['working', 'blocked', null, undefined, 'something else']) assert.equal(inDeepSleep({ ...base, agentMark: agentMark as string, state: 'finished', now: at(600) }), false, String(agentMark));
  // A turn that works, or waits for its answer, is alive: letting go of it would lose the work or the question, whatever the owner said of it.
  for (const state of ['running', 'waiting_owner', null, undefined, 'something else']) assert.equal(inDeepSleep({ ...base, state: state as string, now: at(600) }), false, String(state));
  // Only a DSH session: a conversation in somebody's terminal is not 嘟嘟's to put to sleep or to start again.
  for (const key of ['claude:abc', 'codex:abc', 'dsh:', '', null]) assert.equal(inDeepSleep({ key: key as string, agentMark: 'idle', state: 'idle', handledAt: 0, now: at(600) }), false, String(key));
  // When it was handled is never guessed.
  for (const handledAt of [null, undefined, Number.NaN]) assert.equal(inDeepSleep({ key: 'dsh:a', agentMark: 'idle', state: 'idle', handledAt: handledAt as number, now: at(600) }), false, String(handledAt));
  assert.equal(inDeepSleep({ ...base, state: 'idle', now: at(5), afterMs: 5 * MINUTE }), true, 'the time is a choice of the caller');
});

test('a session was last handled when its state began, when it last did anything, or when the owner last spoke to it or opened it: the latest of them', () => {
  assert.equal(handledAtOf({ stateSince: 100, lastActivityAt: 300, touchedAt: 200 }), 300);
  assert.equal(handledAtOf({ stateSince: 100, lastActivityAt: 50, touchedAt: 200 }), 200);
  assert.equal(handledAtOf({ stateSince: 100, lastActivityAt: null, touchedAt: null }), 100);
  assert.equal(handledAtOf({ stateSince: undefined, lastActivityAt: 0, touchedAt: undefined }), 0);
  assert.equal(handledAtOf({}), null);
  assert.equal(handledAtOf(null), null);
});

test('a historical question can sleep only with confirmed inactive work; live work and unknown liveness stay awake', () => {
  const base = { key: 'dsh:old-question', state: 'waiting_owner', agentMark: 'idle', handledAt: 0, now: 60 * MINUTE };
  assert.equal(inDeepSleep({ ...base, turnActive: false }), true, 'an idle mark over a question left in the transcript');
  assert.equal(inDeepSleep({ ...base, turnActive: false, now: 29 * MINUTE }), false, 'the ordinary idle wait still applies');
  for (const turnActive of [true, null, undefined]) {
    assert.equal(inDeepSleep({ ...base, turnActive }), false, `active or not yet read: ${turnActive}`);
  }
  for (const agentMark of ['working', 'blocked']) {
    assert.equal(inDeepSleep({ ...base, turnActive: false, agentMark }), false, 'the owner has not put the question aside');
  }
  for (const state of ['idle', 'finished', 'error', 'stopped', 'running']) {
    assert.equal(inDeepSleep({ ...base, state, turnActive: true }), false, `${state}: live work always prevents sleep`);
  }
  assert.equal(inDeepSleep({ ...base, state: 'running', turnActive: false }), false, 'a stale inactive observation cannot hide a running state');
});

test('closed and aged issues sleep over historical questions without changing history; native dialogs and DSH waiters stay awake', async () => {
  let clock = 1_800_000_000_000;
  const facts = ['closed', 'aged', 'dialog'].map((id) => ({
    id, updatedAt: clock - 80 * 60 * MINUTE, lastActivityAt: clock - 80 * 60 * MINUTE,
    process: null as any, tail: { last: 'answer', at: clock - 80 * 60 * MINUTE, ending: 'Continue with this?', turnEnded: true },
  }));
  const native = createSessions({
    file: ':memory:', intervals: false, now: () => clock, pinned: () => true,
    readers: { claude: { scan: async () => facts } }, links: { get: (_provider: string, id: string) => id },
  });
  const world = fakeDsh({ turns: new Map([['closed', { last: 'answer', at: facts[0].lastActivityAt }]]) });
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet, now: () => clock });
  let assignment: any;
  const background = new Set<string>();
  const issues = createIssues({
    file: ':memory:', now: () => clock,
    sessionState: (key: string) => assignment.sessionState(key),
    sessionSince: (key: string) => assignment.sessionSince(key),
    sessionBases: (key: string) => assignment.sessionBases(key),
    sessionHandledAt: (key: string) => assignment.sessionHandledAt(key),
    sessionTurnActive: (key: string) => background.has(key) || assignment.sessionTurnActive?.(key),
  });
  assignment = createAssignment({ issues, agentSessions: sessions, snapshotOf: native.snapshotOf, log: quiet });
  try {
    await native.poll();
    const add = (key: string) => issues.add({ title: key, project: { name: 'work', path: '/work' }, agent: 'claude', session: `dsh:${key}` }).issue;
    const closed = add('closed');
    issues.update(closed.id, { status: 'done', agentState: 'idle' });
    const aged = add('aged');
    const dialog = add('dialog');
    const get = (id: number) => issues.get(id).issue;
    const unchanged = [get(closed.id).status, get(closed.id).updatedAt, get(closed.id).ask];
    assert.equal(get(closed.id).deepSleep, true, 'completed HOU-9 shape: an old question and the owner\'s idle mark');
    assert.equal(get(aged.id).deepSleep, true, 'HOU-4 / AIP-1 shape: the question aged into Idle');
    assert.equal(native.snapshotOf('dsh:closed')!.state, 'waiting_owner', 'the historical question remains resumable');
    assert.equal(withDeepSleep(assignment.snapshotOf('dsh:closed'), 'dsh:closed', () => get(closed.id).deepSleep).deepSleep, true, 'sidebar and phone agree with the issue');

    facts[2].process = { status: 'waiting', since: facts[2].lastActivityAt, waitingFor: 'dialog open' };
    await native.poll();
    assert.equal(get(dialog.id).deepSleep, undefined, 'a real native dialog stays alive even after three days');
    background.add('dsh:aged');
    assert.equal(get(aged.id).deepSleep, undefined, 'a retained native background task prevents sleep too');
    background.clear();
    assert.deepEqual([get(closed.id).status, get(closed.id).updatedAt, get(closed.id).ask], unchanged, 'sleep computation never changes the issue or its workflow');

    await assignment.onResume(get(closed.id));
    assert.equal(sessions.snapshotOf('dsh:closed')?.touchedAt, clock, 'opening a completed issue not restored after restart is handling it too');
    assert.equal(get(closed.id).deepSleep, undefined, 'opening it wakes it immediately');
    clock += 30 * MINUTE;
    assert.equal(get(closed.id).deepSleep, true, 'the same historical question sleeps again after the ordinary idle wait');
    const waiter = world.say.ask('closed', 'Approve this?', undefined, 'approval')!;
    issues.update(closed.id, { agentState: 'idle' });
    clock += 80 * 60 * MINUTE;
    assert.equal(get(closed.id).deepSleep, undefined, 'an actual DSH approval still waits, whatever the idle mark and age');
    assert.equal(withDeepSleep(assignment.snapshotOf('dsh:closed'), 'dsh:closed', () => true).deepSleep, undefined, 'the live waiter also protects the sidebar');
    waiter.close();
  } finally {
    await assignment.dispose();
    sessions.dispose();
    await native.dispose();
    issues.close();
  }
});

test('the owner starting, speaking to or opening a session is what keeps it awake; adopting one after a restart is not', async () => {
  let clock = 1_000;
  const world = fakeDsh();
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet, now: () => clock });
  try {
    const started = await sessions.start({ agent: 'deepseek', firstMessage: 'Do the thing.', cwd: '/work/app' });
    assert.equal(started.outcome, 'success');
    const key = started.key as string;
    assert.equal(sessions.snapshotOf(key)!.touchedAt, 1_000, 'started');
    world.say.answer('s1', 'Done.');
    clock = 5_000;
    assert.equal(sessions.snapshotOf(key)!.touchedAt, 1_000, 'what the agent does is not the owner handling it');
    await sessions.send(key, 'one more thing');
    assert.equal(sessions.snapshotOf(key)!.touchedAt, 5_000, 'spoken to');
    world.say.answer('s1', 'Done again.');
    await sessions.close(key);
    clock = 9_000;
    assert.equal((await sessions.resume(key)).outcome, 'success');
    assert.equal(sessions.snapshotOf(key)!.touchedAt, 9_000, 'opened');
    clock = 12_000;
    await sessions.adopt('dsh:elsewhere', { agent: 'claude', cwd: '/work/other' });
    assert.equal(sessions.snapshotOf('dsh:elsewhere')!.touchedAt, null, 'followed after a restart: nobody has handled it');
    // an answer to its question is the owner speaking to it as well
    const asked = world.say.ask('s1', 'Which one?');
    assert.ok(asked);
    clock = 15_000;
    await sessions.send(key, 'The first.');
    assert.equal(sessions.snapshotOf(key)!.touchedAt, 15_000, 'answered');
  } finally { sessions.dispose(); }
});

// The issues store with sessions whose state and last handling the test moves, and a clock.
function store(options: { deepSleepOn?: () => boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dudu-deep-sleep-'));
  const states = new Map<string, string>();
  const handled = new Map<string, number>();
  let now = 1_800_000_000_000;
  const issues = createIssues({
    file: join(dir, 'issues.db'), now: () => now,
    sessionState: (key: string) => states.get(key) ?? null, sessionSince: () => null, sessionHandledAt: (key: string) => handled.get(key) ?? null,
    ...options,
  });
  const add = (key: string | null, state: string | null, fields: Record<string, unknown> = {}) => {
    if (key && state) { states.set(key, state); handled.set(key, now); }
    const made = issues.add({ title: key ?? 'no session', project: { name: 'work', path: '/work' }, agent: 'claude', ...(key ? { session: key } : {}), ...fields });
    assert.equal(made.outcome, 'success', JSON.stringify(made));
    return made.issue.id as number;
  };
  return {
    issues, add, states, handled,
    wait: (minutes: number) => { now += minutes * MINUTE; },
    cleanup: () => { issues.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('an issue says its agent is in deep sleep, in the list, on its own and in the Office; nothing else about it changes', (t) => {
  const s = store();
  t.after(s.cleanup);
  const id = s.add('dsh:a', 'idle');
  const asleep = (issue: number) => Boolean((s.issues.get(issue).issue as any).deepSleep);
  const before = s.issues.get(id).issue as any;
  assert.equal(before.agentState, 'idle');
  assert.equal(asleep(id), false, 'just now');
  s.wait(29);
  assert.equal(asleep(id), false, 'not yet');
  s.wait(1);
  assert.equal(asleep(id), true);
  assert.equal(s.issues.list({ tab: 'all' }).items.find((item: any) => item.id === id).deepSleep, true, 'in the list');
  assert.equal(s.issues.office().items.find((item: any) => item.id === id).deepSleep, true, 'and in the Office');
  const after = s.issues.get(id).issue as any;
  assert.deepEqual([after.status, after.agentState, after.agentFinished, after.updatedAt, after.ask], [before.status, before.agentState, before.agentFinished, before.updatedAt, before.ask],
    'its status, its agent state and what it asks are as they were');

  // it is awake again as soon as anybody handles it
  s.handled.set('dsh:a', 1_800_000_000_000 + 30 * MINUTE);
  assert.equal(asleep(id), false, 'handled');
  s.wait(30);
  assert.equal(asleep(id), true, 'and it falls asleep again half an hour later');
});

test('with deep sleep turned off in the settings no agent is in deep sleep; turned on again, the ones nobody handled in the meantime fall asleep at once', (t) => {
  let on = true;
  const s = store({ deepSleepOn: () => on });
  t.after(s.cleanup);
  const id = s.add('dsh:a', 'idle');
  const flag = (item: any) => item.id === id;
  s.wait(600);
  assert.equal((s.issues.get(id).issue as any).deepSleep, true, 'on: asleep');
  on = false;
  assert.equal((s.issues.get(id).issue as any).deepSleep, undefined, 'off: the issue does not say it');
  assert.equal(s.issues.list({ tab: 'all' }).items.find(flag).deepSleep, undefined, 'not in the list');
  assert.equal(s.issues.office().items.find(flag).deepSleep, undefined, 'and not in the Office');
  assert.equal((s.issues.get(id).issue as any).agentState, 'idle', 'nothing else about it changed');
  on = true;
  assert.equal((s.issues.get(id).issue as any).deepSleep, true, 'on again: nobody handled it all this time, so it sleeps at once');
});

test('an idle agent and a run that finished sleep (a finished run stays in Needs you, with its green check); one that asks, fails or was stopped, or works, does not, and nor does a terminal session', (t) => {
  const s = store();
  t.after(s.cleanup);
  const working = s.add('dsh:working', 'running');
  const asking = s.add('dsh:asking', 'waiting_owner'); // Needs you, red
  const finished = s.add('dsh:finished', 'finished'); // Needs you, with a green check
  const failed = s.add('dsh:failed', 'error'); // Needs you, red
  const stopped = s.add('dsh:stopped', 'stopped'); // Needs you, red
  const resting = s.add('dsh:resting', 'idle'); // really idle
  const said = s.add('dsh:said', 'finished'); // the owner says it is idle
  assert.equal(s.issues.update(said, { agentState: 'idle' }).outcome, 'success');
  const askingSaid = s.add('dsh:asking-said', 'waiting_owner'); // the owner says it is idle, but its question is still asked
  assert.equal(s.issues.update(askingSaid, { agentState: 'idle' }).outcome, 'success');
  const blockedSaid = s.add('dsh:blocked-said', 'finished'); // the owner says Needs you over a finished run: that word is red, never a check
  assert.equal(s.issues.update(blockedSaid, { agentState: 'blocked' }).outcome, 'success');
  const terminal = s.add('claude:native', 'idle');
  const unstarted = s.add(null, null);
  s.wait(600);
  const asleep = (id: number) => Boolean((s.issues.get(id).issue as any).deepSleep);
  assert.deepEqual([working, asking, finished, failed, stopped, resting, said, askingSaid, blockedSaid, terminal, unstarted].map(asleep), [false, false, true, false, false, true, true, false, false, false, false]);
  assert.deepEqual(s.issues.office().items.filter((item: any) => item.deepSleep).map((item: any) => item.id).sort(), [finished, resting, said].sort());
  // sleeping changes nothing about the finished run: it still needs a look, as it did
  const sleeper = s.issues.get(finished).issue as any;
  assert.deepEqual([sleeper.agentState, sleeper.agentFinished, sleeper.deepSleep], ['blocked', true, true]);
  // a store that is not told when sessions were handled never says it
  const plain = createIssues({ file: ':memory:', sessionState: () => 'idle' });
  try {
    const made = plain.add({ title: 'x', project: { name: 'work', path: '/work' }, agent: 'claude', session: 'dsh:x' });
    assert.equal((plain.get(made.issue.id).issue as any).deepSleep, undefined);
  } finally { plain.close(); }
});

test('a finished run sleeps after an hour (an idle agent after half an hour), wakes when handled and sleeps again, and the owner saying idle over it keeps it asleep', (t) => {
  const s = store();
  t.after(s.cleanup);
  const id = s.add('dsh:fin', 'finished');
  const issue = () => s.issues.get(id).issue as any;
  s.wait(31);
  assert.deepEqual([issue().agentState, issue().agentFinished, issue().deepSleep], ['blocked', true, undefined], 'half an hour: a run that waits for a look is not asleep yet (owner, 2026-11-07: an hour in the Needs-you stage)');
  s.wait(29);
  assert.deepEqual([issue().agentState, issue().agentFinished, issue().deepSleep], ['blocked', true, true], 'an hour: asleep, still the owner\'s turn');
  s.handled.set('dsh:fin', 1_800_000_000_000 + 60 * MINUTE);
  assert.deepEqual([issue().agentState, issue().agentFinished, issue().deepSleep], ['blocked', true, undefined], 'opened: awake');
  s.wait(59);
  assert.equal(issue().deepSleep, undefined, 'and not asleep again a minute short of an hour later');
  s.wait(1);
  assert.equal(issue().deepSleep, true, 'asleep again an hour later');
  assert.equal(s.issues.update(id, { agentState: 'idle' }).outcome, 'success');
  assert.deepEqual([issue().agentState, issue().agentFinished === true, issue().deepSleep], ['idle', false, true], 'the owner puts it in Idle: nobody handled it, so it sleeps on, now as an idle agent');
  // an idle agent that the owner woke sleeps again after half an hour
  s.handled.set('dsh:fin', 1_800_000_000_000 + 120 * MINUTE);
  assert.equal(issue().deepSleep, undefined, 'handled: awake');
  s.wait(30);
  assert.equal(issue().deepSleep, true, 'as an idle agent it sleeps again half an hour later');
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
