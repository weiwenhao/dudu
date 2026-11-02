import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseNext, CLOSED_KEY, createClosed, KEEP } from '../host/dudu-plugin/ui/pet/use-reminders.js';

const item = (key: string) => ({ key, kind: 'needs_you', id: 1, ref: 'APP-1', title: 't', text: 't', agent: null });
const memoryStorage = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[CLOSED_KEY, initial]]);
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
};

test('the first reminder that is not closed is shown, with the count of those behind it', () => {
  const list = [item('a'), item('b'), item('c')];
  assert.deepEqual(chooseNext(list, []), { current: list[0], more: 2 });
  assert.deepEqual(chooseNext(list, ['a']), { current: list[1], more: 1 });
  assert.deepEqual(chooseNext(list, ['a', 'c']), { current: list[1], more: 0 });
  assert.deepEqual(chooseNext(list, ['a', 'b', 'c']), { current: null, more: 0 });
  assert.deepEqual(chooseNext([], []), { current: null, more: 0 });
  assert.deepEqual(chooseNext(undefined as any, []), { current: null, more: 0 });
  assert.equal(chooseNext([{ nokey: true } as any, item('x')], []).current!.key, 'x', 'an entry without a key is skipped');
});

test('closed keys are written through and read back by the next page', () => {
  const storage = memoryStorage();
  const closed = createClosed(() => storage);
  closed.add('a:needs_you:1');
  closed.add('a:needs_you:1');
  closed.add('b:overdue:2');
  assert.deepEqual(closed.keys(), ['a:needs_you:1', 'b:overdue:2']);
  assert.equal(closed.has('b:overdue:2'), true);
  assert.equal(closed.has('b:overdue:3'), false, 'a changed key is a different reminder');
  assert.deepEqual(createClosed(() => storage).keys(), ['a:needs_you:1', 'b:overdue:2']);
});

test('only the newest two hundred closed keys are kept', () => {
  const storage = memoryStorage();
  const closed = createClosed(() => storage);
  for (let n = 0; n < KEEP + 25; n++) closed.add(`k${n}`);
  assert.equal(closed.keys().length, KEEP);
  assert.equal(closed.has('k0'), false);
  assert.equal(closed.has(`k${KEEP + 24}`), true);
  assert.equal(JSON.parse(storage.data.get(CLOSED_KEY)!).length, KEEP);
});

test('a storage that throws leaves the closed keys in memory, and a damaged value is ignored', () => {
  const broken = () => { throw new Error('storage is blocked'); };
  const closed = createClosed(broken);
  closed.add('a');
  assert.equal(closed.has('a'), true, 'closed for this page even with no storage');
  const onlyWrite = { getItem: () => null, setItem: broken };
  const second = createClosed(() => onlyWrite);
  second.add('b');
  assert.deepEqual(second.keys(), ['b']);
  for (const damaged of ['not json', '{"a":1}', '"text"', '[1,{"k":2},"ok"]']) {
    const keys = createClosed(() => memoryStorage(damaged)).keys();
    assert.deepEqual(keys, damaged === '[1,{"k":2},"ok"]' ? ['ok'] : []);
  }
});
