// The Office widget's logic that needs neither PixiJS nor the DOM: where the desks are, who sits where, where a head is for the name
// tag, how a state reads, what an idle person does, and what changes when the list of issues changes. The scene (scene.js, marvis/),
// the name tags and the plain surface shown without WebGL all take their numbers from here, so they agree with each other.
//
// The scene is marvis-office's (marvis/SOURCE.md): a plane of 1200 x 900 with the water bar and the treadmill down the left, and desks in
// two columns of three to their right. There are nine desks, fixed: the scene's six and a third column of three beside them, at the same
// column and row spacing. Beyond the left edge of the original scene is the new column (ping-pong, the PS5 corner and the toilet), and the
// balcony is the original column's third module.

// --- the desks (roles.ts of marvis-office: the first desk is the boss's, the others are the same desk in a grid)
const FIRST_X = 491; // the left column of desks
const COLUMN_DX = 351; // 842 - 491: the right column
const ROW_DY = 300; // 641 - 341: rows after the first
const FIRST_ROW = [57, 81]; // the first row: the boss's desk, and the desk beside it, a little lower
const OTHER_ROWS_Y = 341; // the second row
const DESK_OFFSET = { x: 24, y: 9 }; // the desk group sits this far from the person's origin (deskPosition - position in roles.ts)
const PLANE_RIGHT = 1440; // the third column of desks ends at 1400; the original plane went on to 1200 for its two
const PLANE_HEIGHT = 900;

const COLUMNS = 3;
export const DESKS = 9;

/** Where desk `seat` is on the plane: its group's origin, and whether it is the boss's (the bigger desk, the first seat). */
export function deskAt(seat) {
  const column = seat % COLUMNS;
  const row = Math.floor(seat / COLUMNS);
  const personY = row === 0 ? FIRST_ROW[Math.min(column, 1)] : OTHER_ROWS_Y + (row - 1) * ROW_DY;
  return { x: FIRST_X + column * COLUMN_DX + DESK_OFFSET.x, y: personY + DESK_OFFSET.y, boss: seat === 0, column, row };
}

// --- the things down the left of the plane: marvis-office's water bar and treadmill (x 0, `y` is where each sprite starts, they are 398 wide)
// and, to their left and level with them, the ping-pong table, the PS5 corner and the toilet (marvis-office's, moved here), drawn or placed
// in the same view and manner (marvis/SOURCE.md). The balcony, which was in the new column, is the third of the original column, below the
// treadmill. The original column has a wall along its west side, at x 64 to 70 (its shading, to the west of it, is what the modules'
// pictures show); the new column is outside it, and the door is the way in.
export const MODULE_WIDTH = 398;
export const MODULES = [
  { name: 'pingpong', x: -MODULE_WIDTH, y: 30, width: 398, height: 262 },
  { name: 'ps5', x: -MODULE_WIDTH, y: 290, width: 398, height: 311 },
  { name: 'balcony', x: 0, y: 584, width: 398, height: 314 },
];
/** marvis-office's toilet, at the foot of the new column (it was at the foot of the original one); it is the atlas's picture, 398 by 314. */
export const TOILET = Object.freeze({ x: -MODULE_WIDTH, y: 584, width: 398, height: 314 });
/** The door in the original column's west wall, beside the treadmill: the wall is at `x`, the opening is from `y0` to `y1`; the door's picture is drawn from `sprite`. */
export const DOOR = Object.freeze({ x: 66, y0: 455, y1: 535, sprite: Object.freeze({ x: -130, y: 340 }) });
/** Where the PS5 corner's TV screen is on the plane (the monitor of the atlas, smaller), and where its sofa's back and arms are drawn. */
export const TV_SCREEN = { x: -MODULE_WIDTH + 175.1, y: 290 + 11.2, width: 91.4, height: 42.4 };
export const SOFA_FRONT = { x: -MODULE_WIDTH + 135, y: 290 + 191 };

/** The plane: from the left edge of the new column to a little past the third column of desks, 900 tall (about twice as wide as it is high). */
export const SCENE = Object.freeze({ x: -MODULE_WIDTH, y: 0, width: MODULE_WIDTH + PLANE_RIGHT, height: PLANE_HEIGHT });

// --- a person: one of the owner's clay avatars, whole, on a point of the plane (their feet, or, when they sit, their hips)
export const SEATED_TOP = 58; // scene units from the hips to the top of the head of somebody sitting at a desk, seen from behind
const ABOVE_HEAD = 8; // the name tag's tip is this far above the top of the head

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

