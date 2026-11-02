// The Office widget's pure logic: where the desks are on marvis-office's plane, who sits where, where a head is for the name tag, what an
// idle person does and what changes when the list changes. What the widget looks like and does in a browser is checked against real WebGL
// elsewhere (tests/e2e); this is only the rules and the numbers that keep the scene the original's.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentColor, avatarOf, AVATARS, ballPath, boardCounts, SEATED_TOP, deskAt, DESKS, DOOR, employeesOf, fitScene, headPoint, HIPS_ABOVE_FEET, hipsOf, MODULES, MODULE_WIDTH,
  paddles, PING_PONG, pickSpot, placeOf, plan, SCENE, seatAnchor, seating, SOFA_FRONT, SPOTS, spotAt, spreadTags, stateOf, stayFor, summarize, toCanvas, TOILET, TV_SCREEN,
} from '../host/dudu-plugin/ui/widgets/office/layout.js';

type Item = { id: number; status: string; agent?: string | null; agentState?: string };
const issue = (id: number, status = 'in_progress', agentState = 'idle', agent: string | null = 'claude'): Item => ({ id, status, agent, agentState });
const working = (id: number, status = 'in_progress') => issue(id, status, 'working');
// The seven Active issues of the design frames, in the Issues default order.
const SEVEN = [issue(12, 'in_progress', 'needs_you', 'deepseek'), issue(13, 'in_progress', 'stuck', 'claude'), issue(9, 'todo', 'idle', null), issue(14, 'in_progress', 'working', 'claude'),
  issue(10, 'todo', 'idle', 'deepseek'), issue(8, 'in_progress', 'needs_you', 'claude'), issue(11, 'in_review', 'idle', 'codex')];

test('there are nine desks, fixed: the six where marvis-office puts them (roles.ts: deskPosition of Marvis, App, Computer, Browser, File and Search) and a third column', () => {
  assert.equal(DESKS, 9);
  assert.deepEqual(Array.from({ length: 9 }, (_, seat) => { const { x, y } = deskAt(seat); return [x, y]; }), [[515, 66], [866, 90], [1217, 90], [515, 350], [866, 350], [1217, 350], [515, 650], [866, 650], [1217, 650]]);
  assert.deepEqual(Array.from({ length: 9 }, (_, seat) => deskAt(seat).boss), [true, ...Array(8).fill(false)], 'the first desk is the boss\'s');
  // the third column is as far from the second as the second is from the first; every desk is inside the plane
  assert.equal(deskAt(2).x - deskAt(1).x, 351);
  assert.equal(deskAt(1).x - deskAt(0).x, 351);
  assert.deepEqual(SCENE, { x: -MODULE_WIDTH, y: 0, width: MODULE_WIDTH + 1440, height: 900 }, 'a little past the third column of desks, which end at 1400');
  for (let seat = 0; seat < DESKS; seat++) {
    const { x, y } = deskAt(seat);
    assert.ok(x >= SCENE.x && x + 183 <= SCENE.x + SCENE.width && y >= SCENE.y && y + 105 <= SCENE.y + SCENE.height, `desk ${seat}`);
  }
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
    assert.equal(at.y, desk.y + (seat === 0 ? 80 : 62), 'the boss sits lower, in front of the monitor');
    const head = headPoint(at);
    assert.equal(head.x, at.x);
    assert.ok(head.y < at.y - SEATED_TOP, 'above the top of the bust');
  }
});

test('the new column is level with the original one, to its left, and its places are inside the plane', () => {
  assert.deepEqual(MODULES.map(({ name, x, y }) => [name, x, y]), [['pingpong', -398, 30], ['ps5', -398, 290], ['balcony', 0, 584]], 'ping-pong and the PS5 corner level with the water bar and the treadmill; the balcony, which was in the new column, below the treadmill');
  assert.deepEqual([TOILET.x, TOILET.y, TOILET.width, TOILET.height], [-398, 584, 398, 314], 'the toilet, the atlas\'s picture, is in the new column, level with the balcony');
  assert.ok(DOOR.y0 > 290 && DOOR.y1 < 601 && DOOR.y1 - DOOR.y0 >= 60 && DOOR.x > 0, 'the door is in the original column\'s west wall, beside the treadmill (290 to 601), and wide enough for a person');
  for (const spot of SPOTS) {
    assert.ok(spot.x > SCENE.x && spot.x < SCENE.x + SCENE.width && spot.y > SCENE.y && spot.y < SCENE.y + SCENE.height, spot.key);
  }
  assert.equal(new Set(SPOTS.map((spot) => spot.key)).size, SPOTS.length, 'keys are unique');
  // the places are apart from each other (a bust is about 50 wide)
  for (const a of SPOTS) for (const b of SPOTS) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 40, `${a.key} and ${b.key} are not on top of each other`);
  for (const spot of SPOTS.filter((one) => one.partner)) assert.equal(SPOTS.find((other) => other.key === spot.partner)?.partner, spot.key, `${spot.key}'s partner has it as theirs`);
  assert.deepEqual([...new Set(SPOTS.map((spot) => spot.kind))].sort(), ['balcony', 'coffee', 'pingpong', 'ps5', 'toilet', 'treadmill']);
  assert.equal(spotAt('toilet')?.kind, 'toilet');
  assert.equal(spotAt('nowhere'), null);
  // the PS5 corner's TV and sofa are drawn inside its module
  const ps5 = MODULES.find((module) => module.name === 'ps5')!;
  assert.ok(TV_SCREEN.x >= ps5.x && TV_SCREEN.x + TV_SCREEN.width <= ps5.x + ps5.width && TV_SCREEN.y >= ps5.y && TV_SCREEN.y + TV_SCREEN.height <= ps5.y + ps5.height);
  assert.ok(SOFA_FRONT.x >= ps5.x && SOFA_FRONT.y >= ps5.y && SOFA_FRONT.y < ps5.y + ps5.height);
});

