// The Office widget's pure logic: where the desks are on marvis-office's plane, who sits where, where a head is for the name tag, what an
// idle person does and what changes when the list changes. What the widget looks like and does in a browser is checked against real WebGL
// elsewhere (tests/e2e); this is only the rules and the numbers that keep the scene the original's.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentColor, avatarOf, AVATARS, lookFor, ballPath, BALCONY_CROP, BED, BEDS, boardCounts, CAPACITY, chairBottom, SEATED_TOP, deskAt, DESKS, DOOR, employeesOf, fitScene, headPoint, HIPS_ABOVE_FEET, hipsOf, MODULES,
  paddles, PING_PONG, pickSpot, placeOf, plan, REST_SPOTS, SCENE, seatAnchor, seating, SLEEP_ROOM, SOFA_FRONT, SPOTS, spotAt, spreadTags, stateOf, stayFor, summarize, toCanvas, TOILET, TREADMILL, TREADMILLS, TV_SCREEN, WATER_BAR_Y, zoneOf,
} from '../host/dudu-plugin/ui/widgets/office/layout.js';

type Item = { id: number; status: string; agent?: string | null; agentState?: string; deepSleep?: boolean };
const issue = (id: number, status = 'in_progress', agentState = 'idle', agent: string | null = 'claude'): Item => ({ id, status, agent, agentState });
const working = (id: number, status = 'in_progress') => issue(id, status, 'working');
// The seven Active issues of the design frames, in the Issues default order.
const SEVEN = [issue(12, 'in_progress', 'blocked', 'deepseek'), issue(13, 'in_progress', 'blocked', 'claude'), issue(9, 'todo', 'idle', null), issue(14, 'in_progress', 'working', 'claude'),
  issue(10, 'todo', 'idle', 'deepseek'), issue(8, 'in_progress', 'blocked', 'claude'), issue(11, 'in_review', 'blocked', 'codex')];

test('there are eight desks, fixed, in two columns of four: both desks of the first row at one height, and no desk is different from another', () => {
  assert.equal(DESKS, 8);
  assert.deepEqual(Array.from({ length: 8 }, (_, seat) => { const { x, y } = deskAt(seat); return [x, y]; }), [[415, 90], [685, 90], [415, 339], [685, 339], [415, 601], [685, 601], [415, 863], [685, 863]]);
  assert.ok(Array.from({ length: 8 }, (_, seat) => deskAt(seat)).every((desk) => !('boss' in desk)), 'no desk is the boss\'s');
  assert.equal(deskAt(1).x - deskAt(0).x, 270, 'the empty column between the two columns of desks is narrower than marvis-office\'s (351)');
  // the rows after the first are one pitch apart, and a desk\'s chair does not reach the next desk\'s monitor (the way between the rows is open floor)
  for (let seat = 2; seat < DESKS - 2; seat++) assert.equal(deskAt(seat + 2).y - deskAt(seat).y, 262);
  assert.deepEqual(SCENE, { x: -791, y: 0, width: 1690, height: 1102 }, 'from the sleeping room\'s west wall to a little past the second column of desks, which ends at 875');
  for (let seat = 0; seat < DESKS; seat++) {
    const { x, y } = deskAt(seat);
    assert.ok(x >= SCENE.x && x + 183 <= SCENE.x + SCENE.width && y >= SCENE.y && y + 105 <= SCENE.y + SCENE.height, `desk ${seat}`);
    assert.ok(chairBottom(seat) > seatAnchor(seat).y && chairBottom(seat) > y + 105, `desk ${seat}: the chair reaches below the one who sits in it and below the desk, so it is drawn over them`);
  }
});

test('the plane is as wide as the widget\'s default size shows it and as tall as it needs: the people are as big as they were, in the default 5 x 3 cells', () => {
  // the default size is 5 columns and 3 rows of cells (a cell about a column wide, 12 apart): 5 * 100 + 4 * 12 by 3 * 100 + 2 * 12
  const box = { width: 548, height: 324 };
  const before = fitScene({ x: -398, y: 0, width: 1838, height: 900 }, box.width, box.height).scale; // the plane that was here until 2026-11-04
  const now = fitScene(SCENE, box.width, box.height).scale;
  assert.ok(Math.abs(now / before - 1) < 0.05, `the scale is within 5 % of what it was (${now.toFixed(4)} against ${before.toFixed(4)})`);
  const wide = fitScene(SCENE, box.width, box.height);
  const blank = (box.width - SCENE.width * wide.scale) / box.width;
  assert.ok(blank >= 0 && blank < 0.2, `the plane fills the height and leaves at most a fifth of the width blank (${(blank * 100).toFixed(1)} %)`);
});

test('the plane fits the canvas as useScene.ts of marvis-office fits it: padded to 0.98, centred', () => {
  const original = { x: 0, y: 0, width: 1200, height: 900 };
  const fit = fitScene(original, 1440, 900);
  assert.ok(Math.abs(fit.scale - 0.98) < 1e-9);
  assert.deepEqual(toCanvas(fit, { x: 600, y: 450 }), { x: 720, y: 450 }, 'the middle of the plane is the middle of the canvas');
  const narrow = fitScene(original, 600, 900);
  assert.ok(Math.abs(narrow.scale - (600 / 1200) * 0.98) < 1e-9, 'the width decides when it is the narrower');
  // our plane: still centred, and all of it inside
  const wide = fitScene(SCENE, 1000, 700);
  for (const corner of [{ x: SCENE.x, y: SCENE.y }, { x: SCENE.x + SCENE.width, y: SCENE.y + SCENE.height }]) {
    const at = toCanvas(wide, corner);
    assert.ok(at.x >= 0 && at.x <= 1000 && at.y >= 0 && at.y <= 700, JSON.stringify(at));
  }
  assert.ok(Math.abs(toCanvas(wide, { x: SCENE.x + SCENE.width / 2, y: SCENE.y + SCENE.height / 2 }).x - 500) < 1e-9);
  assert.ok(fitScene(SCENE, 0, 0).scale > 0, 'a canvas of no size does not divide by zero');
});

