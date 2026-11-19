import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeComputer, createConnectionStore } from '../src/connection-store.ts';
import { parseConnection } from '../src/connection.ts';

function fixture() {
  const values = new Map<string, string>();
  let failIndex = false;
  let failRemove = false;
  let sequence = 0;
  let clock = 1000;
  const storage = {
    async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: string) {
      if (failIndex && key === 'dudu.computers.v2') throw new Error('Keychain unavailable');
      values.set(key, value);
    },
    async remove(key: string) {
      if (failRemove) throw new Error('Keychain unavailable');
      values.delete(key);
    },
  };
  const open = () => createConnectionStore(storage, {
    now: () => ++clock, newId: () => `test-${++sequence}`,
  });
  return {
    values, open,
    failIndex: (value: boolean) => { failIndex = value; },
    failRemove: (value: boolean) => { failRemove = value; },
  };
}
const pair = (id: string, host = `${id}.example.com`, token = `test-token-${id}`) =>
  parseConnection(`https://${host}/?pair=${token}&computer=${id}&name=${id}`);

test('multiple desktop credentials survive switching and re-opening, without tokens in the index', async () => {
  const f = fixture();
  const store = f.open();
  await store.pair(pair('office'));
  const both = await store.pair(pair('home'));
  assert.equal(both.computers.length, 2);
  assert.equal(activeComputer(both)?.name, 'home');
  const home = activeComputer(both)!;
  const office = both.computers.find((computer) => computer.name === 'office')!;
  await store.select(office.id);
  const restored = await f.open().load();
  assert.equal(activeComputer(restored)?.id, office.id);
  assert.equal(restored.computers.find((computer) => computer.id === home.id)?.url, home.url);
  assert.ok(!f.values.get('dudu.computers.v2')!.includes('test-token'));
  assert.equal([...f.values.keys()].filter((key) => key.startsWith('dudu.computer.')).length, 2);
});

test('pairing another address for the same desktop updates that computer and preserves other desktops', async () => {
  const f = fixture();
  const store = f.open();
  const first = await store.pair(pair('office'));
  const id = first.activeId;
  await store.pair(pair('home'));
  const updated = await store.pair(pair('office', 'new-office.example.com', 'replacement'));
  assert.equal(updated.computers.length, 2);
  assert.equal(updated.activeId, id);
  assert.equal(activeComputer(updated)?.url, pair('office', 'new-office.example.com', 'replacement').url);
  assert.ok(updated.computers.some((computer) => computer.computerId === 'home'));
});

test('legacy credentials migrate before deletion and can acquire a stable desktop identity', async () => {
  const f = fixture();
  f.values.set('dudu.connection.v1', JSON.stringify(parseConnection('https://office.example.com/?pair=old', '书房')));
  const store = f.open();
  const migrated = await store.load();
  assert.equal(activeComputer(migrated)?.name, '书房');
  assert.equal(f.values.has('dudu.connection.v1'), false);
  const updated = await store.pair(pair('office', 'office.example.com', 'old'));
  assert.equal(updated.computers.length, 1);
  assert.equal(updated.activeId, migrated.activeId);
  assert.equal(activeComputer(updated)?.computerId, 'office');
});

test('legacy computers sharing an address are not overwritten by different credentials', async () => {
  const f = fixture();
  const store = f.open();
  const original = parseConnection('https://shared.example.com/?pair=original', 'Original');
  await store.pair(original);
  const next = await store.pair(pair('new-desktop', 'shared.example.com', 'different'));
  assert.equal(next.computers.length, 2);
  assert.equal(next.computers[0].url, original.url);
});

test('a failed migration leaves the original credential available for retry', async () => {
  const f = fixture();
  const previous = JSON.stringify(parseConnection('https://office.example.com/?pair=old', 'Office'));
  f.values.set('dudu.connection.v1', previous);
  f.failIndex(true);
  const store = f.open();
  await assert.rejects(store.load(), /Keychain unavailable/);
  assert.equal(f.values.get('dudu.connection.v1'), previous);
  assert.equal([...f.values.keys()].filter((key) => key.startsWith('dudu.computer.')).length, 0);
  f.failIndex(false);
  assert.equal(activeComputer(await store.load())?.name, 'Office');
});

