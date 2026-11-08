import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationEvidence, previewMessages, textMatch } from '../host/conversation-search.mjs';
import { previewCache } from '../host/dudu-plugin/ui/sessions/preview-cache.js';
import { sessionReader } from '../host/dudu-plugin/ui/sessions/session-reader.js';
import { createCachedContentIndex } from '../host/providers/native/cached-content-index.mjs';

const query = 'Hi Shreyas, the read-only MySQL';

test('conversation evidence prefers the exact phrase over an incidental short substring in the other role', () => {
  const hit = conversationEvidence({
    user: 'Please use redshift.',
    assistant: `${'Earlier context. '.repeat(40)}\n${query} access is set up.`,
  }, query);
  assert.equal(hit.role, 'assistant');
  assert.equal(hit.exact, true);
  assert.ok(hit.text.includes(query));
  assert.equal(textMatch('Hi\nShreyas, the read-only MySQL', query)?.exact, true);
  assert.equal(textMatch('Only redshift and MySQL occur here.', query)?.length, 'mysql'.length);
});

test('a bounded preview keeps a deep match while ordinary browsing retains the message prefix', () => {
  const messages = [{ role: 'assistant', text: `${'x'.repeat(7000)}\n${query} access is set up.` }];
  const ordinary = previewMessages(messages);
  const found = previewMessages(messages, query);
  assert.equal(ordinary.messages[0].text.length, 4000);
  assert.equal(ordinary.messages[0].text.includes(query), false);
  assert.equal(found.matchIndex, 0);
  assert.ok(found.messages[0].text.includes(query));
  assert.ok(found.messages[0].text.length <= 4000);
  assert.ok(messages[0].text.startsWith('x'.repeat(7000)), 'previewing never changes the original message');
});

test('preview caches keep a search passage separate from ordinary browsing and another query', () => {
  const source = () => {};
  const cache = previewCache(source);
  const session = { provider: 'claude', id: 'one', updatedAt: 1 };
  cache.set(session, { messages: ['latest'] });
  cache.set({ ...session, query }, { messages: ['matching passage'] });
  assert.deepEqual(cache.get(session).messages, ['latest']);
  assert.deepEqual(cache.get({ ...session, query }).messages, ['matching passage']);
  assert.equal(cache.get({ ...session, query: 'another query' }), null);
});

test('preview identity survives widget remounts but cannot cross request sources', async () => {
  const calls: unknown[][] = [];
  const request = async (...args: unknown[]) => { calls.push(args); return {}; };
  const first = sessionReader(request);
  const session = { provider: 'codex', id: 'one', updatedAt: 1 };
  const value = { messages: ['cached page'] };
  previewCache(first).set(session, value);
  const reopened = sessionReader(request);
  assert.equal(previewCache(reopened).get(session), value);
  assert.equal(previewCache(sessionReader(async () => ({}))).get(session), null);
  await reopened({ provider: 'codex', id: 'one', before: 20 });
  assert.deepEqual(calls[0], ['sessions/read', { provider: 'codex', id: 'one', before: 20 }, undefined]);
});

test('preview reuse follows the stored source version rather than a wall clock expiry', (t) => {
  let now = 1;
  t.mock.method(Date, 'now', () => now);
  const source = () => {};
  const cache = previewCache(source);
  const session = { provider: 'claude', id: 'one', updatedAt: 1, previewVersion: 'v1' };
  const value = { messages: ['cached'] };
  cache.set(session, value);
  now += 10 * 60_000;
  assert.equal(cache.get(session), value);
  const changed = { ...session, previewVersion: 'v2' };
  assert.equal(cache.get(changed), null, 'a completed database update must replace the old page');
  assert.equal(cache.latest(changed), value, 'the visible page remains usable during that read');
  assert.equal(cache.latest({ ...changed, query: 'different passage' }), null);
  assert.equal(previewCache(() => {}).get(session), null, 'another data source never shares the page');
});

test('ordered SQLite previews backfill search-only records and preserve every page across restart and deletion', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-preview-cache-'));
  const file = join(folder, 'search.sqlite');
  const messages = Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', at: 1000 + i, text: `message ${i}` }));
  messages[3].text = `${'x'.repeat(7000)}\n${query}`;
  let cache = createCachedContentIndex({ file });
  t.after(async () => { await cache.close(); await rm(folder, { recursive: true, force: true }); });
  await cache.ready;
  cache.set('one', 'v1', { user: 'legacy user text', assistant: 'legacy reply' });
  await cache.flush();
  assert.equal(await cache.page('one'), null, 'role-separated search text cannot be reconstructed as a conversation');
  cache.set('one', 'v2', {
    user: messages.filter((m) => m.role === 'user').map((m) => m.text).join('\n'),
    assistant: messages.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n'),
    messages,
  });
  await cache.close();
  cache = createCachedContentIndex({ file });
  await cache.ready;
  assert.equal(cache.messageStamp('one'), 'v2');
  const latest = await cache.page('one');
  assert.deepEqual(latest.messages, messages.slice(25));
  const earlier = await cache.page('one', { before: latest.nextCursor });
  assert.deepEqual(earlier.messages, messages.slice(5, 25));
  const oldest = await cache.page('one', { before: earlier.nextCursor, query });
  assert.equal(oldest.messages.length, 5);
  assert.equal(oldest.nextCursor, null);
  assert.equal(oldest.matchIndex, 3);
  assert.ok(oldest.messages[3].text.includes(query));
  assert.ok(oldest.messages[3].text.length <= 4000);
  cache.delete('one');
  await cache.flush();
  assert.equal(await cache.page('one'), null);
  assert.equal(cache.messageStamp('one'), undefined);
});
