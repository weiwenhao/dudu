// Where people can walk and the way from one place to another. The office is a flat picture, so a person on the plane is just a point (their
// feet) and what they must not do is walk over the furniture, or in front of a chair so close that the chair is drawn over their head. The
// furniture is a list of rectangles of floor; a route goes round them, on a grid that is searched once and then straightened. Pure logic, with
// no PixiJS: the office (marvis/office.js) walks people along what this returns, and tests/office-routes.test.ts checks it.
import { DESKS, DOOR, deskAt } from './layout.js';

const CELL = 10;
const MIN_X = -400;
const MIN_Y = 0;
const COLUMNS = 198; // to x 1580
const ROWS = 90; // to y 900
const PAD = { x: 8, y: 4 }; // a person is not a point: how far from a rectangle their feet stay

/**
 * The floor nobody's feet go on, measured off the pictures: the rest area's furniture (the modules are 398 wide, the original column from
 * x 0, the new one to its left), the walls and what is behind them, and each desk with the chair, whose picture is drawn over whoever stands
 * in front of it (down to where a head clears it). The original column has a wall along its west side (x 62 to 72) with a door in it beside
 * the treadmill, and the leaf of the door stands open into the new column's side; the new column's own west wall has nothing but its shadow
 * outside it. Each is [x0, y0, x1, y1] on the plane.
 */
const FIXED = [
  ['top', -400, 0, 1580, 96], // nobody's head is to be above the plane
  ['bottom', -400, 884, 1580, 900],
  ['west wall of the new column, and outside it', -400, 0, -330, 900],
  ['water bar and the wall behind it', 62, 30, 398, 192],
  ['water bar cabinet', 68, 190, 128, 240],
  ['treadmill', 130, 335, 305, 482],
  ['balcony railing, bench and plants', 70, 606, 400, 712],
  ['ashtray', 208, 712, 238, 782],
  ['toilet wall', -334, 584, 0, 705],
  ['toilet', -260, 690, -152, 826],
  ['ping-pong table', -306, 96, -12, 270],
  ['TV cabinet', -256, 296, -70, 412],
  ['coffee table', -226, 418, -100, 486],
  ['PS5 sofa', -268, 480, -62, 582],
  ['wall north of the door', 62, 30, 72, DOOR.y0],
  ['wall south of the door', 62, DOOR.y1, 72, 898],
  ['open door', -10, DOOR.y0 - 1, 70, DOOR.y0 + 26], // the leaf, hinged at the north side of the opening, standing open to the west
];

function deskBlocks(seat) {
  const desk = deskAt(seat);
  return [
    [`desk ${seat}`, desk.x - 6, desk.y - 6, desk.x + 190, desk.y + (desk.boss ? 130 : 108)],
    // the chair's picture reaches down to desk.y + 148 (170 for the boss's), and its drawing covers a head up to the height of a person above that
    [`chair ${seat}`, desk.x + 34, desk.y + 56, desk.x + 146, desk.y + (desk.boss ? 280 : 262)],
  ];
}

export const BLOCKS = Object.freeze([...FIXED, ...Array.from({ length: DESKS }, (_, seat) => deskBlocks(seat)).flat()].map(([name, x0, y0, x1, y1]) => Object.freeze({ name, x0, y0, x1, y1 })));

const FINE = 2; // the open floor is looked up on a grid of this size
const FINE_COLUMNS = (COLUMNS * CELL) / FINE;
const FINE_ROWS = (ROWS * CELL) / FINE;
let fine = null;

/** The open floor as a grid of small cells (a cell is blocked when its middle is inside a rectangle and its margin), made by filling in the rectangles. */
function rasterize() {
  const open = new Uint8Array(FINE_COLUMNS * FINE_ROWS).fill(1);
  for (const b of BLOCKS) {
    const fx0 = Math.max(0, Math.ceil((b.x0 - PAD.x - MIN_X) / FINE - 0.5));
    const fx1 = Math.min(FINE_COLUMNS - 1, Math.floor((b.x1 + PAD.x - MIN_X) / FINE - 0.5));
    const fy0 = Math.max(0, Math.ceil((b.y0 - PAD.y - MIN_Y) / FINE - 0.5));
    const fy1 = Math.min(FINE_ROWS - 1, Math.floor((b.y1 + PAD.y - MIN_Y) / FINE - 0.5));
    for (let fy = fy0; fy <= fy1; fy++) open.fill(0, fy * FINE_COLUMNS + fx0, fy * FINE_COLUMNS + fx1 + 1);
  }
  return open;
}

/** Whether feet may stand at this point of the plane. */
export function walkable(x, y) {
  if (x < MIN_X + CELL / 2 || x > MIN_X + COLUMNS * CELL - CELL / 2 || y < MIN_Y || y >= MIN_Y + ROWS * CELL) return false;
  if (!fine) fine = rasterize();
  return fine[Math.floor((y - MIN_Y) / FINE) * FINE_COLUMNS + Math.floor((x - MIN_X) / FINE)] === 1;
}

