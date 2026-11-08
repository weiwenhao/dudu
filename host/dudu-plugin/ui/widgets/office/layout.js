// The Office widget's logic that needs neither PixiJS nor the DOM: where the desks and the beds are, who sits where, where a head is for the
// name tag, how a state reads, where somebody goes who waits and where somebody who sleeps, and what changes when the list of issues
// changes. The scene (scene.js, marvis/), the name tags and the plain surface shown without WebGL all take their numbers from here, so
// they agree with each other.
//
// The plane is marvis-office's (marvis/SOURCE.md) made for this widget, 1690 x 1102. From left to right:
//   the sleeping room   eight beds in two columns of four: only whoever's agent is in deep sleep (its session has been let go of) sleeps here;
//   the activity area   two columns with no wall between them, the added one (ping-pong, the PS5 corner, the toilet) and marvis-office's
//                       (the water bar, three treadmills, the balcony): whoever is not working, and is not in deep sleep, is here, whether the
//                       work waits for the owner (Blocked) or the agent is Idle;
//   the desks           eight, in two columns of four: the most urgent issues work here.
// A wall with a door in it keeps the sleeping room from the activity area. The plane is a little taller than marvis-office's 900 (four rows of
// desks and of beds, three treadmills) so that it keeps the look of the widget's default size, 5 x 3 cells (about 1.7 : 1), with the
// people as big as they were.

// --- the desks (roles.ts of marvis-office: the first desk is the boss's, the others are the same desk in a grid)
const DESKS_CLOSER = 100; // the desks are this much nearer the rest area than in marvis-office (the empty column between them is narrower)
const FIRST_X = 491 - DESKS_CLOSER; // the left column of desks
const COLUMN_DX = 270; // the right column (351 in marvis-office: the empty column between the two is narrower here)
const ROW_DY = 262; // the rows after the first (300 in marvis-office, which has three rows: here there are four, in a plane a fifth taller)
const FIRST_ROW = [57, 81]; // the first row: the boss's desk, and the desk beside it, a little lower
const OTHER_ROWS_Y = 330; // the second row
const DESK_OFFSET = { x: 24, y: 9 }; // the desk group sits this far from the person's origin (deskPosition - position in roles.ts)
const PLANE_RIGHT = 899; // the second column of desks ends at 875
const PLANE_HEIGHT = 1102; // 900 in marvis-office

const COLUMNS = 2;
export const DESKS = 8;

/**
 * Where desk `seat` is on the plane: its group's origin, and whether it is the boss's (the bigger desk, the first seat). A number past the eighth (the activity
 * area has ten places, and whoever is there keeps a number too) is a desk of its own number minus eight: the place they appear at and set off from.
 */
export function deskAt(seat) {
  const number = ((seat % DESKS) + DESKS) % DESKS;
  const column = number % COLUMNS;
  const row = Math.floor(number / COLUMNS);
  const personY = row === 0 ? FIRST_ROW[Math.min(column, 1)] : OTHER_ROWS_Y + (row - 1) * ROW_DY;
  return { x: FIRST_X + column * COLUMN_DX + DESK_OFFSET.x, y: personY + DESK_OFFSET.y, boss: number === 0, column, row };
}

