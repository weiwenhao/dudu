import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_MODES, AGENTS, createAgentSessions, modelFor, stateFrom, tidyFailure } from '../host/assistant/home/agent-sessions.mjs';
import { answerOf, approvalText, createDshSessions, outcomeOf, questionText } from '../host/assistant/home/dsh-sessions.mjs';
import { CATALOG, fakeDsh as baseDsh } from './fake-dsh.mjs';

// The sessions of issues: agent-sessions.mjs over a stand-in for DSH's adapter (what DSH itself does is tried in a real DSH by
// tests/e2e/agent-sessions.e2e.test.ts), and dsh-sessions.mjs over a stand-in for DSH's services where its waterfall listener is the point.

const quiet = { warn() {}, info() {}, error() {} };
const fakeDsh = (options?: Record<string, unknown>) => baseDsh(options as any);

const folder = '/work/app';
const startOne = async (world: ReturnType<typeof fakeDsh>, extra: Record<string, unknown> = {}) => {
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  const started = await sessions.start({ agent: 'deepseek', firstMessage: 'Do the thing.', cwd: folder, ...extra });
  assert.equal(started.outcome, 'success', JSON.stringify(started));
  return { sessions, started };
};

test('an agent runs on its own route: the harnesses on theirs, DeepSeek on whatever DSH uses by itself', () => {
  assert.deepEqual(modelFor('claude', CATALOG), { provider: 'claude', model: 'default' }, 'Claude has a model called default');
  assert.deepEqual(modelFor('codex', CATALOG), { provider: 'codex', model: 'gpt-6.1-sol' }, "the harness's own first model");
  assert.deepEqual(modelFor('deepseek', CATALOG), { provider: 'deepseek-official', model: 'deepseek-flash' });
  assert.deepEqual(modelFor('claude', CATALOG, 'haiku'), { provider: 'claude', model: 'haiku' }, 'ASSIGN.md may name the model');
  assert.equal(modelFor('claude', CATALOG, 'gpt-5.5'), null, 'a model of another route is not Claude');
  assert.equal(modelFor('codex', { groups: [] }), null, 'a harness that is not installed has no route');
  assert.equal(modelFor('someone', CATALOG), null);
  // The owner's default may be a harness: DeepSeek is still DSH's own model, and the default it has is not Claude's.
  const harnessFirst = { default: { provider: 'claude', model: 'default' }, groups: [CATALOG.groups[0], { id: 'mock', models: [{ id: 'mock-1' }, { id: 'mock-2' }] }] };
  assert.deepEqual(modelFor('deepseek', harnessFirst), { provider: 'mock', model: 'mock-1' });
  assert.deepEqual(modelFor('deepseek', { default: { provider: 'mock', model: 'mock-2' }, groups: harnessFirst.groups }), { provider: 'mock', model: 'mock-2' });
  assert.deepEqual(Object.keys(AGENTS), ['claude', 'codex', 'deepseek']);
});

test('what DSH says decides the state: a question over everything, then the turn, then how the last turn ended', () => {
  const pending = { text: '?' };
  assert.equal(stateFrom({ pending, running: true, last: null }), 'waiting_owner');
  assert.equal(stateFrom({ pending: undefined, running: true, last: 'answer' }), 'running');
  assert.equal(stateFrom({ pending: undefined, running: false, last: 'error' }), 'error');
  assert.equal(stateFrom({ pending: undefined, running: false, last: 'answer' }), 'finished');
  assert.equal(stateFrom({ pending: undefined, running: false, last: 'aborted' }), 'idle');
  assert.equal(stateFrom({ pending: undefined, running: false, last: null }), 'idle');
});

test('a failure that is a status and a body reads as the status and what the body says', () => {
  assert.equal(tidyFailure('400: {"message":"bad request","type":"invalid_request_error"}'), '400: bad request');
  assert.equal(tidyFailure('429: {"error":{"message":"slow down"}}'), '429: slow down');
  assert.equal(tidyFailure('500: {"nothing":1}'), '500: {"nothing":1}', 'a body that says nothing is shown as it is');
  assert.equal(tidyFailure('401: not json {'), '401: not json {');
  assert.equal(tidyFailure('ChatGPT is not logged in. Run `codex login` in a terminal.'), 'ChatGPT is not logged in. Run `codex login` in a terminal.');
  assert.equal(tidyFailure(undefined), '');
});

