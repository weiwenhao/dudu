import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { briefIssue, createGroup, sayText, taskLine } from '../host/assistant/home/group.mjs';

// 嘟嘟's conversation as a group chat: the owner's @ line comes into the thread, and the answer of that issue's agent after it (the last message of the turn the line started, or its question), or
// a silent mark that none will come; the agent is never told of the thread; the owner can hide lines of it. docs/assistant.md 4.1.

const issue = { id: 9, ref: 'DUD-9', title: '记忆系统调研', agent: 'codex', project: { name: 'dudu' }, brief: 'not part of a line' };
const KEY = 'dsh:abc';

function setup(over: { say?: (kind: string, record: Record<string, unknown>) => Promise<string>; file?: string } = {}) {
  const listeners = new Set<(change: unknown) => void>();
  const textListeners = new Set<(change: unknown) => void>();
  const said: [string, Record<string, unknown>][] = [];
  let group;
  const say = over.say ?? (async (kind: string, record: Record<string, unknown>) => { said.push([kind, record]); const id = `c${said.length}`; group.put(id, record); return id; });
  group = createGroup({ file: over.file, sessions: () => ({
    onChange: (cb: (change: unknown) => void) => { listeners.add(cb); return () => listeners.delete(cb); },
    onText: (cb: (change: unknown) => void) => { textListeners.add(cb); return () => textListeners.delete(cb); },
  }), say, now: () => 1000, log: { warn() {} } });
  const emit = (from: string | null, to: string, snapshot: Record<string, unknown> = {}, key = KEY) => { for (const cb of [...listeners]) cb({ key, from, to, snapshot }); };
  const text = (value: string, key = KEY) => { for (const cb of [...textListeners]) cb({ key, text: value }); };
  return { group, said, emit, text };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a line is what the command takes from the waiting ones, kept under the command\'s own id, and the issue is named by its ID, its title and its agent only', async () => {
  const { group } = setup();
  const record = { v: 1, kind: 'at', issue: briefIssue(issue), text: '结论了吗', at: 5 };
  assert.deepEqual(record.issue, { id: 9, ref: 'DUD-9', title: '记忆系统调研', agent: 'codex' });
  const command = group.command();
  const id = group.pend(record);
  assert.deepEqual(await command.handler({ commandId: 'cmd-1', rawInput: `at ${id}` }), { kind: 'success', text: '@DUD-9 结论了吗' });
  assert.deepEqual(group.get('cmd-1'), record);
  assert.equal((await command.handler({ commandId: 'cmd-2', rawInput: `at ${id}` })).kind, 'error'); // taken once
  assert.equal((await command.handler({ commandId: 'cmd-3', rawInput: `reply ${group.pend(record)}` })).kind, 'error'); // the kind is the line's own
  assert.deepEqual(group.many(['cmd-1', 'nope']), { 'cmd-1': record });
  assert.deepEqual(group.ownLine(), { text: '@DUD-9 结论了吗', at: 5 }, 'the owner\'s last @ line, as the chat list shows it (their words to 嘟嘟)');
  assert.equal(sayText({ kind: 'reply', issue: record.issue, text: '好的' }), 'DUD-9: 好的');
});

test('the @ line keeps the complete references of its pictures, and only those; a line without pictures has no such key', async () => {
  const { group, said } = setup();
  const ref = { attachmentId: 'sha256:aa', mediaType: 'image/jpeg', bytes: 10, width: 3, height: 4, name: 'photo.jpg', originalDimensions: { width: 6, height: 8 } };
  await group.sent(group.expect(KEY), { issue, text: '看图', files: 3, pictures: [ref, { attachmentId: 'sha256:bb', mediaType: 'image/png' }, null] });
  assert.deepEqual(said[0][1].pictures, [{ attachmentId: 'sha256:aa', mediaType: 'image/jpeg', bytes: 10, width: 3, height: 4, name: 'photo.jpg' }]);
  assert.equal(said[0][1].files, 3);
  await group.sent(group.expect(KEY), { issue, text: '没图' });
  assert.equal('pictures' in said[1][1], false);
});

test('the answer comes after the line: the last message of the turn the line started', async () => {
  const { group, said, emit } = setup();
  const token = group.expect(KEY);
  assert.equal(await group.sent(token, { issue, text: '结论了吗' }), 'c1');
  assert.equal(said[0][0], 'at');
  emit('idle', 'running');
  emit('running', 'finished', { ending: '结论：先用 SQLite。', pending: null });
  await flush();
  assert.equal(said.length, 2);
  assert.deepEqual(said[1], ['reply', { v: 1, kind: 'reply', issue: briefIssue(issue), text: '结论：先用 SQLite。', to: 'c1', answer: 'answer', at: 1000 }]);
  emit('running', 'finished', { ending: 'a later turn' }); // nothing is waited for any more
  await flush();
  assert.equal(said.length, 2);
});