test('a person sits in the middle of the desk, and the name tag points just above the head', () => {
  for (let seat = 0; seat < DESKS; seat++) {
    const desk = deskAt(seat);
    const at = seatAnchor(seat);
    assert.equal(at.x, desk.x + 91, 'the middle of the desk (183 wide)');
    assert.ok(at.y > desk.y && at.y < desk.y + 105, 'behind the top of the chair, inside the desk');
    assert.equal(at.y, desk.y + 62, 'everybody sits the same way');
    const head = headPoint(at);
    assert.equal(head.x, at.x);
    assert.ok(head.y < at.y - SEATED_TOP, 'above the top of the bust');
  }
});

test('the activity area has two columns side by side, the sleeping room is west of it, and every place is inside the plane', () => {
  assert.deepEqual(MODULES.map(({ name, x, y }) => [name, x, y]), [['balcony', -50, 786], ['pingpong', -398, 30], ['ps5', -398, 386]], 'ping-pong at the top of the added column, the PS5 corner below it, the balcony at the foot of marvis-office\'s column');
  assert.deepEqual([TOILET.x, TOILET.y, TOILET.width, TOILET.height], [-398, 786, 398, 314], 'the toilet, the atlas\'s picture, is at the foot of the added column, level with the balcony');
  assert.equal(TOILET.y + TOILET.height, SCENE.height - 2, 'and both end where the plane does');
  const ps5 = MODULES.find((module) => module.name === 'ps5')!;
  assert.ok(DOOR.y0 > PING_PONG.bottom && DOOR.y1 < ps5.y + 11 && DOOR.y1 - DOOR.y0 >= 60, 'the door is under the ping-pong table and above the TV, and wide enough for a person');
  assert.equal(DOOR.x, SLEEP_ROOM.wall, 'it is in the sleeping room\'s east wall');
  assert.ok(SLEEP_ROOM.x + SLEEP_ROOM.width <= DOOR.x + 70 && SLEEP_ROOM.height === SCENE.height, 'the sleeping room is west of the wall and as tall as the plane');
  for (const spot of SPOTS) {
    assert.ok(spot.x > SCENE.x && spot.x < SCENE.x + SCENE.width && spot.y > SCENE.y && spot.y < SCENE.y + SCENE.height, spot.key);
  }
  assert.equal(new Set(SPOTS.map((spot) => spot.key)).size, SPOTS.length, 'keys are unique');
  // the places are apart from each other (a bust is about 50 wide)
  for (const a of SPOTS) for (const b of SPOTS) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 40, `${a.key} and ${b.key} are not on top of each other`);
  for (const spot of SPOTS.filter((one) => one.partner)) assert.equal(SPOTS.find((other) => other.key === spot.partner)?.partner, spot.key, `${spot.key}'s partner has it as theirs`);
  assert.deepEqual([...new Set(SPOTS.map((spot) => spot.kind))].sort(), ['balcony', 'bed', 'coffee', 'pingpong', 'ps5', 'toilet', 'treadmill']);
  assert.deepEqual(REST_SPOTS.map((spot) => spot.key), SPOTS.filter((spot) => spot.kind !== 'bed').map((spot) => spot.key), 'the activity area is every place but the beds');
  assert.equal(REST_SPOTS.filter((spot) => spot.kind === 'treadmill').length, 3, 'three treadmills (owner, 2026-11-07: one more)');
  assert.equal(spotAt('toilet')?.kind, 'toilet');
  assert.equal(spotAt('nowhere'), null);
  // the second and third treadmills are the first one\'s picture again: each belt is as far below the one before as the picture was moved
  assert.deepEqual(['treadmill', 'treadmill-2', 'treadmill-3'].map((key) => spotAt(key)!.y), TREADMILLS.map((treadmill) => treadmill.belt));
  assert.equal(spotAt('treadmill-2')!.y - spotAt('treadmill')!.y, TREADMILL.pitch);
  assert.equal(spotAt('treadmill-3')!.y - spotAt('treadmill-2')!.y, TREADMILL.pitch);
  // the PS5 corner\'s TV and sofa are drawn inside its module
  assert.ok(TV_SCREEN.x >= ps5.x && TV_SCREEN.x + TV_SCREEN.width <= ps5.x + ps5.width && TV_SCREEN.y >= ps5.y && TV_SCREEN.y + TV_SCREEN.height <= ps5.y + ps5.height);
  assert.ok(SOFA_FRONT.x >= ps5.x && SOFA_FRONT.y >= ps5.y && SOFA_FRONT.y < ps5.y + ps5.height);
});

