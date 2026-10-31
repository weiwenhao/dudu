import { GAP } from './metrics.js';

// How far each line runs past the last cell, and how dark it is: a little different from line to line, so it reads as a drawn
// construction line and not as a frame.
const OVERSHOOT = [9, 13, 8, 14, 10, 12, 8, 14, 11, 9, 13];
const overshoot = (n) => OVERSHOOT[n % OVERSHOOT.length];
const opacity = (n) => (0.6 + (0.4 * ((n * 7) % 5)) / 4).toFixed(2);

/** The dashed lines in the middle of the gaps between cells, shown while editing and while dragging. */
export function Lattice({ cell, columns, rows }) {
  const pitch = cell + GAP;
  const at = (k) => -GAP / 2 + k * pitch + 0.5;
  const lines = [];
  for (let k = 0; k <= columns; k++) lines.push(<line key={`v${k}`} x1={at(k)} y1={at(0) - overshoot(k)} x2={at(k)} y2={at(rows) + overshoot(k + 5)} opacity={opacity(k)} />);
  for (let j = 0; j <= rows; j++) lines.push(<line key={`h${j}`} x1={at(0) - overshoot(j + 3)} y1={at(j)} x2={at(columns) + overshoot(j + 8)} y2={at(j)} opacity={opacity(j + 2)} />);
  return <div className="db-lines" aria-hidden="true"><svg>{lines}</svg></div>;
}