test('a turn that was running when the line was sent is not its answer: the next one is', async () => {
  const { group, said, emit } = setup();
  const token = group.expect(KEY);
  await group.sent(token, { issue, text: '先做这个' });
  emit('running', 'finished', { ending: 'the earlier turn' }); // the one that was already running
  emit('finished', 'running');
  emit('running', 'finished', { ending: 'the answer to the line' });
  await flush();
  assert.equal(said.length, 2);
  assert.equal(said[1][1].text, 'the answer to the line');
});

test('reply text updates the waiting line in memory, then commits one final answer without changing the owner line', async () => {
  const { group, said, emit, text } = setup();
  await group.sent(group.expect(KEY), { issue, text: '结论了吗' });
  const ownerLine = group.get('c1');
  const changes: string[] = [];
  const release = group.onChange((id: string) => changes.push(id));
  text('the preceding turn');
  assert.equal(group.get('c1').liveReply, undefined);
  emit('idle', 'running');
  text('another issue', 'dsh:other');
  text('结论：');
  assert.deepEqual(group.get('c1').liveReply, { text: '结论：', at: 1000 });
  const revision = group.revision();
  text('结论：');
  assert.equal(group.revision(), revision, 'an unchanged preview does not trigger another publish');
  text('结论：先用 SQLite。');
  assert.equal(group.get('c1').liveReply.text, '结论：先用 SQLite。');
  emit('running', 'running', { ending: '结论：先用 SQLite。' });
  assert.equal(group.waiting(), 1, 'tools or a completed text chunk do not finish the forwarded run');
  assert.equal(group.get('c1').liveReply.text, '结论：先用 SQLite。');
  assert.equal(said.length, 1, 'deltas append no session commands');
  assert.equal(group.material().length, 1, 'an unfinished reply is not committed prompt material');
  assert.equal(ownerLine.liveReply, undefined, 'the durable owner record is untouched');
  emit('running', 'finished', { ending: '结论：先用 SQLite。' });
  await flush();
  assert.deepEqual(said.map(([kind]) => kind), ['at', 'reply']);
  assert.equal(group.get('c2').text, '结论：先用 SQLite。');
  assert.equal(group.get('c1').liveReply, undefined);
  assert.equal(group.waiting(), 0);
  assert.ok(changes.includes('c1'));
  release();
  group.dispose();
});

test('abandoned text clears the preview; stopped text is kept and a question replaces the provisional answer', async () => {
  for (const outcome of ['stopped', 'waiting_owner']) {
    const { group, said, emit, text } = setup();
    await group.sent(group.expect(KEY), { issue, text: 'x' });
    emit('idle', 'running');
    text('discarded attempt');
    text('');
    assert.equal(group.get('c1').liveReply, undefined);
    text('partial answer');
    emit('running', outcome, { pending: { text: 'which one?' } });
    await flush();
    assert.equal(said.length, 2);
    assert.equal(said[1][0], 'reply');
    assert.equal(said[1][1].text, outcome === 'stopped' ? 'partial answer' : 'which one?');
    assert.equal(group.get('c1').liveReply, undefined);
    group.dispose();
  }
});

test('a fast stream waits for its owner line to be recorded and concurrent issue replies keep their own text', async () => {
  let release: () => void = () => {};
  const said: [string, Record<string, unknown>][] = [];
  const { group, emit, text } = setup({
    say: async (kind, record) => {
      said.push([kind, record]);
      const id = `c${said.length}`;
      if (id === 'c1') await new Promise<void>((resolve) => { release = resolve; });
      group.put(id, record);
      return id;
    },
  });
  const sent = group.sent(group.expect(KEY), { issue, text: 'first' });
  emit('idle', 'running');
  text('fast reply');
  assert.deepEqual(said.map(([kind]) => kind), ['at']);
  release();
  await sent;
  assert.equal(group.get('c1').liveReply.text, 'fast reply');
  const other = 'dsh:other';
  await group.sent(group.expect(other), { issue: { ...issue, id: 10, ref: 'DUD-10' }, text: 'second' });
  text('only the first reply changes');
  text('not started yet', other);
  assert.equal(group.get('c1').liveReply.text, 'only the first reply changes');
  assert.equal(group.get('c2').liveReply, undefined);
  emit('idle', 'running', {}, other);
  text('the second reply', other);
  assert.equal(group.get('c1').liveReply.text, 'only the first reply changes');
  assert.equal(group.get('c2').liveReply.text, 'the second reply');
  emit('running', 'finished', { ending: 'only the first reply changes' });
  await flush();
  assert.equal(group.get('c3').to, 'c1');
  assert.equal(group.get('c2').liveReply.text, 'the second reply');
  assert.equal(group.waiting(), 1, 'the other issue is still awaited');
  emit('running', 'finished', { ending: 'the second reply' }, other);
  await flush();
  assert.equal(group.get('c4').to, 'c2');
  assert.equal(group.get('c4').text, 'the second reply');
  assert.equal(group.waiting(), 0);
  group.dispose();
});