// --- the activity area (the rest area): marvis-office's column (the water bar and the treadmills, 398 wide: `y` is where each picture starts) and, level
// with it, the added one (the ping-pong table, the PS5 corner and the toilet, marvis-office's, drawn or placed in the same view and manner: marvis/
// SOURCE.md), side by side with no wall between them. The balcony, which was in the added column, is the last of marvis-office's, below
// the treadmills. Each column has its first module at the top of the plane and its last at the foot of it; the height that is left is air
// between the modules, or, in marvis-office's column, more treadmills. The added column is west of marvis-office's (as it was before the
// sleeping room came, when a wall stood between them); marvis-office's is `CLOSER` nearer to it than its pictures have it, where that wall was.
export const MODULE_WIDTH = 398;
export const WATER_BAR_Y = 30; // where marvis-office's picture of the water bar starts (the first is the column's first module)
const CLOSER = 50;
const ORIGINAL_X = -CLOSER;
const ADDED_X = -MODULE_WIDTH;
const BOTTOM_Y = PLANE_HEIGHT - 2 - 314; // the toilet and the balcony (314 tall) stand at the foot of their columns
const PS5_Y = 386; // the PS5 corner is lower than it was (290), halfway to where its column's spare height would put it
const WALL_OUT = 30; // the sleeping room's wall stands this far west of the added column's own thin wall: room for the player at the end of the ping-pong table
export const MODULES = [
  { name: 'balcony', x: ORIGINAL_X, y: BOTTOM_Y, width: 398, height: 314 }, // (first: the added column's pictures are drawn over its left edge)
  { name: 'pingpong', x: ADDED_X, y: 30, width: 398, height: 262 },
  { name: 'ps5', x: ADDED_X, y: PS5_Y, width: 398, height: 311 },
];
export { ORIGINAL_X, ADDED_X };
/**
 * The treadmills (owner, 2026-11-04: "a treadmill can be added", and 2026-11-07: "one more"): marvis-office's picture of one, drawn three times down its
 * column. The picture has 311 rows (units), and what is drawn in it is from row 50 to row 222; the rest is floor. Each copy is drawn from row `cut` to row `bottom`,
 * `pitch` apart, the first with its row `cut` at `y` on the plane (marvis-office has it at 290, with nothing cut: three of those would not fit above the balcony,
 * and the plane is not made taller, so that the people stay as big as they were).
 */
export const TREADMILL = Object.freeze({ y: 271, cut: 45, bottom: 231, pitch: 180, count: 3 });
export const TREADMILL_LEFT = 0; // the treadmills' places in their pictures are as marvis-office has them (this much nearer the added column than their column)
const TREADMILL_ROWS = Object.freeze({ belt: 156, front: 204, footprint: Object.freeze([45, 192]) }); // where things are in the picture, by row
/** Each treadmill: its key, where its picture is drawn (`picture`: the plane's y of its first drawn row), its belt, the floor in front of it, and its footprint (what feet may not enter). */
export const TREADMILLS = Object.freeze(Array.from({ length: TREADMILL.count }, (_, k) => {
  const row0 = TREADMILL.y + k * TREADMILL.pitch - TREADMILL.cut; // the plane's y of row 0 of the picture (the rows above `cut` are not drawn)
  return Object.freeze({
    key: k === 0 ? 'treadmill' : `treadmill-${k + 1}`, picture: TREADMILL.y + k * TREADMILL.pitch, belt: row0 + TREADMILL_ROWS.belt, front: row0 + TREADMILL_ROWS.front,
    footprint: Object.freeze({ y0: row0 + TREADMILL_ROWS.footprint[0], y1: row0 + TREADMILL_ROWS.footprint[1] }),
  });
}));
/** The balcony's picture starts with floor (its first 30 rows have nothing drawn in them): it is drawn without them, so that it does not cover the last treadmill's shadow. */
export const BALCONY_CROP = 30;
// the ping-pong table: smaller than it was (285 units long, now 245) and higher on its picture, so that its right player does not stand at the
// water bar and the way in from the sleeping room goes under it; its middle line (the ball bounces on it) and its two ends, on the plane
const TABLE = { left: -296.5, right: -51.5, top: 52, bottom: 213, line: 132.5 };
/** marvis-office's toilet, at the foot of the added column; it is the atlas's picture, 398 by 314. */
export const TOILET = Object.freeze({ x: ADDED_X, y: BOTTOM_Y, width: 398, height: 314 });
/** The door in the sleeping room's east wall (the rest area's west one): the wall is at `x`, the opening is from `y0` to `y1`; the door's picture is drawn from `sprite`. */
export const DOOR = Object.freeze({ x: ADDED_X + 67 - WALL_OUT, y0: 265, y1: 345, sprite: Object.freeze({ x: ADDED_X - 130 - WALL_OUT, y: 150 }) });
/** The wall that marvis-office's column has on its left (its pictures show it): it is covered by floor (a patch where the added column's pictures do not hide it). */
export const OLD_WALL = Object.freeze({ x0: 0, x1: ORIGINAL_X + 68, y0: 30, y1: PLANE_HEIGHT - 2 });
export const OLD_WALL_WEST = Object.freeze({ x0: ORIGINAL_X, x1: 0, y0: 30, y1: PLANE_HEIGHT - 2 });
/** Where the PS5 corner's TV screen is on the plane (the monitor of the atlas, smaller), and where its sofa's back and arms are drawn. */
export const TV_SCREEN = { x: ADDED_X + 175.1, y: PS5_Y + 11.2, width: 91.4, height: 42.4 };
export const SOFA_FRONT = { x: ADDED_X + 135, y: PS5_Y + 191 };

