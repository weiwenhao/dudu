// The Office widget's floor: where people may put their feet, and that every way from one place to another goes over open floor, never over
// a desk, the toilet or the ping-pong table. Pure logic; what it looks like walking is checked in a real browser elsewhere.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deskAt, DESKS, DOOR, placeOf, SPOTS, spotAt } from '../host/dudu-plugin/ui/widgets/office/layout.js';
import { BLOCKS, clear, measure, nearestWalkable, routeFor, walkable } from '../host/dudu-plugin/ui/widgets/office/routes.js';

const PLACES: Array<[string, number]> = [...Array.from({ length: DESKS }, (_, seat): [string, number] => ['desk', seat]), ...SPOTS.map((spot): [string, number] => [spot.key, 0])];
const name = ([key, seat]: [string, number]) => (key === 'desk' ? `desk ${seat}` : key);
const block = (title: string) => BLOCKS.find((one) => one.name === title)!;

test('the furniture is where the pictures have it: a block for each piece, a desk and a chair for each desk', () => {
  for (const title of ['water bar and the wall behind it', 'treadmill', 'toilet', 'ping-pong table', 'TV cabinet', 'coffee table', 'PS5 sofa', 'ashtray']) assert.ok(block(title), title);
  for (let seat = 0; seat < DESKS; seat++) {
    const desk = block(`desk ${seat}`);
    const chair = block(`chair ${seat}`);
    const at = deskAt(seat);
    assert.ok(desk.x0 < at.x && desk.x1 > at.x + 183 && desk.y0 < at.y, `desk ${seat} covers its desk`);
    assert.ok(chair.x0 > desk.x0 && chair.x1 < desk.x1 && chair.y0 > desk.y0 && chair.y1 > desk.y1, `chair ${seat} is in front of its desk and reaches below it`);
  }
  // the toilet is the toilet's picture, moved to the new column (x -255 to -161, to y 804), the table the table's (x -302 to -18)
  const toilet = block('toilet');
  assert.ok(toilet.x0 <= -255 && toilet.x1 >= -161 && toilet.y1 >= 804);
  const table = block('ping-pong table');
  assert.ok(table.x0 <= -302 && table.x1 >= -18);
  // the wall has a door in it, the width the pictures give it
  const north = block('wall north of the door');
  const south = block('wall south of the door');
  assert.deepEqual([north.y1, south.y0], [DOOR.y0, DOOR.y1]);
});

test('open floor: the places people stand and the doors to them, not the furniture', () => {
  // somebody who sits is behind a chair or on a seat: where they get up from need not be open floor, but the way out, the gate, is
  for (const place of PLACES) assert.ok(walkable(placeOf(...place).gate.x, placeOf(...place).gate.y), `${name(place)}'s gate is open floor`);
  for (const spot of SPOTS.filter((one) => !one.stand)) assert.ok(walkable(spot.x, spot.y), `${spot.key}: people stand here`);
  // and nowhere on a piece of furniture
  for (const [x, y, what] of [[-205, 760, 'the toilet'], [66, 300, 'the wall'], [66, 700, 'the wall, south of the door'], [-200, 180, 'the ping-pong table'], [580, 120, 'a desk'], [-160, 540, 'the sofa'], [226, 446, 'the treadmill'], [300, 120, 'the water bar']] as Array<[number, number, string]>) {
    assert.equal(walkable(x, y), false, what);
  }
  assert.equal(walkable(-5000, 100), false, 'outside the plane');
  assert.equal(walkable(100, -20), false, 'above it');
  assert.equal(walkable(456, 500), true, 'the lane between the modules and the desks');
  assert.equal(walkable(66, DOOR.y1 - 20), true, 'the door');
  assert.equal(walkable(30, 500), true, 'and the floor on its far side, the shadow of the wall, is floor');
  // somebody standing up from a desk is behind the chair: the chair is where their feet are, which is why they step out to the gate
  for (let seat = 0; seat < DESKS; seat++) assert.equal(walkable(placeOf('desk', seat).stand.x, placeOf('desk', seat).stand.y), false, `desk ${seat}: the chair is where they stand up`);
  assert.deepEqual(nearestWalkable({ x: 456, y: 500 }), { x: 456, y: 500 }, 'open floor is its own nearest');
  const near = nearestWalkable({ x: 220, y: 760 });
  assert.ok(walkable(near.x, near.y) && Math.hypot(near.x - 220, near.y - 760) < 120, 'from the toilet to the floor next to it');
});

