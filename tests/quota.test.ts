import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseClaudeUsage, readClaudeQuota, resetTime } from '../host/providers/quota/claude.mjs';
import { codexReading, paidUntil, readCodexQuota } from '../host/providers/quota/codex.mjs';
import { createKeyReader, createKeyResolver } from '../host/providers/quota/deepseek.mjs';
import { harnessQuotaSources } from '../host/providers/quota/index.mjs';
import { createQuota, FLOOR } from '../host/providers/quota/service.mjs';
import { createQuotaStore } from '../host/providers/quota/store.mjs';

// The quota: how each source is read (Claude's `/usage`, ChatGPT's usage endpoint, a DeepSeek key's balance), and the rule that a source is asked for at most once in the floor (15 minutes) and only when somebody asks.

// What `claude -p /usage` printed for the owner on 2026-11-11 (the first line is a warning that mentions signing in again: it is no sign that the reading failed).
const USAGE = `Warning: this sign-in ends between 2026-11-14 and 2026-11-17 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then, or use claude setup-token for unattended jobs.

You are currently using your subscription to power your Claude Code usage

Current session: 21% used · resets Nov 11 at 3:39pm (Asia/Shanghai)
Current week (all models): 23% used · resets Nov 17 at 1:59am (Asia/Shanghai)
Current week (Fable): 0% used · resets Nov 17 at 2am (Asia/Shanghai)

What's contributing to your usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 2338 requests · 12 sessions
  95%  Start fresh when you switch tasks · run /clear
Last 7d · 403 requests · 388 sessions
`;
const NOW = Date.UTC(2026, 10, 11, 6, 0); // 14:00 in Shanghai

test('/usage is read into the two windows every plan has, a model\'s week only once somebody used it, and the times are read in the zone /usage names', () => {
  const parsed = parseClaudeUsage(USAGE, { now: NOW });
  assert.equal(parsed.kind, 'windows');
  assert.deepEqual(parsed.windows.map((window: any) => [window.key, window.label, window.used, window.core]), [['five_hour', '5 小时', 0.21, true], ['seven_day', '每周', 0.23, true]]);
  assert.equal(parsed.windows[0].resetsAt, Date.UTC(2026, 10, 11, 7, 39), '3:39pm in Asia/Shanghai');
  assert.equal(parsed.windows[1].resetsAt, Date.UTC(2026, 10, 16, 17, 59), 'Nov 17 1:59am in Asia/Shanghai');
  const used = parseClaudeUsage(USAGE.replace('Fable): 0%', 'Fable): 12%'), { now: NOW });
  assert.deepEqual(used.windows.map((window: any) => [window.label, window.core]), [['5 小时', true], ['每周', true], ['Fable 每周', false]]);
  assert.equal(parseClaudeUsage('Current session: 5% used', { now: NOW }).windows[0].resetsAt, undefined, 'a window with no reset says none');
});

test('a /usage with no figure is a sign-in that is gone or a reading that did not work, and the counts it closes with are no HTTP status', () => {
  assert.equal(parseClaudeUsage('Error: not logged in · run /login', { now: NOW }).kind, 'login');
  assert.equal(parseClaudeUsage('Claude Code: /usage is temporarily unavailable', { now: NOW }).kind, 'unavailable');
  assert.equal(parseClaudeUsage('You are currently using your subscription\nLast 7d · 403 requests · 388 sessions', { now: NOW }).kind, 'unavailable');
});

test('a reset that names a time and a date is placed in the year that fits, and a time alone is the next one', () => {
  assert.equal(resetTime('Dec 31 at 11pm (UTC)', Date.UTC(2027, 0, 1, 1, 0), 7 * 24 * 3_600_000), Date.UTC(2026, 11, 31, 23, 0), 'Dec 31 read just after New Year is last year\'s');
  assert.equal(resetTime('3pm (Asia/Shanghai)', NOW, 5 * 3_600_000), Date.UTC(2026, 10, 11, 7, 0));
  assert.equal(resetTime('1am (Asia/Shanghai)', NOW, 7 * 24 * 3_600_000), Date.UTC(2026, 10, 11, 17, 0), 'the next 1am is tomorrow\'s');
  assert.ok((resetTime('1am (Asia/Shanghai)', NOW, 5 * 3_600_000) as number) < NOW, 'a 5-hour window cannot end eleven hours from now: it has started over already');
  assert.equal(resetTime('soon', NOW, 3_600_000), undefined);
});

