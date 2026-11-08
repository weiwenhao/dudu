import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCatalog } from '../host/assistant/home/session-catalog.mjs';

test('lookup for takeover preserves the same renamed title and project shown for a linked conversation', async () => {
  const native = { key: 'claude:native', id: 'native', provider: 'claude', title: 'Old title', cwd: '/work/app', updatedAt: 1, dshSessionId: 'loaded' };
  const local = { key: 'dsh:loaded', id: 'loaded', provider: 'dsh', title: 'Renamed task', cwd: native.cwd, updatedAt: 2, dshSessionId: 'loaded', workspaceId: 'ws', project: { name: 'Customer App', path: native.cwd } };
  const catalog = createSessionCatalog({
    native: { describe: async () => native, list: async () => ({ sessions: [native], providers: [] }) },
    dsh: { catalog: async () => [local] },
  });
  const listed = await catalog.list();
  const selected = await catalog.get({ provider: 'claude', id: native.id });
  assert.equal(listed.sessions.length, 1);
  assert.deepEqual(selected, listed.sessions[0]);
  assert.equal(selected.title, local.title);
  assert.deepEqual(selected.project, local.project);
  assert.equal(selected.provider, 'claude');
});

test('a native conversation remains available when the current DSH catalog cannot be read', async () => {
  const native = { key: 'codex:native', id: 'native', provider: 'codex', title: 'Task', updatedAt: 1, dshSessionId: 'loaded' };
  const catalog = createSessionCatalog({
    native: { describe: async () => native, list: async () => ({ sessions: [native] }) },
    dsh: { catalog: async () => { throw new Error('Unavailable'); } },
  });
  assert.deepEqual(await catalog.get({ provider: 'codex', id: 'native' }), native);
  assert.equal((await catalog.list()).sessions[0].key, native.key);
});

test('a list deadline preserves the ready source while explicit cancellation still aborts the read', async () => {
  const slow = Promise.withResolvers();
  const row = { key: 'dsh:ready', id: 'ready', provider: 'dsh', dshSessionId: 'ready', title: 'Ready', updatedAt: 1 };
  const catalog = createSessionCatalog({
    native: { list: () => slow.promise },
    dsh: { catalog: () => [row] },
  });
  const deadline = new AbortController();
  const listing = catalog.list({}, { signal: deadline.signal });
  // Settle the ready source's promise callbacks without a real timer.
  await Promise.resolve();
  await Promise.resolve();
  deadline.abort(new DOMException('Read deadline', 'TimeoutError'));
  slow.resolve({ sessions: [], providers: [] });
  const result = await listing;
  assert.equal(result.sessions[0].key, row.key);
  assert.equal(result.unavailable, true);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(catalog.list({}, { signal: cancelled.signal }), { name: 'AbortError' });
});

test('a row whose session an issue already manages carries that issue, found by the DSH id or by the native key', async () => {
  const claude = { key: 'claude:a', id: 'a', provider: 'claude', title: 'Taken over', updatedAt: 3, dshSessionId: 'loaded' };
  const codex = { key: 'codex:b', id: 'b', provider: 'codex', title: 'Taken before it was loaded', updatedAt: 2 };
  const plain = { key: 'claude:c', id: 'c', provider: 'claude', title: 'Nobody manages it', updatedAt: 1 };
  const asked: string[] = [];
  const catalog = createSessionCatalog({
    native: { describe: async () => null, list: async () => ({ sessions: [claude, codex, plain] }) },
    dsh: { catalog: async () => [] },
    issues: { findBySession: (key: string) => { asked.push(key); return { issue: { dsh: { id: 7, ref: 'DOC-1' }, 'codex:b': { id: 9, ref: 'APP-4' } }[key === 'dsh:loaded' ? 'dsh' : key] ?? null }; } },
  });
  const { sessions } = await catalog.list();
  assert.deepEqual(sessions.map((session: any) => session.issue ?? null), [{ id: 7, ref: 'DOC-1' }, { id: 9, ref: 'APP-4' }, null]);
  assert.ok(asked.includes('dsh:loaded') && asked.includes('codex:b'));
  // Without an issues library the list is what it was.
  const alone = createSessionCatalog({ native: { describe: async () => null, list: async () => ({ sessions: [claude] }) }, dsh: { catalog: async () => [] } });
  assert.equal('issue' in (await alone.list()).sessions[0], false);
});

test('previews read the original store without catalog searches, importing, synchronization or repair', async () => {
  const calls: string[] = [];
  const page = { outcome: 'success', messages: [{ role: 'assistant', text: 'Preview' }], nextCursor: null };
  const controller = new AbortController();
  const catalog = createSessionCatalog({
    native: {
      read: async (input: any, options: any) => { calls.push(`native:${input.provider}:${input.id}:${input.before}`); assert.equal(options.signal, controller.signal); return page; },
      describe: async () => { throw new Error('A preview must not describe or synchronize the session'); },
      sync: async () => { throw new Error('A preview must not mutate stored sessions'); },
    },
    dsh: {
      catalog: async () => { throw new Error('An id is not a content query'); },
      read: async (key: string, options: any) => { calls.push(key); assert.equal(options.signal, controller.signal); return page; },
    },
  });
  assert.deepEqual(await catalog.read({ provider: 'claude', id: 'original', before: 120 }, { signal: controller.signal }), page);
  assert.deepEqual(await catalog.read({ provider: 'codex', id: 'thread' }, { signal: controller.signal }), page);
  assert.deepEqual(await catalog.read({ provider: 'dsh', id: 'loaded' }, { signal: controller.signal }), page);
  assert.deepEqual(calls, ['native:claude:original:120', 'native:codex:thread:undefined', 'dsh:loaded']);
});

test('a query locates an older exact passage across pages, and explicit cursors still read only one page', async () => {
  const calls: unknown[] = [];
  const query = 'Hi Shreyas, the read-only MySQL';
  const catalog = createSessionCatalog({
    native: { read: async (input: any) => {
      calls.push(input);
      return input.before === 20
        ? { outcome: 'success', messages: [{ role: 'assistant', text: `${query} access is set up.` }], nextCursor: 10 }
        : { outcome: 'success', messages: [{ role: 'user', text: 'redshift and mysql' }], nextCursor: 20 };
    } },
    dsh: {},
  });
  const found = await catalog.read({ provider: 'claude', id: 'original', query });
  assert.equal(found.matchIndex, 0);
  assert.ok(found.messages[0].text.includes(query));
  assert.equal(calls.length, 2);
  const earlier = await catalog.read({ provider: 'claude', id: 'original', before: 20, query });
  assert.equal(earlier.nextCursor, 10);
  assert.equal(calls.length, 3, 'pagination is never turned into another full search');
  assert.equal((await catalog.read({ provider: 'dsh', id: 'dudu-assistant-private', query })).code, 'invalid_session');
  assert.equal((await catalog.read({ provider: 'claude', id: 'original', before: -1 })).code, 'invalid_session');
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(catalog.read({ provider: 'claude', id: 'original', query }, { signal: stopped.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 3);
});