test('there is a bed for each desk, in the sleeping room, two columns of four; whoever sleeps lies on it with their hips, from the aisle', () => {
  assert.equal(BEDS.length, DESKS);
  assert.deepEqual(BEDS.map((bed) => bed.key), Array.from({ length: DESKS }, (_, seat) => `bed-${seat}`), 'seat n sleeps in bed n');
  for (const bed of BEDS) {
    const place = placeOf(bed.key);
    assert.equal(bed.kind, 'bed');
    assert.ok(bed.x - BED.width / 2 > SCENE.x && bed.x + BED.width / 2 < SLEEP_ROOM.wall, `${bed.key} is inside the plane, west of the partition wall`);
    assert.ok(bed.y > bed.top && bed.y < bed.top + BED.height, `${bed.key}: the hips are on the mattress`);
    assert.equal(place.seated, true);
    assert.equal(place.hop, true, 'they lie down from the aisle: a short move from where they stand');
    assert.deepEqual(place.gate, place.stand);
    assert.ok(Math.abs(place.stand.x - bed.x) > BED.width / 2 && Math.abs(place.stand.x - bed.x) < BED.width / 2 + 40, `${bed.key}: they stand beside the bed, in the aisle`);
  }
  // two columns, left to right, and the rows one under the other, as the desks are
  assert.deepEqual([...new Set(BEDS.map((bed) => bed.x))].length, 2);
  assert.deepEqual([...new Set(BEDS.map((bed) => bed.top))].length, 4);
  assert.ok(BEDS[0].x < BEDS[1].x && BEDS[0].top === BEDS[1].top && BEDS[2].top > BEDS[0].top);
  // the aisle is between the two columns, and nobody has to cross a bed to get to theirs
  const aisle = [BEDS[0].x + BED.width / 2, BEDS[1].x - BED.width / 2];
  for (const bed of BEDS) assert.ok(bed.stand.x > aisle[0] && bed.stand.x < aisle[1], `${bed.key}'s stand is in the aisle`);
});

test('three treadmills stand in marvis-office\'s column between the water bar and the balcony, one picture each, without touching each other or either of them', () => {
  assert.equal(TREADMILLS.length, 3);
  assert.deepEqual(TREADMILLS.map((treadmill) => treadmill.key), ['treadmill', 'treadmill-2', 'treadmill-3']);
  const balcony = MODULES.find((module) => module.name === 'balcony')!;
  // the picture has 311 rows and what is drawn in it is from row 50 to row 222: each copy is drawn from row `cut` to row `bottom`, which holds all of that
  assert.ok(TREADMILL.cut <= 50 && TREADMILL.bottom >= 222 && TREADMILL.bottom <= 311, 'the rows that are left out have nothing drawn in them');
  const water = { drawnTo: WATER_BAR_Y + 215 }; // the water bar's picture has nothing drawn below its row 215
  const drawn = TREADMILLS.map((treadmill) => ({ from: treadmill.picture - TREADMILL.cut + 50, to: treadmill.picture - TREADMILL.cut + 222 }));
  assert.ok(drawn[0].from > water.drawnTo, `the first treadmill is drawn below the water bar (${drawn[0].from} > ${water.drawnTo})`);
  for (let k = 1; k < drawn.length; k++) assert.ok(drawn[k].from >= drawn[k - 1].to - 2, `treadmill ${k + 1} starts where treadmill ${k}'s drawing ends (${drawn[k].from} against ${drawn[k - 1].to})`);
  // the balcony's picture starts with `BALCONY_CROP` rows of floor, which are not drawn; what is drawn of it starts at row 33
  assert.ok(drawn[2].to <= balcony.y + BALCONY_CROP + 33, `the last treadmill is drawn down to ${drawn[2].to}, above the balcony's railing at ${balcony.y + BALCONY_CROP + 33}`);
  for (const treadmill of TREADMILLS) {
    const place = placeOf(treadmill.key);
    assert.equal(treadmill.belt - treadmill.footprint.y0, 156 - 45, 'the belt is where the picture has it, in its footprint');
    assert.ok(place.stand.y > treadmill.footprint.y1 && place.stand.y < treadmill.footprint.y1 + 30, 'the floor in front of it is just below the footprint');
    assert.ok(place.stand.y < balcony.y + BALCONY_CROP + 33 - 20, 'and above the balcony');
  }
  // the lane between one treadmill's footprint and the next (the floor to stand on, walked along) is wide enough for a person and the margin of the grid routes are found on
  for (let k = 1; k < TREADMILLS.length; k++) assert.ok(TREADMILLS[k].footprint.y0 - TREADMILLS[k - 1].footprint.y1 >= 30, `the lane in front of treadmill ${k} is at least 30 wide`);
});

test('whoever is awake and not working goes to a free place of the activity area picked at random, the same one each time; a pair is made before a lone player; the beds are not among them', () => {
  const none = new Set<string>();
  const first = pickSpot(none, 7);
  assert.ok(first && REST_SPOTS.some((spot) => spot.key === first));
  assert.equal(pickSpot(none, 7), first, 'the same issue, the same place');
  // issues differ, and so does the same issue after it has moved
  assert.ok(new Set(Array.from({ length: 40 }, (_, id) => pickSpot(none, id + 1))).size >= 6, 'many places are used');
  for (let id = 1; id <= 60; id++) for (let epoch = 0; epoch < 4; epoch++) assert.notEqual(spotAt(pickSpot(none, id, epoch))?.kind, 'bed', 'whoever waits does not go to bed');
  assert.ok(new Set(Array.from({ length: 12 }, (_, epoch) => pickSpot(none, 7, epoch))).size >= 3, 'the same issue goes to different places in turn');
  // a taken place is not given again, and every place taken means none
  const all = new Set(REST_SPOTS.map((spot) => spot.key));
  assert.equal(pickSpot(all, 7), null);
  const left = new Set(all);
  left.delete('toilet');
  assert.equal(pickSpot(left, 7), 'toilet');
  assert.equal(pickSpot(left, 7, 0, ['toilet']), null, 'one that is to be avoided is not picked');
  // somebody waits at the ping-pong table: the next goes there, whoever they are
  for (let id = 1; id <= 30; id++) assert.equal(pickSpot(new Set(['pingpong-a']), id, 0, [], { idleCount: 2 }), 'pingpong-b');
  for (let id = 1; id <= 30; id++) assert.equal(pickSpot(new Set(['ps5-b']), id), 'ps5-a');
  // how long they stay
  for (let id = 1; id <= 50; id++) for (let epoch = 0; epoch < 4; epoch++) assert.ok(stayFor(id, epoch) >= 40 && stayFor(id, epoch) <= 90);
});