test('every way from one place to another is over open floor, whichever way it goes', () => {
  let routes = 0;
  for (const from of PLACES) {
    for (const to of PLACES) {
      if (from === to || (from[0] === to[0] && from[1] === to[1])) continue;
      const a = placeOf(...from).gate;
      const b = placeOf(...to).gate;
      const way = routeFor(a, b);
      routes += 1;
      assert.deepEqual([way[0].x, way[0].y, way.at(-1)!.x, way.at(-1)!.y], [a.x, a.y, b.x, b.y], `${name(from)} to ${name(to)} starts and ends where it should`);
      for (let i = 1; i < way.length; i++) assert.ok(clear(way[i - 1], way[i]), `${name(from)} to ${name(to)}: from ${JSON.stringify(way[i - 1])} to ${JSON.stringify(way[i])} is over open floor`);
      // not a wander: the plane is 1950 wide, and the longest way (the balcony is only open from the east, the desks have their chairs to go
      // round) is a little over 2000
      const length = measure(way).total;
      assert.ok(length < 2400, `${name(from)} to ${name(to)} is not a wander (${Math.round(length)})`);
    }
  }
  assert.equal(routes, PLACES.length * (PLACES.length - 1));
});

test('the toilet is reached from the front and not over it; the ping-pong players walk round the table, not across it', () => {
  const toilet = block('toilet');
  const way = routeFor(placeOf('desk', 4).gate, placeOf('toilet').gate);
  for (let d = 0; d <= measure(way).total; d += 4) {
    const at = measure(way).at(d);
    assert.ok(!(at.x > toilet.x0 && at.x < toilet.x1 && at.y > toilet.y0 && at.y < toilet.y1), `not on the toilet at ${JSON.stringify(at)}`);
  }
  assert.ok(way.at(-1)!.x > toilet.x1, 'it ends on the floor in front of the toilet, which faces right');
  const table = block('ping-pong table');
  for (const from of [['desk', 8], ['coffee-a', 0]] as Array<[string, number]>) {
    const there = routeFor(placeOf(...from).gate, placeOf('pingpong-a').gate);
    const m = measure(there);
    for (let d = 0; d <= m.total; d += 4) {
      const at = m.at(d);
      assert.ok(!(at.x > table.x0 && at.x < table.x1 && at.y > table.y0 && at.y < table.y1), `${name(from)}: not across the table at ${JSON.stringify(at)}`);
    }
  }
});

test('between the original column and the new one there is the door, and only the door', () => {
  const crossings: number[] = [];
  const east = [['coffee-a', 0], ['coffee-b', 0], ['treadmill', 0], ['balcony-a', 0], ['balcony-b', 0], ['desk', 4], ['desk', 8]] as Array<[string, number]>;
  const west = [['pingpong-a', 0], ['pingpong-b', 0], ['ps5-a', 0], ['ps5-b', 0], ['toilet', 0]] as Array<[string, number]>;
  for (const a of east) {
    for (const b of west) {
      for (const [from, to] of [[a, b], [b, a]]) {
        const way = routeFor(placeOf(...from).gate, placeOf(...to).gate);
        const m = measure(way);
        let before = m.at(0);
        for (let d = 2; d <= m.total; d += 2) {
          const at = m.at(d);
          if ((before.x < 67) !== (at.x < 67)) crossings.push(at.y);
          before = at;
        }
      }
    }
  }
  // (the new column's pingpong-b is at x 4: west of the wall; the wall is at x 67, with a door between y 455 and 535)
  assert.ok(crossings.length >= west.length * east.length, 'every way crosses the wall (some leave and come back)');
  for (const y of crossings) assert.ok(y > DOOR.y0 && y < DOOR.y1, `the wall is crossed at y ${Math.round(y)}, in the door (${DOOR.y0} to ${DOOR.y1})`);
});

test('a route is measured along its length: the point at a distance, and which way it faces there', () => {
  const m = measure([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 60, y: 50 }]);
  assert.equal(m.total, 190);
  assert.deepEqual(m.at(0), { x: 0, y: 0, dx: 1 });
  assert.deepEqual(m.at(50), { x: 50, y: 0, dx: 1 });
  assert.deepEqual(m.at(125), { x: 100, y: 25, dx: 0 }, 'going down: no way is faced');
  assert.deepEqual(m.at(170), { x: 80, y: 50, dx: -1 });
  assert.deepEqual(m.at(500), { x: 60, y: 50, dx: -1 }, 'past the end is the end');
  assert.deepEqual(m.at(-5), { x: 0, y: 0, dx: 1 }, 'before the start is the start');
  const still = measure([{ x: 5, y: 5 }, { x: 5, y: 5 }]);
  assert.equal(still.total, 0);
  assert.deepEqual(still.at(3), { x: 5, y: 5, dx: 0 }, 'a walk of no length');
});

test('somebody who is already at the gate does not go anywhere, and a point in the furniture is led out of it', () => {
  const gate = placeOf('coffee-a').gate;
  const way = routeFor(gate, gate);
  assert.ok(way.length <= 2 && measure(way).total < 1);
  // from a desk's chair to the toilet: the first step is out of the chair, the rest is open floor
  const stand = placeOf('desk', 3).stand;
  const out = routeFor(stand, placeOf('toilet').gate);
  assert.ok(Math.hypot(out[1].x - stand.x, out[1].y - stand.y) < 120, 'the first point is the nearest open floor');
  assert.ok(spotAt('treadmill')!.stand!.y > 482, 'the treadmill is stepped onto from below its frame');
});
