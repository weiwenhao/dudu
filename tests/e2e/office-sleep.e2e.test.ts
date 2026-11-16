// Real WebGL, sprites and movement; only the issue facts and elapsed time are supplied by the test. Whoever's agent is in deep sleep lies in a bed
// of the sleeping room west of the activity area (the first free one, and it is theirs while they sleep): they get there by its door, and get up the
// same way. Whoever is Idle but awake is not in bed: they are in the activity area with whoever waits for the owner (office-pingpong.e2e.test.ts).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { avatarOf, BEDS, DESKS } from '../../host/dudu-plugin/ui/widgets/office/layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const captures = resolve(here, '../../.local/office-sleep-nov04');
let browser: Browser;
let code: string;
type Person = { id: number; seat: number; state: string; zone: string; place: string; pose: string; walking: boolean; route: boolean; hop: boolean; sleeping: boolean; at: { x: number; y: number } };
type Snapshot = { people: Person[]; ball: { visible: boolean }; screens: (string | null)[] };
const issue = (id: number, sessionState: string, status = 'in_progress') => ({ id, status, sessionState: ({ working: 'processing', blocked: 'unread' }[sessionState] ?? sessionState), agent: 'claude' });
/** An agent in deep sleep (an idle one, or a finished run that waits for a look, which is `blocked`): the server says so with `deepSleep`. */
const asleep = (id: number, sessionState = 'idle') => ({ ...issue(id, sessionState), deepSleep: true });
const inBed = (one: Person) => one.place.startsWith('bed-');

before(async () => {
  const bundle = await build({
    entryPoints: [resolve(here, 'office-scene-entry.mjs')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    loader: { '.png': 'dataurl', '.webp': 'dataurl' }, minify: true, logLevel: 'warning',
  });
  code = bundle.outputFiles[0].text;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await mkdir(captures, { recursive: true });
});
after(async () => { await browser?.close(); });

async function open() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f7f7f7}canvas{display:block}</style>');
  await page.addScriptTag({ type: 'module', content: code });
  await page.waitForFunction(() => Boolean(window.officeTest));
  return page;
}

const initial = (page: Page, issues: unknown[], still = false): Promise<Snapshot> => page.evaluate(({ issues, still }) => window.officeTest.reset(issues, still), { issues, still });
const setIssues = (page: Page, issues: unknown[]): Promise<Snapshot> => page.evaluate((issues) => window.officeTest.setIssues(issues), issues);
const step = (page: Page, seconds: number): Promise<Snapshot> => page.evaluate((seconds) => window.officeTest.step(seconds), seconds);
const person = (state: Snapshot, id: number) => state.people.find((one) => one.id === id)!;

test('whoever\'s agent is in deep sleep lies in a bed, on their back with their Zs, the first free one; no two share a bed; whoever is merely idle (or waits for the owner) is not in bed', async () => {
  const page = await open();
  try {
    const state = await initial(page, Array.from({ length: DESKS }, (_, i) => asleep(i + 1, i % 2 ? 'blocked' : 'idle')));
    assert.equal(state.people.length, DESKS);
    for (const one of state.people) {
      assert.equal(one.zone, 'sleeping');
      assert.equal(one.place, `bed-${one.seat}`);
      assert.equal(one.pose, 'lie_sleep');
      assert.equal(one.sleeping, true, 'the Zs');
      assert.equal(one.walking, false);
      const bed = BEDS[one.seat];
      assert.deepEqual([one.at.x, one.at.y], [bed.x, bed.y], 'their hips are on the mattress');
    }
    assert.deepEqual(state.people.map((one) => one.place), Array.from({ length: DESKS }, (_, i) => `bed-${i}`), 'the beds fill from the first, in the order of the list');
    assert.equal(new Set(state.people.map((one) => one.place)).size, DESKS, 'a bed each');
    await page.screenshot({ path: resolve(captures, 'all-asleep.png') });
    // an agent that is idle but awake, and one that waits for the owner, are in the activity area, not in a bed
    const awake = await initial(page, [issue(1, 'idle'), issue(2, 'idle'), issue(3, 'blocked', 'in_review'), issue(4, 'working')]);
    assert.deepEqual(awake.people.map((one) => [one.id, one.zone]), [[1, 'resting'], [2, 'resting'], [3, 'resting'], [4, 'working']]);
    for (const one of awake.people.filter((other) => other.zone === 'resting')) {
      assert.ok(!inBed(one) && one.place !== 'desk', `${one.id} is at ${one.place}`);
      assert.notEqual(one.pose, 'lie_sleep');
      assert.equal(one.sleeping, false, 'no Zs');
    }
  } finally { await page.close(); }
});

