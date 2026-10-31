// The Office widget's logic that needs neither three nor the DOM: how many desks a widget size gives, who sits where, what a
// person looks like, how a state reads, and what changes when the list of issues changes. The scene (scene.js), the name tags
// and the picture shown without WebGL all take their numbers from here, so they agree with each other.

// --- the room: one desk per seat, seats numbered row by row from the front row (nearest the viewer), left to right
const DESK_DX = 2.55; // distance between two desks in a row
const DESK_DZ = 2.15; // distance between two rows
const GAP = 1.275; // the gap between two columns of desks is walked in; its middle is this far left of a seat
const AISLE = 0.7; // and the aisle behind a row is walked this far behind its seats
const SIDE = 0.3; // how far into the wall the last step to the door goes: the wall hides whoever walks into it

const whole = (n, least) => Math.max(least, Math.floor(Number.isFinite(n) ? n : least));

/** The desks a widget of `cols` x `rows` cells has: two columns and one row of its cells go to walls, door and walking room. */
export function deskGrid(cols, rows) {
  const columns = whole(cols - 2, 1);
  const lines = whole(rows - 1, 1);
  return { columns, rows: lines, capacity: columns * lines };
}

export function roomSize({ columns, rows }) {
  return { width: columns * DESK_DX + 1.5, depth: rows * DESK_DZ + 1.3 };
}

/** Where seat `index` is on the floor: x grows to the right, z towards the viewer; the person sits at it and faces +z. */
export function seatPosition(index, { columns, rows }) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return { x: (column - (columns - 1) / 2) * DESK_DX, z: ((rows - 1) / 2 - row) * DESK_DZ };
}

/** The door is in the left wall, towards the viewer; `x` is the wall's inner face. */
export function doorPosition(grid) {
  const { width, depth } = roomSize(grid);
  return { x: -width / 2 + 0.2, z: depth / 2 - 2.0 };
}

/** The top right corner of the board on the back wall, where the "+N" for issues without a desk hangs. */
export function boardAnchor(grid) {
  const { width, depth } = roomSize(grid);
  return [width / 2 - 2.3 + 1.55, 1.7 + 0.85, -depth / 2 + 0.2 + 0.06];
}

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

/** The most urgent fill the seats; the rest are "+N" on the wall. */
export function seating(issues, grid) {
  const all = employeesOf(issues);
  const seated = all.slice(0, grid.capacity).map((issue, seat) => ({ id: issue.id, seat, issue }));
  return { seated, overflow: all.slice(grid.capacity) };
}

// --- how an agent state reads. `head` is where the head is in the pose, from the seat: the name tag points at it.
export const STATES = {
  working: { pose: 'type', lamp: 0x9ad0ff, symbol: '···', tone: 'muted', head: [0, 1.5, 0.056] },
  needs_you: { pose: 'wave', lamp: 0xffb020, symbol: '!', tone: 'warning', head: [0, 1.5, 0.014] },
  stuck: { pose: 'head', lamp: 0xff4d4d, symbol: '×', tone: 'danger', head: [0, 1.45, 0.086] },
  idle: { pose: 'recline', lamp: null, symbol: 'z', tone: 'muted', head: [0.02, 1.5, -0.076] },
};
export const STATE_ORDER = ['needs_you', 'stuck', 'working', 'idle'];
export const TAG_ABOVE_HEAD = 0.34;

export const stateOf = (issue) => (Object.hasOwn(STATES, issue?.agentState) ? issue.agentState : 'idle');

/** Where the name tag's tip points for a person sitting at `seat` in `state`: just above the head. */
export function headAnchor(seat, state, grid) {
  const { x, z } = seatPosition(seat, grid);
  const [hx, hy, hz] = STATES[state].head;
  return [x + hx, hy + TAG_ABOVE_HEAD, z + hz];
}

/** How many of the employees are in each state, for the one sentence that stands for the picture. */
export function summarize(issues) {
  const counts = { total: 0, working: 0, needs_you: 0, stuck: 0, idle: 0 };
  for (const issue of employeesOf(issues)) {
    counts.total += 1;
    counts[stateOf(issue)] += 1;
  }
  return counts;
}

/** The three columns of the little board on the wall: how many Todo, In Progress and In Review issues there are, all of them. */
export function boardCounts(issues) {
  const counts = [0, 0, 0];
  for (const issue of employeesOf(issues)) counts[ACTIVE_STATUSES.indexOf(issue.status)] += 1;
  return counts;
}

// --- who a person is
const SKINS = [0xeab794, 0xd49a72, 0xb47652, 0xf0c9ab];
const HAIRS = [0x2b2320, 0x3a2a22, 0x1a1a1f, 0x6b4a2f, 0x1f1a1a];
const STYLES = ['short', 'bun', 'glasses', 'short', 'cap'];

