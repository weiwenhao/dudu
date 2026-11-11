import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRunningClaude, summarizeRunning } from '../host/providers/native/running.mjs';
import { createOverview } from '../host/providers/native/overview.mjs';

async function folder(t: { after: (cleanup: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'dudu-overview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const MINUTE = 60_000;

// ---- running -------------------------------------------------------------------------------------------------------

test('the sessions running now are the live processes in Claude Code\'s registry, one for each session', async (t) => {
  const root = await folder(t);
  const entry = (pid: number, sessionId: string, extra: Record<string, unknown> = {}) => writeFile(join(root, `${pid}.json`), JSON.stringify({
    pid, sessionId, cwd: '/work/app', kind: 'interactive', name: `name-${pid}`, status: 'idle', startedAt: 1000, updatedAt: 2000, statusUpdatedAt: 3000, ...extra,
  }));
  await entry(1, 'busy-one', { status: 'busy' });
  await entry(2, 'idle-one');
  await entry(3, 'gone', { status: 'busy' });
  await entry(4, 'twice', { updatedAt: 5000, name: 'older' });
  await entry(5, 'twice', { updatedAt: 9000, name: 'newer' });
  await entry(6, 'background', { kind: 'bg' });
  await writeFile(join(root, '7.json'), '{not json');
  await writeFile(join(root, '8.abcdef.key'), 'secret');
  await writeFile(join(root, '9.json'), JSON.stringify({ sessionId: 'no-pid' }));
  const found = await listRunningClaude({ directory: root, alive: (pid: number) => pid !== 3 });
  const byId = Object.fromEntries(found.map((item: any) => [item.id, item]));
  assert.deepEqual(Object.keys(byId).sort(), ['background', 'busy-one', 'idle-one', 'twice']);
  assert.equal(byId['busy-one'].status, 'busy');
  assert.equal(byId['idle-one'].status, 'idle');
  assert.equal(byId['twice'].name, 'newer', 'the process that wrote last speaks for a session');
  assert.equal(byId['background'].background, true);
  assert.deepEqual([byId['busy-one'].cwd, byId['busy-one'].since, byId['busy-one'].provider], ['/work/app', 3000, 'claude']);
  assert.deepEqual(await listRunningClaude({ directory: join(root, 'missing') }), []);
});

test('what is running is split into working now, finished a moment ago, and idle; DSH\'s own Codex runs are added', () => {
  const now = 10_000_000;
  const claude = [
    { provider: 'claude', id: 'a', name: 'alpha', cwd: '/w/a', status: 'busy', since: now - 12 * MINUTE, updatedAt: now - MINUTE, background: false },
    { provider: 'claude', id: 'b', name: 'beta', cwd: '/w/b', status: 'idle', since: now - 3 * MINUTE, updatedAt: now - 3 * MINUTE, background: false },
    { provider: 'claude', id: 'c', name: 'gamma', cwd: '/w/c', status: 'idle', since: now - 3 * 3600_000, updatedAt: now - 3 * 3600_000, background: false },
    { provider: 'claude', id: 'd', name: 'delta', cwd: '/w/d', status: 'idle', since: now - MINUTE, updatedAt: now - MINUTE, background: true },
  ];
  const summary = summarizeRunning({
    claude, now,
    dshRuns: [
      { route: 'codex', nativeSessionId: 'x', startedAt: now - 30_000, cwd: '/w/x' },
      { route: 'claude', nativeSessionId: 'a', startedAt: now - MINUTE },          // already in the registry
      { route: 'codex', nativeSessionId: undefined, startedAt: now },              // not started yet
    ],
    titleOf: (provider: string, id: string) => (id === 'a' ? 'The title of alpha' : undefined),
    dshSessionOf: (provider: string, id: string) => (id === 'x' ? 'session-x' : undefined),
  });
  assert.deepEqual(summary.busy.map((item: any) => [item.id, item.title, item.status]), [['a', 'The title of alpha', 'busy'], ['x', '', 'busy']]);
  assert.deepEqual(summary.busy[1].dshSessionId, 'session-x');
  assert.deepEqual(summary.done.map((item: any) => [item.id, item.status, item.title]), [['b', 'done', 'beta']], 'finished minutes ago, named by the registry when nothing better is known');
  assert.deepEqual(summary.idle.map((item: any) => item.id), ['d', 'c'], 'long idle and background sessions are only counted');
  assert.equal(summary.total, 5);
});

test('running: the registry and DSH\'s own runs, named by the sessions list, over the HTTP face', async (t) => {
  const root = await folder(t);
  await writeFile(join(root, '1.json'), JSON.stringify({ pid: process.pid, sessionId: 'claude-1', cwd: '/w/a', status: 'busy', statusUpdatedAt: 1_000_000_000_000 - 60_000, updatedAt: 1_000_000_000_000 }));
  const sources = [
    { id: 'claude', name: 'Claude', route: 'claude', activeRuns: () => [] },
    { id: 'codex', name: 'ChatGPT', route: 'codex', activeRuns: () => [{ route: 'codex', sessionId: 's1', nativeSessionId: 'thread-1', startedAt: 1_000_000_000_000 - 5000, cwd: '/w/x' }] },
  ];
  const links = { get: (_provider: string, id: string) => (id === 'thread-1' ? 'session-1' : undefined) };
  const service = createOverview({
    sources: () => sources, links, titleOf: (_provider: string, id: string) => (id === 'thread-1' ? 'A Codex thread' : undefined), now: () => 1_000_000_000_000, claude: { registry: root },
  });
  const running = await service.running();
  assert.deepEqual(running.busy.map((item: any) => [item.provider, item.id, item.title, item.dshSessionId]), [['claude', 'claude-1', '', undefined], ['codex', 'thread-1', 'A Codex thread', 'session-1']]);
  const post = (action: string) => service.handle(action, new Request('http://x/api', { method: 'POST', body: '{}' }));
  const reply = await post('running');
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).busy.length, 2);
  assert.equal((await post('nothing')).status, 404);
});