test('start makes the session, picks the model, sets the access mode and only then sends the first message', async () => {
  const world = fakeDsh();
  const { sessions, started } = await startOne(world, { issue: { ref: 'DUDU-7', title: '回复供应商' }, agent: 'claude' });
  assert.deepEqual(started, { outcome: 'success', key: 'dsh:s1', sessionId: 's1', agent: 'claude', provider: 'claude', model: 'default', access: 'read-only', cwd: folder });
  assert.deepEqual(world.calls.filter(([name]) => name !== 'watch').map(([name]) => name), ['models', 'createSession', 'selectModel', 'setAccess', 'prompt']);
  assert.deepEqual(world.ofKind('createSession')[0][1], { cwd: folder, title: 'DUDU-7 回复供应商' }, 'the sidebar says which issue it is');
  const named = fakeDsh();
  const { sessions: other } = await startOne(named, { issue: { ref: 'DUDU-8', title: 'x', project: { name: 'docs', path: folder } } });
  assert.deepEqual(named.ofKind('createSession')[0][1], { cwd: folder, title: 'DUDU-8 x', workspaceTitle: 'docs' }, 'a new folder in the sidebar is named for the project');
  other.dispose();
  assert.deepEqual(world.ofKind('setAccess')[0].slice(1), ['s1', 'read-only'], 'read-only unless told (3.3)');
  assert.deepEqual(world.ofKind('prompt')[0].slice(1, 3), ['s1', 'Do the thing.']);
  assert.equal(sessions.stateOf('dsh:s1'), 'running', 'the turn is on its way as soon as DSH took the message');
  assert.equal(sessions.stateOf('dsh:nobody'), null);
  assert.deepEqual([sessions.has('dsh:s1'), sessions.has('dsh:x'), sessions.keys()], [true, false, ['dsh:s1']]);
  sessions.dispose();
});

test('start announces the first state once, and a mode or a model the caller names is used', async () => {
  const world = fakeDsh();
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  const heard: any[] = [];
  sessions.onChange((change: any) => heard.push([change.key, change.from, change.to]));
  const started = await sessions.start({ agent: 'claude', firstMessage: 'x', cwd: folder, access: 'workspace-write', model: 'haiku' });
  assert.deepEqual(heard, [['dsh:s1', null, 'running']]);
  assert.deepEqual([started.access, started.model], ['workspace-write', 'haiku']);
  assert.deepEqual(world.ofKind('setAccess')[0].slice(1), ['s1', 'workspace-write']);
  sessions.dispose();
});

test('start refuses what it cannot do, and says what to do next; it never throws for it', async () => {
  const world = fakeDsh();
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  const refused = async (input: Record<string, unknown>) => sessions.start({ agent: 'deepseek', firstMessage: 'x', cwd: folder, ...input });
  assert.equal((await refused({ agent: 'gemini' })).outcome, 'needs_clarification');
  assert.equal((await refused({ firstMessage: '  ' })).outcome, 'needs_clarification');
  assert.equal((await refused({ firstMessage: 'x'.repeat(100_001) })).outcome, 'needs_clarification');
  assert.equal((await refused({ cwd: 'relative/dir' })).outcome, 'needs_clarification');
  assert.equal((await refused({ cwd: undefined })).outcome, 'needs_clarification');
  const mode = await refused({ access: 'root' });
  assert.equal(mode.outcome, 'needs_clarification');
  assert.match(mode.message, new RegExp(ACCESS_MODES.join('.*')));
  assert.equal(world.ofKind('createSession').length, 0, 'nothing was made for input that is wrong');

  const bare = fakeDsh({ catalog: { default: CATALOG.default, groups: [CATALOG.groups[2]] } });
  const without = await createAgentSessions({ dsh: bare.dsh, log: quiet }).start({ agent: 'codex', firstMessage: 'x', cwd: folder });
  assert.equal(without.outcome, 'error');
  assert.match(without.message, /ChatGPT is not available/);
  assert.match(without.next, /Settings > 供应商/, 'a harness that is not there is a matter of its settings');
  assert.equal(bare.ofKind('createSession').length, 0);
  sessions.dispose();
});

test('a session that did not take its first message is put away, and is not followed', async () => {
  const world = fakeDsh();
  world.failures.set('setAccess', new Error('There is no permission preset "read-only".'));
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  const result = await sessions.start({ agent: 'deepseek', firstMessage: 'x', cwd: folder });
  assert.equal(result.outcome, 'error');
  assert.match(result.message, /read-only/, 'the mode is never silently another one: the session does not start');
  assert.equal(world.ofKind('prompt').length, 0, 'no message is sent to a session that has no access mode');
  assert.deepEqual(world.ofKind('archive')[0].slice(1), ['s1', { stop: true }]);
  assert.equal(sessions.has('dsh:s1'), false);
  assert.equal(sessions.stateOf('dsh:s1'), null);

  const folderless = fakeDsh();
  folderless.failures.set('createSession', new Error('ENOENT: no such file or directory'));
  const missing = await createAgentSessions({ dsh: folderless.dsh, log: quiet }).start({ agent: 'deepseek', firstMessage: 'x', cwd: '/nowhere' });
  assert.equal(missing.outcome, 'error');
  assert.match(missing.next, /folder exists/);
  sessions.dispose();
});

