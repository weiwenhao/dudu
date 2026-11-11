import assert from 'node:assert/strict';
import test from 'node:test';
import { cardEvent, repeatableCard } from '../host/dudu-plugin/ui/pet/card-events.mjs';

// How a quick button's card stands in the pet's thread: it is its command's two events, which can arrive in different reads of the thread.

const run = (commandId: string, name: string, args: string | undefined, seq: number) => ({ type: 'command/run', seq, time: seq * 10, data: { commandId, name, ...(args === undefined ? {} : { args }), source: { kind: 'user' } } });
const done = (commandId: string, kind: string, seq: number) => ({ type: 'command/done', seq, time: seq * 10, data: { commandId, kind } });

test('the card appears when its command is done, at the run\'s place, and the run alone shows nothing', () => {
  const memory = new Map();
  assert.equal(cardEvent(run('a', 'dudu-card', ' todo ', 4), memory), null);
  assert.deepEqual(cardEvent(done('a', 'success', 5), memory), { id: 4, at: 40, role: 'card', commandId: 'a', kind: 'todo' });
});

test('the run and the done may come in different reads: what the run said is kept in the memory the reads share', () => {
  const memory = new Map();
  cardEvent(run('a', 'dudu-card', 'info', 8), memory);
  const later = cardEvent(done('a', 'success', 9), memory);
  assert.equal(later?.kind, 'info');
  assert.equal(later?.id, 8);
});

test('another command, a failed card, a done whose run was never read and anything malformed show nothing', () => {
  const memory = new Map();
  cardEvent(run('compact-1', 'compact', undefined, 1), memory);
  assert.equal(cardEvent(done('compact-1', 'success', 2), memory), null, 'only the card command makes a card');
  cardEvent(run('b', 'dudu-card', 'task', 3), memory);
  assert.equal(cardEvent(done('b', 'error', 4), memory), null, 'a card that could not be made');
  assert.equal(cardEvent(done('never-seen', 'success', 5), memory), null);
  for (const event of [undefined, null, { type: 'command/done' }, { type: 'command/done', data: { kind: 'success' } }, { type: 'assistant/message', data: { commandId: 'x' } }]) {
    assert.equal(cardEvent(event as any, memory), null);
  }
});

test('a tap repeats only the newest card of its kind that nothing but other cards follows; a message, a reply or an empty thread leaves nothing to repeat', () => {
  const card = (kind: string, commandId: string) => ({ id: 1, at: 1, role: 'card', commandId, kind });
  const said = (role: string) => ({ id: 2, at: 2, role, text: 'x' });
  assert.equal(repeatableCard([card('todo', 'a')], 'todo'), 'a');
  assert.equal(repeatableCard([said('user'), card('todo', 'a'), card('info', 'b')], 'todo'), 'a', 'cards of other kinds after it do not matter');
  assert.equal(repeatableCard([card('todo', 'a'), card('todo', 'b')], 'todo'), 'b', 'the newest');
  assert.equal(repeatableCard([card('todo', 'a'), said('assistant')], 'todo'), null, 'a reply since then');
  assert.equal(repeatableCard([card('todo', 'a'), said('user'), card('info', 'b')], 'todo'), null, 'a message since then, whatever follows');
  assert.equal(repeatableCard([card('info', 'b')], 'todo'), null, 'no card of that kind');
  assert.equal(repeatableCard([], 'todo'), null);
  assert.equal(repeatableCard(undefined as any, 'todo'), null);
});