// --- the sleeping room: a module like the others (398 wide), west of the rest area, shut off from it by the partition wall (`wall`: where that
// stands). It has no wall of its own on the west, and nothing dark over it. Its beds are in two columns of four, the heads to the north.
export const SLEEP_ROOM = Object.freeze({ x: -2 * MODULE_WIDTH - WALL_OUT, y: 0, width: 398, height: PLANE_HEIGHT, wall: ADDED_X + 67 - WALL_OUT });
/** The added column's own wall and its shade (its pictures have them), which are east of the partition wall now: covered by floor. The toilet keeps its own, which is its room's. */
export const ADDED_STRIPS = Object.freeze([
  Object.freeze({ x0: ADDED_X + 67 - WALL_OUT, x1: ADDED_X + 70, y0: 30, y1: 292 }), // the table's
  Object.freeze({ x0: ADDED_X + 67 - WALL_OUT, x1: ADDED_X + 70, y0: PS5_Y, y1: PS5_Y + 311 }), // the PS5 corner's
]);
const BED_COLUMNS = [134, 334]; // the middle of each column, from the room's left edge
const BED_ROWS = [64, 330, 596, 862]; // where each row's beds begin (their head board)
export const SLEEP_FRONT = Object.freeze({ x: SLEEP_ROOM.x + 87, y: 103 }); // the blankets, drawn over the sleepers (its picture is cut to what is in it)

/** The plane: from a little west of the beds to a little past the second column of desks (a little over one and a half times as wide as it is high). */
export const SCENE = Object.freeze({ x: SLEEP_ROOM.x + 35, y: 0, width: -SLEEP_ROOM.x - 35 + PLANE_RIGHT, height: PLANE_HEIGHT });

// Where somebody who has no place goes out of the picture, and comes in from (owner, 2026-11-07: "坐不下了，就走到屏幕外面就行了"): the open floor at the right edge of the plane, level with the
// first row of desks (tests/office-routes.test.ts: every place has a way to it over open floor; the corner at the bottom has none), and a point beyond the edge, which the picture does not show.
export const EXIT = Object.freeze({ x: SCENE.x + SCENE.width - 4, y: 260 });
export const OUTSIDE = Object.freeze({ x: SCENE.x + SCENE.width + 90, y: 260 });

// --- a person: one of the owner's clay avatars, whole, on a point of the plane (their feet, or, when they sit, their hips)
export const SEATED_TOP = 58; // scene units from the hips to the top of the head of somebody sitting at a desk, seen from behind
const ABOVE_HEAD = 8; // the name tag's tip is this far above the top of the head

/**
 * Where the bottom of desk `seat`'s chair is on the plane. The chair is drawn over whoever is behind it (the one who sits in it, at the hips)
 * and under whoever is in front of it (anybody who walks past below it): it is in the same layer as the people, ordered by this.
 */
export function chairBottom(seat) {
  const desk = deskAt(seat);
  return desk.y + (desk.boss ? 170 : 148);
}

/**
 * Where the hips of whoever sits at desk `seat` are: in the middle of the desk, behind the top of the chair, which hides everything below.
 * The boss sits lower, in front of the monitor, as the boss's mascot does (the other mascots sit at the monitor's foot).
 */
export function seatAnchor(seat) {
  const desk = deskAt(seat);
  return { x: desk.x + 91, y: desk.y + (desk.boss ? 80 : 62) };
}