test('the state follows DSH: working, an answer is finished, a failure is an error, a stop is idle; each change is told once', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const heard: any[] = [];
  sessions.onChange((change: any) => heard.push([change.from, change.to]));

  world.say.status('s1', true); // DSH says what the start already knew: nothing new
  assert.deepEqual(heard, []);
  world.say.assistant('s1', 'Reading the contract.');
  world.say.assistant('s1', '做完了：第 3 条建议接受。');
  world.say.turnEnd('s1', { kind: 'completed' }); // the turn ends before DSH's loop reports itself idle
  assert.equal(sessions.stateOf('dsh:s1'), 'running');
  world.say.status('s1', false);
  assert.equal(sessions.stateOf('dsh:s1'), 'finished');
  assert.equal(sessions.snapshotOf('dsh:s1')!.ending, '做完了：第 3 条建议接受。', 'its last words are kept');

  world.say.status('s1', true); // the owner speaks again: a new turn
  assert.equal(sessions.stateOf('dsh:s1'), 'running');
  assert.equal(sessions.snapshotOf('dsh:s1')!.ending, '', "the last turn's words are not this turn's");
  world.say.turnEnd('s1', { kind: 'error', error: '400: {"message":"bad request","type":"invalid_request_error"}' });
  world.say.status('s1', false);
  assert.equal(sessions.stateOf('dsh:s1'), 'error');
  assert.equal(sessions.snapshotOf('dsh:s1')!.error, '400: bad request', 'the failure as a person reads it');

  world.say.status('s1', true);
  assert.equal(sessions.snapshotOf('dsh:s1')!.error, '', 'a new turn is not an error yet');
  world.say.turnEnd('s1', { kind: 'aborted' });
  world.say.status('s1', false);
  assert.equal(sessions.stateOf('dsh:s1'), 'idle');
  assert.deepEqual(heard, [['running', 'finished'], ['finished', 'running'], ['running', 'error'], ['error', 'running'], ['running', 'idle']]);
  sessions.dispose();
});

test('max-tokens still ends in an answer; every other end of a turn is a stop', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  for (const [kind, state] of [['max-tokens', 'finished'], ['blocked', 'idle'], ['interrupted', 'idle'], ['forked', 'idle'], ['aborted', 'idle'], ['completed', 'finished']]) {
    world.say.status('s1', true);
    world.say.turnEnd('s1', { kind });
    world.say.status('s1', false);
    assert.equal(sessions.stateOf('dsh:s1'), state, kind);
  }
  sessions.dispose();
});

test('DSH hands the session back before the turn is heard of: a turn that has ended already is not made to run again', async () => {
  const world = fakeDsh();
  // The turn begins and ends while the first message is still on its way to DSH's answer.
  world.dsh.prompt = async (id: string, text: string) => {
    world.calls.push(['prompt', id, text]);
    world.say.status(id, true);
    world.say.turnEnd(id, { kind: 'error', error: 'no key' });
    world.say.status(id, false);
  };
  const { sessions } = await startOne(world);
  assert.equal(sessions.stateOf('dsh:s1'), 'error', 'DSH has the last word, not the guess that the turn is on its way');
  sessions.dispose();
});

test('a question of the agent is the state waiting_owner until it is answered; the answer is what the owner said', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const heard: any[] = [];
  sessions.onChange((change: any) => heard.push([change.from, change.to, change.snapshot.pending?.text]));

  const asked = world.say.ask('s1', 'Accept clause 3 or reject it? (Accept / Reject)')!;
  assert.equal(sessions.stateOf('dsh:s1'), 'waiting_owner');
  assert.deepEqual(sessions.snapshotOf('dsh:s1')!.pending, { kind: 'question', text: 'Accept clause 3 or reject it? (Accept / Reject)' });
  assert.deepEqual(sessions.reader.stateOf('s1')!.pending!.kind, 'question');

  const sent = await sessions.send('dsh:s1', ' 接受 ');
  assert.deepEqual(sent, { outcome: 'success', kind: 'answer', key: 'dsh:s1' });
  assert.equal(await asked.answer, '接受', 'the words as the owner wrote them, trimmed');
  assert.equal(world.ofKind('prompt').length, 1, 'an answer is not a new message');
  assert.equal(sessions.stateOf('dsh:s1'), 'running', 'the agent goes on');
  assert.deepEqual(heard, [['running', 'waiting_owner', 'Accept clause 3 or reject it? (Accept / Reject)'], ['waiting_owner', 'running', undefined]]);
  sessions.dispose();
});

test('a question that DSH\'s own window answered, or that was cancelled, is not waited on any more', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  // The adapter calls close() when anyone settled the question.
  const firstWaiter = world.say.ask('s1', 'first?')!;
  assert.equal(sessions.stateOf('dsh:s1'), 'waiting_owner');
  firstWaiter.close();
  await firstWaiter.answer.catch(() => {});
  assert.equal(sessions.stateOf('dsh:s1'), 'running');

  const cancel = new AbortController();
  world.say.ask('s1', 'second?', cancel.signal);
  assert.equal(sessions.stateOf('dsh:s1'), 'waiting_owner');
  cancel.abort(); // the turn was stopped
  assert.equal(sessions.stateOf('dsh:s1'), 'running');

  const early = new AbortController();
  early.abort();
  world.say.ask('s1', 'third?', early.signal);
  assert.equal(sessions.stateOf('dsh:s1'), 'running', 'a question that is cancelled already is not waited on');
  sessions.dispose();
});