test('removal affects only its selected computer and remembers a remaining active desktop', async () => {
  const f = fixture();
  const store = f.open();
  const office = activeComputer(await store.pair(pair('office')))!;
  const home = activeComputer(await store.pair(pair('home')))!;
  await store.pair(pair('spare'));
  let library = await store.remove(home.id);
  assert.equal(activeComputer(library)?.computerId, 'spare');
  library = await store.remove(library.activeId!);
  assert.equal(library.activeId, office.id);
  assert.equal(activeComputer(await f.open().load())?.id, office.id);
  assert.deepEqual(await store.remove(office.id), { computers: [], activeId: null });
});

test('failed list writes preserve the previous active computer and all listed credentials', async () => {
  const f = fixture();
  const store = f.open();
  const first = await store.pair(pair('office'));
  f.failIndex(true);
  await assert.rejects(store.pair(pair('home')), /Keychain unavailable/);
  await assert.rejects(store.remove(first.activeId!), /Keychain unavailable/);
  assert.deepEqual(await store.load(), first);
  assert.deepEqual(await f.open().load(), first);
  assert.equal([...f.values.keys()].filter((key) => key.startsWith('dudu.computer.')).length, 1);
});

test('failed index writes roll back a replacement credential and a selection timestamp', async () => {
  const f = fixture();
  const store = f.open();
  const office = activeComputer(await store.pair(pair('office')))!;
  const both = await store.pair(pair('home'));
  f.failIndex(true);
  await assert.rejects(store.pair(pair('office', 'new.example.com', 'new-token')), /Keychain unavailable/);
  await assert.rejects(store.select(office.id), /Keychain unavailable/);
  assert.deepEqual(await store.load(), both);
  assert.deepEqual(await f.open().load(), both);
});

test('failed credential deletion is recorded for cleanup after reopening without touching other computers', async () => {
  const f = fixture();
  const store = f.open();
  const office = activeComputer(await store.pair(pair('office')))!;
  const home = activeComputer(await store.pair(pair('home')))!;
  f.failRemove(true);
  const remaining = await store.remove(office.id);
  assert.equal(remaining.computers.length, 1);
  assert.equal(f.values.has(`dudu.computer.${office.id}`), true);
  assert.deepEqual(JSON.parse(f.values.get('dudu.computers.v2')!).pendingDeletes, [office.id]);
  f.failRemove(false);
  assert.equal(activeComputer(await f.open().load())?.id, home.id);
  assert.equal(f.values.has(`dudu.computer.${office.id}`), false);
  assert.equal(f.values.has(`dudu.computer.${home.id}`), true);
  assert.equal(JSON.parse(f.values.get('dudu.computers.v2')!).pendingDeletes, undefined);
});

test('concurrent pairing is serialized, and a missing computer cannot replace the current selection', async () => {
  const f = fixture();
  const store = f.open();
  await Promise.all([store.pair(pair('office')), store.pair(pair('home'))]);
  const library = await store.load();
  assert.equal(library.computers.length, 2);
  assert.equal(activeComputer(library)?.computerId, 'home');
  await assert.rejects(store.select('missing'), /已被移除/);
  assert.deepEqual(await store.load(), library);
});

test('a damaged record does not hide the remaining desktop, while a damaged index is not overwritten', async () => {
  const f = fixture();
  const store = f.open();
  await store.pair(pair('office'));
  const current = activeComputer(await store.pair(pair('home')))!;
  f.values.set(`dudu.computer.${current.id}`, '{"url":');
  assert.equal(activeComputer(await f.open().load())?.computerId, 'office');
  f.values.set('dudu.computers.v2', '{"version":2,"ids":"invalid","activeId":null}');
  await assert.rejects(f.open().pair(pair('another')), /无法读取/);
  assert.match(f.values.get('dudu.computers.v2')!, /"ids":"invalid"/);
});
