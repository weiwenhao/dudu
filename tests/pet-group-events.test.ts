import assert from 'node:assert/strict';
import test from 'node:test';
import { groupEvent, placeReplies, plainText, waitingLines, WAIT_LIMIT } from '../host/dudu-plugin/ui/pet/group-events.mjs';
import { cardEvent } from '../host/dudu-plugin/ui/pet/card-events.mjs';
import { replyDraft } from '../host/dudu-plugin/ui/pet/completion.mjs';

// How a line of the group chat stands in the pet's thread (owner, 2026-11-10): like a card, it is its command's two events; the dots wait for the lines no answer has named; 回复 fills the box with the issue's @.

const run = (commandId: string, name: string, seq: number) => ({ type: 'command/run', seq, time: seq * 10, data: { commandId, name, args: 'at x', source: { kind: 'user' } } });
const done = (commandId: string, kind: string, seq: number) => ({ type: 'command/done', seq, time: seq * 10, data: { commandId, kind } });

test('a line appears when its command is done, at the run\'s place; the run alone, another command and a failed line show nothing', () => {
  const memory = new Map();
  assert.equal(groupEvent(run('a', 'dudu-say', 6), memory), null);
  assert.deepEqual(groupEvent(done('a', 'success', 7), memory), { id: 6, at: 60, role: 'group', commandId: 'a' });
  groupEvent(run('b', 'dudu-say', 8), memory);
  assert.equal(groupEvent(done('b', 'error', 9), memory), null);
  groupEvent(run('c', 'compact', 10), memory);
  assert.equal(groupEvent(done('c', 'success', 11), memory), null);
});

test('a card\'s events and a line\'s events share the thread\'s memory without ever being taken for each other', () => {
  const memory = new Map();
  cardEvent(run('card-1', 'dudu-card', 1) as any, memory);
  groupEvent(run('line-1', 'dudu-say', 2), memory);
  assert.equal(groupEvent(done('card-1', 'success', 3), memory), null, 'a card is not a line');
  assert.equal(cardEvent(done('line-1', 'success', 4) as any, memory), null, 'a line is not a card');
  assert.equal(cardEvent(done('card-1', 'success', 5) as any, memory)?.role, 'card');
  assert.equal(groupEvent(done('line-1', 'success', 6), memory)?.role, 'group');
});

const at = (commandId: string, time: number) => ({ id: 1, at: time, role: 'group', commandId });
const lines = (entries: Record<string, any>) => entries;

test('an @ line waits for its answer until a reply or an end names it, or fifteen minutes go by', () => {
  const now = 1_000_000_000;
  const messages = [at('a', now - 1000), at('r', now - 500), at('b', now - 2000), at('e', now - 100), at('old', now - WAIT_LIMIT - 1)];
  const known = lines({
    a: { kind: 'at', at: now - 1000, issue: { id: 1 } }, r: { kind: 'reply', to: 'a', issue: { id: 1 } },
    b: { kind: 'at', at: now - 2000, issue: { id: 2 } }, e: { kind: 'end', to: 'x', issue: { id: 9 } },
    old: { kind: 'at', at: now - WAIT_LIMIT - 1, issue: { id: 3 } },
  });
  assert.deepEqual(waitingLines(messages, known, now).map((one: any) => one.commandId), ['b'], 'a was answered, old was given up, an end names a line that is not here');
  const ended = lines({ ...known, e: { kind: 'end', to: 'b', issue: { id: 2 } } });
  assert.deepEqual(waitingLines(messages, ended, now), [], 'an end stops the dots as an answer does');
  assert.deepEqual(waitingLines([...messages, { id: 2, at: 1, role: 'card', commandId: 'a' }], known, now).length, 1, 'cards are never waited for');
  const streaming = lines({ ...known, old: { ...known.old, liveReply: { text: 'Still answering', at: now } } });
  assert.deepEqual(waitingLines(messages, streaming, now).map((one: any) => one.commandId), ['b', 'old'], 'a live answer remains visible even after a long turn');
});