test('a request for a wider mode waits for the owner like a question, and says what kind it is', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const asked = world.say.ask('s1', '允许本次操作使用 workspace-write 权限：写 two.txt\n回复“允许”放开这一次，其他回复都不放开。', undefined, 'approval')!;
  assert.equal(sessions.stateOf('dsh:s1'), 'waiting_owner');
  assert.deepEqual(sessions.snapshotOf('dsh:s1')!.pending, { kind: 'approval', text: '允许本次操作使用 workspace-write 权限：写 two.txt\n回复“允许”放开这一次，其他回复都不放开。' }, 'the lines stay lines');
  assert.equal(sessions.reader.stateOf('s1')!.pending!.kind, 'approval');
  await sessions.send('dsh:s1', '允许');
  assert.equal(await asked.answer, '允许');
  assert.equal(sessions.stateOf('dsh:s1'), 'running');
  sessions.dispose();
});

test('questions are answered one at a time, the oldest first', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const one = world.say.ask('s1', 'one?')!;
  const two = world.say.ask('s1', 'two?')!;
  assert.equal(sessions.snapshotOf('dsh:s1')!.pending!.text, 'one?');
  await sessions.send('dsh:s1', 'A');
  assert.equal(await one.answer, 'A');
  assert.equal(sessions.stateOf('dsh:s1'), 'waiting_owner', 'the second is still open');
  assert.equal(sessions.snapshotOf('dsh:s1')!.pending!.text, 'two?');
  await sessions.send('dsh:s1', 'B');
  assert.equal(await two.answer, 'B');
  assert.equal(sessions.stateOf('dsh:s1'), 'running');
  sessions.dispose();
});

test('what the owner says to a session that is not waiting starts its next turn; steering is a choice', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  world.say.status('s1', true);
  world.say.turnEnd('s1', { kind: 'completed' });
  world.say.status('s1', false);
  assert.equal(sessions.stateOf('dsh:s1'), 'finished');

  assert.deepEqual(await sessions.send('dsh:s1', '还没好，再看第 4 条'), { outcome: 'success', kind: 'message', key: 'dsh:s1' });
  assert.deepEqual(world.ofKind('prompt').at(-1)!.slice(1), ['s1', '还没好，再看第 4 条', { steer: false }]);
  assert.equal(sessions.stateOf('dsh:s1'), 'running');
  await sessions.send('dsh:s1', '顺便看第 5 条', { steer: true });
  assert.deepEqual((world.ofKind('prompt').at(-1) as any)[3], { steer: true });

  assert.equal((await sessions.send('dsh:s1', '   ')).outcome, 'needs_clarification');
  assert.equal((await sessions.send('claude:abc', 'hi')).outcome, 'needs_clarification', 'only the sessions of DSH are spoken to here');
  world.failures.set('prompt', new Error('session/agent-busy'));
  const failed = await sessions.send('dsh:s1', 'again');
  assert.deepEqual([failed.outcome, failed.message], ['error', 'session/agent-busy']);
  sessions.dispose();
});

test('a session that is followed without having been started here can be spoken to', async () => {
  const world = fakeDsh();
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  const sent = await sessions.send('dsh:old', 'hello');
  assert.equal(sent.outcome, 'success');
  assert.equal(sessions.stateOf('dsh:old'), 'running');
  assert.equal(sessions.has('dsh:old'), true);
  sessions.dispose();
});

test('closing folds the session away, resuming puts it back, and speaking to a closed one reopens it', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  world.say.status('s1', true);
  world.say.turnEnd('s1', { kind: 'completed' });
  world.say.status('s1', false);

  assert.deepEqual(await sessions.close('dsh:s1'), { outcome: 'success', key: 'dsh:s1' });
  assert.equal(sessions.snapshotOf('dsh:s1')!.closed, true);
  assert.equal((await sessions.close('dsh:s1')).outcome, 'no_op');
  assert.equal(sessions.reader.list().length, 0, 'a closed session is not on the list of what is followed');
  assert.deepEqual(await sessions.resume('dsh:s1'), { outcome: 'success', key: 'dsh:s1', workspaceId: 'ws-of-s1' }, 'and where it lives, which a window needs to adopt it');
  const open = await sessions.resume('dsh:s1');
  assert.deepEqual([open.outcome, open.workspaceId], ['no_op', 'ws-of-s1']);
  assert.equal(sessions.snapshotOf('dsh:s1')!.closed, false);

  await sessions.close('dsh:s1');
  await sessions.send('dsh:s1', 'one more thing');
  assert.deepEqual(world.calls.filter(([name]) => name === 'unarchive' || name === 'prompt').slice(-2).map(([name]) => name), ['unarchive', 'prompt'], 'back in the sidebar before it is spoken to');
  assert.equal(sessions.snapshotOf('dsh:s1')!.closed, false);
  assert.equal((await sessions.resume('claude:abc')).outcome, 'needs_clarification');
  // A session that is not followed here, and not folded away either, is where it should be.
  assert.equal((await sessions.resume('dsh:elsewhere')).outcome, 'no_op');
  sessions.dispose();
});

