import { GAP } from './metrics.js';

// How far each line runs past the last cell, and how dark it is: a little different from line to line, so it reads as a drawn
// construction line and not as a frame.
const OVERSHOOT = [9, 13, 8, 14, 10, 12, 8, 14, 11, 9, 13];
const overshoot = (n) => OVERSHOOT[n % OVERSHOOT.length];
const opacity = (n) => (0.6 + (0.4 * ((n * 7) % 5)) / 4).toFixed(2);

/** The dashed lines in the middle of the gaps between cells, shown while editing and while dragging. */
export function Lattice({ cell, row = cell, columns, rows }) {
  // A column is a cell wide and a row `row` tall (a little different from a cell: the rows share the height of the window).
  const across = (k) => -GAP / 2 + k * (cell + GAP) + 0.5;
  const down = (k) => -GAP / 2 + k * (row + GAP) + 0.5;
  const lines = [];
  for (let k = 0; k <= columns; k++) lines.push(<line key={`v${k}`} x1={across(k)} y1={down(0) - overshoot(k)} x2={across(k)} y2={down(rows) + overshoot(k + 5)} opacity={opacity(k)} />);
  for (let j = 0; j <= rows; j++) lines.push(<line key={`h${j}`} x1={across(0) - overshoot(j + 3)} y1={down(j)} x2={across(columns) + overshoot(j + 8)} y2={down(j)} opacity={opacity(j + 2)} />);
  return <div className="db-lines" aria-hidden="true"><svg>{lines}</svg></div>;
}
