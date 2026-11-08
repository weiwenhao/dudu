// The Office widget's floor: where people may put their feet, and that every way from one place to another goes over open floor, never over
// a desk, a bed, the toilet or the ping-pong table, and into the sleeping room only by its door. Pure logic; what it looks like walking is
// checked in a real browser elsewhere.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BED, BEDS, deskAt, DESKS, DOOR, EXIT, OUTSIDE, PING_PONG, placeOf, SCENE, SLEEP_ROOM, SPOTS, spotAt, TOILET } from '../host/dudu-plugin/ui/widgets/office/layout.js';
import { BLOCKS, clear, measure, nearestWalkable, routeFor, walkable } from '../host/dudu-plugin/ui/widgets/office/routes.js';

const PLACES: Array<[string, number]> = [...Array.from({ length: DESKS }, (_, seat): [string, number] => ['desk', seat]), ...SPOTS.map((spot): [string, number] => [spot.key, 0])];
const name = ([key, seat]: [string, number]) => (key === 'desk' ? `desk ${seat}` : key);
const block = (title: string) => BLOCKS.find((one) => one.name === title)!;

test('the furniture is where the pictures have it: a block for each piece, a desk and a chair for each desk', () => {
  for (const title of ['water bar and the wall behind it', 'treadmill', 'second treadmill', 'third treadmill', 'toilet', 'ping-pong table', 'TV cabinet', 'coffee table', 'PS5 sofa', 'ashtray']) assert.ok(block(title), title);
  for (let seat = 0; seat < DESKS; seat++) {
    const desk = block(`desk ${seat}`);
    const chair = block(`chair ${seat}`);
    const at = deskAt(seat);
    assert.ok(desk.x0 < at.x && desk.x1 > at.x + 183 && desk.y0 < at.y, `desk ${seat} covers its desk`);
    assert.ok(chair.x0 > desk.x0 && chair.x1 < desk.x1 && chair.y0 > desk.y0 && chair.y1 > desk.y1, `chair ${seat} is in front of its desk and reaches below it`);
  }
  // the toilet is the toilet's picture at the foot of the added column (x -260 to -152, to 242 below the picture's top), the table the table's
  const toilet = block('toilet');
  assert.ok(toilet.x0 <= TOILET.x + 138 && toilet.x1 >= TOILET.x + 246 && toilet.y1 >= TOILET.y + 242);
  const table = block('ping-pong table');
  assert.ok(table.x0 <= PING_PONG.left && table.x1 >= PING_PONG.right && table.y0 <= PING_PONG.top && table.y1 >= PING_PONG.bottom);
  // the second and the third treadmill are the first one's picture again, further down
  assert.equal(block('second treadmill').x0, block('treadmill').x0);
  assert.equal(block('third treadmill').x0, block('treadmill').x0);
  assert.ok(block('second treadmill').y0 >= block('treadmill').y1, 'below the first one, not on it');
  assert.ok(block('third treadmill').y0 >= block('second treadmill').y1, 'and the third below the second');
  // each bed is its mattress, in the room the sleeping room's walls make; the wall between it and the rest area has a door in it, the width the pictures give it
  assert.equal(BEDS.length, DESKS, 'a bed for each desk');
  for (const bed of BEDS) {
    const mattress = block(`bed ${bed.seat}`);
    assert.deepEqual([mattress.x1 - mattress.x0, mattress.y1 - mattress.y0], [BED.width, BED.height], `bed ${bed.seat}`);
    assert.ok(bed.x > mattress.x0 && bed.x < mattress.x1 && bed.y > mattress.y0 && bed.y < mattress.y1, `the sleeper's hips are on bed ${bed.seat}`);
    assert.ok(mattress.x0 > SCENE.x && mattress.x1 < SLEEP_ROOM.wall, `bed ${bed.seat} is inside the plane, west of the partition wall`);
  }
  const north = block('wall north of the door');
  const south = block('wall south of the door');
  assert.deepEqual([north.y1, south.y0], [DOOR.y0, DOOR.y1]);
  assert.ok(north.x0 < DOOR.x && north.x1 > DOOR.x && south.x0 < DOOR.x && south.x1 > DOOR.x, 'the wall stands where the door is');
  assert.ok(block('open door').x1 <= DOOR.x + 8 && block('open door').x0 < DOOR.x - 60, 'the leaf stands open into the sleeping room');
});