test('a session the owner folded away in DSH\'s own sidebar is put back by resume, and before a message is sent to it', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  world.say.answer('s1', 'done');
  world.archived.add('s1'); // archived in the sidebar: this library did not close it, and it is DSH that knows
  assert.equal((await sessions.resume('dsh:s1')).outcome, 'success');
  assert.equal((await sessions.resume('dsh:s1')).outcome, 'no_op', 'now it is open');

  world.archived.add('s1');
  const sent = await sessions.send('dsh:s1', 'one more thing');
  assert.deepEqual([sent.outcome, sent.kind, sent.resumed], ['success', 'message', true], 'a folded session takes no turn: it is put back first, and the caller is told');
  assert.deepEqual(world.calls.filter(([name]) => name === 'unarchive' || name === 'prompt').slice(-2).map(([name]) => name), ['unarchive', 'prompt']);
  const next = await sessions.send('dsh:s1', 'and another');
  assert.equal(next.resumed, undefined, 'an open session is just spoken to');

  world.say.answer('s1', 'done again');
  assert.equal((await sessions.close('dsh:s1')).outcome, 'success');
  assert.equal((await sessions.close('dsh:s1')).outcome, 'no_op', 'DSH says it was folded away already');
  sessions.dispose();
});

test('a session that works is not closed unless it is told to stop', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const busy = await sessions.close('dsh:s1');
  assert.equal(busy.outcome, 'needs_clarification');
  assert.match(busy.next, /stop: true/);
  assert.equal(world.ofKind('archive').length, 0, 'DSH was not even asked');
  assert.equal((await sessions.close('dsh:s1', { stop: true })).outcome, 'success');
  assert.deepEqual(world.ofKind('archive')[0].slice(1), ['s1', { stop: true }]);

  // A session that is followed from elsewhere: DSH's refusal is the same answer.
  const other = fakeDsh();
  other.running.add('x');
  const stranger = createAgentSessions({ dsh: other.dsh, log: quiet });
  assert.equal((await stranger.close('dsh:x')).outcome, 'needs_clarification');
  assert.equal((await stranger.close('dsh:x', { stop: true })).outcome, 'success');
  other.failures.set('unarchive', new Error('no such session'));
  assert.equal((await stranger.resume('dsh:x')).outcome, 'error');
  sessions.dispose();
  stranger.dispose();
});

test('stop ends the turn that runs and says so when there is none', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  assert.deepEqual(await sessions.stop('dsh:s1'), { outcome: 'success', key: 'dsh:s1' });
  assert.deepEqual(world.ofKind('cancel')[0].slice(1), ['s1']);
  world.say.status('s1', true);
  world.say.turnEnd('s1', { kind: 'aborted' });
  world.say.status('s1', false);
  assert.equal((await sessions.stop('dsh:s1')).outcome, 'no_op');
  assert.equal((await sessions.stop('claude:x')).outcome, 'needs_clarification');
  sessions.dispose();
});

test('after a restart a session is followed again from what DSH stored of it, and nothing is announced', async () => {
  const turns = new Map([
    ['done', { last: 'answer', at: 1000, ending: 'all done' }],
    ['broke', { last: 'error', at: 2000, error: 'the model refused' }],
    ['cut', { last: 'aborted', at: 3000 }],
  ]);
  const world = fakeDsh({ turns });
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  const heard: unknown[] = [];
  sessions.onChange((change: unknown) => heard.push(change));
  assert.deepEqual(await sessions.adopt('dsh:done', { agent: 'claude', cwd: folder }), { outcome: 'success', key: 'dsh:done', state: 'finished' });
  assert.equal((await sessions.adopt('dsh:broke')).state, 'error');
  assert.equal((await sessions.adopt('dsh:cut')).state, 'idle');
  assert.equal((await sessions.adopt('dsh:never-ran')).state, 'idle', 'a session DSH has no turn of');
  assert.equal(sessions.snapshotOf('dsh:broke')!.error, 'the model refused');
  assert.equal(sessions.snapshotOf('dsh:done')!.ending, 'all done');
  assert.equal(sessions.snapshotOf('dsh:done')!.agent, 'claude');
  assert.deepEqual(heard, []);
  // From here on it is followed like any other: a new turn is news.
  world.say.status('done', true);
  assert.deepEqual(heard.map((change: any) => [change.key, change.from, change.to]), [['dsh:done', 'finished', 'running']]);
  assert.equal((await sessions.adopt('claude:x')).outcome, 'needs_clarification');
  sessions.dispose();
});

test('a reader that cannot tell about a session does not break the adoption', async () => {
  const world = fakeDsh();
  world.dsh.lastTurn = async () => { throw new Error('the log is unreadable'); };
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  assert.deepEqual(await sessions.adopt('dsh:s9'), { outcome: 'success', key: 'dsh:s9', state: 'idle' });
  sessions.dispose();
});