test('Claude is read with `/usage` and `auth status` (the plan), without what makes it answer as paid by use; a signed-out account says login', async () => {
  const calls: { args: string[]; env: Record<string, string | undefined> }[] = [];
  const run = (answers: Record<string, { stdout: string; stderr?: string }>) => async (_command: string, args: string[], options: { env: Record<string, string | undefined> }) => {
    calls.push({ args, env: options.env });
    const answer = answers[args[0] === 'auth' ? 'status' : 'usage'];
    return { code: 0, stdout: answer.stdout, stderr: answer.stderr ?? '' };
  };
  const reading = await readClaudeQuota({
    command: 'claude', environment: () => ({ HERDR_PANE: null }), now: () => NOW,
    run: run({ status: { stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }) }, usage: { stdout: USAGE } }) as never,
  });
  assert.equal(reading.state, 'ok');
  assert.equal(reading.plan, 'Max');
  assert.deepEqual(calls.map((call) => call.args).sort(), [['-p', '/usage', '--no-session-persistence'], ['auth', 'status', '--json']], 'a reading must not be kept as a conversation in the owner\'s Claude folder');
  assert.ok(calls.every((call) => !('ANTHROPIC_API_KEY' in call.env) || call.env.ANTHROPIC_API_KEY === undefined), 'a key in the environment would make Claude Code answer as paid by use');
  const out = await readClaudeQuota({ command: 'claude', run: run({ status: { stdout: JSON.stringify({ loggedIn: false }) }, usage: { stdout: '' } }) as never });
  assert.equal(out.state, 'login');
  await assert.rejects(() => readClaudeQuota({ command: 'claude', run: run({ status: { stdout: '{}' }, usage: { stdout: 'nothing useful' } }) as never }), /no usage figures/);
});

test('a Claude Code that does not know --no-session-persistence is asked again without it, so the reading still works', async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'auth') return { code: 0, stdout: '{}', stderr: '' };
    if (args.includes('--no-session-persistence')) return { code: 1, stdout: '', stderr: "error: unknown option '--no-session-persistence'" };
    return { code: 0, stdout: USAGE, stderr: '' };
  };
  const reading = await readClaudeQuota({ command: 'claude', now: () => NOW, run: run as never });
  assert.equal(reading.state, 'ok');
  assert.deepEqual(calls.filter((args) => args[0] === '-p'), [['-p', '/usage', '--no-session-persistence'], ['-p', '/usage']]);
});

// ---- ChatGPT: the usage endpoint, with the token Codex keeps

const jwt = (payload: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
const ANSWER = {
  plan_type: 'plus', rate_limit: {
    primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1_793_263_787, reset_after_seconds: 3000 },
    secondary_window: { used_percent: 48, limit_window_seconds: 604800, reset_after_seconds: 400_000 },
  },
};

test('the ChatGPT answer is read into a 5-hour and a weekly window by how long each is', () => {
  const reading = codexReading(ANSWER, 1_000_000);
  assert.equal(reading.plan, 'Plus');
  assert.deepEqual(reading.windows.map((window: any) => [window.label, window.used, window.core]), [['5 小时', 0.12, true], ['每周', 0.48, true]]);
  assert.equal(reading.windows[0].resetsAt, 1_793_263_787_000);
  assert.equal(reading.windows[1].resetsAt, 1_000_000 + 400_000_000, 'a reset told as seconds from now is counted from now');
  assert.throws(() => codexReading({ plan_type: 'plus', rate_limit: {} }), /no window/);
});