test('what a message says as one quiet line: the marks of markdown are left out and the lines are run together', () => {
  assert.equal(plainText('## 结论\n- **SQLite**：单文件\n1. 向量库\n```js\nstays\n```\n> `备份` 每天'), '结论 SQLite：单文件 向量库 stays 备份 每天', 'the lines of a code fence are dropped, what is inside stays');
  assert.equal(plainText('| 评估项 | 当前结果 |\n|---|---|\n| 架构适配 | 值得进一步试验 |\n---\n之后'), '评估项 当前结果 架构适配 值得进一步试验 之后', 'the bars and the rule row of a table are left out');
  assert.equal(plainText(undefined as any), '');
});

test('回复 puts the issue\'s @ in front of what is written, or in place of the @ that starts it', () => {
  const issue = { id: 9, ref: 'DUD-9' };
  assert.equal(replyDraft('', issue), '@DUD-9 ');
  assert.equal(replyDraft('hello', issue), '@DUD-9 hello');
  assert.equal(replyDraft('@HOU-18 hello', issue), '@DUD-9 hello', 'only a leading @ routes, so it is replaced');
  assert.equal(replyDraft('@HOU-18', issue), '@DUD-9 ');
  assert.equal(replyDraft('see @HOU-18 later', issue), '@DUD-9 see @HOU-18 later', 'an @ in the middle is only a word');
  assert.equal(replyDraft('', { id: 7 }), '@#7 ', 'an issue without a project reference is addressed by its number');
});

test('an answer stands under the line it answers, where its dots were, and not at the end of the thread (owner, 2026-11-11)', () => {
  // arrival order: the line to issue 1, a talk with 嘟嘟, the line to issue 2 and its answer, and last the answer to the first line
  const thread = [
    { id: 1, at: 100, role: 'group', commandId: 'ask-1' }, { id: 2, at: 200, role: 'owner', text: 'hello' }, { id: 3, at: 300, role: 'dudu', text: 'hi' },
    { id: 4, at: 400, role: 'group', commandId: 'ask-2' }, { id: 5, at: 500, role: 'group', commandId: 'answer-2' }, { id: 6, at: 600, role: 'group', commandId: 'answer-1' },
  ];
  const known = lines({
    'ask-1': { kind: 'at' }, 'ask-2': { kind: 'at' }, 'answer-2': { kind: 'reply', to: 'ask-2' }, 'answer-1': { kind: 'reply', to: 'ask-1' },
  });
  const placed = placeReplies(thread, known);
  assert.deepEqual(placed.map((message) => message.id), [1, 6, 2, 3, 4, 5], 'answer 1 under line 1, answer 2 under line 2, everything else in its order');
  assert.equal(placed[1].at, 100, 'filed under the day of the line it answers');
  assert.equal(thread[5].at, 600, 'the input is not changed');
  // an answer whose line is not in the thread (hidden, or on a page not read) stays where it arrived; an @ line that nothing answers, and threads without answers, are the same list
  assert.deepEqual(placeReplies(thread.slice(2), known).map((message) => message.id), [3, 4, 5, 6]);
  assert.equal(placeReplies(thread.slice(0, 4), known).length, 4);
  const plain = [thread[1], thread[2]];
  assert.strictEqual(placeReplies(plain, known), plain, 'nothing to move: the very same list');
  // a line whose record has not come yet is taken for any other message, and is moved when it has
  assert.deepEqual(placeReplies(thread, lines({ 'ask-1': { kind: 'at' }, 'ask-2': { kind: 'at' } })).map((message) => message.id), [1, 2, 3, 4, 5, 6]);
  // two answers to one line keep their order behind it
  const twice = placeReplies([thread[0], thread[1], { id: 7, at: 700, role: 'group', commandId: 'end-1' }, thread[5]], lines({ ...known, 'end-1': { kind: 'end', to: 'ask-1' } }));
  assert.deepEqual(twice.map((message) => message.id), [1, 7, 6, 2]);
});