test('a turn that stops to ask is answered with its question; one that fails, is stopped or says nothing leaves a silent mark', async () => {
  for (const [to, snapshot, kind, extra] of [
    ['waiting_owner', { pending: { kind: 'question', text: '先查哪一个？' } }, 'reply', { answer: 'question', text: '先查哪一个？' }],
    ['error', { error: 'boom' }, 'end', {}],
    ['stopped', {}, 'end', {}],
    ['finished', { ending: '' }, 'end', {}],
  ] as const) {
    const { group, said, emit } = setup();
    await group.sent(group.expect(KEY), { issue, text: 'x' });
    emit('idle', 'running');
    emit('running', to, snapshot);
    await flush();
    assert.equal(said[1][0], kind, to);
    assert.deepEqual(Object.fromEntries(Object.entries(extra).map(([key]) => [key, said[1][1][key]])), extra, to);
  }
});

test('a turn that ends before the entry for the line is made still answers after it', async () => {
  let release: (id: string) => void = () => {};
  const calls: string[] = [];
  const { group, emit } = setup({ say: (kind) => { calls.push(kind); return kind === 'at' ? new Promise<string>((resolve) => { release = resolve; }) : Promise.resolve('c2'); } });
  const token = group.expect(KEY);
  const sent = group.sent(token, { issue, text: 'fast' });
  emit('idle', 'running');
  emit('running', 'finished', { ending: 'quick answer' });
  assert.deepEqual(calls, ['at']);
  release('c1');
  await sent;
  assert.deepEqual(calls, ['at', 'reply']);
});

test('a line that was not delivered makes nothing, and the lines the model reads are the latest ones, oldest first and cut short', async () => {
  const { group, said, emit } = setup();
  group.cancel(group.expect(KEY));
  emit('idle', 'running'); emit('running', 'finished', { ending: 'x' });
  await flush();
  assert.equal(said.length, 0);
  const lines = createGroup({ log: { warn() {} } });
  lines.put('a', { v: 1, kind: 'at', issue: briefIssue(issue), text: 'q', at: 1 });
  lines.put('b', { v: 1, kind: 'reply', issue: briefIssue(issue), text: 'y'.repeat(2000), to: 'a', answer: 'question', at: 2 });
  lines.put('c', { v: 1, kind: 'end', issue: briefIssue(issue), to: 'a', at: 3 });
  const material = lines.material();
  assert.equal(material.length, 2); // the silent mark is not for 嘟嘟
  assert.deepEqual([material[0].from, material[0].to, material[1].from, material[1].asksTheOwner], ['owner', 'DUD-9', 'DUD-9', true]);
  assert.ok(material[1].text.length <= 800);
});

test('hidden lines and the lines of the group survive a restart; only whole numbers can be hidden', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-group-'));
  try {
    const file = join(folder, 'group.json');
    const first = createGroup({ file, log: { warn() {} } });
    first.put('a', { v: 1, kind: 'at', issue: briefIssue(issue), text: 'q', at: 1 });
    assert.equal(first.hide(['x', 1.5]).outcome, 'needs_clarification');
    assert.deepEqual(first.hide([7, 9]).hidden, [7, 9]);
    const second = createGroup({ file, log: { warn() {} } });
    assert.deepEqual([...second.hidden()], [7, 9]);
    assert.equal(second.get('a')?.text, 'q');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('the result of a scheduled task is a line of the thread: kept under its command, shown to 嘟嘟 among the latest lines, and a failed one says so', async () => {
  const { group } = setup();
  const done = taskLine({ task: { id: 't1', title: '每日热点新闻' }, text: '今日热点：1. …', at: 7 });
  const failed = taskLine({ task: { id: 't1', title: '每日热点新闻' }, text: 'The model call failed.', ok: false, at: 9 });
  assert.deepEqual(done, { v: 1, kind: 'task', task: { id: 't1', title: '每日热点新闻' }, text: '今日热点：1. …', ok: true, at: 7 });
  const command = group.command();
  assert.deepEqual(await command.handler({ commandId: 'c1', rawInput: `task ${group.pend(done)}` }), { kind: 'success', text: '每日热点新闻: 今日热点：1. …' });
  await command.handler({ commandId: 'c2', rawInput: `task ${group.pend(failed)}` });
  assert.deepEqual(group.get('c1'), done);
  assert.deepEqual(group.material().map((line: any) => [line.from.startsWith('scheduled task'), line.to, line.text, line.failed ?? false]), [[true, 'owner', '今日热点：1. …', false], [true, 'owner', 'The model call failed.', true]]);
  // The owner goes on from a part of a long result: it is cut later than an agent's answer (2000 against 800).
  const long = taskLine({ task: { id: 't2', title: '长的' }, text: '字'.repeat(3000), at: 11 });
  await command.handler({ commandId: 'c3', rawInput: `task ${group.pend(long)}` });
  assert.equal(group.material().at(-1).text.length, 2000);
});