test('whoever is Idle goes to a free place picked at random, the same one each time; a pair is made before a lone player', () => {
  const none = new Set<string>();
  const first = pickSpot(none, 7);
  assert.ok(first && SPOTS.some((spot) => spot.key === first));
  assert.equal(pickSpot(none, 7), first, 'the same issue, the same place');
  // issues differ, and so does the same issue after it has moved
  assert.ok(new Set(Array.from({ length: 40 }, (_, id) => pickSpot(none, id + 1))).size >= 6, 'many places are used');
  assert.ok(new Set(Array.from({ length: 12 }, (_, epoch) => pickSpot(none, 7, epoch))).size >= 3, 'the same issue goes to different places in turn');
  // a taken place is not given again, and every place taken means none
  const all = new Set(SPOTS.map((spot) => spot.key));
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

test('where somebody stands, arrives and rests: at a desk, on the toilet, on the sofa, on the treadmill', () => {
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
  const treadmill = placeOf('treadmill');
  assert.equal(treadmill.seated, false);
  assert.equal(treadmill.hop, true);
  assert.ok(treadmill.stand.y > treadmill.rest.y);
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
  assert.ok(PING_PONG.left < -300 && PING_PONG.right > -100 && PING_PONG.left - a.x < 30 && b.x - PING_PONG.right < 30, 'close to the ends');
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
  const list = [issue(1), issue(2, 'backlog'), issue(3, 'done'), issue(1), ...Array.from({ length: 10 }, (_, i) => issue(i + 4))];
  const { seated, overflow } = seating(list);
  assert.deepEqual(seated.map(({ id, seat }) => [id, seat]), [[1, 0], ...Array.from({ length: 8 }, (_, i) => [i + 4, i + 1])]);
  assert.deepEqual(overflow.map(({ id }) => id), [12, 13]);
  assert.deepEqual(employeesOf(list).map(({ id }) => id).slice(0, 3), [1, 4, 5]);
  for (const [count, sits, over] of [[0, 0, 0], [1, 1, 0], [9, 9, 0], [10, 9, 1]] as const) {
    const r = seating(Array.from({ length: count }, (_, i) => issue(i + 1)));
    assert.deepEqual([r.seated.length, r.overflow.length], [sits, over]);
  }
});

test('the numbers on the widget: states, totals and what the one sentence says', () => {
  assert.deepEqual(summarize(SEVEN), { total: 7, working: 1, needs_you: 2, stuck: 1, idle: 3 });
  assert.deepEqual(boardCounts(SEVEN), [1, 1, 4, 1], 'unassigned, todo, in progress, in review');
  assert.deepEqual(boardCounts([]), [0, 0, 0, 0]);
  assert.equal(stateOf({ agentState: 'stuck' }), 'stuck');
  assert.equal(stateOf({ agentState: 'nonsense' }), 'idle');
  assert.equal(stateOf(null), 'idle');
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
  // 2 is done, 4 is new and urgent, 1 changes its state only
  const next = plan(first.seats, [working(4), issue(1, 'in_progress', 'stuck'), working(2, 'done'), working(3)]);
  assert.deepEqual(next.enter.map(({ id, seat }) => [id, seat]), [[4, 0]]);
  assert.deepEqual(next.move.map(({ id, from, to }) => [id, from, to]), [[1, 0, 1]], '1 sits where 2 sat');
  assert.deepEqual(next.stay.map(({ id }) => id), [3]);
  assert.deepEqual(next.leave.map(({ id, reason }) => [id, reason]), [[2, 'done']]);
  const same = plan(next.seats, [working(4), working(1), working(3)]);
  assert.deepEqual([same.stay.length, same.move.length, same.enter.length, same.leave.length], [3, 0, 0, 0]);
  // a more urgent issue takes the last desk's place: the one bumped goes; one that is gone, or in Backlog, goes too
  const full = plan([], Array.from({ length: 9 }, (_, i) => working(i + 1)));
  const bumped = plan(full.seats, [working(99), ...Array.from({ length: 9 }, (_, i) => working(i + 1))]);
  assert.deepEqual(bumped.leave.map(({ id, reason }) => [id, reason]), [[9, 'overflow']]);
  assert.equal(bumped.overflow, 1);
  const gone = plan(full.seats, [working(1), working(2, 'backlog'), ...Array.from({ length: 6 }, (_, i) => working(i + 3))]);
  assert.deepEqual(gone.leave.map(({ id, reason }) => [id, reason]).sort(), [[2, 'backlog'], [9, 'gone']]);
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
