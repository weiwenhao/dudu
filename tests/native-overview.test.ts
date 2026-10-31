import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRunningClaude, summarizeRunning } from '../host/providers/native/running.mjs';
import { codexLimitsView, createOverview, usageView, windowView } from '../host/providers/native/overview.mjs';

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

// ---- usage and the service -------------------------------------------------------------------------------------------

const claudeSnapshot = {
  kind: 'available', plan: 'team', rateLimited: false,
  windows: [
    { label: 'Current week (Fable)', usedRatio: 0, resetsAt: '2026-11-02T18:00:00.000Z', id: 'model_scoped:Fable', durationMs: 604800000 },
    { label: 'Current week (all models)', usedRatio: 0.334, resetsAt: '2026-11-02T18:00:00.272Z', id: 'seven_day', durationMs: 604800000 },
    { label: 'Current session', usedRatio: 0.14, resetsAt: '2026-10-29T09:00:00.272Z', id: 'five_hour', durationMs: 18000000 },
    { label: 'Current week (Opus)', usedRatio: 0.2, resetsAt: '2026-11-02T18:00:00.000Z', id: 'model_scoped:Opus', durationMs: 604800000 },
  ],
};

test('a usage reading is shown as short windows, the two every plan has first, and nothing nobody used', () => {
  const view = usageView({ id: 'claude', name: 'Claude' }, claudeSnapshot);
  assert.deepEqual([view.state, view.limited, view.plan], ['ok', false, 'Team']);
  assert.deepEqual(view.windows.map((window: any) => [window.label, Math.round(window.used * 100)]), [['5 小时', 14], ['每周', 33], ['Opus 每周', 20]]);
  assert.equal(view.windows[0].resetsAt, Date.parse('2026-10-29T09:00:00.272Z'));
  assert.deepEqual(usageView({ id: 'claude', name: 'Claude' }, { ...claudeSnapshot, rateLimited: true }).limited, true);
  assert.deepEqual(usageView({ id: 'codex', name: 'ChatGPT' }, { kind: 'unsupported', reason: 'unsupported_auth_mode' }), { id: 'codex', name: 'ChatGPT', state: 'hidden', plan: '', limited: false, windows: [] });
  assert.equal(usageView({ id: 'claude', name: 'Claude' }, { kind: 'reauth_required' }).state, 'login');
  assert.equal(windowView({ label: 'Daily budget', usedRatio: 5 }).used, 1, 'a ratio is kept within 0 to 1');
  assert.equal(windowView({ label: 'Odd', usedRatio: 0.5, resetsAt: 'never' }).resetsAt, undefined);
});

// What Codex answered to account/rateLimits/read on a real Team account (the numbers rounded).
const codexReply = {
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: 'codex', primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1793263787 }, secondary: { usedPercent: 6, windowDurationMins: 10080, resetsAt: 1793775118 },
    credits: { hasCredits: false, unlimited: false, balance: null }, spendControlReached: false, planType: 'team', rateLimitReachedType: null,
  },
};

test('Codex\'s own limits are shown the way Claude\'s are, with the plan, and a reached limit is marked', () => {
  const source = { id: 'codex', name: 'ChatGPT' };
  const view = codexLimitsView(source, codexReply);
  assert.deepEqual([view.state, view.plan, view.limited], ['ok', 'Team', false]);
  assert.deepEqual(view.windows.map((window: any) => [window.label, Math.round(window.used * 100), window.resetsAt]), [['5 小时', 1, 1793263787000], ['每周', 6, 1793775118000]]);
  assert.equal(codexLimitsView(source, { ...codexReply, rateLimits: { ...codexReply.rateLimits, rateLimitReachedType: 'primary' } }).limited, true);
  assert.equal(codexLimitsView(source, { ...codexReply, ordinaryUsageAllowed: false }).limited, true);
  assert.equal(codexLimitsView(source, { rateLimits: { ...codexReply.rateLimits, primary: { usedPercent: 40, windowDurationMins: 1440 }, secondary: null } }).windows[0].label, '1 天');
  assert.equal(codexLimitsView(source, {}).state, 'hidden');
});

function setupService(t: { after: (cleanup: () => Promise<void>) => void }, extra: Record<string, unknown> = {}, start = 1_000_000_000_000) {
  const calls = { usage: 0, codexLimits: 0 };
  let clock = start;
  const sources = [
    { id: 'claude', name: 'Claude', route: 'claude', activeRuns: () => [], driver: { accountUsage: async () => { calls.usage++; return claudeSnapshot; } } },
    { id: 'codex', name: 'ChatGPT', route: 'codex', command: 'codex', activeRuns: () => [{ route: 'codex', sessionId: 's1', nativeSessionId: 'thread-1', startedAt: clock - 5000, cwd: '/w/x' }], driver: { accountUsage: async () => ({ kind: 'unsupported' }) } },
  ];
  const links = { get: (provider: string, id: string) => (id === 'thread-1' ? 'session-1' : undefined) };
  const service = createOverview({
    sources: () => sources, links, titleOf: (_provider: string, id: string) => (id === 'thread-1' ? 'A Codex thread' : undefined), now: () => clock,
    codexLimits: async () => { calls.codexLimits++; return codexReply; },
    ...extra,
  });
  return { service, calls, sources, tick: (ms: number) => { clock += ms; } };
}

test('usage is read once in two minutes however often the page asks, Codex is asked directly when OAR cannot read it, and a failing harness is marked', async (t) => {
  const { service, calls, sources, tick } = setupService(t);
  const first = await service.usage();
  assert.deepEqual(first.providers.map((provider: any) => [provider.id, provider.state, provider.plan, provider.windows.length]), [['claude', 'ok', 'Team', 3], ['codex', 'ok', 'Team', 2]],
    'OAR says Codex is unsupported here (a custom model provider hides the account), its own limits call still answers');
  await service.usage(); await service.usage();
  assert.deepEqual([calls.usage, calls.codexLimits], [1, 1]);
  tick(121_000);
  const stale = await service.usage();
  assert.deepEqual(stale, first, 'the last reading is shown while a new one is taken');
  await service.settled();
  assert.deepEqual([calls.usage, calls.codexLimits], [2, 2]);
  sources[0].driver.accountUsage = async () => { throw new Error('the harness did not answer'); };
  const failed = await service.usage({ refresh: true });
  assert.equal(failed.providers[0].state, 'unavailable');
  assert.equal(failed.providers[1].state, 'ok', 'one harness failing leaves the other');
});

test('running: the registry and DSH\'s own runs, named by the sessions list, over the HTTP face', async (t) => {
  const root = await folder(t);
  await writeFile(join(root, '1.json'), JSON.stringify({ pid: process.pid, sessionId: 'claude-1', cwd: '/w/a', status: 'busy', statusUpdatedAt: 1_000_000_000_000 - 60_000, updatedAt: 1_000_000_000_000 }));
  const { service } = setupService(t, { claude: { registry: root } });
  const running = await service.running();
  assert.deepEqual(running.busy.map((item: any) => [item.provider, item.id, item.title, item.dshSessionId]), [['claude', 'claude-1', '', undefined], ['codex', 'thread-1', 'A Codex thread', 'session-1']]);
  const post = (action: string) => service.handle(action, new Request('http://x/api', { method: 'POST', body: '{}' }));
  const reply = await post('running');
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).busy.length, 2);
  assert.equal((await post('usage')).status, 200);
  assert.equal((await post('nothing')).status, 404);
});
