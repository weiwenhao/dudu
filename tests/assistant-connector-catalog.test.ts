// The catalog dudu ships (host/assistant/connectors/catalog.json): every item says how it connects, and a bad item is a bug that stops the load with the reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog } from '../host/assistant/connectors/catalog.mjs';

test('the shipped catalog loads: hosted items have an https address, command-line items a command and the sentence that says how to read them', () => {
  const catalog = loadCatalog();
  assert.deepEqual(catalog.items.map((item: any) => item.id), [
    'lark', 'google-calendar', 'google-drive', 'notion', 'airtable', 'canva', 'linear', 'atlassian', 'gitlab', 'sentry', 'supabase', 'vercel', 'ego',
  ], 'the owner\'s fifteen less Gmail (taken out 2026-11-08) and less GitHub, which is offered once its OAuth App is registered (no client id yet), in the order of their groups');
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
  // ego lite is named for what it is (owner, 2026-11-11, then the full product name on 2026-11-21), a command-line connector like the others: the command must run, and when it is not there the row says where to get it.
  assert.ok(!catalog.byId('browser'), 'there is no connector that is just "a browser": another browser tool is a custom connector');
  assert.deepEqual([catalog.byId('ego')?.name, catalog.byId('ego')?.how, catalog.byId('ego')?.command, catalog.byId('ego')?.status], ['ego lite', 'cli', 'ego-browser', ['--version']]);
  assert.equal(new URL(catalog.byId('ego')?.install ?? '').protocol, 'https:');
  // The two Google ones are signed in when `gws auth status` says its credentials are stored.
  for (const id of ['google-calendar', 'google-drive']) assert.deepEqual([catalog.byId(id)?.status, catalog.byId(id)?.ready], [['auth', 'status'], { path: 'auth_method', equals: 'oauth2' }], id);
  assert.equal(catalog.byId('nothing'), null);
  assert.deepEqual(catalog.byId('lark')?.ready, { path: 'identities.user.status', equals: 'ready' });
});

test('an item signed in to by a device code is offered only when its client is registered, and is checked like the others', () => {
  const item = { id: 'github', name: 'GitHub', group: 'dev', icon: 'github', line: 'x', how: 'device', url: 'https://api.githubcopilot.com/mcp/readonly', clientId: '', scope: 'repo', deviceUrl: 'https://github.com/login/device/code', tokenUrl: 'https://github.com/login/oauth/access_token' };
  const load = (value: any) => loadCatalog({ groups: ['dev'], items: [value] });
  assert.equal(load(item).byId('github'), null, 'no client id: not offered');
  assert.equal(load({ ...item, clientId: 'abc' }).byId('github')?.how, 'device');
  assert.throws(() => load({ ...item, deviceUrl: 'http://github.com/login/device/code' }), /deviceUrl must be https/);
  assert.throws(() => load({ ...item, tokenUrl: undefined }), /tokenUrl must be an address/);
  assert.throws(() => load({ ...item, clientId: undefined }), /clientId/);
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