const hashOf = (id) => {
  if (typeof id === 'number' && Number.isFinite(id)) return Math.imul(Math.trunc(id), 2654435761) >>> 0;
  let hash = 2166136261;
  for (const char of String(id)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return Math.imul(hash, 2654435761) >>> 0;
};

/**
 * Hair, skin and glasses (or a bun, or a cap) from the issue number alone: the same issue is always the same person.
 * Kept exactly as the design frames drew it, which the owner has approved: hair and style are indexed with signed shifts, so for
 * about half of the numbers the index is negative and that person is plain, with the first (dark) hair.
 */
export function look(id) {
  const hash = hashOf(id);
  const signed = hash | 0;
  return { skin: SKINS[hash % SKINS.length], hair: HAIRS[(signed >> 3) % HAIRS.length] ?? HAIRS[0], style: STYLES[(signed >> 6) % STYLES.length] ?? STYLES[0] };
}

// --- clothes: the agent's colour. Claude orange, ChatGPT green, DeepSeek blue; any other agent takes one of three more, by its
// name, so it keeps it; no agent is grey.
const AGENT_SHIRTS = { claude: 0xd97757, codex: 0x19a58a, chatgpt: 0x19a58a, deepseek: 0x4d6bfe };
const OTHER_SHIRTS = [0x8b6fd6, 0xe27ba8, 0xe4b93c]; // purple, pink, yellow
const NO_AGENT_SHIRT = 0x9aa0ad;

export function shirtOf(agent) {
  if (!agent) return NO_AGENT_SHIRT;
  const key = String(agent).toLowerCase();
  return Object.hasOwn(AGENT_SHIRTS, key) ? AGENT_SHIRTS[key] : OTHER_SHIRTS[hashOf(key) % OTHER_SHIRTS.length];
}

export const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;

// --- the road: what a person walks along between seats and to the door, as points on the floor [{ x, z }]
const gapX = (column, grid) => seatPosition(column, grid).x - GAP;
const cellOf = (index, grid) => ({ column: index % grid.columns, row: Math.floor(index / grid.columns) });

/** Out of the chair into the gap beside the desk, behind the row to the corridor along the left wall, to the door and into it. */
export function routeToDoor(seat, grid) {
  const { column } = cellOf(seat, grid);
  const here = seatPosition(seat, grid);
  const door = doorPosition(grid);
  const path = [here, { x: gapX(column, grid), z: here.z }];
  if (column > 0) path.push({ x: gapX(column, grid), z: here.z - AISLE }, { x: gapX(0, grid), z: here.z - AISLE });
  path.push({ x: gapX(0, grid), z: door.z }, { x: door.x - SIDE, z: door.z });
  return path;
}

const routeFromDoor = (seat, grid) => routeToDoor(seat, grid).reverse();

/** From one seat to another: into the gap, behind the row if the column changes, along the other gap, into the seat. */
export function routeBetween(from, to, grid) {
  const a = cellOf(from, grid);
  const b = cellOf(to, grid);
  const start = seatPosition(from, grid);
  const end = seatPosition(to, grid);
  const path = [start, { x: gapX(a.column, grid), z: start.z }];
  if (a.column !== b.column) path.push({ x: gapX(a.column, grid), z: start.z - AISLE }, { x: gapX(b.column, grid), z: start.z - AISLE });
  path.push({ x: gapX(b.column, grid), z: end.z }, end);
  return path;
}

// --- what changes when the list changes
/**
 * Who does what to go from the seating now (`prev`: [{ id, seat }], the `seats` of the last plan, or []) to the one `issues`
 * calls for. Seats follow the order of the list strictly (the most urgent in the front row), so a change in the order is people
 * walking to their new seats.
 *   stay   sits where they sat (their state may have changed: that is a pose, not a walk)
 *   move   gets up and walks to another seat
 *   enter  comes in at the door and walks to a seat
 *   leave  gets up and walks out through the door: the issue is Done or Canceled, left the Active list, or lost its desk to a more
 *          urgent one (`reason` says which)
 * `seats` is the new seating, `overflow` how many issues have no desk.
 */
export function plan(prev, issues, grid) {
  const { seated, overflow } = seating(issues, grid);
  const before = new Map((prev ?? []).map(({ id, seat }) => [id, seat]));
  const after = new Map(seated.map(({ id, seat }) => [id, seat]));
  const stay = [];
  const move = [];
  const enter = [];
  for (const { id, seat } of seated) {
    if (!before.has(id)) enter.push({ id, seat, path: routeFromDoor(seat, grid) });
    else if (before.get(id) === seat) stay.push({ id, seat });
    else move.push({ id, from: before.get(id), to: seat, path: routeBetween(before.get(id), seat, grid) });
  }
  const byId = new Map((issues ?? []).filter(Boolean).map((issue) => [issue.id, issue]));
  const leave = [];
  for (const [id, seat] of before) {
    if (after.has(id)) continue;
    const issue = byId.get(id);
    const reason = !issue ? 'gone' : SITTING.has(issue.status) ? 'overflow' : issue.status;
    leave.push({ id, seat, reason, path: routeToDoor(seat, grid) });
  }
  return { seats: seated.map(({ id, seat }) => ({ id, seat })), stay, move, enter, leave, overflow: overflow.length };
}