test('ping-pong is unavailable with fewer than two idle employees, even if every solo activity is occupied', () => {
  const soloSpots = new Set(SPOTS.filter((spot) => spot.kind !== 'pingpong').map((spot) => spot.key));
  for (const idleCount of [0, 1]) {
    for (let id = 1; id <= 40; id++) {
      assert.equal(pickSpot(soloSpots, id, 0, [], { idleCount }), null);
      assert.notEqual(spotAt(pickSpot(new Set(), id, 0, [], { idleCount }))?.kind, 'pingpong');
    }
  }
  assert.equal(spotAt(pickSpot(soloSpots, 1, 0, [], { idleCount: 2 }))?.kind, 'pingpong');
});

test('the first to the sofa sits at the far end; nobody has to climb over anybody to sit down', () => {
  const none = new Set<string>();
  for (let id = 1; id <= 60; id++) for (let epoch = 0; epoch < 4; epoch++) assert.notEqual(pickSpot(none, id, epoch), 'ps5-b', 'the near seat waits for the far one');
  const others = SPOTS.map((spot) => spot.key).filter((key) => !key.startsWith('ps5'));
  assert.equal(pickSpot(new Set(others), 3), 'ps5-a', 'with the sofa empty, only the far seat is free');
  assert.equal(pickSpot(new Set([...others, 'ps5-a']), 3), 'ps5-b', 'then the near one');
  assert.equal(spotAt('ps5-b')?.after, 'ps5-a');
});

test('where somebody stands, arrives and rests: at a desk, on the toilet, on the sofa, on a treadmill', () => {
  assert.equal(HIPS_ABOVE_FEET, 30);
  assert.deepEqual(hipsOf({ x: 10, y: 100 }), { x: 10, y: 70 });
  for (let seat = 0; seat < DESKS; seat++) {
    const desk = deskAt(seat);
    const place = placeOf('desk', seat);
    assert.deepEqual(place.rest, seatAnchor(seat));
    assert.deepEqual(place.stand, { x: seatAnchor(seat).x, y: seatAnchor(seat).y + HIPS_ABOVE_FEET }, 'getting up, the feet land under the hips');
    assert.deepEqual(hipsOf(place.stand), place.rest, 'so that standing up from the desk is not a move');
    assert.equal(place.seated, true);
    assert.equal(place.hop, false);
    assert.ok(place.gate.x < desk.x + 20 && place.gate.y > desk.y + 105, 'the way out is at the left end of the desk, in front of it');
  }
  // the toilet faces right: they sit on the seat, and walk up to it from the front
  const toilet = placeOf('toilet');
  assert.equal(toilet.seated, true);
  assert.equal(toilet.hop, true);
  assert.ok(toilet.stand.x > toilet.rest.x + 40, 'the floor in front of it is to the right of the seat');
  assert.ok(toilet.stand.y > toilet.rest.y + HIPS_ABOVE_FEET, 'on the floor, below the seat');
  // the sofa is climbed into from its right side; the treadmill is stepped onto from its front, and is not sat on
  for (const key of ['ps5-a', 'ps5-b']) {
    const place = placeOf(key);
    assert.equal(place.seated, true);
    assert.ok(place.stand.x > -64, `${key}: the right of the sofa's right arm`);
    assert.equal(place.stand.y, place.rest.y + HIPS_ABOVE_FEET);
  }
  for (const key of ['treadmill', 'treadmill-2', 'treadmill-3']) {
    const treadmill = placeOf(key);
    assert.equal(treadmill.seated, false);
    assert.equal(treadmill.hop, true);
    assert.ok(treadmill.stand.y > treadmill.rest.y);
  }
  // where they just stand, there is nothing to step over
  for (const key of ['coffee-a', 'coffee-b', 'pingpong-a', 'pingpong-b', 'balcony-a', 'balcony-b']) {
    const place = placeOf(key);
    assert.deepEqual([place.stand, place.gate], [place.rest, place.rest], key);
    assert.equal(place.hop, false);
  }
});

test('ping-pong is played from the two ends of the table, facing each other, and the ball goes between the paddles', () => {
  const [a, b] = [spotAt('pingpong-a')!, spotAt('pingpong-b')!];
  assert.ok(a.x < PING_PONG.left && b.x > PING_PONG.right, 'a at the left end, b at the right end: not at the long sides');
  assert.equal(a.y, b.y, 'level with each other');
  assert.deepEqual([a.face, b.face], [1, -1], 'a faces right, b faces left');
  assert.ok(PING_PONG.left < -290 && PING_PONG.right > -60 && PING_PONG.left - a.x < 30 && b.x - PING_PONG.right < 30, 'close to the ends');
  assert.ok(PING_PONG.right - PING_PONG.left < 260 && PING_PONG.top < PING_PONG.line && PING_PONG.line < PING_PONG.bottom, 'the table is the smaller one (245 long), and its middle line is on its top');
  const hands = paddles(a, b);
  assert.ok(hands.a.x > a.x && hands.b.x < b.x, 'each paddle is held out in front of its player');
  assert.ok(hands.a.y < a.y && hands.b.y < b.y, 'above their feet');
  // one flight: from the hitter's paddle to the other's, once on the table in between, over the net, never below the table
  const start = ballPath(0, hands.a, hands.b);
  const end = ballPath(1, hands.a, hands.b);
  assert.deepEqual([Math.round(start.x), Math.round(start.y)], [Math.round(hands.a.x), Math.round(hands.a.y)]);
  assert.deepEqual([Math.round(end.x), Math.round(end.y)], [Math.round(hands.b.x), Math.round(hands.b.y)]);
  let touches = 0;
  let previous = ballPath(0, hands.a, hands.b);
  for (let k = 0.01; k <= 1; k += 0.01) {
    const at = ballPath(k, hands.a, hands.b);
    assert.ok(at.x >= previous.x, 'it only goes forward');
    assert.ok(at.y <= PING_PONG.line + 0.5, 'not under the table top');
    if (Math.abs(at.y - PING_PONG.line) < 0.6) touches += 1;
    previous = at;
  }
  assert.ok(touches >= 1 && touches <= 4, `it touches the table (${touches} steps)`);
  const net = ballPath(((PING_PONG.left + PING_PONG.right) / 2 - hands.a.x) / (hands.b.x - hands.a.x), hands.a, hands.b);
  assert.ok(net.y < PING_PONG.line - 8, 'it clears the net');
  // and back
  const back = ballPath(0, hands.b, hands.a);
  assert.deepEqual([Math.round(back.x), Math.round(back.y)], [Math.round(hands.b.x), Math.round(hands.b.y)]);
});

