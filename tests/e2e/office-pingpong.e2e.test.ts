// Real WebGL, sprites and movement; only the issue facts and elapsed time are supplied by the test.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const captures = resolve(here, '../../.local/office-pingpong-nov02');
let browser: Browser;
let code: string;
const issue = (id: number, agentState = 'idle', status = 'in_review') => ({ id, status, agentState, agent: 'claude' });
// These two choose the table on their first joint break, with the same deterministic selection as the widget.
const pair = [issue(5), issue(3)];

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

const pingpong = (person: { place: string }) => person.place.startsWith('pingpong-');
const initial = (page: Page, issues = pair, still = false) => page.evaluate(({ issues, still }) => window.officeTest.reset(issues, still), { issues, still });

test('one idle employee never goes to ping-pong, even with other employees at work or waiting for boss', async () => {
  const page = await open();
  try {
    await initial(page, [issue(3), issue(1, 'working'), issue(2, 'needs_you'), issue(4, 'stuck')]);
    const solo = await page.evaluate(() => {
      const places = [];
      for (let second = 0; second < 1800; second++) {
        const state = window.officeTest.step(1);
        if (state.people.some((person) => person.place.startsWith('pingpong-')) || state.ball.visible) return { invalid: second, places };
        places.push(state.people.find((person) => person.id === 3).place);
      }
      return { invalid: null, places };
    });
    assert.equal(solo.invalid, null, 'no unaccompanied player across thirty minutes of rest rotations');
    assert.ok(new Set(solo.places).size >= 2, `other rest activities still rotate: ${[...new Set(solo.places)].join(', ')}`);
  } finally { await page.close(); }
});

test('both idle employees are reserved together, and the ball waits for both to arrive', async () => {
  const page = await open();
  try {
    await initial(page, [issue(5)]);
    const leaving = await page.evaluate((issues) => window.officeTest.setIssues(issues), pair);
    assert.deepEqual(leaving.people.filter(pingpong).map(({ place }) => place).sort(), ['pingpong-a', 'pingpong-b']);
    assert.equal(leaving.people[0].until, leaving.people[1].until, 'one shared break');
    assert.equal(leaving.ball.visible, false, 'no rally while either player is walking or getting off a seat');
    const playing = await page.evaluate(() => window.officeTest.step(20));
    assert.ok(playing.people.every((person) => pingpong(person) && !person.walking));
    assert.equal(playing.ball.visible, true);
    const leavingTogether = await page.evaluate((seconds) => window.officeTest.step(seconds), playing.people[0].until - 20 + 0.1);
    assert.equal(leavingTogether.people.filter(pingpong).length, 0);
    assert.equal(leavingTogether.ball.visible, false);
  } finally { await page.close(); }
});

test('both paddles swing and the ball travels, bounces and returns in real rendered frames', async () => {
  const page = await open();
  try {
    const start = await initial(page);
    assert.equal(start.people.filter(pingpong).length, 2);
    assert.equal(start.ball.visible, true);
    await page.evaluate(() => window.officeTest.step(0.12));
    await page.screenshot({ path: resolve(captures, 'left-hit.png') });
    const frames = await page.evaluate(() => Array.from({ length: 22 }, () => window.officeTest.step(0.1)));
    for (const id of [3, 5]) assert.equal(new Set(frames.map((frame) => frame.people.find((person) => person.id === id).frame)).size, 2, `player ${id} swings`);
    assert.ok(frames.every((frame) => frame.ball.visible && frame.shadow.visible));
    const xs = frames.map((frame) => frame.ball.x);
    assert.ok(xs.some((x, index) => index > 0 && x > xs[index - 1]), 'outward flight');
    assert.ok(xs.some((x, index) => index > 0 && x < xs[index - 1]), 'return flight');
    const ys = frames.map((frame) => frame.ball.y);
    assert.ok(Math.max(...ys) - Math.min(...ys) > 25, 'visible arc and bounce');
    assert.ok(frames.every((frame) => frame.ball.y <= frame.shadow.y && frame.ball.x === frame.shadow.x));
    await initial(page);
    await page.evaluate(() => window.officeTest.step(1.22));
    await page.screenshot({ path: resolve(captures, 'right-hit.png') });
  } finally { await page.close(); }
});