/** The point the name tag points at for somebody at `at`, `top` units tall from there (more when they stand): just above the head. */
export const headPoint = (at, top = SEATED_TOP) => ({ x: at.x, y: at.y - top - ABOVE_HEAD });

// --- how the plane fits the canvas (useScene.ts of marvis-office: the whole plane in the canvas, a little inside it, centred)
const VIEWPORT_PADDING = 0.98;

export function fitScene(size, width, height) {
  const scale = Math.max(1e-6, Math.min(width / size.width, height / size.height) * VIEWPORT_PADDING);
  return { scale, x: width / 2 - (size.x + size.width / 2) * scale, y: height / 2 - (size.y + size.height / 2) * scale };
}

export const toCanvas = (fit, point) => ({ x: fit.x + point.x * fit.scale, y: fit.y + point.y * fit.scale });

/**
 * Name tags of people who stand close together would sit on top of each other. From the front of the plane to the back (the lowest head
 * on the screen first) a tag that would cover one already placed is lifted above it. `anchors` maps an id to the screen point of its head,
 * `sizes` an id to the size of its tag; the result maps the id to where the tag's bottom middle goes and how far `lift` that is above the
 * head, which the widget draws as a thin line down to it. Tags that only touch at their rounded ends (`slack`) are left alone.
 */
export function spreadTags(anchors, sizes, { gap = 2, slack = 8, fallback = { width: 62, height: 17 } } = {}) {
  const order = [...anchors].sort(([, a], [, b]) => b.y - a.y || a.x - b.x);
  const placed = [];
  const spread = new Map();
  for (const [id, { x, y }] of order) {
    const { width, height } = sizes.get(id) ?? fallback;
    let bottom = y;
    for (let tries = 0; tries < order.length; tries++) {
      const hit = placed.find((other) => Math.abs(other.x - x) < (other.width + width) / 2 - slack && other.bottom - other.height < bottom && bottom - height < other.bottom);
      if (!hit) break;
      bottom = hit.bottom - hit.height - gap;
    }
    placed.push({ x, width, height, bottom });
    spread.set(id, { x, y: bottom, lift: y - bottom });
  }
  return spread;
}

// --- the activity area: where somebody goes who is not working and whose agent is awake: the work waits for the boss (Blocked), or the agent is Idle. Where each person is when they are there (`x`, `y`: their
// feet; their hips where they sit: at the toilet and on the PS5 sofa), and for the places seen from the side, which
// way they face (1: to the right, -1: to the left). Somebody who sits, or who steps up onto something, arrives at `stand` (their feet, on
// the open floor in front of it) and moves the short way from there. `after` keeps a seat free until the one before it is taken (the
// first to the sofa sits at the far end, so that the second does not have to climb over them).
const TREADMILL_X = 226 + ORIGINAL_X - TREADMILL_LEFT; // the belt's middle, in the picture
export const SPOTS = [
  { key: 'coffee-a', kind: 'coffee', x: 262 + ORIGINAL_X, y: 216, face: 1 },
  { key: 'coffee-b', kind: 'coffee', x: 338 + ORIGINAL_X, y: 216, face: -1 },
  // on the belt of a treadmill, which they step up onto from its front
  ...TREADMILLS.map((treadmill) => ({ key: treadmill.key, kind: 'treadmill', x: TREADMILL_X, y: treadmill.belt, face: -1, stand: { x: TREADMILL_X, y: treadmill.front } })),
  // on the toilet, which faces right: the hips are on the seat, the legs hang over its front
  { key: 'toilet', kind: 'toilet', x: ADDED_X + 194, y: BOTTOM_Y + 162, face: 1, seated: true, stand: { x: ADDED_X + 264, y: BOTTOM_Y + 250 } },
  // the added column: ping-pong from the two ends of the table (which is a little higher than it was: the way in from the sleeping room goes
  // under it), two on the PS5 sofa (facing the TV, which is away from us); and in marvis-office's column, two at the ashtray of the balcony.
  // A spot with a `partner` is for two, and the second goes there before anyone starts another pair
  { key: 'pingpong-a', kind: 'pingpong', partner: 'pingpong-b', x: TABLE.left - 15, y: TABLE.line + 24, face: 1 },
  { key: 'pingpong-b', kind: 'pingpong', partner: 'pingpong-a', x: TABLE.right + 21.5, y: TABLE.line + 24, face: -1 },
  { key: 'ps5-a', kind: 'ps5', partner: 'ps5-b', x: ADDED_X + 196, y: PS5_Y + 256, seated: true, stand: { x: ADDED_X + 362, y: PS5_Y + 286 } },
  { key: 'ps5-b', kind: 'ps5', partner: 'ps5-a', x: ADDED_X + 268, y: PS5_Y + 256, seated: true, stand: { x: ADDED_X + 362, y: PS5_Y + 286 }, after: 'ps5-a' },
  { key: 'balcony-a', kind: 'balcony', partner: 'balcony-b', x: 190 + ORIGINAL_X, y: BOTTOM_Y + 228, face: 1 },
  { key: 'balcony-b', kind: 'balcony', partner: 'balcony-a', x: 258 + ORIGINAL_X, y: BOTTOM_Y + 228, face: -1 },
];