test('ChatGPT is asked with the token Codex keeps, which is only read: an expired one, no file and no token are a sign-in that has ended, and the token goes nowhere but the one URL', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dudu-quota-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authFile = join(root, 'auth.json');
  const now = 1_790_000_000_000;
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const send = (status = 200) => async (url: string, init: { headers: Record<string, string> }) => { sent.push({ url, headers: init.headers }); return new Response(JSON.stringify(ANSWER), { status }); };
  const read = (extra: Record<string, unknown> = {}) => readCodexQuota({ authFile, fetch: send() as never, now: () => now, version: '0.162.0', ...extra });

  assert.equal((await read()).state, 'login', 'no file: Codex has no sign-in here');
  await writeFile(authFile, JSON.stringify({ tokens: { access_token: jwt({ exp: now / 1000 - 60 }), account_id: 'acct-1' } }));
  assert.equal((await read()).state, 'login', 'an expired token is not renewed here: Codex renews it as it runs');
  await writeFile(authFile, JSON.stringify({ OPENAI_API_KEY: 'sk-test' }));
  assert.equal((await read()).state, 'login', 'an API-key sign-in has no plan');
  assert.equal(sent.length, 0, 'nothing was sent for any of those');

  await writeFile(authFile, JSON.stringify({ tokens: { access_token: jwt({ exp: now / 1000 + 3600 }), account_id: 'acct-1' } }));
  const reading = await read();
  assert.equal(reading.state, 'ok');
  assert.deepEqual(sent.map((call) => call.url), ['https://chatgpt.com/backend-api/wham/usage']);
  assert.equal(sent[0].headers['chatgpt-account-id'], 'acct-1');
  assert.match(sent[0].headers.authorization, /^Bearer /);
  assert.equal((await read({ fetch: send(401) as never })).state, 'login', 'a token ChatGPT refuses is a sign-in that has ended');
  await assert.rejects(() => read({ fetch: send(500) as never }), /answered 500/);
  assert.equal(JSON.parse(await (await import('node:fs/promises')).readFile(authFile, 'utf8')).tokens.account_id, 'acct-1', 'the file is left as it was');
});

test('when the plan\'s paid time ends is what the sign-in\'s token says while it is ahead, and the view leaves it out once it has passed', async (t) => {
  const now = 1_790_000_000_000;
  const claim = (iso: string) => jwt({ 'https://api.openai.com/auth': { chatgpt_subscription_active_until: iso } });
  assert.equal(paidUntil({ id_token: claim('2026-11-24T14:02:23+00:00') }, Date.parse('2026-11-11T05:00:00Z')), Date.parse('2026-11-24T14:02:23Z'));
  assert.equal(paidUntil({ id_token: claim('2026-11-24T14:02:23+00:00') }, Date.parse('2026-11-25T00:00:00Z')), undefined, 'a date gone by (the token was not refreshed since) says nothing of now');
  assert.equal(paidUntil({ id_token: 'x', access_token: claim('2026-11-24T14:02:23+00:00') }, Date.parse('2026-11-11T05:00:00Z')), Date.parse('2026-11-24T14:02:23Z'), 'the access token says it too');
  assert.equal(paidUntil({}, now), undefined);
  assert.equal(paidUntil({ id_token: claim('not a date') }, now), undefined);

  const { quota, tick } = await setup(t, [{ id: 'codex', agent: 'codex', name: 'ChatGPT', read: async () => ({ ...ok, until: 1_790_000_000_000 + 3 * 86_400_000 }) }]);
  await quota.request({ ask: true }); await quota.settled();
  assert.equal((await quota.request()).providers[0].until, 1_790_000_000_000 + 3 * 86_400_000);
  tick(4 * 86_400_000);
  const later = (await quota.request()).providers[0];
  assert.equal(later.until, undefined, 'the date has passed: it is not shown, the numbers still are');
  assert.equal(later.windows.length, 1);
});