test('the same sessions in the shapes of the sessions library: a runner that starts in a folder and a reader of what DSH knows', async () => {
  const world = fakeDsh();
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet });
  const started = await sessions.runner.start({ cwd: folder, firstMessage: 'Look at the build.', access: 'workspace-write' });
  assert.deepEqual(started, { key: 'dsh:s1' }, 'DSH is the runner of DeepSeek unless an agent is named');
  await assert.rejects(sessions.runner.start({ cwd: 'nowhere', firstMessage: 'x' }), /full path/, 'a runner that cannot start throws, as the library expects');
  world.say.assistant('s1', '看过了。');
  assert.deepEqual(sessions.reader.list(), [{ id: 's1', title: 'DeepSeek', cwd: folder, updatedAt: sessions.reader.list()[0].updatedAt }]);
  const facts = sessions.reader.stateOf('s1')!;
  assert.deepEqual([facts.running, facts.pending, facts.last, facts.excerpt, facts.ending], [true, null, null, '看过了。', '看过了。']);
  assert.equal(sessions.reader.stateOf('nobody'), null);
  await sessions.runner.close('dsh:s1'); // the library has decided it may close a session that works: it is stopped
  assert.deepEqual(world.ofKind('archive')[0].slice(1), ['s1', { stop: true }]);
  await sessions.runner.resume('dsh:s1');
  await sessions.runner.send('dsh:s1', 'and the tests');
  await assert.rejects(sessions.runner.send('dsh:s1', ''), /must not be empty/);
  sessions.dispose();
});

test('dispose stops listening and lets go of the questions that nobody can answer now', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const pending = world.say.ask('s1', 'still there?')!;
  let failure: unknown;
  pending.answer.catch((error: unknown) => { failure = error; });
  sessions.dispose();
  sessions.dispose(); // twice is the same as once
  await new Promise((done) => setImmediate(done));
  assert.match(String((failure as Error)?.message), /stopped before the question was answered/);
  assert.equal(world.ofKind('unwatch').length, 1);
  assert.equal(world.say.owns('s1'), undefined, 'DSH is not listened to any more');
  assert.throws(() => createAgentSessions({} as any), /needs the adapter of DSH/);
});

// ---------------------------------------------------------------------------------------------------------------------
// The adapter's words: how a question reads on the issue, and how the owner's words become DSH's answer.

test('a question reads as one text with its choices; the owner\'s words answer the first question', () => {
  const questions = [
    { id: 'q1', question: 'Accept clause 3 or reject it?', options: [{ label: 'Accept' }, { label: 'Reject' }] },
    { id: 'q2', question: 'Copy legal?' },
  ];
  assert.equal(questionText(questions), '1. Accept clause 3 or reject it? (Accept / Reject)\n2. Copy legal?');
  assert.equal(questionText([questions[1]]), 'Copy legal?', 'a single question is not numbered');
  assert.deepEqual(answerOf(questions, 'reject'), { answers: [{ id: 'q1', selected: ['Reject'] }, { id: 'q2', selected: [] }] }, 'the name of a choice picks it, whatever its case');
  assert.deepEqual(answerOf(questions, ' 接受，但加一句免责 '), { answers: [{ id: 'q1', selected: [], custom: '接受，但加一句免责' }, { id: 'q2', selected: [] }] });
  assert.deepEqual(answerOf([questions[1]], 'yes'), { answers: [{ id: 'q2', selected: [], custom: 'yes' }] });
});

/** DSH's services as far as the listener of questions meets them: an event bus with the options it was registered with. */
function fakeCtx() {
  const listeners: Record<string, Array<{ handler: (...args: any[]) => any; options?: any }>> = {};
  const ctx = {
    on(event: string, handler: (...args: any[]) => any, options?: any) {
      (listeners[event] ??= []).push({ handler, options });
      return () => { listeners[event] = listeners[event].filter((entry) => entry.handler !== handler); };
    },
  };
  return { ctx, listeners };
}