// the sleeping room: eight beds, two columns of four, for whoever's agent is in deep sleep (bed n is the number n of the sleepers: it is theirs while they sleep, and
// they never get up to change it). They lie with their hips on the mattress (`x`, `y`), head up the picture on the pillow; the way in is from the aisle between the
// two columns, at the bed's side, where `stand` is. `top` is where the bed's head board is.
export const BED = Object.freeze({ width: 98, height: 170 });
const BED_STANDS = [SLEEP_ROOM.x + 208, SLEEP_ROOM.x + 260]; // in the aisle, beside the bed of the left column and of the right one
export const BEDS = Array.from({ length: DESKS }, (_, seat) => {
  const column = seat % 2;
  const top = BED_ROWS[Math.floor(seat / 2)];
  return { key: `bed-${seat}`, kind: 'bed', seat, x: SLEEP_ROOM.x + BED_COLUMNS[column], y: top + 60, top, seated: true, stand: { x: BED_STANDS[column], y: top + 100 } };
});
export const BED_KEYS = BEDS.map((bed) => bed.key);
SPOTS.push(...BEDS);
/** The spots of the activity area (where somebody is who is awake and not working), not the beds. */
export const REST_SPOTS = SPOTS.filter((spot) => spot.kind !== 'bed');

export const spotAt = (key) => SPOTS.find((spot) => spot.key === key) ?? null;

/** A standing person's hips are this far above their feet, as they are drawn (the sheets draw a seated person from the hips up). */
export const HIPS_ABOVE_FEET = 30;
export const hipsOf = (feet) => ({ x: feet.x, y: feet.y - HIPS_ABOVE_FEET });

/**
 * Where somebody is, and how they get there, at a desk (`key` 'desk', with its `seat`) or at one of the spots: `rest` is where they stay
 * (their hips when `seated`, else their feet); `stand` is where their feet are when they arrive or leave, on the floor in front of it; `gate` is
 * a point of open floor to walk to and from (the same as `stand` where that is open floor); `hop` is whether the short way from `stand` to
 * `rest` is more than standing up or sitting down in the same place. The desk's `stand` is below the hips, behind the chair, and its `gate`
 * is beside the chair, in front of the desk.
 */
export function placeOf(key, seat = 0) {
  if (key === 'desk') {
    const desk = deskAt(seat);
    const rest = seatAnchor(seat);
    return { rest, seated: true, hop: false, stand: { x: rest.x, y: rest.y + HIPS_ABOVE_FEET }, gate: { x: desk.x + 8, y: desk.y + (desk.boss ? 140 : 118) } };
  }
  const spot = spotAt(key);
  const stand = spot.stand ?? { x: spot.x, y: spot.y };
  return { rest: { x: spot.x, y: spot.y }, seated: Boolean(spot.seated), hop: Boolean(spot.stand), stand, gate: stand };
}

