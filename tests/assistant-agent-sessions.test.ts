import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSessions, stateFrom } from '../host/assistant/home/agent-sessions.mjs';
import { approvalText, createDshSessions, outcomeOf } from '../host/assistant/home/dsh-sessions.mjs';
import { fakeDsh as baseDsh } from './fake-dsh.mjs';

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

test('what DSH says decides the state: a question over everything, then the turn, then how the last turn ended', () => {
  const pending = { text: '?' };
  assert.equal(stateFrom({ pending, running: true, last: null }), 'waiting_owner');
  assert.equal(stateFrom({ pending: undefined, running: true, last: 'answer' }), 'running');
  assert.equal(stateFrom({ pending: undefined, running: false, last: 'error' }), 'error');
  assert.equal(stateFrom({ pending: undefined, running: false, last: 'answer' }), 'finished');
  assert.equal(stateFrom({ pending: undefined, running: false, last: 'aborted' }), 'stopped', 'a stop needs the owner (2026-11-05), it is not idle');
  assert.equal(stateFrom({ pending: undefined, running: false, last: null }), 'idle');
});

test('start makes the session, picks the model, sets the access mode and only then sends the first message', async () => {
  const world = fakeDsh();
  const { sessions, started } = await startOne(world, { issue: { ref: 'APP-7', title: '回复供应商' }, agent: 'claude' });
  assert.deepEqual(started, { outcome: 'success', key: 'dsh:s1', sessionId: 's1', agent: 'claude', provider: 'claude', model: 'opus', access: 'read-only', cwd: folder });
  assert.deepEqual(world.calls.filter(([name]) => name !== 'watch').map(([name]) => name), ['models', 'createSession', 'selectModel', 'setAccess', 'prompt']);
  assert.deepEqual(world.ofKind('createSession')[0][1], { cwd: folder, title: 'APP-7 回复供应商' }, 'the sidebar says which issue it is');
  const named = fakeDsh();
  const { sessions: other } = await startOne(named, { issue: { ref: 'APP-8', title: 'x', project: { name: 'docs', path: folder } } });
  assert.deepEqual(named.ofKind('createSession')[0][1], { cwd: folder, title: 'APP-8 x', workspaceTitle: 'docs' }, 'a new folder in the sidebar is named for the project');
  other.dispose();
  assert.deepEqual(world.ofKind('setAccess')[0].slice(1), ['s1', 'read-only'], 'read-only unless told (3.3)');
  assert.deepEqual(world.ofKind('prompt')[0].slice(1, 3), ['s1', 'Do the thing.']);
  assert.equal(sessions.stateOf('dsh:s1'), 'running', 'the turn is on its way as soon as DSH took the message');
  assert.equal(sessions.stateOf('dsh:nobody'), null);
  assert.deepEqual([sessions.has('dsh:s1'), sessions.has('dsh:x'), sessions.keys()], [true, false, ['dsh:s1']]);
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

test('the state follows DSH: working, an answer is finished, a failure is an error, a stop is stopped (it needs the owner); each change is told once', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const heard: any[] = [];
  sessions.onChange((change: any) => heard.push([change.from, change.to]));

  world.say.status('s1', true); // DSH says what the start already knew: nothing new
  assert.deepEqual(heard, []);
  world.say.assistant('s1', 'Reading the contract.');
  world.say.assistant('s1', '做完了：第 3 条建议接受。');
  world.say.turnEnd('s1', { kind: 'completed' }); // the turn ends before DSH's loop reports itself idle
  assert.equal(sessions.stateOf('dsh:s1'), 'finished', 'a committed turn end immediately ends the working state');
  assert.equal(sessions.snapshotOf('dsh:s1')!.agentState, 'blocked');
  assert.deepEqual(heard, [['running', 'finished']]);
  world.say.status('s1', false);
  assert.equal(sessions.stateOf('dsh:s1'), 'finished');
  assert.deepEqual(heard, [['running', 'finished']], 'the later idle notification does not repeat the transition');
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
  assert.equal(sessions.stateOf('dsh:s1'), 'stopped');
  assert.deepEqual(heard, [['running', 'finished'], ['finished', 'running'], ['running', 'error'], ['error', 'running'], ['running', 'stopped']]);
  sessions.dispose();
});

test('a queued DSH turn resumes working without another loop status event; replayed history cannot start work', async (t) => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const agent = { status: 'running' };
  const dsh = createDshSessions({
    agents: new Map([['s1', agent]]),
    sessionController: { inspect: async () => ({ events: [] }) },
    on: (name: string, listener: (...args: any[]) => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
  });
  const sessions = createAgentSessions({ dsh, log: quiet });
  t.after(async () => { sessions.dispose(); await dsh.close(); });
  await sessions.adopt('dsh:s1', { agent: 'codex' });
  const event = (type: string, data: Record<string, unknown> = {}) => listeners.get('session/event')!({ id: 's1' }, { type, data });
  assert.equal(sessions.stateOf('dsh:s1'), 'running');
  event('turn/end', { reason: { kind: 'completed' } });
  assert.equal(sessions.stateOf('dsh:s1'), 'finished');
  // DSH consumes the queued message in the same driver: no second api-session/status true.
  event('turn/start', { turn: 2 });
  assert.equal(sessions.stateOf('dsh:s1'), 'running');
  assert.equal(sessions.snapshotOf('dsh:s1')!.agentState, 'working');
  event('turn/end', { reason: { kind: 'completed' } });
  agent.status = 'idle';
  listeners.get('api-session/status')!('s1', false);
  assert.equal(sessions.stateOf('dsh:s1'), 'finished');
  event('turn/start', { turn: 3 });
  assert.equal(sessions.stateOf('dsh:s1'), 'finished', 'imported boundaries without a running Agent are history');
});

test('DSH streams only the current attempt body to text listeners without changing state or activity', async (t) => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const agent = { session: { id: 's1' }, status: 'running' };
  const dsh = createDshSessions({
    agents: new Map([['s1', agent]]),
    sessionController: { inspect: async () => ({ events: [] }) },
    on: (name: string, listener: (...args: any[]) => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    },
  });
  let clock = 1_000;
  const sessions = createAgentSessions({ dsh, now: () => clock, log: quiet });
  t.after(async () => { sessions.dispose(); await dsh.close(); });
  await sessions.adopt('dsh:s1', { agent: 'claude' });
  const original = sessions.snapshotOf('dsh:s1');
  const texts: string[] = [];
  const states: unknown[] = [];
  sessions.onText(({ text }) => texts.push(text));
  sessions.onChange((change) => states.push(change));
  const frame = (value: Record<string, unknown>, source = agent) => listeners.get('agent/assistant-stream')!({ agent: source, frame: value });
  frame({ type: 'start', attemptId: 'a', revision: 1 });
  let index = 0;
  const chunk = (value: Record<string, unknown>) => frame({ type: 'chunk', attemptId: 'a', revision: index + 2, index: index++, chunk: value });
  clock = 9_000;
  chunk({ type: 'block-start', index: 0, blockType: 'reasoning' });
  chunk({ type: 'reasoning-delta', index: 0, text: 'private reasoning' });
  chunk({ type: 'tool-call-delta', index: 1, argumentsDelta: 'private tool arguments' });
  chunk({ type: 'block-start', index: 2, blockType: 'text' });
  chunk({ type: 'text-chunks', index: 2, texts: ['结论：', '先用'] });
  frame({ type: 'chunk', attemptId: 'old', revision: 100, index, chunk: { type: 'text-delta', index: 2, text: 'wrong attempt' } });
  frame({ type: 'end', attemptId: 'old', revision: 101, outcome: { kind: 'abandoned' } });
  chunk({ type: 'text-delta', index: 2, text: ' SQLite。' });
  assert.deepEqual(texts, ['结论：先用', '结论：先用 SQLite。']);
  listeners.get('session/event')!({ id: 's1' }, {
    type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', name: 'read' }] } },
  });
  assert.equal(texts.at(-1), '结论：先用 SQLite。', 'a tool-only message leaves the visible answer alone');
  chunk({ type: 'block-end', index: 2, block: { type: 'text', text: '结论：先用 SQLite。' } });
  chunk({ type: 'block-start', index: 3, blockType: 'text' });
  chunk({ type: 'text-delta', index: 3, text: '第二段。' });
  assert.equal(texts.at(-1), '结论：先用 SQLite。\n第二段。', 'text blocks keep the same boundary as the durable answer');
  assert.equal(sessions.snapshotOf('dsh:s1').ending, '', 'transient output is not a completed answer');
  assert.equal(sessions.snapshotOf('dsh:s1').lastActivityAt, original.lastActivityAt);
  assert.deepEqual(states, []);
  frame({ type: 'end', attemptId: 'a', revision: index + 2, outcome: { kind: 'abandoned' } });
  assert.equal(texts.at(-1), '');
  frame({ type: 'start', attemptId: 'b', revision: 11 }, { session: { id: 'unowned' }, status: 'running' });
  assert.equal(texts.at(-1), '');
  listeners.get('session/event')!({ id: 's1' }, {
    type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '最终回答' }] } },
  });
  assert.equal(texts.at(-1), '最终回答');
  assert.equal(sessions.snapshotOf('dsh:s1').ending, '最终回答');
});