test('nobody who sleeps gets up to change beds, however long they sleep and however the list is shuffled (owner, 2026-11-07)', async () => {
  const page = await open();
  try {
    const sleepers = [asleep(1), asleep(2, 'blocked'), asleep(3), asleep(4)];
    const others = [issue(5, 'working'), issue(6, 'blocked', 'in_review'), issue(7, 'idle'), issue(8, 'idle')];
    const start = await initial(page, [...sleepers, ...others]);
    const beds = Object.fromEntries(start.people.filter(inBed).map((one) => [one.id, one.place]));
    assert.deepEqual(Object.keys(beds).sort(), ['1', '2', '3', '4'], 'the four deep sleepers are in beds and nobody else is');
    let state = start;
    for (let minute = 0; minute < 10; minute++) {
      const order = [...sleepers, ...others].sort(() => Math.random() - 0.5); // the list comes in any order each time
      state = await setIssues(page, order);
      for (let tick = 0; tick < 6; tick++) {
        state = await step(page, 10);
        for (const [id, place] of Object.entries(beds)) {
          const one = person(state, Number(id));
          assert.equal(one.place, place, `minute ${minute}: ${id} is in ${place} still`);
          assert.equal(one.walking, false, `minute ${minute}: ${id} has not got up`);
          assert.equal(one.pose, 'lie_sleep');
        }
      }
    }
    // while the awake ones went about the activity area the whole time
    assert.ok(state.people.filter((one) => one.zone === 'resting').every((one) => !inBed(one)), 'nobody awake is in a bed');
  } finally { await page.close(); }
});

test('somebody in the activity area never plays a game on the monitor of a desk where another works, whatever number they have', async () => {
  const page = await open();
  try {
    const gamer = Array.from({ length: 40 }, (_, i) => i + 10).find((id) => avatarOf(id) % 2 === 1)!; // one who likes games
    await initial(page, [issue(1, 'working')]);
    await page.waitForTimeout(1500); // the monitor's animation is loaded when it is first asked for
    const alone = (await step(page, 5)).screens[0];
    assert.ok(alone, 'the worker at the first desk has an animation on its monitor');
    // the gamer is idle: they are in the activity area and have the number 0 there, which is also the first desk's
    await initial(page, [issue(1, 'working'), issue(gamer, 'idle')]);
    await page.waitForTimeout(1500);
    const both = await step(page, 5);
    assert.equal(person(both, gamer).place === 'desk', false, 'in the activity area');
    assert.equal(both.screens[0], alone, 'and the first desk\'s monitor plays what it played for its worker, not their game');
  } finally { await page.close(); }
});

test('whoever has no place walks out of the picture, nobody else moves, and they walk back in when a place is free (owner, 2026-11-07)', async () => {
  const page = await open();
  try {
    // eight beds, eight asleep, and a ninth who is awake in the activity area
    const eight = Array.from({ length: 8 }, (_, i) => asleep(i + 1));
    const first = await initial(page, [...eight, issue(9, 'idle')]);
    assert.equal(first.people.length, 9);
    // the ninth falls asleep with every bed taken: they have none, so they set off out of the picture; the eight lie where they lay
    let now = await setIssues(page, [...eight, asleep(9)]);
    assert.equal(person(now, 9).zone, 'out');
    assert.equal(person(now, 9).walking, true, 'on their way out');
    for (let id = 1; id <= 8; id++) assert.equal(person(now, id).place, `bed-${id - 1}`, `${id} still lies in bed ${id - 1}`);
    now = await step(page, 30); // longer than the longest way out and the fade
    assert.equal(now.people.some((one) => one.id === 9), false, 'out of the picture');
    assert.equal(now.people.length, 8);
    // the first of the eight wakes, a bed is free, and the ninth walks in and lies down in it
    now = await setIssues(page, [issue(1, 'idle'), ...eight.slice(1), asleep(9)]);
    assert.equal(person(now, 9).walking, true, 'on their way in');
    now = await step(page, 40);
    assert.equal(person(now, 9).place, 'bed-0');
    assert.equal(person(now, 9).pose, 'lie_sleep');
    assert.equal(now.people.length, 9);
  } finally { await page.close(); }
});