// --- the ping-pong table (its picture is marvis/assets/modules/pingpong.webp): the ball goes from one paddle to the other, touching the
// table once on the way, and the players stand at the two ends
export const PING_PONG = Object.freeze({ ...TABLE }); // the table's ends and the middle of its top, on the plane
const PADDLE = { x: 34, y: -44 }; // where the paddle is from the feet of somebody who has just hit

/** The two players' paddles, for the players at `a` (the left end, facing right) and `b` (the right end, facing left). */
export const paddles = (a, b) => ({ a: { x: a.x + PADDLE.x, y: a.y + PADDLE.y }, b: { x: b.x - PADDLE.x, y: b.y + PADDLE.y } });

/** The ball, `k` (0 to 1) of the way from the paddle `from` to the paddle `to`: over the net, down onto the table, up to the paddle. */
export function ballPath(k, from, to, line = PING_PONG.line) {
  const hit = 0.68; // where it touches the table
  const x = from.x + (to.x - from.x) * k;
  if (k < hit) {
    const u = k / hit;
    return { x, y: from.y + (line - from.y) * u - 30 * Math.sin(Math.PI * u) };
  }
  const u = (k - hit) / (1 - hit);
  return { x, y: line + (to.y - line) * u - 14 * Math.sin(Math.PI * u) };
}

const mix = (a, b) => Math.imul((Math.imul(a ^ 0x9e3779b9, 2246822519) ^ Math.imul(b + 0x7f4a7c15, 3266489917)) >>> 0, 2654435761) >>> 0;