test('the most urgent sit at the first desks; the rest are "+N"; only Active issues sit', () => {
  const list = [working(1), working(2, 'backlog'), working(3, 'done'), working(1), ...Array.from({ length: 10 }, (_, i) => working(i + 4))];
  const { seated, overflow } = seating(list);
  assert.deepEqual(seated.map(({ id, seat }) => [id, seat]), [[1, 0], ...Array.from({ length: 7 }, (_, i) => [i + 4, i + 1])]);
  assert.deepEqual(overflow.map(({ id }) => id), [11, 12, 13]);
  assert.deepEqual(employeesOf(list).map(({ id }) => id).slice(0, 3), [1, 4, 5]);
  for (const [count, sits, over] of [[0, 0, 0], [1, 1, 0], [8, 8, 0], [9, 8, 1]] as const) {
    const r = seating(Array.from({ length: count }, (_, i) => working(i + 1)));
    assert.deepEqual([r.seated.length, r.overflow.length], [sits, over]);
  }
});

const asleep = (id: number, state = 'idle') => ({ ...issue(id, 'in_progress', state), deepSleep: true });
const blocked = (id: number) => issue(id, 'in_progress', 'blocked');

test('whoever is where: a desk for whoever works, a bed only for whoever\'s agent is in deep sleep, the activity area for everybody else (idle or waiting for the owner)', () => {
  assert.equal(zoneOf(working(1)), 'working');
  assert.equal(zoneOf(blocked(2)), 'resting', 'waiting for the owner: the activity area');
  assert.equal(zoneOf(issue(3)), 'resting', 'idle: the activity area too, not a bed (owner, 2026-11-07)');
  assert.equal(zoneOf(asleep(4)), 'sleeping', 'idle and in deep sleep: a bed');
  assert.equal(zoneOf(asleep(5, 'blocked')), 'sleeping', 'a finished run that waits for a look, in deep sleep: a bed');
  assert.equal(zoneOf({ ...issue(6), deepSleep: false }), 'resting');
  assert.equal(zoneOf({ ...issue(7), deepSleep: 'yes' as unknown as boolean }), 'resting', 'only the server\'s true counts');
  assert.equal(zoneOf({ ...working(8), deepSleep: true }), 'working', 'nobody who works is asleep');
  assert.equal(zoneOf(null), 'resting');
  assert.deepEqual(CAPACITY, { working: 8, resting: 10, sleeping: 8 }, 'eight desks, eight beds, and ten places in the activity area (twelve spots, two of which are a ping-pong pair)');
  assert.equal(CAPACITY.resting, REST_SPOTS.filter((spot) => spot.kind !== 'pingpong').length, 'ten is how many can have a place without a pair');
});

test('each part of the office has places of its own: nobody is "+N" while the places of their part are free (a ninth person with the desks empty was "+1")', () => {
  // the owner's case (2026-11-05): nine people, two at desks, three idle, four waiting for the owner: six desks free, and still the ninth had no place
  const nine = [working(1), blocked(2), issue(3), working(4), issue(5), blocked(6), issue(7), blocked(8), blocked(9)];
  const mixed = seating(nine);
  assert.deepEqual([mixed.seated.length, mixed.overflow.length], [9, 0]);
  assert.deepEqual(mixed.seated.map(({ id, zone }) => [id, zone]), [[1, 'working'], [2, 'resting'], [3, 'resting'], [4, 'working'], [5, 'resting'], [6, 'resting'], [7, 'resting'], [8, 'resting'], [9, 'resting']],
    'the two who work have desks; the seven who are idle or wait for the owner are in the activity area, together');
  // hot desks: the first who works sits at the first desk, the next at the next free one; each part counted by itself
  assert.deepEqual(mixed.seated.map(({ seat }) => seat), [0, 0, 1, 1, 2, 3, 4, 5, 6]);
  for (const zone of ['working', 'resting', 'sleeping']) {
    const seats = mixed.seated.filter((one) => one.zone === zone).map(({ seat }) => seat);
    assert.equal(new Set(seats).size, seats.length, `${zone}: no two people have the same number`);
  }
  // only when the places of a part are taken is the next of that part "+N"; the other parts are not asked
  const kinds: [string, (id: number) => Item, number][] = [['working', working, DESKS], ['activity area', (id) => (id % 2 ? issue(id) : blocked(id)), CAPACITY.resting], ['beds', (id) => asleep(id), BEDS.length]];
  for (const [name, make, places] of kinds) {
    const crowd = seating(Array.from({ length: places + 1 }, (_, i) => make(i + 1)));
    assert.deepEqual([crowd.seated.length, crowd.overflow.length, crowd.overflow[0].id], [places, 1, places + 1], `${name}: one more than the places`);
  }
  const all = seating([...Array.from({ length: 8 }, (_, i) => working(i + 1)), ...Array.from({ length: 8 }, (_, i) => asleep(i + 11)), ...Array.from({ length: 10 }, (_, i) => (i % 2 ? issue(i + 21) : blocked(i + 21))), working(99)]);
  assert.deepEqual([all.seated.length, all.overflow.map(({ id }) => id)], [26, [99]], 'eight at desks, eight in bed, ten in the activity area, and the ninth who works has no desk');
});