test('an interrupted walk or hop cannot leave a player heading to the table alone', async () => {
  const page = await open();
  try {
    for (const elapsed of [0, 0.15, 2]) {
      await initial(page, [issue(5)]);
      await page.evaluate((issues) => window.officeTest.setIssues(issues), pair);
      await page.evaluate((seconds) => window.officeTest.step(seconds), elapsed);
      const changed = await page.evaluate((issues) => window.officeTest.setIssues(issues), [issue(5), issue(3, 'working')]);
      assert.equal(changed.people.filter(pingpong).length, 0);
      const later = await page.evaluate(() => window.officeTest.step(20));
      assert.equal(later.people.filter(pingpong).length, 0);
      assert.equal(later.ball.visible, false);
      assert.equal(later.people.find((person) => person.id === 3).place, 'desk');
      assert.ok(later.people.every((person) => !person.walking));
    }
  } finally { await page.close(); }
});

for (const change of ['working', 'needs_you', 'stuck', 'done', 'removed', 'overflow']) test(`an opponent becoming ${change} ends the pair and leaves no lone player`, async () => {
  const page = await open();
  try {
    await initial(page);
    const next = change === 'removed' ? [issue(5)] :
      change === 'overflow' ? [...Array.from({ length: 8 }, (_, i) => issue(100 + i, 'working')), ...pair] :
      [issue(5), issue(3, change === 'done' ? 'idle' : change, change === 'done' ? 'done' : 'in_progress')];
    const stopped = await page.evaluate((issues) => window.officeTest.setIssues(issues), next);
    assert.equal(stopped.people.filter(pingpong).length, 0);
    assert.equal(stopped.ball.visible, false);
    const later = await page.evaluate(() => window.officeTest.step(20));
    assert.equal(later.people.filter(pingpong).length, 0, 'no stale route takes the remaining player back');
    const survivor = later.people.find((person) => person.id === 5);
    assert.equal(survivor.state, 'idle');
    assert.notEqual(survivor.pose, 'play_side_a');
    assert.notEqual(survivor.pose, 'play_side_b');
  } finally { await page.close(); }
});

test('a busy employee is never recruited, and every ping-pong reservation has two idle employees', async () => {
  const page = await open();
  try {
    await initial(page, [...pair, issue(1, 'working'), issue(4), issue(7), issue(9)]);
    const rotations = await page.evaluate(() => {
      let rallies = 0;
      for (let second = 0; second < 900; second++) {
        const snapshot = window.officeTest.step(1);
        const players = snapshot.people.filter((person) => person.place.startsWith('pingpong-'));
        if (players.length !== 0 && (players.length !== 2 || players.some((person) => person.state !== 'idle') || players[0].place === players[1].place)) return { invalid: second, rallies };
        if (snapshot.people.find((person) => person.id === 1).place !== 'desk') return { invalid: second, rallies };
        if (snapshot.ball.visible) rallies++;
      }
      return { invalid: null, rallies };
    });
    assert.equal(rotations.invalid, null);
    assert.ok(rotations.rallies > 10);
  } finally { await page.close(); }
});

test('reduced motion freezes the players and ball while preserving the two-player rule', async () => {
  const page = await open();
  try {
    const start = await initial(page, pair, true);
    assert.equal(start.people.filter(pingpong).length, 2);
    const still = await page.evaluate(() => window.officeTest.step(200));
    assert.deepEqual(still, start);
    const alone = await page.evaluate(() => window.officeTest.setIssues([{ id: 5, status: 'in_review', agentState: 'idle', agent: 'claude' }]));
    assert.equal(alone.people.filter(pingpong).length, 0);
    assert.equal(alone.ball.visible, false);
  } finally { await page.close(); }
});
