import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createOarProvider } from '../host/providers/oar.mjs';

// DSH's model catalog (and with it the phone's catalog.get) waits for every harness at once. A harness that cannot reach its
// servers takes ~24 s to give up (owner, 2026-11-24: Antigravity without a proxy), so the plugin must never make a menu wait for
// one: the list that was read is served at once, and asking for it never starts the harness (owner, 2026-11-27: with Claude selected,
// a menu must not wake Codex or Antigravity, and a reading of Antigravity's models left an empty conversation behind every time).

const FALLBACK = [{ id: 'default', displayName: 'Default' }];
const OLD = [{ id: 'opus', displayName: 'Opus' }];
const NEW = [{ id: 'opus', displayName: 'Opus' }, { id: 'sonnet', displayName: 'Sonnet' }];
const HOURS = 60 * 60_000;
const DAYS = 24 * HOURS;

/** A harness whose n-th model listing is what `answers[n]()` returns (a promise the test settles). `calls` says where each reading ran. */
function harness(answers: Array<() => Promise<any>>, modelsChanged?: () => void, extra: Record<string, unknown> = {}, create: Record<string, unknown> = {}) {
  let asked = 0;
  const calls: any[] = [];
  const runtime = { listModels: (_installation: any, options: any) => { calls.push(options); return answers[asked++](); } };
  const provider = createOarProvider({
    id: 'fake', name: 'Fake', runtime, binaryEnv: 'FAKE_BIN', tools: [], login: 'Sign in.', normalizer: () => ({}),
    fallbackModels: FALLBACK, scrub: { patterns: [] }, session: () => ({}), ...extra,
  } as any);
  const driver = provider.create({ installation: { kind: 'available', via: 'executable', command: '/bin/fake' }, modelsChanged, ...create } as any);
  return { driver, asked: () => asked, calls };
}
const ids = async (driver: any) => (await driver.listModels()).map((model: any) => model.id);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const ok = (models: any[]) => ({ kind: 'ok', models });
const fail = () => Promise.reject(new Error('offline'));
/** A session starts on the harness (the runtime has no session to give: only what comes before it matters). */
const startSession = (driver: any) => driver.start({ prompt: 'hi', cwd: tmpdir(), permission: 'danger-full-access', signal: new AbortController().signal }).catch(() => {});

test('a harness that cannot say does not hold the menu, and its late answer is there for the next ask', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const first = Promise.withResolvers<any>();
  const { driver, asked } = harness([() => first.promise]);
  const waiting = ids(driver);
  t.mock.timers.tick(3_000);
  assert.deepEqual(await waiting, ['default'], 'after the first ask has waited a little, the list the plugin knows');
  assert.deepEqual(await ids(driver), ['default'], 'and an ask in the meantime does not wait again');
  first.resolve(ok(NEW));
  await settle();
  assert.deepEqual(await ids(driver), ['opus', 'sonnet'], 'what the harness said when it was done');
  assert.equal(asked(), 1);
});

test('a list that was read is served as it is, however old: asking for it never starts a reading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const second = Promise.withResolvers<any>();
  const { driver, asked } = harness([() => Promise.resolve(ok(OLD)), () => second.promise]);
  assert.deepEqual(await ids(driver), ['opus']);
  t.mock.timers.tick(30 * DAYS);
  for (let i = 0; i < 5; i++) assert.deepEqual(await ids(driver), ['opus']);
  await settle();
  assert.equal(asked(), 1, 'asked for a month: the harness was started once');
  // Made stale on purpose (Settings > Providers, a changed setting): the next ask serves the old list at once and one reading starts, however many ask.
  driver.refreshModels();
  const [a, b] = await Promise.all([ids(driver), ids(driver)]);
  assert.deepEqual([a, b], [['opus'], ['opus']], 'the old list, without waiting for the reading');
  assert.equal(asked(), 2, 'two asks at the same time start one reading');
  second.resolve(ok(NEW));
  await settle();
  assert.deepEqual(await ids(driver), ['opus', 'sonnet']);
  assert.equal(asked(), 2, 'and the next ask starts nothing');
});

test('a session that starts reads a list that is older than its lifetime, in the background, and not before', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { driver, asked } = harness([() => Promise.resolve(ok(OLD)), () => Promise.resolve(ok(NEW))]);
  assert.deepEqual(await ids(driver), ['opus']);
  t.mock.timers.tick(5 * 60_000 - 1);
  await startSession(driver);
  await settle();
  assert.equal(asked(), 1, 'a session that starts within the five minutes leaves it as it is');
  t.mock.timers.tick(2);
  await startSession(driver);
  await settle();
  assert.equal(asked(), 2, 'one that starts after them reads it anew');
  assert.deepEqual(await ids(driver), ['opus', 'sonnet']);
});

test('a harness that fails to read again keeps what it said before', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { driver, asked } = harness([() => Promise.resolve(ok(OLD)), fail, () => Promise.resolve(ok(NEW))]);
  await ids(driver);
  driver.refreshModels();
  assert.deepEqual(await ids(driver), ['opus'], 'the old list while the failing reading runs');
  await settle();
  assert.equal(asked(), 2);
  t.mock.timers.tick(HOURS);
  assert.deepEqual(await ids(driver), ['opus']);
  assert.equal(asked(), 2, 'asking does not try again');
  await startSession(driver);
  await settle();
  assert.equal(asked(), 3, 'a session that starts once its wait is over does');
  assert.deepEqual(await ids(driver), ['opus', 'sonnet']);
});