test('what DSH says again is not activity: only a change of the state moves a session\'s last activity (a session nobody touched must not look just used)', async () => {
  const world = fakeDsh();
  let clock = 1_000;
  const sessions = createAgentSessions({ dsh: world.dsh, log: quiet, now: () => clock });
  assert.equal((await sessions.start({ agent: 'deepseek', firstMessage: 'Do it.', cwd: folder })).outcome, 'success');
  clock = 2_000;
  world.say.turnEnd('s1', { kind: 'completed' });
  assert.deepEqual([sessions.stateOf('dsh:s1'), sessions.snapshotOf('dsh:s1')!.lastActivityAt, sessions.snapshotOf('dsh:s1')!.stateSince], ['finished', 2_000, 2_000]);
  clock = 9_000;
  world.say.status('s1', false); // DSH says the same again, twice
  world.say.status('s1', false);
  assert.deepEqual([sessions.snapshotOf('dsh:s1')!.lastActivityAt, sessions.snapshotOf('dsh:s1')!.stateSince], [2_000, 2_000], 'a word that changed nothing moves nothing');
  clock = 12_000;
  world.say.status('s1', true);
  assert.equal(sessions.snapshotOf('dsh:s1')!.lastActivityAt, 12_000, 'a new turn does');
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

test('a direct forwarded message stays a user prompt and cannot answer a pending question or approval', async () => {
  const world = fakeDsh();
  const { sessions } = await startOne(world);
  const asked = world.say.ask('s1', 'May I write?', undefined, 'approval')!;
  let answered = false;
  void asked.answer.then(() => { answered = true; });
  assert.equal((await sessions.send('dsh:s1', 'Allow', { direct: true })).kind, 'message');
  assert.equal(world.ofKind('prompt').at(-1)[2], 'Allow');
  assert.equal(answered, false);
  assert.equal(sessions.stateOf('dsh:s1'), 'waiting_owner');
  await sessions.send('dsh:s1', 'Reject');
  assert.equal(await asked.answer, 'Reject');
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
  assert.deepEqual(await sessions.resume('dsh:s1'), { outcome: 'success', key: 'dsh:s1', sessionId: 's1', workspaceId: 'ws-of-s1' }, 'and the session identity and workspace needed to open it');
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
  assert.equal((await sessions.adopt('dsh:cut')).state, 'stopped');
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

test('only a plain yes lets an agent have a wider mode for one operation; DSH\'s own sentence says what is asked', () => {
  for (const yes of ['允许', ' 允许。', '同意', '可以', '好的！', 'Yes', 'y', 'OK', 'allow', '放开']) assert.equal(outcomeOf(yes), 'allowed-once', yes);
  for (const no of ['不', '不要写', '先别写，先给我看看方案', '', 'maybe', '允许，但只改第一行', 'no', '?']) assert.equal(outcomeOf(no), 'rejected', JSON.stringify(no));
  const request = { toolName: 'write', reason: 'escalate sandbox to workspace-write: The issue asks for the file.', displayReason: { en: 'Allow this operation with workspace-write permissions: The issue asks for the file.', zh: '允许本次操作使用 workspace-write 权限：需要写出文件。' } };
  assert.equal(approvalText(request), '允许本次操作使用 workspace-write 权限：需要写出文件。\n回复“允许”放开这一次，其他回复都不放开。');
  assert.match(approvalText({ ...request, displayReason: { en: 'Allow it.' } }), /^Allow it\.\n/, 'without the Chinese sentence, the English one');
  assert.match(approvalText({ toolName: 'write', reason: 'because' }), /^because\n/);
  assert.match(approvalText({ toolName: 'bash' }), /^使用 bash\n/);
});

test('changing a cold session access resolves that same DSH agent and refuses a running turn', async () => {
  const calls: any[] = [];
  const agent = { session: { id: 'existing' }, status: 'idle' };
  const adapter = createDshSessions({
    agents: { get: () => undefined },
    sessionController: { resolveAgent: async (id: string) => { calls.push(['resolve', id]); return { agent }; } },
    permissionPresets: { set: (session: any, mode: string) => calls.push(['set', session.id, mode]) },
  });
  await adapter.setAccess('existing', 'workspace-write');
  assert.deepEqual(calls, [['resolve', 'existing'], ['set', 'existing', 'workspace-write']]);
  agent.status = 'running';
  await assert.rejects(adapter.setAccess('existing', 'danger-full-access'), /current turn stops/);
  assert.equal(calls.filter(([name]) => name === 'set').length, 1);
});