// ---- DeepSeek: the balance of an API key

test('the DeepSeek key is found as DSH finds a provider\'s key and its balance is read from api.deepseek.com only; no key, no row', async () => {
  const profile = { apiKeyEnv: 'DEEPSEEK_API_KEY' };
  const found: string[] = [];
  const resolve = createKeyResolver({
    providers: () => [{ provider: 'deepseek-account' }, { provider: 'deepseek-official', settingsNs: 'llm', settingsPath: ['deepseek', 'profile'] }],
    settings: () => ({ describe: () => [{ ns: 'llm', value: { deepseek: { profile } } }] }),
    credentials: () => ({ resolve: async (ref: string) => { found.push(ref); return { value: 'sk-secret', source: 'store' }; } }),
  });
  assert.equal(await resolve(), 'sk-secret');
  assert.deepEqual(found, ['DEEPSEEK_API_KEY']);
  assert.equal(await createKeyResolver({ providers: () => [{ provider: 'deepseek-account' }], settings: () => ({ describe: () => [] }), credentials: () => ({ resolve: async () => undefined }) })(), undefined, 'no such provider');
  assert.equal(await createKeyResolver({ providers: () => undefined, settings: () => undefined, credentials: () => undefined })(), undefined, 'a DSH without the services');

  const sent: string[] = [];
  const body = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] };
  const send = (status = 200) => async (url: string, init: { headers: Record<string, string> }) => { sent.push(`${url} ${init.headers.authorization}`); return new Response(JSON.stringify(body), { status }); };
  const read = (key: string | undefined, status = 200) => createKeyReader({ resolveKey: async () => key, fetch: send(status) as never })({});
  assert.deepEqual(await read('sk-secret'), { state: 'ok', plan: 'API', kind: 'balance', balance: [{ text: '¥110.00' }] });
  assert.deepEqual(sent, ['https://api.deepseek.com/user/balance Bearer sk-secret']);
  assert.deepEqual(await read(undefined), { state: 'none' });
  assert.deepEqual(await read('sk-secret', 401), { state: 'login' });
  await assert.rejects(() => read('sk-secret', 500), /answered 500/);
});

// ---- the service: at most once in the floor, only when asked, and what is shown

const MINUTE = 60_000;
function setup(t: { after: (cleanup: () => Promise<void>) => void }, sources: any[]) {
  let clock = 1_790_000_000_000;
  const folderPromise = mkdtemp(join(tmpdir(), 'dudu-quota-'));
  return folderPromise.then((root) => {
    t.after(async () => { await rm(root, { recursive: true, force: true }); });
    const store = createQuotaStore(join(root, 'quota.db'));
    const quota = createQuota({ store, sources: () => sources, now: () => clock, log: { warn() {} } });
    t.after(async () => { quota.close(); });
    return { quota, tick: (ms: number) => { clock += ms; }, store };
  });
}
const ok = { state: 'ok', plan: 'Max', windows: [{ key: 'five_hour', label: '5 小时', used: 0.2, core: true }] };

test('a source is asked for only when somebody asks, and at most once in the floor, a failed ask included; what it last said is kept and shown with its time', async (t) => {
  const asked = { a: 0 };
  let answer: () => unknown = () => ok;
  const { quota, tick } = await setup(t, [{ id: 'a', agent: 'a', name: 'A', read: async () => { asked.a++; return answer(); } }]);
  assert.deepEqual(await quota.request(), { providers: [], refreshing: false, readAt: null }, 'looking is not asking: nothing is read, nothing is shown yet');
  assert.equal(asked.a, 0);

  const first = await quota.request({ ask: true });
  assert.equal(first.refreshing, true, 'the answer does not wait for the reading');
  await quota.settled();
  const shown = await quota.request();
  assert.deepEqual(shown.providers.map((p: any) => [p.id, p.plan, p.windows.length]), [['a', 'Max', 1]]);
  assert.equal(shown.refreshing, false);
  assert.equal(shown.readAt, 1_790_000_000_000);

  tick(FLOOR - MINUTE); await quota.request({ ask: true }); await quota.settled();
  assert.equal(asked.a, 1, 'a minute short of the floor: it holds however often somebody asks');
  tick(2 * MINUTE); answer = () => { throw new Error('the server did not answer'); };
  await quota.request({ ask: true }); await quota.settled();
  assert.equal(asked.a, 2);
  const kept = await quota.request();
  assert.equal(kept.providers.length, 1, 'a reading that failed leaves the one that worked');
  assert.equal(kept.readAt, 1_790_000_000_000, 'and its time, so the panel can say how old it is');
  tick(5 * MINUTE); await quota.request({ ask: true }); await quota.settled();
  assert.equal(asked.a, 2, 'the failed ask counts for the floor too');
});