test('open floor: the places people stand and the doors to them, not the furniture', () => {
  // somebody who sits is behind a chair or on a seat: where they get up from need not be open floor, but the way out, the gate, is
  for (const place of PLACES) assert.ok(walkable(placeOf(...place).gate.x, placeOf(...place).gate.y), `${name(place)}'s gate is open floor`);
  for (const spot of SPOTS.filter((one) => !one.stand)) assert.ok(walkable(spot.x, spot.y), `${spot.key}: people stand here`);
  // and nowhere on a piece of furniture
  for (const [x, y, what] of [[-205, 962, 'the toilet'], [DOOR.x, 100, 'the wall'], [DOOR.x, 700, 'the wall, south of the door'], [-200, 130, 'the ping-pong table'], [480, 120, 'a desk'], [-160, 620, 'the sofa'], [176, 400, 'the treadmill'],
    [176, 580, 'the second treadmill'], [176, 740, 'the third treadmill'], [250, 120, 'the water bar'], [BEDS[3].x, BEDS[3].y, 'a bed'], [DOOR.x - 40, DOOR.y0 + 10, 'the open leaf of the door']] as Array<[number, number, string]>) {
    assert.equal(walkable(x, y), false, what);
  }
  assert.equal(walkable(-5000, 100), false, 'outside the plane');
  assert.equal(walkable(100, -20), false, 'above it');
  assert.equal(walkable(376, 500), true, 'the lane between the rest area and the desks');
  assert.equal(walkable(DOOR.x, DOOR.y1 - 20), true, 'the door');
  assert.equal(walkable(SLEEP_ROOM.x + 234, 600), true, 'and the aisle between the two columns of beds, on its far side');
  assert.equal(walkable(SCENE.x + SCENE.width + 100, 500), false, 'outside the plane, to the east');
  // somebody standing up from a desk is behind the chair: the chair is where their feet are, which is why they step out to the gate
  for (let seat = 0; seat < DESKS; seat++) assert.equal(walkable(placeOf('desk', seat).stand.x, placeOf('desk', seat).stand.y), false, `desk ${seat}: the chair is where they stand up`);
  assert.deepEqual(nearestWalkable({ x: 376, y: 500 }), { x: 376, y: 500 }, 'open floor is its own nearest');
  const near = nearestWalkable({ x: 170, y: 960 });
  assert.ok(walkable(near.x, near.y) && Math.hypot(near.x - 170, near.y - 960) < 120, 'from the ashtray to the floor next to it');
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
      // not a wander: the plane is 1690 wide and 1102 tall, and the longest way (from the toilet at the foot of the rest area up to the door,
      // through it, and down the aisle to the last bed) is a little over 2300
      const length = measure(way).total;
      assert.ok(length < 2600, `${name(from)} to ${name(to)} is not a wander (${Math.round(length)})`);
    }
  }
  assert.equal(routes, PLACES.length * (PLACES.length - 1));
});