test('desks are hot: whoever starts to work takes a free desk and keeps it, nobody walks because the list changed its order', () => {
  const list = [blocked(1), working(2), issue(3), working(4)];
  const first = plan([], list);
  assert.deepEqual(first.enter.map(({ id, seat }) => [id, seat]), [[1, 0], [2, 0], [3, 1], [4, 1]], 'the first who works has the first desk, whoever the list puts first; the two in the activity area have numbers of their own');
  // the same people in another order: nobody moves
  const shuffled = plan(first.seats, [working(4), issue(3), working(2), blocked(1)]);
  assert.deepEqual([shuffled.stay.length, shuffled.move.length, shuffled.enter.length, shuffled.leave.length], [4, 0, 0, 0]);
  // 1 comes to work: the desks are free but 0 and 1, so it takes the next one
  const started = plan(first.seats, [working(1), working(2), issue(3), working(4)]);
  assert.deepEqual(started.move.map(({ id, from, to }) => [id, from, to]), [[1, 0, 2]]);
  assert.equal(started.stay.length, 3);
  // 2 stops working: it goes to the activity area, to the first number nobody there has
  const stopped = plan(first.seats, [blocked(1), issue(2), issue(3), working(4)]);
  assert.deepEqual(stopped.move.map(({ id, from, to }) => [id, from, to]), [[2, 0, 2]]);
  assert.deepEqual(stopped.seats.map(({ id, zone }) => [id, zone]), [[1, 'resting'], [2, 'resting'], [3, 'resting'], [4, 'working']]);
  // with all the desks taken the ninth who works is "+N"; when one of the eight stops, the ninth sits at that desk
  const eight = Array.from({ length: 9 }, (_, i) => working(i + 1));
  const full = plan([], eight);
  assert.deepEqual([full.seats.length, full.overflow], [8, 1]);
  const freed = plan(full.seats, [issue(3, 'in_progress', 'idle'), ...eight.filter((one) => one.id !== 3)]);
  assert.deepEqual(freed.enter.map(({ id, seat }) => [id, seat]), [[9, 2]], 'the ninth takes the desk that was freed');
  assert.equal(freed.overflow, 0);
});

test('whoever sleeps keeps their bed for as long as they sleep, whatever happens to the list (nobody gets up to change beds)', () => {
  const sleepers = [asleep(1), asleep(2), asleep(3), asleep(4)];
  const first = plan([], sleepers);
  assert.deepEqual(first.seats.map(({ id, seat, zone }) => [id, seat, zone]), [[1, 0, 'sleeping'], [2, 1, 'sleeping'], [3, 2, 'sleeping'], [4, 3, 'sleeping']], 'the beds fill from the first');
  const bedOf = (seats: { id: number; seat: number }[], id: number) => seats.find((one) => one.id === id)?.seat;
  // another order, others in front of them, one of them awake and back, one gone, new ones: every one who is still asleep is in the bed they were in
  const lists: Item[][] = [
    [asleep(4), asleep(3), asleep(2), asleep(1)],
    [working(9), blocked(8), asleep(3), asleep(1), asleep(7), asleep(4), asleep(2)],
    [asleep(2), asleep(10), asleep(11), asleep(1), asleep(3), asleep(4)],
    [issue(1), asleep(2), asleep(3), asleep(4)], // 1 woke up
    [asleep(1), asleep(2), asleep(3), asleep(4)], // and fell asleep again: the first free bed, which is the one it left
  ];
  let seats = first.seats;
  for (const list of lists) {
    const next = plan(seats, list);
    for (const sleeper of seats.filter((one) => one.zone === 'sleeping')) {
      const still = list.find((one) => one.id === sleeper.id && zoneOf(one) === 'sleeping');
      if (still && !next.leave.some((one) => one.id === sleeper.id)) assert.equal(bedOf(next.seats, sleeper.id), sleeper.seat, `${sleeper.id} is in bed ${sleeper.seat} still`);
    }
    assert.equal(new Set(next.seats.filter((one) => one.zone === 'sleeping').map((one) => one.seat)).size, next.seats.filter((one) => one.zone === 'sleeping').length, 'no two share a bed');
    seats = next.seats;
  }
  // and over a long run of lists that change all the time: a person who sleeps in two looks in a row has the same bed in both
  let random = 12345;
  const next01 = () => { random = (Math.imul(random, 1103515245) + 12345) >>> 0; return random / 2 ** 32; };
  let before: { id: number; seat: number; zone: string }[] = [];
  for (let round = 0; round < 300; round++) {
    const list: Item[] = Array.from({ length: 14 }, (_, i) => i + 1).filter(() => next01() < 0.8).map((id) => {
      const roll = next01();
      return roll < 0.55 ? asleep(id, roll < 0.3 ? 'idle' : 'blocked') : roll < 0.75 ? working(id) : roll < 0.9 ? issue(id) : blocked(id);
    }).sort(() => next01() - 0.5);
    const after = plan(before, list);
    for (const person of after.seats.filter((one) => one.zone === 'sleeping')) {
      const was = before.find((one) => one.id === person.id);
      if (was?.zone === 'sleeping') assert.equal(person.seat, was.seat, `round ${round}: ${person.id} stays in bed ${was.seat}`);
    }
    before = after.seats;
  }
});