// --- the grid
let grid = null;
const cellOf = (x, y) => [Math.floor((x - MIN_X) / CELL), Math.floor((y - MIN_Y) / CELL)];
const centre = (cx, cy) => ({ x: MIN_X + (cx + 0.5) * CELL, y: MIN_Y + (cy + 0.5) * CELL });
const inside = (cx, cy) => cx >= 0 && cy >= 0 && cx < COLUMNS && cy < ROWS;

function freeCells() {
  if (grid) return grid;
  grid = new Uint8Array(COLUMNS * ROWS);
  for (let cy = 0; cy < ROWS; cy++) for (let cx = 0; cx < COLUMNS; cx++) { const c = centre(cx, cy); grid[cy * COLUMNS + cx] = walkable(c.x, c.y) ? 1 : 0; }
  return grid;
}

/** The point of open floor nearest to this one (itself, when it is open floor). */
export function nearestWalkable(point) {
  if (walkable(point.x, point.y)) return { x: point.x, y: point.y };
  for (let radius = 4; radius <= 400; radius += 4) {
    let best = null;
    for (let angle = 0; angle < 360; angle += 15) {
      const x = point.x + Math.cos((angle * Math.PI) / 180) * radius;
      const y = point.y + Math.sin((angle * Math.PI) / 180) * radius;
      if (walkable(x, y) && (!best || Math.hypot(x - point.x, y - point.y) < best.d)) best = { x, y, d: Math.hypot(x - point.x, y - point.y) };
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x: point.x, y: point.y };
}

/** Whether feet can go in a straight line from `a` to `b` without leaving the open floor. */
export function clear(a, b) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
  for (let i = 0; i <= steps; i++) if (!walkable(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)) return false;
  return true;
}

// a binary heap of [priority, cell]
class Heap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(priority, value) {
    const items = this.items;
    items.push([priority, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let least = i;
        if (left < items.length && items[left][0] < items[least][0]) least = left;
        if (right < items.length && items[right][0] < items[least][0]) least = right;
        if (least === i) break;
        [items[least], items[i]] = [items[i], items[least]];
        i = least;
      }
    }
    return top;
  }
}

const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** The cells from `start` to `goal` (both open floor) round the furniture, or null. */
function search(start, goal) {
  const free = freeCells();
  const [sx, sy] = cellOf(start.x, start.y);
  const [gx, gy] = cellOf(goal.x, goal.y);
  if (!inside(sx, sy) || !inside(gx, gy)) return null;
  const cost = new Float64Array(COLUMNS * ROWS).fill(Infinity); // not Float32: a rounded cost can look like an improvement, for ever
  const from = new Int32Array(COLUMNS * ROWS).fill(-1);
  const heuristic = (cx, cy) => { const dx = Math.abs(cx - gx); const dy = Math.abs(cy - gy); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  const open = new Heap();
  cost[sy * COLUMNS + sx] = 0;
  open.push(heuristic(sx, sy), sy * COLUMNS + sx);
  while (open.size) {
    const [, at] = open.pop();
    const cx = at % COLUMNS;
    const cy = (at / COLUMNS) | 0;
    if (cx === gx && cy === gy) {
      const out = [];
      for (let i = at; i !== -1; i = from[i]) out.push(centre(i % COLUMNS, (i / COLUMNS) | 0));
      return out.reverse();
    }
    for (const [dx, dy, step] of STEPS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inside(nx, ny) || !free[ny * COLUMNS + nx]) continue;
      if (dx && dy && (!free[cy * COLUMNS + nx] || !free[ny * COLUMNS + cx])) continue; // no cutting a corner
      const next = ny * COLUMNS + nx;
      const total = cost[at] + step;
      if (total >= cost[next]) continue;
      cost[next] = total;
      from[next] = at;
      open.push(total + heuristic(nx, ny), next);
    }
  }
  return null;
}

/** Takes the steps out of a path of cells: from each point, straight on to the farthest one that can be seen from it. */
function straighten(points) {
  const out = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    while (j + 1 < points.length && clear(points[i], points[j + 1])) j += 1;
    out.push(points[j]);
    i = j;
  }
  return out;
}

/**
 * The way for feet from `from` to `to` over the open floor: the points to walk to in turn, the first being `from` and the last `to`.
 * Both are normally open floor (a place's `gate`); a point that is not is walked to from, or towards, the nearest open floor.
 */
export function routeFor(from, to) {
  const a = nearestWalkable(from);
  const b = nearestWalkable(to);
  const cells = search(a, b);
  const middle = cells ? straighten([a, ...cells.slice(1, -1), b]) : [a, b];
  const points = [{ x: from.x, y: from.y }, ...middle, { x: to.x, y: to.y }];
  return points.filter((point, i) => i === 0 || Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y) > 0.5);
}

/** How long a route is, and where along it a distance `d` from its start is, and which way (-1, 0 or 1 to the right) that part goes. */
export function measure(points) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lengths[lengths.length - 1];
  return {
    total,
    at(d) {
      const along = Math.max(0, Math.min(total, d));
      let i = 1;
      while (i < points.length - 1 && lengths[i] < along) i += 1;
      const a = points[i - 1];
      const b = points[i];
      const span = lengths[i] - lengths[i - 1] || 1;
      const k = (along - lengths[i - 1]) / span;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: Math.abs(b.x - a.x) < 1 ? 0 : Math.sign(b.x - a.x) };
    },
  };
}