test('the listener of DSH\'s questions answers for the sessions that are followed, passes every other on, and lets DSH\'s own window answer first if it can', async () => {
  const { ctx, listeners } = fakeCtx();
  const adapter = createDshSessions(ctx);
  const followed = new Set(['s1']);
  let pending: any = null;
  let closed = 0;
  const stop = adapter.watch({
    owns: (id: string) => followed.has(id),
    status() {}, turnEnd() {}, assistant() {},
    question(id: string, { text }: { text: string }) {
      let resolve: (words: string) => void = () => {};
      let reject: (error: Error) => void = () => {};
      const answer = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
      answer.catch(() => {});
      pending = { id, text, resolve, reject };
      return { answer, close() { closed++; } };
    },
  });
  assert.deepEqual(Object.keys(listeners).sort(), ['api-session/status', 'approval/request', 'session/event', 'user-questions/request']);
  const entry = listeners['user-questions/request'][0];
  assert.deepEqual(entry.options, { global: true, prepend: true }, "before DSH's own answerer, for every session");
  const tick = () => new Promise((done) => setImmediate(done));

  // Another session is none of ours: the question goes on to DSH untouched.
  const others = { agent: { session: { id: 's2' } }, questions: [{ id: 'q', question: 'x' }] };
  assert.equal(await entry.handler(others, async () => 'DSH answered'), 'DSH answered');
  assert.equal(pending, null);
  assert.equal(await entry.handler({ questions: [] }, async () => 'no agent'), 'no agent', 'a request that is not about a session of ours is passed on as it is');
  assert.equal(await entry.handler({ agent: { session: { id: 's1' } }, questions: [] }, async () => 'no questions'), 'no questions');

  // Ours, answered on the issue's page: DSH's own wait is told to end, and the request is put back as it was found.
  const own = new AbortController();
  const ask: any = { agent: { session: { id: 's1' } }, signal: own.signal, questions: [{ id: 'q1', question: 'Accept?', options: [{ label: 'Accept' }] }] };
  let seen: AbortSignal | undefined;
  const result = entry.handler(ask, () => new Promise(() => { seen = ask.signal; })); // DSH's window: nobody is there, it never answers
  await tick();
  assert.equal(pending.text, 'Accept? (Accept)', 'the question as the issue shows it');
  pending.resolve('accept');
  assert.deepEqual(await result, { answers: [{ id: 'q1', selected: ['Accept'] }] });
  assert.equal(seen!.aborted, true, "the card in DSH's own window goes when the page has answered");
  assert.notEqual(seen, own.signal, 'it was given a signal that ends with the request');
  assert.equal(ask.signal, own.signal, 'the request is left as it was found');
  assert.equal(closed, 1);

  // Answered in DSH's own window first: that is the answer, and the issue's question is closed.
  const second = await entry.handler({ agent: { session: { id: 's1' } }, questions: [{ id: 'q1', question: 'Again?' }] }, async () => ({ answers: [{ id: 'q1', selected: ['yes'] }] }));
  assert.deepEqual(second, { answers: [{ id: 'q1', selected: ['yes'] }] });
  assert.equal(closed, 2);

  // DSH has nobody to ask (it refuses at once): the owner's page is still there to answer.
  const third = entry.handler({ agent: { session: { id: 's1' } }, questions: [{ id: 'q1', question: 'Last?' }] }, async () => { throw Object.assign(new Error('no answerer'), { code: 'NO_PROVIDER' }); });
  await tick();
  pending.resolve('go');
  assert.deepEqual(await third, { answers: [{ id: 'q1', selected: [], custom: 'go' }] });

  // The page gives the question up (the plugin stops) while DSH's window is still there: its answer is the answer.
  let late: (answer: unknown) => void = () => {};
  const fourth = entry.handler({ agent: { session: { id: 's1' } }, questions: [{ id: 'q1', question: 'Still?' }] }, () => new Promise((done) => { late = done; }));
  await tick();
  pending.reject(new Error('stopped'));
  await tick();
  late({ answers: [{ id: 'q1', selected: ['yes'] }] });
  assert.deepEqual(await fourth, { answers: [{ id: 'q1', selected: ['yes'] }] });

  // Both give up (the turn was cancelled): the tool call fails, it does not hang.
  const fifth = entry.handler({ agent: { session: { id: 's1' } }, questions: [{ id: 'q1', question: 'Gone?' }] }, async () => { throw new Error('aborted'); });
  await tick();
  pending.reject(new Error('The question is settled.'));
  await assert.rejects(fifth, /settled|aborted/);

  followed.delete('s1'); // a session that is no longer followed is passed on
  assert.equal(await entry.handler({ agent: { session: { id: 's1' } }, questions: [{ id: 'q1', question: 'x' }] }, async () => 'DSH'), 'DSH');
  stop();
  assert.equal(listeners['user-questions/request'].length, 0, 'nothing is left listening');
  assert.equal(listeners['approval/request'].length, 0);
  assert.equal(listeners['api-session/status'].length, 0);
  assert.equal(listeners['session/event'].length, 0);
});

test('only a plain yes lets an agent have a wider mode for one operation; DSH\'s own sentence says what is asked', () => {
  for (const yes of ['允许', ' 允许。', '同意', '可以', '好的！', 'Yes', 'y', 'OK', 'allow', '放开']) assert.equal(outcomeOf(yes), 'allowed-once', yes);
  for (const no of ['不', '不要写', '先别写，先给我看看方案', '', 'maybe', '允许，但只改第一行', 'no', '?']) assert.equal(outcomeOf(no), 'rejected', JSON.stringify(no));
  const request = { toolName: 'write', reason: 'escalate sandbox to workspace-write: The issue asks for the file.', displayReason: { en: 'Allow this operation with workspace-write permissions: The issue asks for the file.', zh: '允许本次操作使用 workspace-write 权限：需要写出文件。' } };
  assert.equal(approvalText(request), '允许本次操作使用 workspace-write 权限：需要写出文件。\n回复“允许”放开这一次，其他回复都不放开。');
  assert.match(approvalText({ ...request, displayReason: { en: 'Allow it.' } }), /^Allow it\.\n/, 'without the Chinese sentence, the English one');
  assert.match(approvalText({ toolName: 'write', reason: 'because' }), /^because\n/);
  assert.match(approvalText({ toolName: 'bash' }), /^使用 bash\n/);
});