test('a part with no room moves nobody to make room: whoever has none is outside, and walks in when a place is free (owner, 2026-11-07)', () => {
  // nine sleepers, eight beds: the ninth has no bed whatever the order of the list, and nobody who has one loses it for it
  const nine = Array.from({ length: 9 }, (_, i) => asleep(i + 1));
  const first = plan([], nine);
  assert.deepEqual([first.seats.length, first.overflow], [8, 1]);
  const reversed = plan(first.seats, [...nine].reverse());
  assert.deepEqual([reversed.stay.length, reversed.move.length, reversed.enter.length, reversed.leave.length, reversed.overflow], [8, 0, 0, 0, 1], 'the ninth stays outside, nobody swaps with them');
  // somebody in the activity area falls asleep with every bed taken: they have no bed, so they go out (and nobody else moves)
  const mixed = plan([], [...Array.from({ length: 8 }, (_, i) => asleep(i + 1)), issue(9)]);
  const falls = plan(mixed.seats, [...Array.from({ length: 8 }, (_, i) => asleep(i + 1)), asleep(9)]);
  assert.deepEqual(falls.leave.map(({ id, reason }) => [id, reason]), [[9, 'overflow']]);
  assert.equal(falls.stay.length, 8);
  // a bed is free again: the one who was outside enters, and nobody else moves
  const woke = plan(falls.seats, [issue(1), ...Array.from({ length: 7 }, (_, i) => asleep(i + 2)), asleep(9)]);
  assert.deepEqual(woke.enter.map(({ id, seat }) => [id, seat]), [[9, 0]], 'the first bed that was freed');
  // over a long run of lists that change all the time, with more sleepers than beds: whoever slept in a bed and still sleeps is in the same bed, and never gets pushed out
  let random = 777;
  const next01 = () => { random = (Math.imul(random, 1103515245) + 12345) >>> 0; return random / 2 ** 32; };
  let before: { id: number; seat: number; zone: string }[] = [];
  for (let round = 0; round < 300; round++) {
    const list: Item[] = Array.from({ length: 14 }, (_, i) => i + 1).filter(() => next01() < 0.9).map((id) => (next01() < 0.8 ? asleep(id) : issue(id))).sort(() => next01() - 0.5);
    const after = plan(before, list);
    for (const person of before.filter((one) => one.zone === 'sleeping')) {
      const stillAsleep = list.some((one) => one.id === person.id && zoneOf(one) === 'sleeping');
      if (stillAsleep) assert.equal(after.seats.find((one) => one.id === person.id)?.seat, person.seat, `round ${round}: ${person.id} keeps bed ${person.seat}`);
    }
    before = after.seats;
  }
});

test('custom workflow statuses keep active employees and whiteboard counts using their canonical type', () => {
  const list = [
    { ...issue(1, 'custom-started', 'working'), statusType: 'in_progress' },
    { ...issue(2, 'custom-review', 'blocked'), statusType: 'in_review' },
    { ...issue(3, 'custom-ready', 'idle', null), statusType: 'todo' },
    { ...issue(4, 'custom-finished', 'blocked'), statusType: 'done' },
  ];
  assert.deepEqual(employeesOf(list.filter((item) => item.agent)).map(({ id }) => id), [1, 2]);
  assert.deepEqual(boardCounts(list), [1, 0, 1, 1]);
  assert.equal(plan([{ id: 4, seat: 0 }], list).leave[0].reason, 'done');
});

test('the numbers on the widget: states, totals and what the one sentence says', () => {
  assert.deepEqual(summarize(SEVEN), { total: 7, working: 1, blocked: 4, idle: 2 });
  assert.deepEqual(boardCounts(SEVEN), [1, 1, 4, 1], 'unassigned, todo, in progress, in review');
  assert.deepEqual(boardCounts([]), [0, 0, 0, 0]);
  assert.equal(stateOf({ agentState: 'blocked' }), 'blocked');
  assert.equal(stateOf({ agentState: 'nonsense' }), 'idle');
  assert.equal(stateOf(null), 'idle');
});

test('nobody drawn shares a look while there are looks left: a taken look moves to the next free one', () => {
  const ids = Array.from({ length: 400 }, (_, i) => i + 1);
  const first = ids.find((id) => ids.some((other) => other !== id && avatarOf(other) === avatarOf(id)))!;
  const second = ids.find((id) => id !== first && avatarOf(id) === avatarOf(first))!;
  assert.equal(lookFor(first, []), avatarOf(first), 'alone: its own look');
  assert.equal(lookFor(first, [avatarOf(first)]) === avatarOf(first), false, 'taken: another look');
  const looks: number[] = [];
  for (const id of [first, second, ...ids.slice(0, 14)]) looks.push(lookFor(id, looks));
  assert.equal(new Set(looks).size, 16, 'sixteen people, sixteen different looks');
  assert.equal(lookFor(second, [avatarOf(second), avatarOf(second)]) === avatarOf(second), false);
  const crowd: number[] = [];
  for (let i = 0; i < 40; i++) crowd.push(lookFor(i + 1, crowd));
  const counts = new Array(16).fill(0);
  for (const look of crowd) counts[look] += 1;
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'more people than looks: spread as evenly as can be');
});

