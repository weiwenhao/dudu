import { doorPosition, hex, look, roomSize, seatPosition, shirtOf, STATES } from './layout.js';
import { project } from './camera.js';
import { THEMES } from './palette.js';

// The office as a flat picture, for when the scene cannot be drawn (no WebGL, a lost context) and for the moment before it is
// loaded: the same room, desks and people as the scene, seen through the same camera, in plain shapes. `view` is camera.js's.

const shade = (color, k) => {
  const channel = (shift) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 255) * k)));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
};

export function OfficeFallback({ grid, view, theme, people = [] }) {
  const T = THEMES[theme] ?? THEMES.light;
  const { width: W, depth: D } = roomSize(grid);
  const at = (x, y, z) => project(view, [x, y, z]);
  const quad = (points, fill, extra) => <polygon points={points.map(([x, y, z]) => { const p = at(x, y, z); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ')} fill={fill} {...extra} />;
  const unit = (x, y, z) => { const a = at(x, y, z); const b = at(x + 1, y, z); return Math.hypot(b.x - a.x, b.y - a.y); };
  const wz = -D / 2 + 0.2;
  const wx = -W / 2 + 0.2;
  const door = doorPosition(grid);
  const byseat = new Map(people.map((person) => [person.seat, person]));
  const rows = Array.from({ length: grid.rows }, (_, row) => row).reverse(); // the back row first, the front row over it
  const glows = [...new Set(people.map((person) => STATES[person.state].lamp).filter((lamp) => lamp != null))];

  const desk = (k) => {
    const { x, z } = seatPosition(k, grid);
    const person = byseat.get(k);
    const lamp = person && STATES[person.state].lamp;
    return (
      <g key={k}>
        {!person && quad([[x - 0.29, 0.5, z - 0.3], [x + 0.29, 0.5, z - 0.3], [x + 0.29, 1.12, z - 0.3], [x - 0.29, 1.12, z - 0.3]], hex(T.chair))}
        {person && <Person grid={grid} view={view} seat={k} person={person} />}
        {quad([[x - 0.85, 0.79, z + 0.29], [x + 0.85, 0.79, z + 0.29], [x + 0.85, 0.79, z + 1.15], [x - 0.85, 0.79, z + 1.15]], hex(T.desk))}
        {quad([[x - 0.85, 0.79, z + 1.15], [x + 0.85, 0.79, z + 1.15], [x + 0.85, 0.2, z + 1.15], [x - 0.85, 0.2, z + 1.15]], shade(T.desk, 0.9))}
        {lamp != null && (() => { const c = at(x + 0.15, 0.8, z + 0.75); return <ellipse cx={c.x} cy={c.y} rx={unit(x, 0.8, z)} ry={unit(x, 0.8, z) * 0.4} fill={`url(#office-glow-${lamp})`} />; })()}
        {quad([[x - 0.26, 0.82, z + 0.74], [x + 0.26, 0.82, z + 0.74], [x + 0.26, 1.12, z + 0.8], [x - 0.26, 1.12, z + 0.8]], '#c9ccd6')}
      </g>
    );
  };

  return (
    <svg className="absolute inset-0 size-full" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="none" aria-hidden="true" data-office-fallback="">
      <defs>
        {glows.map((lamp) => (
          <radialGradient key={lamp} id={`office-glow-${lamp}`}>
            <stop offset="0" stopColor={hex(lamp)} stopOpacity={T.night ? 0.85 : 0.55} />
            <stop offset="1" stopColor={hex(lamp)} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {quad([[-W / 2, 0, D / 2], [W / 2, 0, D / 2], [W / 2, -0.5, D / 2], [-W / 2, -0.5, D / 2]], shade(T.slab, 0.94))}
      {quad([[W / 2, 0, D / 2], [W / 2, 0, -D / 2], [W / 2, -0.5, -D / 2], [W / 2, -0.5, D / 2]], shade(T.slab, 0.8))}
      {quad([[-W / 2, 0, -D / 2], [W / 2, 0, -D / 2], [W / 2, 0, D / 2], [-W / 2, 0, D / 2]], hex(T.floor))}
      {quad([[-W / 2 + 1.3, 0.04, -D / 2 + 1.0], [W / 2 - 1.3, 0.04, -D / 2 + 1.0], [W / 2 - 1.3, 0.04, D / 2 - 1.2], [-W / 2 + 1.3, 0.04, D / 2 - 1.2]], hex(T.rug))}
      {quad([[wx, 0, -D / 2], [wx, 0, D / 2], [wx, 3, D / 2], [wx, 3, -D / 2]], hex(T.wallSide))}
      {quad([[-W / 2, 3, -D / 2], [wx, 3, -D / 2], [wx, 3, D / 2], [-W / 2, 3, D / 2]], shade(T.wallSide, 1.06))}
      {quad([[-W / 2, 0, wz], [W / 2, 0, wz], [W / 2, 3, wz], [-W / 2, 3, wz]], hex(T.wall))}
      {quad([[-W / 2, 3, -D / 2], [W / 2, 3, -D / 2], [W / 2, 3, wz], [-W / 2, 3, wz]], shade(T.wall, 1.06))}
      {[-W * 0.25, -W * 0.25 + 3].map((x) => <g key={x}>{quad([[x - 1.15, 1.05, wz], [x + 1.15, 1.05, wz], [x + 1.15, 2.45, wz], [x - 1.15, 2.45, wz]], T.night ? T.skyBot : T.skyTop, { stroke: hex(T.trim), strokeWidth: 2 })}</g>)}
      {quad([[W / 2 - 3.85, 0.85, wz], [W / 2 - 0.75, 0.85, wz], [W / 2 - 0.75, 2.55, wz], [W / 2 - 3.85, 2.55, wz]], hex(T.board), { stroke: hex(T.frame), strokeWidth: 2 })}
      {quad([[wx, 0, door.z - 0.5], [wx, 0, door.z + 0.5], [wx, 2.25, door.z + 0.5], [wx, 2.25, door.z - 0.5]], hex(T.door), { stroke: hex(T.trim), strokeWidth: 2 })}
      {rows.flatMap((row) => Array.from({ length: grid.columns }, (_, column) => desk(row * grid.columns + column)))}
      {[[W / 2 - 0.7, -D / 2 + 0.8, 1.15], [W / 2 - 0.6, D / 2 - 0.7, 0.9]].map(([x, z, s]) => {
        const c = at(x, 0.8 * s, z);
        return <circle key={`${x}`} cx={c.x} cy={c.y} r={unit(x, 0.8, z) * 0.42 * s} fill={hex(T.leaf)} />;
      })}
    </svg>
  );
}

// A person from the front: body, head, hair and the two arms, posed as the state asks.
function Person({ grid, view, seat, person }) {
  const { x, z } = seatPosition(seat, grid);
  const spec = look(person.id);
  const shirt = hex(shirtOf(person.agent));
  const skin = hex(spec.skin);
  const at = (px, py, pz) => project(view, [x + px, py, z + pz]);
  const unit = Math.hypot(at(1, 1, 0).x - at(0, 1, 0).x, at(1, 1, 0).y - at(0, 1, 0).y);
  const state = person.state;
  const lean = state === 'idle' ? -0.1 : state === 'stuck' ? 0.1 : 0.04;
  const body = at(0, 0.95, lean * -0.2);
  const [hx, hy, hz] = STATES[state].head;
  const head = at(hx, hy, hz);
  const hands = {
    working: [[-0.2, 0.84, 0.55], [0.2, 0.84, 0.55]],
    needs_you: [[-0.24, 0.9, 0.5], [0.44, 1.92, 0.12]],
    stuck: [[-0.16, 1.62, 0.18], [0.16, 1.62, 0.18]],
    idle: [[-0.36, 0.64, -0.02], [0.36, 0.64, -0.02]],
  }[state];
  const r = 0.235 * unit;
  return (
    <g>
      <ellipse cx={body.x} cy={body.y} rx={0.3 * unit} ry={0.45 * unit} fill={shirt} />
      {[-1, 1].map((side, i) => {
        const from = at(side * 0.3, 1.14, 0);
        const to = at(...hands[i]);
        return (
          <g key={side}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={shirt} strokeWidth={0.16 * unit} strokeLinecap="round" />
            <circle cx={to.x} cy={to.y} r={0.07 * unit} fill={skin} />
          </g>
        );
      })}
      <circle cx={head.x} cy={head.y} r={r} fill={skin} />
      <path d={`M${head.x - r * 1.05},${head.y} A${r * 1.05},${r * 1.05} 0 0 1 ${head.x + r * 1.05},${head.y} Z`} fill={hex(spec.hair)} />
      {state !== 'idle' && [-1, 1].map((side) => <circle key={side} cx={head.x + side * 0.085 * unit} cy={head.y + 0.03 * unit} r={0.03 * unit} fill="#23232b" />)}
    </g>
  );
}
