// The Office widget's pure logic: desks, seating, who a person is, what changes when the list changes, and the camera. What the widget
// looks like and does in a browser is checked against real WebGL elsewhere (the harness's e2e script); this is only the rules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitCamera, project, roomBox } from '../host/dudu-plugin/ui/widgets/office/camera.js';
import {
  deskGrid, doorPosition, headAnchor, look, plan, roomSize, routeBetween, routeToDoor, seatPosition, seating, shirtOf, STATES, summarize,
} from '../host/dudu-plugin/ui/widgets/office/layout.js';
import { headOf } from '../host/dudu-plugin/ui/widgets/office/pose.js';
import { O } from '../host/dudu-plugin/ui/widgets/office/strings.js';

type Item = { id: number; status: string; agent?: string | null; agentState?: string };
const issue = (id: number, status = 'in_progress', agentState = 'idle', agent: string | null = null): Item => ({ id, status, agent, agentState });
// The seven Active issues of the design frames, in the Issues default order.
const SEVEN = [issue(12, 'in_progress', 'needs_you', 'deepseek'), issue(13, 'in_progress', 'stuck', 'claude'), issue(9, 'todo'), issue(14, 'in_progress', 'working', 'claude'),
  issue(10, 'todo', 'idle', 'deepseek'), issue(8, 'in_progress', 'needs_you', 'claude'), issue(11, 'in_review', 'idle', 'codex')];

test('the desks follow the widget size: columns - 2 across, rows - 1 down', () => {
  assert.deepEqual(deskGrid(6, 4), { columns: 4, rows: 3, capacity: 12 });
  assert.deepEqual(deskGrid(4, 3), { columns: 2, rows: 2, capacity: 4 });
  assert.equal(deskGrid(12, 12).capacity, 10 * 11);
  assert.equal(deskGrid(1, 1).capacity, 1, 'never fewer than one desk');
});

test('the most urgent sit in the front row, left to right; the rest are "+N"; only Active issues sit', () => {
  const grid = deskGrid(4, 3);
  const list = [issue(1), issue(2, 'backlog'), issue(3, 'done'), issue(1), issue(4, 'todo'), issue(5, 'in_review'), issue(6), issue(7)];
  const { seated, overflow } = seating(list, grid);
  assert.deepEqual(seated.map(({ id, seat }) => [id, seat]), [[1, 0], [4, 1], [5, 2], [6, 3]]);
  assert.deepEqual(overflow.map(({ id }) => id), [7]);
  // The front row (seat 0..columns-1) is the one nearest the viewer: the largest z.
  assert.ok(seatPosition(0, grid).z > seatPosition(grid.columns, grid).z);
  assert.ok(seatPosition(0, grid).x < seatPosition(1, grid).x);
  // 0, 1, capacity and capacity + 1 issues
  for (const [count, sits, over] of [[0, 0, 0], [1, 1, 0], [4, 4, 0], [5, 4, 1]] as const) {
    const r = seating(Array.from({ length: count }, (_, i) => issue(i + 1)), grid);
    assert.deepEqual([r.seated.length, r.overflow.length], [sits, over]);
  }
});

test('the same issue is always the same person, dressed in the colour of its agent', () => {
  assert.deepEqual(look(12), look(12));
  assert.equal(look(12).style, 'glasses', 'as in the design frame');
  assert.equal(look(13).style, 'bun');
  assert.equal(look(8).style, 'short', 'a number whose hash gives a negative index is plain, as the frames drew it');
  assert.deepEqual(look('x9'), look('x9'));
  assert.equal(shirtOf('claude'), 0xd97757);
  assert.equal(shirtOf('codex'), 0x19a58a);
  assert.equal(shirtOf('deepseek'), 0x4d6bfe);
  assert.equal(shirtOf(null), 0x9aa0ad);
  assert.ok([0x8b6fd6, 0xe27ba8, 0xe4b93c].includes(shirtOf('gemini')), 'any other agent is purple, pink or yellow');
  assert.equal(shirtOf('gemini'), shirtOf('gemini'), 'and keeps it');
});