const hashOf = (id) => {
  if (typeof id === 'number' && Number.isFinite(id)) return Math.imul(Math.trunc(id), 2654435761) >>> 0;
  let hash = 2166136261;
  for (const char of String(id)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return Math.imul(hash, 2654435761) >>> 0;
};

/**
 * Where somebody goes who is awake and not working (Blocked, or Idle): the free spot of the activity area that comes first in the order of (their issue, how many
 * times they have moved, the spot), or null when every spot is taken (they stay where they are). Random to look at, but the same for the same issue and the
 * same count. `avoid` are spots they do not want (the one they are at). Ping-pong needs two in the area (`idleCount`). Whoever's agent is in deep sleep does not
 * come here: they sleep in a bed.
 */
export function pickSpot(taken, id, epoch = 0, avoid = [], { idleCount = 1 } = {}) {
  const key = (hashOf(id) + Math.imul(epoch, 7919)) >>> 0;
  const free = REST_SPOTS.filter((spot) => !taken.has(spot.key) && !avoid.includes(spot.key) &&
    (!spot.after || taken.has(spot.after)) && (spot.kind !== 'pingpong' || idleCount >= 2));
  const pairing = (spot) => (spot.partner && taken.has(spot.partner) ? 0 : 1);
  free.sort((a, b) => pairing(a) - pairing(b) || mix(key, hashOf(a.key)) - mix(key, hashOf(b.key)));
  return free[0]?.key ?? null;
}

/**
 * How long somebody keeps to a place before going to another: between 40 and 90 seconds, from the issue and how many times they moved
 * (the range the first office used for its rest area).
 */
export const stayFor = (id, epoch) => 40 + (mix(hashOf(id), 31 + epoch) % 51);

// --- who is an employee
export const ACTIVE_STATUSES = ['todo', 'in_progress', 'in_review'];
const SITTING = new Set(ACTIVE_STATUSES);

/** The issues that work in the office, in the order given (the Issues default order: the most urgent first). A twice-listed id counts once. */
export function employeesOf(issues) {
  const seen = new Set();
  const out = [];
  for (const issue of issues ?? []) {
    if (!issue || !SITTING.has(issue.statusType ?? issue.status) || seen.has(issue.id)) continue;
    seen.add(issue.id);
    out.push(issue);
  }
  return out;
}

/**
 * Where somebody is: at a desk (`working`: their agent works), in a bed (`sleeping`: their agent is in deep sleep, so nothing of it is running; owner, 2026-11-07:
 * "only deep sleep goes to the sleeping area") or in the activity area (`resting`: anything else, whether the work waits for the owner or the agent is Idle).
 */
export const zoneOf = (issue) => (stateOf(issue) === 'working' ? 'working' : issue?.deepSleep === true ? 'sleeping' : 'resting');

/**
 * How many people each part of the office can place (owner, 2026-11-05: "the desks are all free now", with a ninth who had no place): a desk for each who works, a
 * bed for each who sleeps, a place for each who is in the activity area. The activity area has twelve spots, but ping-pong takes two at a time, so ten is what
 * everybody can have without a pair: with ten there is always a place to go to. A person's number (`seat`) is a desk's when they work and a bed's when they sleep; in the
 * activity area it is only a number (past the eighth it is a desk's minus eight, the place they appear at).
 */
export const CAPACITY = Object.freeze({ working: DESKS, resting: REST_SPOTS.filter((spot) => spot.kind !== 'pingpong').length, sleeping: BEDS.length });

/**
 * Hot desks (owner, 2026-11-05: "whoever needs to work goes and sits; no fixed place for each person"). Whoever has a place in their zone keeps it, whatever happens to the order of
 * the list or to anybody else (`prev`, the seating of the last look, [{ id, seat, zone }]: a sleeper's bed is theirs for as long as they sleep, and nobody walks because the list was
 * shuffled). Whoever changed zone, and anybody new, takes the first free place of their zone, in the order of the list (the boss's desk, the first, goes to the first who works; the
 * beds fill from the first); when the zone has none left they have no place and are outside (owner, 2026-11-07: when a part of the office has no room "走到屏幕外面就行了，什么额外
 * 的操作都不需要做": nobody is moved or pushed out to make room, and nothing is said of it): they walk in when a place is free. The places are `CAPACITY`.
 */
export function seating(issues, prev = []) {
  const before = new Map((prev ?? []).map((entry) => [entry.id, entry]));
  const wanted = employeesOf(issues).map((issue) => ({ issue, zone: zoneOf(issue) }));
  const taken = { working: new Set(), resting: new Set(), sleeping: new Set() };
  const seatOf = new Map();
  const free = (zone, seat) => Number.isInteger(seat) && seat >= 0 && seat < CAPACITY[zone] && !taken[zone].has(seat);
  const give = (id, zone, seat) => { taken[zone].add(seat); seatOf.set(id, seat); };
  for (const { issue, zone } of wanted) { // those who stay in their zone keep their place
    const was = before.get(issue.id);
    if (was?.zone === zone && free(zone, was.seat)) give(issue.id, zone, was.seat);
  }
  const overflow = [];
  for (const { issue, zone } of wanted) { // the rest, in the order of the list: the first free place of their zone, or none
    if (seatOf.has(issue.id)) continue;
    let seat = -1;
    for (let candidate = 0; seat < 0 && candidate < CAPACITY[zone]; candidate++) if (free(zone, candidate)) seat = candidate;
    if (seat < 0) overflow.push(issue); else give(issue.id, zone, seat);
  }
  const seated = wanted.filter(({ issue }) => seatOf.has(issue.id)).map(({ issue, zone }) => ({ id: issue.id, seat: seatOf.get(issue.id), zone, issue }));
  return { seated, overflow };
}

// --- how an agent state reads
export const STATES = {
  working: { tone: 'muted' },
  blocked: { tone: 'warning' },
  idle: { tone: 'muted' },
};
export const STATE_ORDER = ['blocked', 'working', 'idle'];

export const stateOf = (issue) => (Object.hasOwn(STATES, issue?.agentState) ? issue.agentState : 'idle');

/** How many of the employees are in each state, for the one sentence that stands for the picture. */
export function summarize(issues) {
  const counts = { total: 0, working: 0, blocked: 0, idle: 0 };
  for (const issue of employeesOf(issues)) {
    counts.total += 1;
    counts[stateOf(issue)] += 1;
  }
  return counts;
}

/** How many Unassigned, Todo, In Progress and In Review issues there are, all of them (the widget's totals, used when the API sent none). */
export function boardCounts(issues) {
  const counts = [0, 0, 0, 0];
  for (const issue of issues ?? []) {
    if (!issue) continue;
    const column = ACTIVE_STATUSES.indexOf(issue.statusType ?? issue.status);
    if (column < 0) continue;
    counts[issue.agent ? column + 1 : 0] += 1;
  }
  return counts;
}

// --- who a person is
export const AVATARS = 16; // the avatars of the owner's sheet

/** Which of them an issue would like to be: from its number alone, so the same issue is the same person whenever nobody else has taken that look. */
export const avatarOf = (id) => (hashOf(id) >>> 7) % AVATARS;

/**
 * The look an issue's person really gets (owner, 2026-11-05: "why are two people exactly the same"): its own look from `avatarOf` unless somebody in the office
 * already has it, then the next one nobody has. `inUse` is the looks of everybody drawn now; with more people than looks (16) the least used one is taken.
 */
export function lookFor(id, inUse = []) {
  const uses = new Array(AVATARS).fill(0);
  for (const look of inUse) if (Number.isInteger(look) && look >= 0 && look < AVATARS) uses[look] += 1;
  const first = avatarOf(id);
  let best = first;
  for (let step = 0; step < AVATARS; step++) {
    const look = (first + step) % AVATARS;
    if (uses[look] === 0) return look;
    if (uses[look] < uses[best]) best = look;
  }
  return best;
}

// --- the agent's colour (the hover card's dot): Claude orange, ChatGPT green, DeepSeek blue; any other agent takes one of three more, by
// its name, so it keeps it; no agent is grey.
const AGENT_COLORS = { claude: 0xd97757, codex: 0x19a58a, chatgpt: 0x19a58a, deepseek: 0x4d6bfe };
const OTHER_COLORS = [0x8b6fd6, 0xe27ba8, 0xe4b93c]; // purple, pink, yellow
const NO_AGENT_COLOR = 0x9aa0ad;

export function agentColor(agent) {
  if (!agent) return NO_AGENT_COLOR;
  const key = String(agent).toLowerCase();
  return Object.hasOwn(AGENT_COLORS, key) ? AGENT_COLORS[key] : OTHER_COLORS[hashOf(key) % OTHER_COLORS.length];
}

export const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;

// --- what changes when the list changes
/**
 * Who does what to go from the seating now (`prev`: [{ id, seat, zone }], the `seats` of the last plan, or []) to the one `issues` calls
 * for. Places are hot (see `seating`): a place is kept until the person's zone changes, so a change in the order of the list is nobody walking.
 *   stay   keeps their number (their state may have changed: that is what they do where they are, not a walk)
 *   move   has another number: they changed zone (desk, activity area, bed) and walk to the place of the new one
 *   enter  appears at a desk
 *   leave  goes: the issue is Done or Canceled, left the Active list, or lost its desk to a more urgent one (`reason` says which)
 * `seats` is the new seating, `overflow` how many issues have no place (all the places of their zone are taken).
 */
export function plan(prev, issues) {
  const { seated, overflow } = seating(issues, prev);
  const before = new Map((prev ?? []).map(({ id, seat }) => [id, seat]));
  const after = new Map(seated.map(({ id, seat }) => [id, seat]));
  const stay = [];
  const move = [];
  const enter = [];
  for (const { id, seat } of seated) {
    if (!before.has(id)) enter.push({ id, seat });
    else if (before.get(id) === seat) stay.push({ id, seat });
    else move.push({ id, from: before.get(id), to: seat });
  }
  const byId = new Map((issues ?? []).filter(Boolean).map((issue) => [issue.id, issue]));
  const leave = [];
  for (const [id, seat] of before) {
    if (after.has(id)) continue;
    const issue = byId.get(id);
    leave.push({ id, seat, reason: !issue ? 'gone' : SITTING.has(issue.statusType ?? issue.status) ? 'overflow' : (issue.statusType ?? issue.status) });
  }
  return { seats: seated.map(({ id, seat, zone }) => ({ id, seat, zone })), stay, move, enter, leave, overflow: overflow.length };
}
