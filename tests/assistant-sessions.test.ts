import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { appendFile, mkdtemp, mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIssues } from '../host/assistant/issues/index.mjs';
import { createLinkStore } from '../host/providers/native/index.mjs';
import { claudeReader, codexReader, createSessions, DEFAULT_INTERVALS } from '../host/assistant/sessions/index.mjs';

// The sessions library end to end: createSessions over a Claude Code home written to disk the way Claude Code writes it (transcripts and the
// registry of live processes), a fake `codex app-server` (the harness itself is outside this process), a fake DSH, and a real SQLite file.

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.parse('2026-10-31T12:00:00.000Z');
const clock = { now: T0 };
const now = () => clock.now;

// --- a Claude Code home -------------------------------------------------------------------------------------------------

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (at: number) => new Date(at).toISOString();
const prompt = (at: number, text = 'fix the failing build') => ({
  parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text }, uuid: `u-${at}`, timestamp: iso(at), entrypoint: 'cli', cwd: '/work/app', gitBranch: 'main',
});
const result = (at: number, toolId: string) => ({
  parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }] }, toolUseResult: { stdout: 'ok' }, uuid: `r-${at}`, timestamp: iso(at),
});
const message = (at: number, block: Record<string, unknown>, stop: string | null, extra: Record<string, unknown> = {}) => ({
  parentUuid: null, isSidechain: false, type: 'assistant', uuid: `a-${at}`, timestamp: iso(at), cwd: '/work/app',
  message: { role: 'assistant', id: `m-${at}`, model: 'claude-sonnet-5-5', stop_reason: stop, content: [block] }, ...extra,
});
const said = (at: number, text: string, extra: Record<string, unknown> = {}) => message(at, { type: 'text', text }, 'end_turn', extra);
const called = (at: number, name: string, input: unknown, toolId = `toolu_${at}`) => message(at, { type: 'tool_use', id: toolId, name, input }, 'tool_use');
const turnEnd = (at: number) => ({ type: 'system', subtype: 'turn_duration', timestamp: iso(at), durationMs: 4000 });
// What Claude Code appends after an answer: hook output, titles, a slash command's output, a subagent's chatter. None of it is conversation.
const noise = (at: number) => [
  { parentUuid: null, isSidechain: false, attachment: { type: 'hook_success' }, type: 'attachment', uuid: `x-${at}`, timestamp: iso(at) },
  { type: 'system', subtype: 'stop_hook_summary', timestamp: iso(at) },
  { type: 'last-prompt', lastPrompt: 'x', sessionId: 's' },
  { type: 'ai-title', aiTitle: 'Build repair', sessionId: 's' },
  { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: '<local-command-stdout>bye</local-command-stdout>' }, uuid: `l-${at}`, timestamp: iso(at) },
  { parentUuid: null, isSidechain: false, type: 'user', isMeta: true, message: { role: 'user', content: 'a skill was loaded' }, uuid: `k-${at}`, timestamp: iso(at) },
  { ...said(at, 'subagent chatter?'), isSidechain: true },
];

type Done = { after: (cleanup: () => Promise<void>) => void };

async function claudeHome(t: Done) {
  const base = await mkdtemp(join(tmpdir(), 'dudu-sessions-'));
  const cleanup: Array<() => Promise<void>> = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    await rm(base, { recursive: true, force: true });
  });
  const root = join(base, 'projects');
  const registry = join(base, 'sessions');
  await mkdir(join(root, 'app'), { recursive: true });
  await mkdir(registry);
  const file = (n: number) => join(root, 'app', `${id(n)}.jsonl`);
  const text = (records: unknown[]) => records.map((record) => `${JSON.stringify(record)}\n`).join('');
  return {
    base, root, registry, file, beforeRemove: (close: () => Promise<void>) => cleanup.push(close),
    transcript: (n: number, records: unknown[]) => writeFile(file(n), text(records)),
    append: (n: number, records: unknown[]) => appendFile(file(n), text(records)),
    remove: (n: number) => rm(file(n)),
    // A live process, with the fields Claude Code writes. The test's own pid is alive; `pid` says another.
    live: (n: number, status: string, extra: Record<string, unknown> = {}) => writeFile(join(registry, `${n}.json`), JSON.stringify({
      pid: process.pid, sessionId: id(n), cwd: '/work/app', kind: 'interactive', name: `s${n}`, status, startedAt: T0 - 5 * DAY, updatedAt: T0 - MINUTE, statusUpdatedAt: T0 - MINUTE, ...extra,
    })),
    leave: (n: number) => rm(join(registry, `${n}.json`)),
  };
}

// --- a fake `codex app-server`: it answers the calls the reader makes, and counts them ---------------------------------------

const thread = (name: string, extra: Record<string, unknown> = {}) => ({
  id: name, preview: `thread ${name}`, name: null, cwd: '/work/codex', ephemeral: false, parentThreadId: null, source: 'cli', status: { type: 'notLoaded' },
  createdAt: Math.floor((T0 - 30 * DAY) / 1000), updatedAt: Math.floor((T0 - HOUR) / 1000), model: 'gpt-x', gitInfo: { branch: 'main' }, ...extra,
});
const sec = (at: number) => Math.floor(at / 1000);
const turn = (status: string, items: unknown[], extra: Record<string, unknown> = {}) => ({
  id: `turn-${status}`, rootTurnId: null, items, itemsView: 'summary', status, error: null, startedAt: sec(T0 - 2 * HOUR), completedAt: status === 'inProgress' ? null : sec(T0 - HOUR), durationMs: 1000, ...extra,
});
const asked = (text: string) => [{ type: 'userMessage', id: 'i0', content: [{ type: 'text', text: 'do it' }] }, { type: 'agentMessage', id: 'i1', text, phase: 'final_answer', memoryCitation: null, delivery: null, questions: null }];

function fakeCodex(threads: any[], turns: Record<string, any[]>) {
  const requests: { method: string; params: any }[] = [];
  const state = { fail: '' };
  const spawnProcess = () => {
    const child: any = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('exit', 0)); };
    if (state.fail) { queueMicrotask(() => child.emit('error', new Error(state.fail))); return child; }
    let buffer = '';
    child.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (request.id === undefined) continue;
        requests.push({ method: request.method, params: request.params });
        let reply: unknown = {};
        if (request.method === 'thread/list') reply = { data: threads, nextCursor: null, backwardsCursor: null };
        else if (request.method === 'thread/turns/list') {
          const all = turns[request.params.threadId] ?? [];
          reply = { data: all.slice(0, request.params.limit ?? 1), nextCursor: all.length > (request.params.limit ?? 1) ? 'more' : null, backwardsCursor: null };
        }
        child.stdout.write(`${JSON.stringify({ id: request.id, result: reply })}\n`);
      }
    });
    return child;
  };
  return { spawnProcess, requests, state, count: (method: string) => requests.filter((request) => request.method === method).length };
}

// --- a fake DSH: the interface of the `dsh` reader, nothing more ------------------------------------------------------------

function fakeDsh() {
  const sessions = new Map<string, { entry: any; facts: any }>();
  const asked: string[] = [];
  return {
    sessions, asked,
    set: (sessionId: string, facts: any, entry: any = {}) => sessions.set(sessionId, { entry: { id: sessionId, title: `DSH ${sessionId}`, cwd: '/work/dsh', updatedAt: T0 - HOUR, ...entry }, facts }),
    reader: {
      list: async () => [...sessions.values()].map((item) => item.entry),
      stateOf: async (sessionId: string) => { asked.push(sessionId); return sessions.get(sessionId)?.facts ?? null; },
      read: async (sessionId: string) => ({ turns: [{ at: T0, prompt: `asked in ${sessionId}`, reply: 'answered', tools: ['shell'] }], more: false }),
    },
  };
}