test('a source whose sign-in is gone or that has nothing to read is not shown, asks that come together read once, and the card can wait for the readings', async (t) => {
  let state: any = { state: 'login' };
  let reads = 0;
  const gate = Promise.withResolvers<void>();
  const { quota, tick } = await setup(t, [
    { id: 'gone', agent: 'gone', name: 'Gone', read: async () => state },
    { id: 'none', agent: 'none', name: 'None', read: async () => ({ state: 'none' }) },
    { id: 'slow', agent: 'slow', name: 'Slow', read: async () => { reads++; await gate.promise; return ok; } },
  ]);
  const [one, two] = await Promise.all([quota.request({ ask: true }), quota.request({ ask: true })]);
  assert.equal(reads, 1, 'two people asking at once start one reading');
  assert.equal(one.refreshing && two.refreshing, true);
  const waiting = quota.request({ ask: true, wait: true });
  gate.resolve();
  const done = await waiting;
  assert.deepEqual(done.providers.map((p: any) => p.id), ['slow'], 'a sign-in that is gone, and a source with nothing to read, are not shown');
  state = ok; tick(FLOOR + MINUTE);
  await quota.request({ ask: true }); await quota.settled();
  assert.deepEqual((await quota.request()).providers.map((p: any) => p.id), ['gone', 'slow'], 'signed in again: it is shown once it has been read');
  state = { state: 'login' }; tick(FLOOR + MINUTE);
  await quota.request({ ask: true }); await quota.settled();
  assert.deepEqual((await quota.request()).providers.map((p: any) => p.id), ['slow'], 'and gone again when the sign-in ends: the old numbers are not left to hide that');
});

test('the sources are the providers that are found and enabled and say how their quota is read; none is named here', async () => {
  const read = async () => ok;
  const listed = harnessQuotaSources([
    { id: 'claude', name: 'Claude', command: 'claude', environment: () => ({}), driver: { quota: read } },
    { id: 'pi', name: 'Pi', command: 'pi', environment: () => ({}), driver: { quota: read } },
    { id: 'mute', name: 'Mute', command: 'mute', driver: {} },
  ] as never);
  assert.deepEqual(listed.map((source: any) => [source.id, source.agent, source.name]), [['claude', 'claude', 'Claude'], ['pi', 'pi', 'Pi']], 'a provider with no quota reader is left out, a new one needs nothing else');
});

test('a quota file of another version is made again, and a row that cannot be read is no reading', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dudu-quota-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { DatabaseSync } = await import('node:sqlite');
  const file = join(root, 'quota.db');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE readings (source TEXT, other TEXT); INSERT INTO readings VALUES ('a', 'x'); PRAGMA user_version=99;");
  old.close();
  const store = createQuotaStore(file);
  assert.equal(store.get('a'), undefined);
  store.begin('a', 5); store.succeed('a', 6, ok);
  assert.deepEqual(store.get('a'), { source: 'a', triedAt: 5, readAt: 6, state: 'ok', data: ok });
  store.clear('a', 'login');
  assert.deepEqual(store.get('a'), { source: 'a', triedAt: 5, readAt: null, state: 'login', data: null });
  store.close();
});
