import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLatest } from '../host/assistant/home/latest.mjs';

// The latest message of each issue's session, for the 待办 card: kept from what DSH says of live sessions, read from the stored session only once for one nobody has spoken in, and
// never for a session that no issue gave an agent.

const user = (text: string, time: number, kind = 'user') => ({ type: 'user/message', time, data: { message: { source: { kind }, content: [{ type: 'text', text }] } } });
const agent = (text: string, time: number) => ({ type: 'assistant/message', time, data: { message: { content: [{ type: 'text', text }] } } });
const noTimers = { setTimer: (() => 0) as unknown as typeof setTimeout, clearTimer: (() => {}) as unknown as typeof clearTimeout };

test('the latest message is the newer of what the owner and the agent said, and only for sessions an issue gave an agent', () => {
  const latest = createLatest({ relevant: (id: string) => id === 'a', ...noTimers });
  latest.observe('a', agent('结论：先用 SQLite', 100));
  latest.observe('a', user('再确认一下', 200));
  latest.observe('a', user('一个别的来源的话', 300, 'schedule')); // not the owner's words
  latest.observe('b', agent('another session', 400));
  assert.deepEqual(latest.get('a'), { who: 'me', text: '再确认一下', at: 200 });
  latest.observe('a', agent('好的，已确认', 250));
  assert.deepEqual(latest.get('a'), { who: 'agent', text: '好的，已确认', at: 250 });
  assert.equal(latest.get('b'), null);
  // The chat list shows what the owner said last (owner, 2026-11-22): `mine` is only their words, and `observe` says which side it kept so that the board can be told.
  assert.deepEqual(latest.mine('a'), { text: '再确认一下', at: 200 }, 'the agent speaking later does not take the owner\'s words away');
  assert.equal(latest.observe('a', user('再补一句', 260)), 'me');
  assert.equal(latest.observe('a', agent('', 270)), null);
  assert.equal(latest.observe('b', user('not an issue\'s session', 280)), null);
  assert.deepEqual(latest.mine('a'), { text: '再补一句', at: 260 });
  assert.equal(latest.mine('b'), null);
});

test('a message that arrives late does not replace a newer one, and a long one is cut', () => {
  const latest = createLatest({ ...noTimers });
  latest.observe('a', agent('new', 500));
  latest.observe('a', agent('old', 100));
  assert.equal(latest.get('a')?.text, 'new');
  latest.observe('c', agent('x'.repeat(5000), 1));
  const text = latest.get('c')?.text ?? '';
  assert.ok(text.length <= 2000 && text.endsWith('…'));
});

test('what is kept survives a restart', () => {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-latest-'));
  try {
    const file = join(folder, 'latest.json');
    const first = createLatest({ file, ...noTimers });
    first.observe('a', agent('结论', 100));
    first.dispose(); // saves what is pending
    const second = createLatest({ file, ...noTimers });
    assert.deepEqual(second.get('a'), { who: 'agent', text: '结论', at: 100 });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('a session nobody has spoken in is read once, within the budget, and not again', async () => {
  const reads: string[] = [];
  const latest = createLatest({
    relevant: () => true, ...noTimers,
    read: async (id: string) => { reads.push(id); return id === 'broken' ? Promise.reject(new Error('unreadable')) : { me: { text: '你好', at: 5 }, agent: { text: '在', at: 9 } }; },
  });
  await latest.ensure(['s1', 's2', 'broken']);
  assert.deepEqual(latest.get('s1'), { who: 'agent', text: '在', at: 9 });
  assert.equal(latest.get('broken'), null);
  await latest.ensure(['s1', 'broken']); // kept, and one that said nothing is not asked again and again
  assert.deepEqual(reads.sort(), ['broken', 's1', 's2']);
});