test('settings saved while a reading is under way drop what it says', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const old = Promise.withResolvers<any>();
  const fresh = Promise.withResolvers<any>();
  const { driver, asked } = harness([() => Promise.resolve(ok(OLD)), () => old.promise, () => fresh.promise]);
  await ids(driver);
  driver.refreshModels();
  await ids(driver);
  driver.refreshModels();
  assert.deepEqual(await ids(driver), ['opus']);
  assert.equal(asked(), 3, 'read anew with the new settings');
  old.resolve(ok([{ id: 'stale', displayName: 'Stale' }]));
  await settle();
  assert.deepEqual(await ids(driver), ['opus'], 'what the old settings gave is not used');
  fresh.resolve(ok(NEW));
  await settle();
  assert.deepEqual(await ids(driver), ['opus', 'sonnet']);
});

// DSH's client keeps the first catalog it gets until it hears `llm/models-updated`: without the announcement a menu that was given the
// stand-in stays on "Default" for good (owner, 2026-11-24: Antigravity, whose listing now takes 11 s).
test('a list that replaces one DSH was given is announced, and only then', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const slow = Promise.withResolvers<any>();
  const told: string[] = [];
  const { driver } = harness([() => slow.promise, () => Promise.resolve(ok(NEW)), () => Promise.resolve(ok(NEW))], () => told.push('changed'));
  const waiting = ids(driver);
  t.mock.timers.tick(3_000);
  assert.deepEqual(await waiting, ['default'], 'the stand-in is what DSH was given');
  slow.resolve(ok(OLD));
  await settle();
  assert.deepEqual(told, ['changed'], 'the reading that ends after the stand-in went out is announced');
  assert.deepEqual(await ids(driver), ['opus'], 'and DSH, asking again, gets it');
  driver.refreshModels();
  await ids(driver);
  await settle();
  assert.deepEqual(told, ['changed', 'changed'], 'a model found by a later reading is announced');
  driver.refreshModels();
  await ids(driver);
  await settle();
  assert.deepEqual(told, ['changed', 'changed'], 'a reading that finds the same list is not');
});

test('a list that is read before anything was handed out is not announced', async () => {
  const told: string[] = [];
  const { driver } = harness([() => Promise.resolve(ok(OLD))], () => told.push('changed'));
  assert.deepEqual(await ids(driver), ['opus']);
  await settle();
  assert.deepEqual(told, []);
});

// 2026-11-27: a harness that has said nothing yet is the one asked again, and it was asked every minute.
/** Ask until the n-th reading, after each failure checking that nothing is read a moment before its wait is over and something is a moment after. */
async function waits(t: any, driver: any, asked: () => number, minutes: number[]) {
  await ids(driver);
  await settle();
  let reads = 1;
  for (const wait of minutes) {
    t.mock.timers.tick(wait * 60_000 - 1);
    await ids(driver);
    await settle();
    assert.equal(asked(), reads, `not asked before ${wait} minutes are over`);
    t.mock.timers.tick(2);
    await ids(driver);
    await settle();
    assert.equal(asked(), ++reads, `asked once ${wait} minutes are over`);
  }
}

test('a harness that has said nothing yet is asked after a minute, two, four... at most an hour', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { driver, asked } = harness(Array.from({ length: 10 }, () => fail), undefined, { modelsTtl: 6 * HOURS });
  await waits(t, driver, asked, [1, 2, 4, 8, 16, 32, 60, 60]);
  assert.deepEqual(await ids(driver), ['default'], 'what the plugin knows until the harness says');
});

test('a harness with the usual five minutes is never made to wait longer than that after a failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { driver, asked } = harness(Array.from({ length: 8 }, () => fail));
  await waits(t, driver, asked, [1, 2, 4, 5, 5]);
});

test('a harness that asks for it is read in a folder of its own, which is cleared after every reading', async () => {
  const cleared: any[] = [];
  const second = Promise.withResolvers<void>();
  const failing = harness([fail, () => Promise.resolve(ok(OLD))], undefined,
    { listingInFolder: true, listingCleanup: async (options: any) => { cleared.push(options); if (cleared.length === 2) second.resolve(); throw new Error('a cleanup that fails does not fail the reading'); } },
    { listingFolder: tmpdir() });
  assert.deepEqual(await ids(failing.driver), ['default']);
  assert.deepEqual(failing.calls.map((options) => options.cwd), [tmpdir()], 'the reading ran in that folder');
  assert.deepEqual(cleared.map((options) => options.folder), [tmpdir()], 'and what it left was cleared, although the reading failed');
  assert.equal(typeof cleared[0].since, 'number', 'with the time the reading began, so that only what it made is looked at');
  failing.driver.refreshModels();
  await ids(failing.driver);
  await second.promise;
  await settle();
  assert.deepEqual(await ids(failing.driver), ['opus']);
  // One that does not ask for it keeps the home folder and has nothing cleared.
  const other = harness([() => Promise.resolve(ok(OLD))], undefined, { listingCleanup: async () => { throw new Error('never called'); } }, { listingFolder: tmpdir() });
  assert.deepEqual(await ids(other.driver), ['opus']);
  assert.notEqual(other.calls[0].cwd, tmpdir());
});