test('the listener of DSH\'s approvals asks the owner for the sessions that are followed, and lets DSH\'s own window answer as well', async () => {
  const { ctx, listeners } = fakeCtx();
  const adapter = createDshSessions(ctx);
  let pending: any = null;
  adapter.watch({
    owns: (id: string) => id === 's1',
    status() {}, turnEnd() {}, assistant() {},
    question(id: string, options: { text: string; kind: string }) {
      let resolve: (words: string) => void = () => {};
      const answer = new Promise<string>((done) => { resolve = done; });
      pending = { id, ...options, resolve };
      return { answer, close() {} };
    },
  });
  const entry = listeners['approval/request'][0];
  assert.deepEqual(entry.options, { global: true, prepend: true });
  const tick = () => new Promise((done) => setImmediate(done));
  const ask = (session: string, extra: Record<string, unknown> = {}) => ({ agent: { session: { id: session } }, toolName: 'write', displayReason: { zh: '允许本次操作使用 workspace-write 权限：写 two.txt' }, ...extra });

  assert.equal(await entry.handler(ask('s2'), async () => 'allowed-once'), 'allowed-once', "another session's request is passed on untouched");
  assert.equal(pending, null);
  assert.equal(await entry.handler({ toolName: 'bash' }, async () => 'rejected'), 'rejected', 'a request that names no session is passed on');

  const yes = entry.handler(ask('s1'), () => new Promise(() => {})); // DSH's window: nobody there
  await tick();
  assert.deepEqual([pending.id, pending.kind], ['s1', 'approval'], 'it is shown to the owner as a request for a mode, not as a question');
  assert.match(pending.text, /写 two\.txt\n回复“允许”/);
  pending.resolve('允许');
  assert.equal(await yes, 'allowed-once');

  const no = entry.handler(ask('s1'), () => new Promise(() => {}));
  await tick();
  pending.resolve('先别写，先给我看看方案');
  assert.equal(await no, 'rejected', 'a reply that is not a yes refuses it');

  assert.equal(await entry.handler(ask('s1'), async () => 'allowed-once'), 'allowed-once', "DSH's own window may answer first");
});

test('the events of the sessions that are followed reach the library, and the others are not looked at', () => {
  const { ctx, listeners } = fakeCtx();
  const adapter = createDshSessions(ctx);
  const told: any[] = [];
  const stop = adapter.watch({
    owns: (id: string) => id === 's1',
    status: (id: string, running: boolean) => told.push(['status', id, running]),
    turnEnd: (id: string, end: unknown) => told.push(['turnEnd', id, end]),
    assistant: (id: string, text: string) => told.push(['assistant', id, text]),
    question: () => null,
  });
  const [status] = listeners['api-session/status'];
  const [event] = listeners['session/event'];
  status.handler('s1', true);
  status.handler('s2', true);
  event.handler({ id: 's1' }, { type: 'turn/end', data: { reason: { kind: 'error', error: { message: '401: no key', code: 'X' } } } });
  event.handler({ id: 's1' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  event.handler({ id: 's1' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'a' }, { type: 'tool-call', id: 'c' }, { type: 'text', text: 'b' }] } } });
  event.handler({ id: 's1' }, { type: 'assistant/message', data: { message: { content: 'plain' } } });
  event.handler({ id: 's1' }, { type: 'user/message', data: {} });
  event.handler({ id: 's2' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  event.handler(undefined, { type: 'turn/end', data: {} });
  assert.deepEqual(told, [
    ['status', 's1', true],
    ['turnEnd', 's1', { kind: 'error', error: '401: no key' }],
    ['turnEnd', 's1', { kind: 'completed', error: undefined }],
    ['assistant', 's1', 'a\nb'],
    ['assistant', 's1', 'plain'],
  ]);
  // A handler that fails does not break DSH's own event dispatch.
  const failing = createDshSessions(ctx);
  const origin = console.warn;
  const warned: string[] = [];
  console.warn = (line: string) => { warned.push(line); };
  try {
    failing.watch({ owns: () => true, status() { throw new Error('boom'); }, turnEnd() {}, assistant() {}, question: () => null });
    listeners['api-session/status'].at(-1)!.handler('s1', true);
  } finally { console.warn = origin; }
  assert.match(warned[0], /not handled: boom/);
  stop();
});

test('a DSH that lacks a service says which, when the call that needs it is made', async () => {
  const adapter = createDshSessions({ on: () => () => {} });
  await assert.rejects(adapter.models(), /no sessionController service/);
  await assert.rejects(adapter.setAccess('s', 'read-only'), /no agents service/);
  await assert.rejects(adapter.archive('s'), /no workspaceRegistry service/);
  assert.equal(await adapter.lastTurn('s'), null, 'a session DSH cannot read is no news');
});