// --- the rest area: where somebody who has nothing to do can go instead of sleeping at their desk. Where each person is when they are
// there (`x`, `y`: their feet; their hips where they sit: at the toilet and on the PS5 sofa), and for the places seen from the side, which
// way they face (1: to the right, -1: to the left). Somebody who sits, or who steps up onto something, arrives at `stand` (their feet, on
// the open floor in front of it) and moves the short way from there. `after` keeps a seat free until the one before it is taken (the
// first to the sofa sits at the far end, so that the second does not have to climb over them).
export const SPOTS = [
  { key: 'coffee-a', kind: 'coffee', x: 262, y: 216, face: 1 },
  { key: 'coffee-b', kind: 'coffee', x: 338, y: 216, face: -1 },
  // on the belt of the treadmill, which they step up onto from its front
  { key: 'treadmill', kind: 'treadmill', x: 226, y: 446, face: -1, stand: { x: 226, y: 494 } },
  // on the toilet, which faces right: the hips are on the seat, the legs hang over its front
  { key: 'toilet', kind: 'toilet', x: -204, y: 746, face: 1, seated: true, stand: { x: -134, y: 834 } },
  // the new column: ping-pong from the two ends of the table, two on the PS5 sofa (facing the TV, which is away from us); and in the original
  // column, two at the ashtray of the balcony. A spot with a `partner` is for two, and the second goes there before anyone starts another pair
  { key: 'pingpong-a', kind: 'pingpong', partner: 'pingpong-b', x: -318, y: 196, face: 1 },
  { key: 'pingpong-b', kind: 'pingpong', partner: 'pingpong-a', x: 4, y: 196, face: -1 },
  { key: 'ps5-a', kind: 'ps5', partner: 'ps5-b', x: -202, y: 546, seated: true, stand: { x: -36, y: 576 } },
  { key: 'ps5-b', kind: 'ps5', partner: 'ps5-a', x: -130, y: 546, seated: true, stand: { x: -36, y: 576 }, after: 'ps5-a' },
  { key: 'balcony-a', kind: 'balcony', partner: 'balcony-b', x: 190, y: 812, face: 1 },
  { key: 'balcony-b', kind: 'balcony', partner: 'balcony-a', x: 258, y: 812, face: -1 },
];

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
export const PING_PONG = Object.freeze({ left: -302, right: -18, line: 172 }); // the table's ends and the middle of its top, on the plane
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
 * Where an idle person goes: the free spot that comes first in the order of (their issue, how many times they have moved, the spot), or
 * null when every spot is taken (they sleep at their desk). Random to look at, but the same for the same issue and the same count.
 * `avoid` are spots they do not want (the one they are at). Ping-pong needs two idle employees.
 */
export function pickSpot(taken, id, epoch = 0, avoid = [], { idleCount = 1 } = {}) {
  const key = (hashOf(id) + Math.imul(epoch, 7919)) >>> 0;
  const free = SPOTS.filter((spot) => !taken.has(spot.key) && !avoid.includes(spot.key) &&
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
    if (!issue || !SITTING.has(issue.status) || seen.has(issue.id)) continue;
    seen.add(issue.id);
    out.push(issue);
  }
  return out;
}

/** The most urgent fill the desks; the rest are "+N". */
export function seating(issues) {
  const all = employeesOf(issues);
  const seated = all.slice(0, DESKS).map((issue, seat) => ({ id: issue.id, seat, issue }));
  return { seated, overflow: all.slice(DESKS) };
}

// --- how an agent state reads
export const STATES = {
  working: { tone: 'muted' },
  needs_you: { tone: 'warning' },
  stuck: { tone: 'danger' },
  idle: { tone: 'muted' },
};
export const STATE_ORDER = ['needs_you', 'stuck', 'working', 'idle'];

export const stateOf = (issue) => (Object.hasOwn(STATES, issue?.agentState) ? issue.agentState : 'idle');

/** How many of the employees are in each state, for the one sentence that stands for the picture. */
export function summarize(issues) {
  const counts = { total: 0, working: 0, needs_you: 0, stuck: 0, idle: 0 };
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
    const column = ACTIVE_STATUSES.indexOf(issue.status);
    if (column < 0) continue;
    counts[issue.agent ? column + 1 : 0] += 1;
  }
  return counts;
}

// --- who a person is
export const AVATARS = 16; // the avatars of the owner's sheet

/** Which of them an issue is: from its number alone, so the same issue is always the same person. */
export const avatarOf = (id) => (hashOf(id) >>> 7) % AVATARS;

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
 * Who does what to go from the seating now (`prev`: [{ id, seat }], the `seats` of the last plan, or []) to the one `issues` calls
 * for. Seats follow the order of the list strictly (the most urgent at the boss's desk), so a change in the order is people walking to
 * their new desks.
 *   stay   sits where they sat (their state may have changed: that is what they do at the desk, not a walk)
 *   move   gets up and walks to another desk
 *   enter  appears at a desk
 *   leave  goes: the issue is Done or Canceled, left the Active list, or lost its desk to a more urgent one (`reason` says which)
 * `seats` is the new seating, `overflow` how many issues have no desk.
 */
export function plan(prev, issues) {
  const { seated, overflow } = seating(issues);
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
    leave.push({ id, seat, reason: !issue ? 'gone' : SITTING.has(issue.status) ? 'overflow' : issue.status });
  }
  return { seats: seated.map(({ id, seat }) => ({ id, seat })), stay, move, enter, leave, overflow: overflow.length };
}