test('a changed list tells who stays, moves, enters and leaves (and why)', () => {
  const grid = deskGrid(4, 3);
  const first = plan([], [issue(1), issue(2), issue(3)], grid);
  assert.deepEqual(first.enter.map(({ id, seat }) => [id, seat]), [[1, 0], [2, 1], [3, 2]]);
  // 2 is done, 4 is new and urgent, 1 changes its state only
  const next = plan(first.seats, [issue(4), issue(1, 'in_progress', 'stuck'), issue(2, 'done'), issue(3)], grid);
  assert.deepEqual(next.enter.map(({ id, seat }) => [id, seat]), [[4, 0]]);
  assert.deepEqual(next.move.map(({ id, from, to }) => [id, from, to]), [[1, 0, 1]], '1 sits where 2 sat');
  assert.deepEqual(next.stay.map(({ id }) => id), [3]);
  assert.deepEqual(next.leave.map(({ id, reason }) => [id, reason]), [[2, 'done']]);
  const same = plan(next.seats, [issue(4), issue(1), issue(3)], grid);
  assert.deepEqual([same.stay.length, same.move.length, same.enter.length, same.leave.length], [3, 0, 0, 0]);
  // a more urgent issue takes the last desk's place: the one bumped walks out; one that is gone, or in Backlog, leaves too
  const full = plan([], Array.from({ length: 4 }, (_, i) => issue(i + 1)), grid);
  const bumped = plan(full.seats, [issue(9), ...Array.from({ length: 4 }, (_, i) => issue(i + 1))], grid);
  assert.deepEqual(bumped.leave.map(({ id, reason }) => [id, reason]), [[4, 'overflow']]);
  assert.equal(bumped.overflow, 1);
  const gone = plan(full.seats, [issue(1), issue(2, 'backlog'), issue(3)], grid);
  assert.deepEqual(gone.leave.map(({ id, reason }) => [id, reason]).sort(), [[2, 'backlog'], [4, 'gone']]);
  // no seats change by themselves: the same list in the same order is no movement at all
  assert.equal(plan(first.seats, [issue(1), issue(2), issue(3)], grid).move.length, 0);
});

test('whoever walks stays on the floor and reaches the door and the seat', () => {
  for (const [cols, rows] of [[4, 3], [6, 4], [12, 12]]) {
    const grid = deskGrid(cols, rows);
    const { width, depth } = roomSize(grid);
    const door = doorPosition(grid);
    for (let seat = 0; seat < grid.capacity; seat++) {
      const out = routeToDoor(seat, grid);
      assert.deepEqual(out[0], seatPosition(seat, grid));
      assert.ok(out.at(-1)!.x < door.x, 'the last step goes into the wall at the door');
      assert.equal(out.at(-1)!.z, door.z);
      for (const { x, z } of out.slice(0, -1)) assert.ok(Math.abs(x) < width / 2 - 0.2 && Math.abs(z) < depth / 2 - 0.2, `seat ${seat} walks inside the room`);
    }
    const across = routeBetween(0, grid.capacity - 1, grid);
    assert.deepEqual([across[0], across.at(-1)], [seatPosition(0, grid), seatPosition(grid.capacity - 1, grid)]);
  }
});

test('the state table: poses, lamps, symbols, and where the head is for the name tag', () => {
  assert.deepEqual(Object.keys(STATES), ['working', 'needs_you', 'stuck', 'idle']);
  assert.deepEqual(Object.values(STATES).map((s) => s.symbol), ['···', '!', '×', 'z']);
  assert.deepEqual(Object.values(STATES).map((s) => s.lamp), [0x9ad0ff, 0xffb020, 0xff4d4d, null], 'Idle: the lamp is off');
  for (const state of Object.keys(STATES)) assert.deepEqual(headOf(state).map((v: number) => +v.toFixed(4)), STATES[state as keyof typeof STATES].head, `${state}: the pose and the tag agree on the head`);
  assert.deepEqual(summarize(SEVEN), { total: 7, working: 1, needs_you: 2, stuck: 1, idle: 3 });
  assert.equal(O.summary(summarize(SEVEN)), 'Office: 7 issues, 2 need you, 1 stuck, 1 working, 3 idle');
  assert.equal(O.summary(summarize([issue(1, 'todo', 'needs_you')])), 'Office: 1 issue, 1 needs you');
  assert.equal(O.summary(summarize([])), 'Office: 0 issues');
});

test('the camera is three\'s: a head is where a PerspectiveCamera puts it, and the whole room is in the picture', () => {
  for (const [cols, rows, width, height] of [[6, 4, 730, 448], [4, 3, 482, 285], [12, 12, 1500, 1200], [6, 4, 300, 700]]) {
    const grid = deskGrid(cols, rows);
    const view = fitCamera(roomBox(roomSize(grid)), width, height);
    const camera = new PerspectiveCamera(view.fov, view.aspect, view.near, view.far);
    camera.position.set(...(view.position as [number, number, number]));
    camera.lookAt(...(view.target as [number, number, number]));
    camera.setViewOffset(width, height, (view.shift[0] * width) / 2, (-view.shift[1] * height) / 2, width, height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    for (let seat = 0; seat < grid.capacity; seat += 3) {
      const at = headAnchor(seat, 'working', grid);
      const mine = project(view, at);
      const theirs = new Vector3(...(at as [number, number, number])).project(camera);
      assert.ok(Math.abs(mine.x - (theirs.x * 0.5 + 0.5) * width) < 1e-6 && Math.abs(mine.y - (-theirs.y * 0.5 + 0.5) * height) < 1e-6);
    }
    const box = roomBox(roomSize(grid));
    for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
      const { x: px, y: py } = project(view, [x, y, z]);
      assert.ok(px >= -1 && px <= width + 1 && py >= -1 && py <= height + 1, `a corner of the room is in the picture at ${width} x ${height}`);
    }
  }
});