const byId = (list: any[]) => Object.fromEntries(list.map((item) => [item.id, item]));
const waitFor = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) assert.fail('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

// --- the rules ----------------------------------------------------------------------------------------------------------------

test('Claude: every state rule, over a Claude Code home on disk (registry statuses, transcript tails, the age of a question)', async (t) => {
  const home = await claudeHome(t);
  const deadPid = spawnSync(process.execPath, ['-e', '0']).pid;
  const longAnswer = `The cause is in the cache layer. ${'It keeps the old value. '.repeat(100)}`;
  type Case = { n: number; name: string; records: unknown[]; live?: [string, Record<string, unknown>?]; expect: [string, number | null, unknown] };
  const recent = T0 - 30 * MINUTE;
  const old = T0 - 10 * DAY;
  const cases: Case[] = [
    { n: 1, name: 'registry busy -> running, since the status changed', live: ['busy', { statusUpdatedAt: T0 - 2 * MINUTE }],
      records: [prompt(T0 - 10 * MINUTE), called(T0 - 9 * MINUTE, 'Bash', { command: 'npm test' }, 'toolu_1'), result(T0 - 8 * MINUTE, 'toolu_1')], expect: ['running', T0 - 2 * MINUTE, null] },
    { n: 2, name: 'registry shell (idle prompt, a background shell still running) -> running, as Claude itself calls it', live: ['shell', { statusUpdatedAt: T0 - 3 * MINUTE }],
      records: [prompt(recent), said(recent + 1000, 'Started the server.'), turnEnd(recent + 2000)], expect: ['running', T0 - 3 * MINUTE, null] },
    { n: 3, name: 'registry waiting on a dialog -> waiting_owner, the approval is the tool call', live: ['waiting', { waitingFor: 'dialog open', statusUpdatedAt: T0 - MINUTE }],
      records: [prompt(T0 - 5 * MINUTE), called(T0 - 2 * MINUTE, 'Bash', { command: 'rm -rf build' })], expect: ['waiting_owner', T0 - MINUTE, { kind: 'approval', text: 'Bash: rm -rf build' }] },
    { n: 4, name: 'registry waiting for input -> waiting_owner, the question is the AskUserQuestion', live: ['waiting', { waitingFor: 'input needed', statusUpdatedAt: T0 - MINUTE }],
      records: [prompt(T0 - 5 * MINUTE), called(T0 - 2 * MINUTE, 'AskUserQuestion', { questions: [{ question: 'Which database should the migration use?', header: 'DB', options: [{ label: 'A', description: '' }], multiSelect: false }] })],
      expect: ['waiting_owner', T0 - MINUTE, { kind: 'question', text: 'Which database should the migration use?' }] },
    { n: 5, name: 'process alive and idle, an AskUserQuestion with no answer -> waiting_owner, since it was asked', live: ['idle', { statusUpdatedAt: T0 - 9 * MINUTE }],
      records: [prompt(T0 - 12 * MINUTE), called(T0 - 10 * MINUTE, 'AskUserQuestion', { questions: [{ question: 'Keep the old API?' }, { question: 'Rename the module?' }] })],
      expect: ['waiting_owner', T0 - 10 * MINUTE, { kind: 'question', text: 'Keep the old API? / Rename the module?' }] },
    { n: 6, name: 'process alive and idle, the last message ends in a question -> waiting_owner, the question is its last paragraph', live: ['idle', { statusUpdatedAt: recent + 5000 }],
      records: [prompt(recent - MINUTE), said(recent, 'The fix is in and the tests pass.\n\nShould I also update the changelog?'), turnEnd(recent + 1000)],
      expect: ['waiting_owner', recent, { kind: 'question', text: 'Should I also update the changelog?' }] },
    { n: 7, name: 'process alive and idle, a plain final answer -> finished even while its TUI stays open, since the answer', live: ['idle', { statusUpdatedAt: T0 - 20 * MINUTE }],
      records: [prompt(recent - MINUTE), said(recent, 'Done. The build passes.'), turnEnd(recent + 1000)], expect: ['finished', recent, null] },
    { n: 8, name: 'process gone, the final answer, then hook output, a slash command and a subagent -> finished, since the answer', records: [prompt(recent - MINUTE), said(recent, 'Done. The build passes.'), turnEnd(recent + 1000), ...noise(recent + 2000)],
      expect: ['finished', recent, null] },
    { n: 9, name: 'process gone, a question a day ago -> waiting_owner (the session can be resumed and answered)', records: [prompt(T0 - DAY - MINUTE), said(T0 - DAY, '**Want me to proceed with the migration?**'), turnEnd(T0 - DAY + 1000)],
      expect: ['waiting_owner', T0 - DAY, { kind: 'question', text: '**Want me to proceed with the migration?' }] },
    { n: 10, name: 'process gone, the same question ten days ago -> idle: an abandoned session, not a request', records: [prompt(old - MINUTE), said(old, 'Want me to proceed with the migration?'), turnEnd(old + 1000)],
      expect: ['idle', old, null] },
    { n: 11, name: 'process gone, the last message is an API error -> error', records: [prompt(T0 - 2 * HOUR), message(T0 - 2 * HOUR + 1000, { type: 'text', text: 'API Error: 401 Please run /login' }, null, { isApiErrorMessage: true, error: 'authentication_failed' })],
      expect: ['error', T0 - 2 * HOUR + 1000, null] },
    { n: 12, name: 'process gone, an API error ten days ago -> idle', records: [prompt(old), message(old + 1000, { type: 'text', text: 'API Error: 500' }, null, { isApiErrorMessage: true })], expect: ['idle', old + 1000, null] },
    { n: 13, name: 'process gone in the middle of a tool call -> error: the turn never finished', records: [prompt(T0 - HOUR), called(T0 - HOUR + 1000, 'Bash', { command: 'sleep 600' })], expect: ['error', T0 - HOUR + 1000, null] },
    { n: 14, name: 'process gone after a tool result, before the answer -> error', records: [prompt(T0 - HOUR), called(T0 - HOUR + 1000, 'Read', { file_path: '/x' }, 'toolu_14'), result(T0 - HOUR + 2000, 'toolu_14')],
      expect: ['error', T0 - HOUR + 2000, null] },
    { n: 15, name: 'process gone after a prompt nothing answered -> error', records: [prompt(T0 - HOUR)], expect: ['error', T0 - HOUR, null] },
    { n: 16, name: 'the person interrupted it (Esc) -> stopped: it needs the owner', records: [prompt(T0 - HOUR), called(T0 - HOUR + 1000, 'Bash', { command: 'make' }), prompt(T0 - HOUR + 2000, '[Request interrupted by user]')],
      expect: ['stopped', T0 - HOUR + 2000, null] },
    { n: 17, name: 'a conversation just compacted -> idle', records: [prompt(T0 - HOUR), said(T0 - HOUR + 1000, 'Done.'), { ...prompt(T0 - HOUR + 2000, 'This session is being continued from a previous conversation.'), isCompactSummary: true, isVisibleInTranscriptOnly: true }],
      expect: ['idle', T0 - HOUR + 2000, null] },
    { n: 18, name: 'a registry file of a process that is gone is not a live session', live: ['busy', { pid: deadPid }], records: [prompt(recent - MINUTE), said(recent, 'Done.'), turnEnd(recent + 1000)], expect: ['finished', recent, null] },
    { n: 19, name: 'a final message with no stop reason, in a turn that was never marked over, is cut off -> error', records: [prompt(T0 - HOUR), message(T0 - HOUR + 1000, { type: 'text', text: 'I was saying' }, null)],
      expect: ['error', T0 - HOUR + 1000, null] },
    { n: 20, name: 'a long answer: the excerpt is its start, at most 300 characters', records: [prompt(recent - MINUTE), said(recent, longAnswer), turnEnd(recent + 1000)], expect: ['finished', recent, null] },
    { n: 21, name: 'a slash command after the answer (/exit) is not something said to the model -> finished', records: [prompt(recent - MINUTE), said(recent, 'Done. The build passes.'), turnEnd(recent + 1000),
      prompt(recent + 2000, '<command-name>/exit</command-name>\n<command-message>exit</command-message>\n<command-args></command-args>')], expect: ['finished', recent, null] },
    { n: 22, name: 'a message with no stop reason in a turn that was marked over is its answer -> finished', records: [prompt(recent - MINUTE), message(recent, { type: 'text', text: 'All set.' }, null), turnEnd(recent + 1000)], expect: ['finished', recent, null] },
    { n: 23, name: 'words that stopped for a tool whose call was never written -> the turn never finished -> error', records: [prompt(T0 - HOUR), message(T0 - HOUR + 1000, { type: 'text', text: 'Let me run the tests.' }, 'tool_use')],
      expect: ['error', T0 - HOUR + 1000, null] },
    { n: 24, name: 'a question in Chinese, ended by a full-width mark', records: [prompt(recent - MINUTE), said(recent, '已经改好了。要不要把超时改成 60 秒？'), turnEnd(recent + 1000)],
      expect: ['waiting_owner', recent, { kind: 'question', text: '已经改好了。要不要把超时改成 60 秒？' }] },
  ];
  for (const item of cases) {
    await home.transcript(item.n, item.records);
    if (item.live) await home.live(item.n, item.live[0], item.live[1]);
  }
  // A session in which only slash commands were run has no conversation: idle, not a turn that died. Since when is the file's own time.
  await home.transcript(40, [prompt(T0 - HOUR, '<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>high</command-args>')]);

  const sessions = createSessions({ readers: { claude: claudeReader({ root: home.root, registry: home.registry }) }, file: ':memory:', now, intervals: false });
  t.after(() => sessions.dispose());
  assert.deepEqual(sessions.snapshots().sources, { claude: 'pending' }, 'nothing was read yet');
  assert.equal(sessions.stateOf(`claude:${id(1)}`), null);
  assert.equal((await sessions.poll()).outcome, 'success');

  const { snapshots, sources, total } = sessions.snapshots();
  assert.equal(total, cases.length + 1);
  assert.deepEqual(sources, { claude: 'ok' });
  assert.deepEqual([sessions.stateOf(`claude:${id(40)}`), byId(snapshots)[id(40)].stateSince], ['idle', (await stat(home.file(40))).mtimeMs]);
  const found = byId(snapshots);
  for (const item of cases) {
    const snapshot = found[id(item.n)];
    assert.ok(snapshot, item.name);
    assert.deepEqual([snapshot.state, snapshot.stateSince, snapshot.pending], item.expect, item.name);
    assert.equal(sessions.stateOf(snapshot.key), snapshot.state, `stateOf agrees: ${item.name}`);
  }
  assert.deepEqual([1, 2, 3, 4, 6, 9].map((n) => found[id(n)].turnActive), [true, true, true, true, false, false],
    'registry work and dialogs are live; questions left in a completed turn are history');
  // The rest of the snapshot, as docs/assistant.md 3.4 shapes it.
  const done = found[id(8)];
  assert.equal(done.incomingAt, recent);
  assert.equal(found[id(2)].foregroundActive, false, 'a background shell keeps lifecycle safety without occupying the foreground');
  assert.equal(found[id(1)].foregroundActive, true);
  assert.deepEqual([done.key, done.provider, done.dshSessionId, done.title, done.cwd, done.excerpt, done.lastActivityAt], [`claude:${id(8)}`, 'claude', null, 'Build repair', '/work/app', 'Done. The build passes.', recent]);
  const long = found[id(20)];
  assert.ok([...long.excerpt].length <= 300 && long.excerpt.startsWith('The cause is in the cache layer.'), 'the excerpt is the start of the last message, cut to 300');
  assert.deepEqual(snapshots.map((s: any) => s.lastActivityAt), [...snapshots.map((s: any) => s.lastActivityAt)].sort((a, b) => b - a), 'the most recently active first');
  assert.deepEqual(sessions.snapshots({ state: 'waiting_owner' }).snapshots.map((s: any) => s.id).sort(), [id(3), id(4), id(5), id(6), id(9), id(24)]);
  assert.deepEqual(sessions.snapshots({ state: ['error', 'running'], provider: 'claude' }).total, 6 + 2);
  assert.equal(sessions.snapshots({ state: 'sleeping' }).outcome, 'needs_clarification');
  assert.equal(sessions.snapshots({ provider: 'vim' }).outcome, 'needs_clarification');

  // A state that has not changed keeps its time; a status the registry changes is read again by the cheap look alone.
  await home.live(7, 'busy', { statusUpdatedAt: T0 + MINUTE });
  clock.now = T0 + 2 * MINUTE;
  await sessions.poll({ kind: 'live' });
  assert.deepEqual([sessions.stateOf(`claude:${id(7)}`), sessions.snapshots().snapshots.find((s: any) => s.id === id(7)).stateSince], ['running', T0 + MINUTE]);
  clock.now = T0;
});

test('Codex: the last turn of each thread through a fake app-server, and only a thread that changed is read again', async (t) => {
  const stale = T0 - 10 * DAY;
  const threads = [
    thread('c-done'), thread('c-ask'), thread('c-questions'), thread('c-failed'), thread('c-stopped'),
    thread('c-live', { updatedAt: sec(T0 - 2 * MINUTE) }), thread('c-dead', { updatedAt: sec(T0 - 2 * HOUR) }), thread('c-empty'), thread('c-old'),
    thread('c-sub', { parentThreadId: 'c-done' }),
  ];
  const turns: Record<string, any[]> = {
    'c-done': [turn('completed', asked('Done. All 12 tests pass.'))],
    'c-ask': [turn('completed', asked('I changed the config.\n\nShould I restart the service?'))],
    'c-questions': [turn('completed', [{ type: 'agentMessage', id: 'q', text: 'I need two things.', phase: 'final_answer', delivery: 'async', questions: [{ title: 'Which region?', options: ['eu', 'us'] }, { title: 'Which size?', options: null }] }])],
    'c-failed': [turn('failed', [{ type: 'userMessage', id: 'i0', content: [{ type: 'text', text: 'do it' }] }], { error: { message: 'stream disconnected', codexErrorInfo: null, additionalDetails: null, misalignment: null } })],
    'c-stopped': [turn('interrupted', [{ type: 'userMessage', id: 'i0', content: [{ type: 'text', text: 'do it' }] }])],
    'c-live': [turn('inProgress', [{ type: 'userMessage', id: 'i0', content: [{ type: 'text', text: 'long job' }] }], { startedAt: sec(T0 - 10 * MINUTE) })],
    'c-dead': [turn('inProgress', [{ type: 'userMessage', id: 'i0', content: [{ type: 'text', text: 'long job' }] }], { startedAt: sec(T0 - 3 * HOUR) })],
    'c-empty': [],
    'c-old': [turn('completed', asked('Should I continue?'), { startedAt: sec(stale - HOUR), completedAt: sec(stale) })],
  };
  const codex = fakeCodex(threads, turns);
  const sessions = createSessions({ readers: { codex: codexReader({ command: 'codex', spawnProcess: codex.spawnProcess }) }, file: ':memory:', now, intervals: false });
  t.after(() => sessions.dispose());
  await sessions.poll();

  const { snapshots, sources } = sessions.snapshots();
  assert.deepEqual(sources, { codex: 'ok' });
  assert.equal(snapshots.length, 9, 'a subagent thread is not a session');
  const state = (name: string) => { const s = byId(snapshots)[name]; return [s.state, s.stateSince, s.pending]; };
  assert.deepEqual(state('c-done'), ['finished', sec(T0 - HOUR) * 1000, null]);
  assert.deepEqual(state('c-ask'), ['waiting_owner', sec(T0 - HOUR) * 1000, { kind: 'question', text: 'Should I restart the service?' }]);
  assert.deepEqual(state('c-questions'), ['waiting_owner', sec(T0 - HOUR) * 1000, { kind: 'question', text: 'Which region? / Which size?' }]);
  assert.deepEqual(state('c-failed')[0], 'error');
  assert.deepEqual(state('c-stopped')[0], 'stopped');
  assert.deepEqual(state('c-live'), ['running', sec(T0 - 10 * MINUTE) * 1000, null]);
  assert.deepEqual(state('c-dead')[0], 'idle', 'a turn that says it is in progress in a thread nobody has written to for two hours is not running');
  assert.equal(byId(snapshots)['c-live'].foregroundActive, true);
  assert.equal(byId(snapshots)['c-dead'].foregroundActive, false);
  assert.deepEqual(state('c-empty')[0], 'idle');
  assert.deepEqual(state('c-old')[0], 'idle', 'a question from ten days ago');
  const shown = byId(snapshots)['c-done'];
  assert.deepEqual([shown.key, shown.title, shown.cwd, shown.excerpt, shown.lastActivityAt], ['codex:c-done', 'thread c-done', '/work/codex', 'Done. All 12 tests pass.', sec(T0 - HOUR) * 1000]);
  // One call asks for one turn, not the thread; a thread that did not change is not asked about again.
  assert.deepEqual(codex.requests.find((request) => request.method === 'thread/turns/list')?.params, { threadId: 'c-done', limit: 1, sortDirection: 'desc', itemsView: 'summary' });
  assert.equal(codex.count('thread/turns/list'), 9);
  await sessions.poll();
  assert.equal(codex.count('thread/turns/list'), 9, 'nothing changed');
  threads[0].updatedAt = sec(T0);
  turns['c-done'] = [turn('completed', asked('Done again.'))];
  await sessions.poll();
  assert.equal(codex.count('thread/turns/list'), 10);
  assert.equal(byId(sessions.snapshots().snapshots)['c-done'].excerpt, 'Done again.');
});

test('an issue\'s agent keeps a question, a failure and a stop however old (pinned): idle is the owner\'s word, not a matter of time; a session nobody manages still ages into idle', async (t) => {
  const stale = T0 - 10 * DAY;
  const user = [{ type: 'userMessage', id: 'i0', content: [{ type: 'text', text: 'do it' }] }];
  const age = { startedAt: sec(stale - HOUR), completedAt: sec(stale) };
  // two of each: the first of every pair is an issue's agent (linked to a DSH session the issue holds), the second is nobody's
  const names = ['ask', 'failed', 'stopped'];
  const threads = names.flatMap((name) => [thread(`mine-${name}`), thread(`free-${name}`)]);
  const turns: Record<string, any[]> = {};
  for (const prefix of ['mine', 'free']) {
    turns[`${prefix}-ask`] = [turn('completed', asked('I changed the config.\n\nShould I restart the service?'), age)];
    turns[`${prefix}-failed`] = [turn('failed', user, { ...age, error: { message: 'stream disconnected', codexErrorInfo: null, additionalDetails: null, misalignment: null } })];
    turns[`${prefix}-stopped`] = [turn('interrupted', user, age)];
  }
  const asked_about: string[] = [];
  const sessions = createSessions({
    readers: { codex: codexReader({ command: 'codex', spawnProcess: fakeCodex(threads, turns).spawnProcess }) }, file: ':memory:', now, intervals: false,
    links: { get: (provider: string, id: string) => (provider === 'codex' && id.startsWith('mine-') ? `held-${id}` : undefined) },
    pinned: (key: string) => { asked_about.push(key); return key.startsWith('dsh:held-'); },
  });
  t.after(() => sessions.dispose());
  await sessions.poll();
  const states = Object.fromEntries(sessions.snapshots().snapshots.map((snapshot: any) => [snapshot.id, snapshot.state]));
  assert.deepEqual(names.map((name) => states[`mine-${name}`]), ['waiting_owner', 'error', 'stopped'], 'an issue\'s agent: still the owner\'s turn after ten days');
  assert.deepEqual(names.map((name) => states[`free-${name}`]), ['idle', 'idle', 'idle'], 'a session nobody manages: an old, abandoned one, as before');
  assert.ok(asked_about.length > 0 && asked_about.every((key) => key.startsWith('dsh:held-')), `only a session that has a DSH session is asked about, with its DSH key: ${asked_about.join(', ')}`);
});

test('DSH: its own rules; a Claude or Codex session that DSH drives is one session with its DSH side; 嘟嘟\'s own is never reported', async (t) => {
  const home = await claudeHome(t);
  const links = await createLinkStore(join(home.base, 'dudu'));
  home.beforeRemove(() => links.flush());
  // A Claude session DSH drives, between its turns (no process), and a Codex session the same way, linked only by what DSH's list says.
  await home.transcript(30, [prompt(T0 - HOUR), said(T0 - HOUR + 1000, 'Done.'), turnEnd(T0 - HOUR + 2000)]);
  links.record({ route: 'claude', nativeSessionId: id(30), sessionId: 'dsh-30' });
  await home.transcript(31, [prompt(T0 - HOUR), said(T0 - HOUR + 1000, 'Done.'), turnEnd(T0 - HOUR + 2000)]);
  links.record({ route: 'claude', nativeSessionId: id(31), sessionId: 'dsh-own' });   // 嘟嘟's own conversation, run by Claude
  const codexTurns: Record<string, any[]> = { 'c-1': [turn('completed', asked('Done.'))] };
  const codex = fakeCodex([thread('c-1')], codexTurns);
  const dsh = fakeDsh();
  dsh.set('dsh-30', { running: true, since: T0 - 3 * MINUTE });
  dsh.set('dsh-c1', { running: false, last: 'answer', at: T0 - HOUR }, { native: { provider: 'codex', id: 'c-1' } });
  dsh.set('dsh-own', { running: true });
  dsh.set('d-ask', { pending: { kind: 'approval', text: 'Run `npm publish`?', since: T0 - 5 * MINUTE } });
  dsh.set('d-run', { running: true, since: T0 - 4 * MINUTE });
  dsh.set('d-done', { last: 'answer', at: T0 - 2 * HOUR, excerpt: 'The summary is ready.' });
  dsh.set('d-broke', { last: 'error', at: T0 - 2 * HOUR });
  dsh.set('d-old-broke', { last: 'error', at: T0 - 20 * DAY });
  dsh.set('d-stopped', { last: 'aborted', at: T0 - 2 * HOUR });
  dsh.set('d-blank', null);
  dsh.sessions.set('d-listed-only', { entry: { id: 'd-listed-only', title: 'x', updatedAt: T0 }, facts: undefined });

  const sessions = createSessions({
    readers: { claude: claudeReader({ root: home.root, registry: home.registry }), codex: codexReader({ command: 'codex', spawnProcess: codex.spawnProcess }), dsh: dsh.reader },
    links, now, file: ':memory:', intervals: false, ignore: (key: string) => key === 'dsh:dsh-own',
  });
  t.after(() => sessions.dispose());
  await sessions.poll();

  const { snapshots, sources } = sessions.snapshots();
  assert.deepEqual(sources, { claude: 'ok', codex: 'ok', dsh: 'ok' });
  const found = Object.fromEntries(snapshots.map((s: any) => [s.key, s]));
  assert.deepEqual(Object.keys(found).sort(), [`claude:${id(30)}`, 'codex:c-1', 'dsh:d-ask', 'dsh:d-blank', 'dsh:d-broke', 'dsh:d-done', 'dsh:d-listed-only', 'dsh:d-old-broke', 'dsh:d-run', 'dsh:d-stopped'].sort(),
    'the DSH sessions that are harness sessions are not listed twice, and 嘟嘟\'s own is not listed at all');
  const row = (key: string) => [found[key].state, found[key].stateSince, found[key].pending];
  assert.deepEqual(row('dsh:d-ask'), ['waiting_owner', T0 - 5 * MINUTE, { kind: 'approval', text: 'Run `npm publish`?' }]);
  assert.deepEqual(row('dsh:d-run'), ['running', T0 - 4 * MINUTE, null]);
  assert.deepEqual(row('dsh:d-done'), ['finished', T0 - 2 * HOUR, null]);
  assert.deepEqual([found['dsh:d-done'].excerpt, found['dsh:d-done'].dshSessionId, found['dsh:d-done'].provider, found['dsh:d-done'].title], ['The summary is ready.', 'd-done', 'dsh', 'DSH d-done']);
  assert.equal(found['dsh:d-broke'].state, 'error');
  assert.equal(found['dsh:d-old-broke'].state, 'idle', 'an error from twenty days ago');
  assert.equal(found['dsh:d-stopped'].state, 'stopped');
  assert.equal(found['dsh:d-blank'].state, 'idle', 'DSH knows nothing of it');
  assert.equal(found['dsh:d-listed-only'].state, 'idle');
  // The Claude session is DSH's, and DSH says its loop is running: that is what it is doing, whatever its transcript's last answer says.
  assert.deepEqual([found[`claude:${id(30)}`].state, found[`claude:${id(30)}`].stateSince, found[`claude:${id(30)}`].dshSessionId], ['running', T0 - 3 * MINUTE, 'dsh-30']);
  assert.equal(sessions.stateOf('dsh:dsh-30'), 'running', 'the DSH key of a harness session names that session');
  // The Codex one is linked by DSH's own word (no link in the store), and DSH says it is done.
  assert.deepEqual([found['codex:c-1'].state, found['codex:c-1'].dshSessionId], ['finished', 'dsh-c1']);
  assert.ok(!dsh.asked.includes('dsh-own') && !dsh.asked.includes('d-nothing'), '嘟嘟\'s own session is never asked about');
  assert.equal(sessions.stateOf('dsh:dsh-own'), null);
  assert.equal((await sessions.read('dsh:dsh-own')).outcome, 'needs_clarification');

  // DSH's loop ends: the harness session is read again at once, not when its own reader next comes round.
  dsh.set('dsh-30', { running: false, last: 'answer', at: T0 }, {});
  await home.append(30, [prompt(T0 - 5 * MINUTE, 'and the docs?'), said(T0 - 4 * MINUTE, 'Docs updated. Anything else?'), turnEnd(T0 - 3 * MINUTE)]);
  await sessions.poll({ kind: 'live' });
  assert.deepEqual(sessions.snapshots().snapshots.find((s: any) => s.id === id(30)).pending, { kind: 'question', text: 'Docs updated. Anything else?' });
  assert.equal(sessions.stateOf(`claude:${id(30)}`), 'waiting_owner');
  // The same for the Codex session: its thread was not written to since the last look, but DSH says a turn just ran in it.
  const asks = codex.count('thread/turns/list');
  codexTurns['c-1'] = [turn('completed', asked('Shall I deploy it?'))];
  dsh.set('dsh-c1', { running: false, last: 'answer', at: T0 }, { native: { provider: 'codex', id: 'c-1' } });
  await sessions.poll({ kind: 'live' });
  assert.equal(codex.count('thread/turns/list'), asks + 1);
  assert.deepEqual(sessions.snapshots().snapshots.find((s: any) => s.id === 'c-1').pending, { kind: 'question', text: 'Shall I deploy it?' });
  await sessions.poll({ kind: 'live' });
  assert.equal(codex.count('thread/turns/list'), asks + 1, 'and only when DSH\'s side changed');
});

// --- the index: changes, the issues hook, restart ------------------------------------------------------------------------------

test('a question arrives, a session starts and one is deleted: exact change events, the issues hook, a restart, a corrupt index', async (t) => {
  const home = await claudeHome(t);
  const file = join(home.base, 'index', 'sessions.db');
  const recent = T0 - 30 * MINUTE;
  await home.transcript(1, [prompt(recent), said(recent + 1000, 'Working on it.'), called(recent + 2000, 'Bash', { command: 'npm test' }, 't1'), result(recent + 3000, 't1')]);
  await home.live(1, 'busy', { statusUpdatedAt: recent });
  await home.transcript(2, [prompt(recent), said(recent + 1000, 'Done.'), turnEnd(recent + 2000)]);
  await home.transcript(3, [prompt(recent), said(recent + 1000, 'Done.'), turnEnd(recent + 2000)]);
  const open = (extra: any = {}) => createSessions({ readers: { claude: claudeReader({ root: home.root, registry: home.registry }) }, file, now, intervals: false, ...extra });

  const sessions = open();
  const events: any[] = [];
  sessions.onChange((event: any) => events.push(event));
  const issues = createIssues({ file: ':memory:', lifecycleState: sessions.stateOf, now });
  t.after(() => issues.close());
  const issue = issues.add({ project: { name: 'work', path: '/work' }, title: 'Fix the build', status: 'in_progress', agent: 'claude', session: `claude:${id(1)}` }).issue;

  // The first read on an empty index is the baseline: it holds three sessions and says nothing.
  await sessions.poll();
  assert.deepEqual(events, []);
  assert.equal(sessions.snapshots().total, 3);

  // The agent asks a question and stops; a new session appears; one is deleted.
  await home.append(1, [said(T0 - 5 * MINUTE, 'The suite needs a database.\n\nShall I start the test one?'), turnEnd(T0 - 4 * MINUTE)]);
  await home.live(1, 'idle', { statusUpdatedAt: T0 - 4 * MINUTE });
  await home.transcript(4, [prompt(T0 - MINUTE), called(T0 - MINUTE + 1000, 'Bash', { command: 'ls' })]);
  await home.live(4, 'busy', { statusUpdatedAt: T0 - MINUTE });
  await home.remove(3);
  assert.equal((await sessions.poll()).changes, 3);
  const asked = { kind: 'question', text: 'Shall I start the test one?' };
  assert.deepEqual(events.map((event) => [event.key, event.from, event.to]).sort(), [
    [`claude:${id(1)}`, 'running', 'waiting_owner'], [`claude:${id(3)}`, 'finished', null], [`claude:${id(4)}`, null, 'running'],
  ]);
  const changed = events.find((event) => event.key === `claude:${id(1)}`);
  assert.deepEqual([changed.snapshot.state, changed.snapshot.pending, changed.snapshot.stateSince], ['waiting_owner', asked, T0 - 5 * MINUTE]);
  events.length = 0;
  await sessions.poll();
  assert.deepEqual(events, [], 'a read that finds nothing new says nothing');

  // The agent is answered and runs again; unsubscribing stops the events.
  const off = sessions.onChange(() => { throw new Error('a listener that breaks must not break the read'); });
  await home.live(1, 'busy', { statusUpdatedAt: T0 });
  await sessions.poll();
  assert.deepEqual(events.map((event) => [event.from, event.to]), [['waiting_owner', 'running']]);
  off();
  await sessions.dispose();
  await sessions.dispose();
  assert.equal((await sessions.poll()).outcome, 'no_op', 'a disposed index answers and does nothing');

  // A restart: the index answers before anything is read, and what changed while nothing was running is an event, from what it held.
  await home.live(1, 'idle', { statusUpdatedAt: T0 + MINUTE });
  const restarted = open();
  t.after(() => restarted.dispose());
  assert.equal(restarted.stateOf(`claude:${id(1)}`), 'running', 'the state it held');
  assert.equal(restarted.snapshots().total, 3);
  const later: any[] = [];
  restarted.onChange((event: any) => later.push(event));
  await restarted.poll();
  assert.deepEqual(later.map((event) => [event.key, event.from, event.to]), [[`claude:${id(1)}`, 'running', 'waiting_owner']]);
  await restarted.dispose();

  // A file that is not a database is replaced: it is an index of sessions that can be read again.
  await writeFile(file, 'this is not a database '.repeat(400));
  const rebuilt = open();
  t.after(() => rebuilt.dispose());
  assert.equal(rebuilt.snapshots().total, 0);
  const none: any[] = [];
  rebuilt.onChange((event: any) => none.push(event));
  await rebuilt.poll();
  assert.equal(rebuilt.snapshots().total, 3);
  assert.deepEqual(none, [], 'and what it finds again is a baseline');
  assert.equal(rebuilt.snapshots().store, 'ok');
  assert.throws(() => createSessions({ readers: {}, now }), /needs the file/);
});

test('a reader that fails marks only itself, keeps what it knew, and the rest go on', async (t) => {
  const home = await claudeHome(t);
  await home.transcript(1, [prompt(T0 - HOUR), said(T0 - HOUR + 1000, 'Done.'), turnEnd(T0 - HOUR + 2000)]);
  const codex = fakeCodex([thread('c-1')], { 'c-1': [turn('completed', asked('Done.'))] });
  const dsh = fakeDsh();
  dsh.set('d-1', { last: 'answer', at: T0 - HOUR });
  let listFails = false;
  const reader = { ...dsh.reader, list: async () => { if (listFails) throw new Error('DSH is restarting'); return dsh.reader.list(); } };
  const sessions = createSessions({
    readers: { claude: claudeReader({ root: home.root, registry: home.registry }), codex: codexReader({ command: 'codex', spawnProcess: codex.spawnProcess }), dsh: reader },
    file: ':memory:', now, intervals: false,
  });
  t.after(() => sessions.dispose());
  await sessions.poll();
  assert.deepEqual(sessions.snapshots().sources, { claude: 'ok', codex: 'ok', dsh: 'ok' });
  assert.equal(sessions.snapshots().total, 3);

  codex.state.fail = 'spawn codex ENOENT';
  listFails = true;
  await home.transcript(2, [prompt(T0 - MINUTE), called(T0 - MINUTE + 1000, 'Bash', { command: 'ls' })]);
  const reply = await sessions.poll();
  assert.equal(reply.outcome, 'success', 'a failing source is not a failing read');
  const { sources, snapshots } = sessions.snapshots();
  assert.deepEqual([sources.claude, sources.codex, sources.dsh], ['ok', 'error: spawn codex ENOENT', 'error: DSH is restarting']);
  assert.equal(snapshots.length, 4, 'what the two sources knew stays, and Claude went on: the new session is in');
  assert.equal(sessions.stateOf(`claude:${id(2)}`), 'error');
  assert.equal(sessions.stateOf('codex:c-1'), 'finished');

  codex.state.fail = '';
  listFails = false;
  await sessions.poll();
  assert.deepEqual(sessions.snapshots().sources, { claude: 'ok', codex: 'ok', dsh: 'ok' });

  // A Claude home that cannot be listed at all.
  const broken = createSessions({ readers: { claude: claudeReader({ root: join(home.base, 'sessions', 'nothing.json'), registry: home.registry }) }, file: ':memory:', now, intervals: false });
  t.after(() => broken.dispose());
  await writeFile(join(home.registry, 'nothing.json'), '{}');
  await broken.poll();
  assert.match(broken.snapshots().sources.claude, /^error: /);
  assert.equal(broken.snapshots().total, 0);
});

test('a transcript of tens of gigabytes is read from its ends only', async (t) => {
  const home = await claudeHome(t);
  const size = 64 * 1024 ** 3;
  const head = `${JSON.stringify(prompt(T0 - 2 * HOUR))}\n`;
  const tail = `\n${[said(T0 - 2 * HOUR, 'The end of an earlier answer.'), prompt(T0 - HOUR - MINUTE, 'ship it'), said(T0 - HOUR, 'All done. Want me to open the pull request?'), turnEnd(T0 - HOUR + 1000)]
    .map((record) => JSON.stringify(record)).join('\n')}\n`;
  // Only the two ends are written: the file is a hole in between, which a read of the whole file would have to walk through (a minute, here).
  const handle = await open(home.file(1), 'w');
  try {
    await handle.write(head, 0);
    await handle.write(Buffer.from(tail), 0, Buffer.byteLength(tail), size - Buffer.byteLength(tail));
  } catch (error) {
    await handle.close();
    return t.skip(`this file system has no sparse files (${(error as Error).message})`);
  }
  await handle.close();
  assert.equal((await stat(home.file(1))).size, size);

  const sessions = createSessions({ readers: { claude: claudeReader({ root: home.root, registry: home.registry }) }, file: ':memory:', now, intervals: false });
  t.after(() => sessions.dispose());
  const started = Date.now();
  await sessions.poll();
  const first = Date.now() - started;
  assert.deepEqual([sessions.stateOf(`claude:${id(1)}`), sessions.snapshots().snapshots[0].pending], ['waiting_owner', { kind: 'question', text: 'All done. Want me to open the pull request?' }]);
  const again = Date.now();
  await sessions.poll();
  assert.ok(first < 5000 && Date.now() - again < 1000, `a read took ${first} ms, the next one ${Date.now() - again} ms`);
  const one = await sessions.read(`claude:${id(1)}`, { turns: 1 });
  assert.deepEqual([one.outcome, one.turns.map((item: any) => [item.prompt, item.reply]), one.truncated], ['success', [['ship it', 'All done. Want me to open the pull request?']], true], 'and reading the end of it for a person is the same');
  const two = await sessions.read(`claude:${id(1)}`, { turns: 2 });
  assert.deepEqual(two.turns.map((item: any) => [item.prompt, item.reply]), [['', 'The end of an earlier answer.'], ['ship it', 'All done. Want me to open the pull request?']],
    'a turn whose prompt is out of reach comes with the end of what was said in it');
});

// --- read, and the runners -----------------------------------------------------------------------------------------------------

test('read: the end of one session, as many turns as asked for, capped, and marked as the session\'s own words', async (t) => {
  const home = await claudeHome(t);
  const records: unknown[] = [];
  for (let i = 1; i <= 30; i++) {
    const at = T0 - (31 - i) * HOUR;
    records.push(prompt(at, `question ${i}`), called(at + 1000, 'Bash', { command: `echo ${i}` }, `toolu_${i}`), result(at + 2000, `toolu_${i}`), said(at + 3000, `answer ${i}`), turnEnd(at + 4000));
  }
  records.push(prompt(T0 - MINUTE, 'the last question'), said(T0 - MINUTE + 1000, 'x'.repeat(9000)), turnEnd(T0 - MINUTE + 2000));
  await home.transcript(1, records);
  const codex = fakeCodex([thread('c-1')], {
    'c-1': [turn('completed', asked('second answer')), turn('completed', asked('first answer'))].map((item, index) => ({ ...item, id: `t${index}`, items: [item.items[0], { type: 'commandExecution', id: 'c', command: 'ls', status: 'completed' }, ...item.items.slice(1)] })),
  });
  const dsh = fakeDsh();
  dsh.set('d-1', { last: 'answer', at: T0 - HOUR });
  const sessions = createSessions({
    readers: { claude: claudeReader({ root: home.root, registry: home.registry }), codex: codexReader({ command: 'codex', spawnProcess: codex.spawnProcess }), dsh: dsh.reader },
    file: ':memory:', now, intervals: false,
  });
  t.after(() => sessions.dispose());
  await sessions.poll();

  const three = await sessions.read(`claude:${id(1)}`);
  assert.deepEqual([three.outcome, three.key, three.provider, three.source, three.content], ['success', `claude:${id(1)}`, 'claude', `claude:${id(1)}`, 'data']);
  assert.deepEqual(three.turns.map((item: any) => item.prompt), ['question 29', 'question 30', 'the last question'], 'the end of the session, oldest of them first');
  assert.deepEqual(three.turns[0], { at: T0 - 2 * HOUR, prompt: 'question 29', reply: 'answer 29', tools: ['Bash'] });
  assert.equal(three.truncated, true, 'there is more before it, and the last answer was cut');
  assert.ok(three.turns[2].reply.length <= 4001, 'one message is capped');
  const small = await sessions.read(`claude:${id(1)}`, { turns: 20, chars: 1500 });
  assert.ok(small.turns.reduce((sum: number, item: any) => sum + item.prompt.length + item.reply.length, 0) <= 1500 + 2, 'what is read has a budget');
  assert.equal(small.turns.at(-1).prompt, 'the last question', 'and the newest turns are the ones kept');
  const all = await sessions.read(`claude:${id(1)}`, { turns: 500, chars: 10_000_000 });
  assert.ok(all.turns.length <= 20 && all.turns.reduce((sum: number, item: any) => sum + item.prompt.length + item.reply.length, 0) <= 40_002, 'neither can be asked past its cap');

  const viaCodex = await sessions.read('codex:c-1', { turns: 2 });
  assert.deepEqual(viaCodex.turns.map((item: any) => [item.prompt, item.reply, item.tools]), [['do it', 'first answer', ['commandExecution']], ['do it', 'second answer', ['commandExecution']]]);
  assert.deepEqual(codex.requests.find((request) => request.method === 'thread/turns/list' && request.params.itemsView === 'full')?.params, { threadId: 'c-1', limit: 2, sortDirection: 'desc', itemsView: 'full' });
  assert.deepEqual((await sessions.read('dsh:d-1')).turns, [{ at: T0, prompt: 'asked in d-1', reply: 'answered', tools: ['shell'] }]);
  assert.equal((await sessions.read('claude:nothing')).outcome, 'needs_clarification');
  assert.equal((await sessions.read(42 as any)).outcome, 'needs_clarification');
  await home.remove(1);
  assert.equal((await sessions.read(`claude:${id(1)}`)).outcome, 'error', 'a session whose file went away since the last look says so');
});

test('open, close, resume and send: the runners do it; the input is checked, a running session is not interrupted, and the session is read again afterwards', async (t) => {
  const home = await claudeHome(t);
  await home.transcript(1, [prompt(T0 - HOUR), said(T0 - HOUR + 1000, 'Done.'), turnEnd(T0 - HOUR + 2000)]);
  await home.transcript(2, [prompt(T0 - 5 * MINUTE), called(T0 - 4 * MINUTE, 'Bash', { command: 'make' })]);
  await home.live(2, 'busy', { statusUpdatedAt: T0 - 4 * MINUTE });
  const calls: any[] = [];
  const runners: any = {
    claude: {
      // What the real runner does: the session exists and its process is busy by the time the call returns.
      start: async (input: any) => { calls.push(['start', input]); await home.transcript(9, [prompt(T0, input.firstMessage)]); await home.live(9, 'busy', { statusUpdatedAt: T0 }); return { key: `claude:${id(9)}` }; },
      resume: async (key: string) => { calls.push(['resume', key]); },
      send: async (key: string, text: string) => { calls.push(['send', key, text]); await home.live(1, 'busy', { statusUpdatedAt: T0 }); },
      close: async (key: string) => { calls.push(['close', key]); },
    },
    codex: { start: async () => { throw new Error('codex is not logged in'); }, send: async () => ({ outcome: 'no_op', message: 'It was not asked anything.' }) },
    dsh: { start: async () => ({ key: 'claude:wrong-provider' }) },
  };
  const sessions = createSessions({ readers: { claude: claudeReader({ root: home.root, registry: home.registry }) }, runners, now, file: ':memory:', intervals: false });
  t.after(() => sessions.dispose());
  await sessions.poll();

  // open
  const opened = await sessions.open({ provider: 'claude', cwd: '/work/app', firstMessage: 'look at the failing build' });
  assert.deepEqual([opened.outcome, opened.key, opened.provider, opened.snapshot?.state, opened.snapshot?.title], ['success', `claude:${id(9)}`, 'claude', 'running', 'look at the failing build']);
  assert.deepEqual(calls.at(-1), ['start', { cwd: '/work/app', firstMessage: 'look at the failing build', access: 'read-only' }], 'a session is read-only unless told otherwise');
  assert.equal(sessions.stateOf(`claude:${id(9)}`), 'running', 'the session is known as soon as it was opened');
  await sessions.open({ provider: 'claude', cwd: '/work/app', firstMessage: 'edit it', access: 'workspace-write' });
  assert.equal(calls.at(-1)[1].access, 'workspace-write');
  const before = calls.length;
  for (const bad of [
    {}, { provider: 'vim', cwd: '/w', firstMessage: 'x' }, { provider: 'claude', firstMessage: 'x' }, { provider: 'claude', cwd: '  ', firstMessage: 'x' }, { provider: 'claude', cwd: '/w' },
    { provider: 'claude', cwd: '/w', firstMessage: '   ' }, { provider: 'claude', cwd: '/w', firstMessage: 'x', access: 'root' }, { provider: 'claude', cwd: '/w', firstMessage: 'x'.repeat(100_001) },
    { provider: 'claude', cwd: 7, firstMessage: 'x' },
  ]) {
    const result = await sessions.open(bad as any);
    assert.equal(result.outcome, 'needs_clarification', JSON.stringify(bad).slice(0, 80));
    assert.ok(result.message && result.next);
  }
  assert.equal((await sessions.open(undefined as any)).outcome, 'needs_clarification');
  assert.equal((await sessions.open({ provider: 'claude', cwd: '/w', firstMessage: 'x', access: 'danger-full-access' })).outcome, 'success', 'full access is a mode that can be asked for');
  assert.equal(calls.length, before + 1, 'nothing wrong reached a runner');
  assert.deepEqual(await sessions.open({ provider: 'codex', cwd: '/w', firstMessage: 'x' }), { outcome: 'error', message: 'codex is not logged in', next: 'Check that the harness is installed and enabled, then try again.' });
  assert.equal((await sessions.open({ provider: 'dsh', cwd: '/w', firstMessage: 'x' })).outcome, 'error', 'a key that is not of the provider asked is not a session started');
  const unwired = createSessions({ readers: {}, runners: {}, now, file: ':memory:', intervals: false });
  t.after(() => unwired.dispose());
  assert.equal((await unwired.open({ provider: 'claude', cwd: '/w', firstMessage: 'x' })).outcome, 'needs_clarification');

  // close: a running session is not interrupted; collapsing is the runner's to do and nothing is deleted here
  const running = await sessions.close(`claude:${id(2)}`);
  assert.deepEqual([running.outcome, calls.some((call) => call[0] === 'close')], ['needs_clarification', false]);
  assert.match(running.next, /force: true/);
  assert.equal((await sessions.close(`claude:${id(2)}`, { force: true })).outcome, 'success');
  const closed = await sessions.close(`claude:${id(1)}`);
  assert.deepEqual([closed.outcome, closed.snapshot.state, calls.filter((call) => call[0] === 'close').map((call) => call[1])], ['success', 'finished', [`claude:${id(2)}`, `claude:${id(1)}`]]);
  assert.equal((await sessions.close('nonsense')).outcome, 'needs_clarification');
  assert.equal((await sessions.close(`dsh:x`)).outcome, 'needs_clarification', 'no runner for it');

  // resume
  assert.deepEqual([(await sessions.resume(`claude:${id(2)}`)).outcome, calls.some((call) => call[0] === 'resume')], ['no_op', false]);
  assert.equal((await sessions.resume(`claude:${id(1)}`)).outcome, 'success');
  assert.deepEqual(calls.at(-1), ['resume', `claude:${id(1)}`]);

  // send
  assert.equal((await sessions.send(`claude:${id(1)}`, '  ')).outcome, 'needs_clarification');
  assert.equal((await sessions.send(`claude:${id(1)}`, 'x'.repeat(100_001))).outcome, 'needs_clarification');
  assert.equal((await sessions.send(`claude:${id(1)}`, 3 as any)).outcome, 'needs_clarification');
  const sent = await sessions.send(`claude:${id(1)}`, 'and the docs?');
  assert.deepEqual([sent.outcome, sent.snapshot.state, calls.at(-1)], ['success', 'running', ['send', `claude:${id(1)}`, 'and the docs?']], 'the answer to a question makes the session run, and that is known at once');
  assert.deepEqual(await sessions.send('codex:c-1', 'hello'), { outcome: 'no_op', message: 'It was not asked anything.', key: 'codex:c-1', snapshot: null }, 'a runner may say there was nothing to do');
  runners.claude.send = async () => { throw new Error('the session is open in another process (pid 7)'); };
  assert.deepEqual(await sessions.send(`claude:${id(1)}`, 'hi'), { outcome: 'error', message: 'the session is open in another process (pid 7)', next: 'Check the session, then try again.' });
});

test('the cadence: the defaults are the doc\'s, the timers read without being asked, and dispose stops them', async (t) => {
  assert.deepEqual({ ...DEFAULT_INTERVALS }, { live: 10_000, files: 60_000, codex: 120_000 });
  const home = await claudeHome(t);
  await home.transcript(1, [prompt(T0 - HOUR), said(T0 - HOUR + 1000, 'Done.'), turnEnd(T0 - HOUR + 2000)]);
  await home.live(1, 'idle', { statusUpdatedAt: T0 - HOUR });
  const sessions = createSessions({ readers: { claude: claudeReader({ root: home.root, registry: home.registry }) }, file: ':memory:', now, intervals: { live: 20, files: 0, codex: 0 } });
  t.after(() => sessions.dispose());
  // Reads at the start, with no one asking.
  await waitFor(() => sessions.stateOf(`claude:${id(1)}`) === 'finished');
  // The cheap look picks up a registry change on its own timer.
  await home.live(1, 'busy', { statusUpdatedAt: T0 });
  await waitFor(() => sessions.stateOf(`claude:${id(1)}`) === 'running');
  await sessions.dispose();
  await home.live(1, 'idle', { statusUpdatedAt: T0 + MINUTE });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(sessions.stateOf(`claude:${id(1)}`), 'running', 'a disposed index reads nothing more');
});

// --- scale (not run by default: DUDU_SESSIONS_SCALE=1) ------------------------------------------------------------------------------

test('scale: two thousand sessions, read cold and read again', { skip: !process.env.DUDU_SESSIONS_SCALE }, async (t) => {
  const home = await claudeHome(t);
  for (let n = 1; n <= 2000; n++) {
    await home.transcript(n, [prompt(T0 - DAY - n), said(T0 - DAY - n + 1000, n % 7 === 0 ? 'Shall I go on?' : 'Done.'), turnEnd(T0 - DAY - n + 2000)]);
    if (n % 50 === 0) await home.live(n, n % 100 === 0 ? 'busy' : 'idle');
  }
  const sessions = createSessions({ readers: { claude: claudeReader({ root: home.root, registry: home.registry }) }, file: join(home.base, 'sessions.db'), now, intervals: false });
  t.after(() => sessions.dispose());
  let started = performance.now();
  await sessions.poll();
  const cold = performance.now() - started;
  started = performance.now();
  await sessions.poll();
  const warm = performance.now() - started;
  started = performance.now();
  await sessions.poll({ kind: 'live' });
  const live = performance.now() - started;
  console.log(`2000 sessions: cold read ${Math.round(cold)} ms, read again ${Math.round(warm)} ms, live look ${Math.round(live)} ms`);
  assert.equal(sessions.snapshots({ limit: 5000 }).total, 2000);
  assert.ok(warm < 1000, `reading again took ${warm} ms`);
});

test('a restart keeps what the index knew of a session that DSH and its harness share: asked by its DSH key it answers from the start, not after the first read (owner, 2026-11-07)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dudu-alias-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'sessions.db');
  const ended = { last: 'answer', at: T0, turnEnded: true, ending: 'Done.', question: '', tool: '', excerpt: 'Done.' };
  const facts = [{ id: 'abc', title: 'Shared', cwd: '/work', updatedAt: T0, lastActivityAt: T0, excerpt: 'Done.', process: null, tail: ended }];
  const links = { get: (provider: string, one: string) => (provider === 'claude' && one === 'abc' ? 'dsh-1' : undefined) };
  const first = createSessions({ readers: { claude: { scan: async () => facts, live: async () => facts } }, links, now, file, intervals: false });
  await first.poll();
  assert.equal(first.stateOf('dsh:dsh-1'), 'finished', 'one session, asked by either key');
  assert.equal(first.snapshotOf('dsh:dsh-1')?.turnActive, false);
  await first.dispose();
  // the next run, before anything has been read: DSH's key finds the session's snapshot all the same (it used to find nothing until the read was done, and the issue held by it
  // read as something else for that long, and again when the read ended)
  const second = createSessions({ readers: {}, links, now, file, intervals: false });
  assert.equal(second.stateOf('dsh:dsh-1'), 'finished');
  assert.equal(second.snapshotOf('dsh:dsh-1')?.turnActive, undefined, 'process liveness is never restored from SQLite');
  assert.deepEqual([second.snapshotOf('dsh:dsh-1')?.key, second.snapshotOf('dsh:dsh-1')?.stateSince], [`claude:abc`, T0]);
  await second.dispose();
});
