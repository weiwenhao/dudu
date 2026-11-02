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