test('the same issue is always the same person: one of the 16 avatars of the sheet; and the agent has a colour', () => {
  assert.equal(AVATARS, 16);
  for (let id = 1; id <= 60; id++) {
    assert.equal(avatarOf(id), avatarOf(id));
    assert.ok(avatarOf(id) >= 0 && avatarOf(id) < AVATARS);
  }
  assert.ok(new Set(Array.from({ length: 60 }, (_, i) => avatarOf(i + 1))).size >= 12, 'many different people');
  assert.equal(avatarOf('DUD-4'), avatarOf('DUD-4'), 'an id that is not a number');
  assert.deepEqual([agentColor('claude'), agentColor('Claude'), agentColor('codex'), agentColor('chatgpt'), agentColor('deepseek')], [0xd97757, 0xd97757, 0x19a58a, 0x19a58a, 0x4d6bfe]);
  assert.equal(agentColor('somebody-new'), agentColor('somebody-new'));
  assert.notEqual(agentColor('somebody-new'), agentColor(null), 'no agent is grey, another agent is not');
});

test('a changed list tells who stays, moves, enters and leaves (and why)', () => {
  const first = plan([], [working(1), working(2), working(3)]);
  assert.deepEqual(first.enter.map(({ id, seat }) => [id, seat]), [[1, 0], [2, 1], [3, 2]]);
  // 2 is done, 4 is new and urgent, 1 changes its state only: it rests, with the number it had
  const next = plan(first.seats, [working(4), issue(1, 'in_progress', 'blocked'), working(2, 'done'), working(3)]);
  assert.deepEqual(next.enter.map(({ id, seat }) => [id, seat]), [[4, 0]], 'the new one takes the first free desk, which 1 and 2 have left');
  assert.deepEqual(next.move, []);
  assert.deepEqual(next.stay.map(({ id }) => id).sort(), [1, 3]);
  assert.deepEqual(next.leave.map(({ id, reason }) => [id, reason]), [[2, 'done']]);
  // 1 comes back to work: the first desk is 4's, so it takes the first free one
  const same = plan(next.seats, [working(4), working(1), working(3)]);
  assert.deepEqual(same.move.map(({ id, from, to }) => [id, from, to]), [[1, 0, 1]]);
  assert.deepEqual([same.stay.length, same.enter.length, same.leave.length], [2, 0, 0]);
  // a more urgent issue takes nobody's desk: with every desk taken it has none (it is outside), and nobody is bumped; one that is gone, or in Backlog, goes
  const full = plan([], Array.from({ length: 8 }, (_, i) => working(i + 1)));
  const crowded = plan(full.seats, [working(99), ...Array.from({ length: 8 }, (_, i) => working(i + 1))]);
  assert.deepEqual([crowded.leave, crowded.enter, crowded.move, crowded.stay.length, crowded.overflow], [[], [], [], 8, 1]);
  const gone = plan(full.seats, [working(1), working(2, 'backlog'), ...Array.from({ length: 5 }, (_, i) => working(i + 3))]);
  assert.deepEqual(gone.leave.map(({ id, reason }) => [id, reason]).sort(), [[2, 'backlog'], [8, 'gone']]);
  assert.equal(plan(first.seats, [working(1), working(2), working(3)]).move.length, 0, 'the same list in the same order is no movement at all');
});

test('name tags that would cover each other are lifted, front to back, and the rest stay at their heads', () => {
  const sizes = new Map([[1, { width: 80, height: 24 }], [2, { width: 80, height: 24 }], [3, { width: 80, height: 24 }], [4, { width: 80, height: 24 }]]);
  const apart = spreadTags(new Map([[1, { x: 100, y: 300 }], [2, { x: 300, y: 300 }], [3, { x: 100, y: 200 }]]), sizes);
  assert.deepEqual([...apart.values()].map((tag) => tag.lift), [0, 0, 0], 'far apart, or far enough above, nothing moves');
  const touching = spreadTags(new Map([[1, { x: 100, y: 300 }], [2, { x: 100 + 80 - 4, y: 300 }]]), sizes);
  assert.deepEqual([...touching.values()].map((tag) => tag.lift), [0, 0], 'tags that only touch at their rounded ends stay where they are');
  // three heads close together, the lowest on the screen first: the next is lifted over its tag, the last over both
  const crowd = spreadTags(new Map([[1, { x: 100, y: 200 }], [2, { x: 130, y: 190 }], [3, { x: 160, y: 180 }]]), sizes);
  assert.deepEqual([crowd.get(1)!.lift, crowd.get(2)!.lift, crowd.get(3)!.lift], [0, 24 + 2 - 10, 2 * (24 + 2) - 20], 'each is lifted just clear of the one in front of it');
  assert.deepEqual([crowd.get(1)!.x, crowd.get(2)!.x, crowd.get(3)!.x], [100, 130, 160], 'never sideways: the tag stays over its head');
  const boxes = [1, 2, 3].map((id) => ({ x: crowd.get(id)!.x, bottom: crowd.get(id)!.y }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    assert.ok(Math.abs(boxes[i].x - boxes[j].x) >= 80 || Math.abs(boxes[i].bottom - boxes[j].bottom) >= 24, `tags ${i + 1} and ${j + 1} do not overlap`);
  }
  // a tag it knows no size of still gets the usual one; the order of the heads in the map does not matter
  const unknown = spreadTags(new Map([[5, { x: 100, y: 190 }], [6, { x: 110, y: 200 }]]), new Map());
  assert.deepEqual([unknown.get(6)!.lift, unknown.get(5)!.lift], [0, 17 + 2 - 10], 'the usual size is 62 by 17, a tag as it is drawn');
  assert.equal(spreadTags(new Map(), sizes).size, 0);
});
