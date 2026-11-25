import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOarProvider } from '../host/providers/oar.mjs';

// DSH's model catalog (and with it the phone's catalog.get) waits for every harness at once. A harness that cannot reach its
// servers takes ~24 s to give up (owner, 2026-11-24: Antigravity without a proxy), so the plugin must never make a menu wait for
// one: the list that was read is served at once and read anew in the background.

const FALLBACK = [{ id: 'default', displayName: 'Default' }];
const OLD = [{ id: 'opus', displayName: 'Opus' }];
const NEW = [{ id: 'opus', displayName: 'Opus' }, { id: 'sonnet', displayName: 'Sonnet' }];

/** A harness whose n-th model listing is what `answers[n]()` returns (a promise the test settles). */
function harness(answers: Array<() => Promise<any>>, modelsChanged?: () => void) {
  let asked = 0;
  const runtime = { listModels: () => answers[asked++]() };
  const provider = createOarProvider({
    id: 'fake', name: 'Fake', runtime, binaryEnv: 'FAKE_BIN', tools: [], login: 'Sign in.', normalizer: () => ({}),
    fallbackModels: FALLBACK, scrub: { patterns: [] }, session: () => ({}),
  } as any);
  const driver = provider.create({ installation: { kind: 'available', via: 'executable', command: '/bin/fake' }, modelsChanged } as any);
  return { driver, asked: () => asked };
}
const ids = async (driver: any) => (await driver.listModels()).map((model: any) => model.id);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const ok = (models: any[]) => ({ kind: 'ok', models });

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

test('an old list is served at once while a new one is read, one reading at a time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const second = Promise.withResolvers<any>();
  const { driver, asked } = harness([() => Promise.resolve(ok(OLD)), () => second.promise]);
  assert.deepEqual(await ids(driver), ['opus']);
  t.mock.timers.tick(5 * 60_000 + 1);
  const [a, b] = await Promise.all([ids(driver), ids(driver)]);
  assert.deepEqual([a, b], [['opus'], ['opus']], 'the old list, without waiting for the reading');
  assert.equal(asked(), 2, 'two asks at the same time start one reading');
  second.resolve(ok(NEW));
  await settle();
  assert.deepEqual(await ids(driver), ['opus', 'sonnet']);
});

test('a harness that fails keeps what it said before and is asked again after a minute', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { driver, asked } = harness([() => Promise.resolve(ok(OLD)), () => Promise.reject(new Error('offline')), () => Promise.resolve(ok(NEW))]);
  await ids(driver);
  t.mock.timers.tick(5 * 60_000 + 1);
  assert.deepEqual(await ids(driver), ['opus'], 'the old list while the failing reading runs');
  await settle();
  t.mock.timers.tick(30_000);
  assert.deepEqual(await ids(driver), ['opus']);
  assert.equal(asked(), 2, 'not asked again within a minute of failing');
  t.mock.timers.tick(30_001);
  assert.deepEqual(await ids(driver), ['opus'], 'still the old one while the next reading runs');
  await settle();
  assert.equal(asked(), 3);
  assert.deepEqual(await ids(driver), ['opus', 'sonnet']);
});

test('settings saved while a reading is under way drop what it says', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const old = Promise.withResolvers<any>();
  const fresh = Promise.withResolvers<any>();
  const { driver, asked } = harness([() => Promise.resolve(ok(OLD)), () => old.promise, () => fresh.promise]);
  await ids(driver);
  t.mock.timers.tick(5 * 60_000 + 1);
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
  t.mock.timers.tick(5 * 60_000 + 1);
  await ids(driver);
  await settle();
  assert.deepEqual(told, ['changed', 'changed'], 'a model found by a later reading is announced');
  t.mock.timers.tick(5 * 60_000 + 1);
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
