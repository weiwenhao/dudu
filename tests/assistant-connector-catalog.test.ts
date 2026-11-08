// The catalog dudu ships (host/assistant/connectors/catalog.json): every item says how it connects, and a bad item is a bug that stops the load with the reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog } from '../host/assistant/connectors/catalog.mjs';

test('the shipped catalog loads: hosted items have an https address, command-line items a command and the sentence that says how to read them', () => {
  const catalog = loadCatalog();
  assert.deepEqual(catalog.items.map((item: any) => item.id), [
    'lark', 'google-calendar', 'google-drive', 'notion', 'airtable', 'canva', 'linear', 'atlassian', 'github', 'gitlab', 'sentry', 'supabase', 'vercel', 'browser',
  ], 'the owner\'s fifteen less Gmail (taken out 2026-11-08), in the order of their groups');
  assert.deepEqual(catalog.groups, ['work', 'projects', 'dev', 'web']);
  assert.deepEqual(catalog.here, []);
  for (const id of ['google-calendar', 'google-drive']) assert.equal(catalog.byId(id)?.command, 'gws', 'the two Google ones are one command line');
  assert.ok(!catalog.byId('gmail'), 'Gmail is not offered: it needs a Google Cloud client of the owner\'s own');
  for (const item of [...catalog.items, ...catalog.here]) {
    assert.ok(item.name && item.line && item.icon, item.id);
    if (item.how === 'oauth' || item.how === 'open') assert.equal(new URL(item.url).protocol, 'https:', item.id);
    else assert.ok(item.command && item.prompt, item.id);
  }
  assert.deepEqual(catalog.byId('notion'), catalog.items.find((item: any) => item.id === 'notion'));
  assert.equal(catalog.byId('browser')?.how, 'browser');
  assert.equal(catalog.byId('nothing'), null);
  assert.deepEqual(catalog.byId('lark')?.ready, { path: 'identities.user.status', equals: 'ready' });
});

test('an item that cannot work is refused with the reason, not shown half made', () => {
  const load = (items: any[]) => () => loadCatalog({ groups: ['work'], items });
  const good = { id: 'a', name: 'A', group: 'work', icon: 'a', line: 'x', how: 'oauth', url: 'https://a.test/mcp' };
  assert.doesNotThrow(load([good]));
  assert.throws(load([{ ...good, url: 'http://a.test/mcp' }]), /https/);
  assert.throws(load([{ ...good, how: 'ftp' }]), /how must be/);
  assert.throws(load([good, good]), /there twice/);
  assert.throws(load([{ ...good, group: 'other' }]), /group must be/);
  assert.throws(load([{ ...good, how: 'cli', url: undefined, command: 'a b', prompt: 'x' }]), /name of a command/);
  assert.throws(load([{ ...good, how: 'cli', url: undefined, command: 'a', prompt: 'x', ready: { path: 'p', equals: 1 } }]), /ready needs/);
});