test('somebody who has no place walks out from every place, over open floor, to the corner of the plane and on beyond its edge (owner, 2026-11-07)', () => {
  assert.ok(walkable(EXIT.x, EXIT.y), 'the corner is open floor');
  assert.ok(OUTSIDE.x > SCENE.x + SCENE.width && OUTSIDE.y <= SCENE.y + SCENE.height, 'and the point after it is beyond the edge of the plane');
  for (const place of PLACES) {
    const way = routeFor(placeOf(place[0], place[1]).gate, EXIT);
    for (let i = 1; i < way.length; i++) assert.ok(clear(way[i - 1], way[i]), `${name(place)}: the way out is over open floor`);
  }
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
  for (const from of [['desk', 7], ['coffee-a', 0]] as Array<[string, number]>) {
    const there = routeFor(placeOf(...from).gate, placeOf('pingpong-a').gate);
    const m = measure(there);
    for (let d = 0; d <= m.total; d += 4) {
      const at = m.at(d);
      assert.ok(!(at.x > table.x0 && at.x < table.x1 && at.y > table.y0 && at.y < table.y1), `${name(from)}: not across the table at ${JSON.stringify(at)}`);
    }
  }
});

test('between the sleeping room and the rest area there is the door, and only the door', () => {
  const crossings: number[] = [];
  const east = [['coffee-a', 0], ['coffee-b', 0], ['treadmill', 0], ['treadmill-2', 0], ['treadmill-3', 0], ['balcony-a', 0], ['balcony-b', 0], ['pingpong-a', 0], ['ps5-a', 0], ['toilet', 0], ['desk', 4], ['desk', 7]] as Array<[string, number]>;
  const west = BEDS.map((bed): [string, number] => [bed.key, bed.seat]);
  for (const a of east) {
    for (const b of west) {
      for (const [from, to] of [[a, b], [b, a]]) {
        const way = routeFor(placeOf(...from).gate, placeOf(...to).gate);
        const m = measure(way);
        let before = m.at(0);
        for (let d = 2; d <= m.total; d += 2) {
          const at = m.at(d);
          if ((before.x < DOOR.x) !== (at.x < DOOR.x)) crossings.push(at.y);
          before = at;
        }
      }
    }
  }
  assert.equal(crossings.length, east.length * west.length * 2, 'every way crosses the wall, once');
  for (const y of crossings) assert.ok(y > DOOR.y0 && y < DOOR.y1, `the wall is crossed at y ${Math.round(y)}, in the door (${DOOR.y0} to ${DOOR.y1})`);
});

test('a sleeper is reached from the aisle, beside the bed, and the way to it does not go over another bed or the leaf of the door', () => {
  for (const bed of BEDS) {
    const place = placeOf(bed.key);
    assert.equal(place.seated, true, `${bed.key}: they lie with their hips on the mattress`);
    assert.equal(place.hop, true, `${bed.key}: they get on and off the bed from the aisle`);
    assert.ok(walkable(place.stand.x, place.stand.y), `${bed.key}: the aisle is open floor`);
    assert.ok(Math.abs(place.stand.x - bed.x) < BED.width / 2 + 40 && Math.abs(place.stand.x - bed.x) > BED.width / 2, `${bed.key}: beside the bed, not on it`);
    const way = routeFor(placeOf('desk', bed.seat).gate, place.gate);
    const m = measure(way);
    for (let d = 0; d <= m.total; d += 4) {
      const at = m.at(d);
      for (const other of BEDS) assert.ok(!(at.x > other.x - BED.width / 2 && at.x < other.x + BED.width / 2 && at.y > other.top && at.y < other.top + BED.height), `${bed.key}: not over bed ${other.seat} at ${JSON.stringify(at)}`);
      assert.ok(!(at.x > DOOR.x - 76 && at.x < DOOR.x + 4 && at.y > DOOR.y0 - 1 && at.y < DOOR.y0 + 26), `${bed.key}: not through the leaf of the door at ${JSON.stringify(at)}`);
    }
  }
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
  assert.ok(spotAt('treadmill')!.stand!.y > block('treadmill').y1, 'the treadmill is stepped onto from below its frame');
  assert.ok(spotAt('treadmill-2')!.stand!.y > block('second treadmill').y1, 'and so is the second');
  assert.ok(spotAt('treadmill-3')!.stand!.y > block('third treadmill').y1, 'and the third');
});
