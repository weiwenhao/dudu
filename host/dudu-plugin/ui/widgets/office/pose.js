// How a person is posed, as a flat list of numbers (torso, head, face, hands, elbows, feet), and how two poses blend. Pure: the
// scene turns the numbers into transforms. Positions are from the seat, x to the person's right, z to the viewer.
// Every pose a state asks for is a function of time, so typing, waving and breathing need no keyframes; a state change is a blend
// from the pose the person was in to the new one.
import { STATES } from './layout.js';

export const POSE = {
  lean: 0, torsoY: 1, torsoZ: 2, shoulderY: 3, headX: 4, headY: 5, headZ: 6, headTilt: 7, headRoll: 8, eyes: 9,
  mouthTurn: 10, mouthY: 11, mouthWidth: 12, mouthHeight: 13,
  handL: 14, handR: 17, elbowL: 20, elbowR: 23, legs: 26, footL: 27, footR: 30, bob: 33,
};
const POSE_SIZE = 34;

export const ARM = [0.34, 0.32]; // upper arm and forearm
export const LEG = [0.33, 0.33];
const STAND = 0.12; // how much higher the torso is standing than sitting

const set = (out, at, x, y, z) => { out[at] = x; out[at + 1] = y; out[at + 2] = z; };

// The body in a pose, before anything moves: from the first version of the scene (seated, one per state) and the standing one.
function base(out, { lean, torsoY = 0.95, headY = 1.5, headX = 0, headTilt, headRoll = 0, eyes = 1, mouth = [Math.PI, -0.085, 1, 1], shoulderY }) {
  out[POSE.lean] = lean;
  out[POSE.torsoY] = torsoY;
  out[POSE.torsoZ] = lean * -0.18;
  out[POSE.shoulderY] = shoulderY ?? 0.19 - 0.04 * lean;
  out[POSE.headX] = headX;
  out[POSE.headY] = headY;
  out[POSE.headZ] = 0.02 + lean * 0.3;
  out[POSE.headTilt] = headTilt;
  out[POSE.headRoll] = headRoll;
  out[POSE.eyes] = eyes;
  [out[POSE.mouthTurn], out[POSE.mouthY], out[POSE.mouthWidth], out[POSE.mouthHeight]] = mouth;
  out[POSE.legs] = 0;
  set(out, POSE.footL, -0.14, 0.065, 0);
  set(out, POSE.footR, 0.14, 0.065, 0);
  set(out, POSE.elbowL, -0.9, -1, -0.3);
  set(out, POSE.elbowR, 0.9, -1, -0.3);
}

const KINDS = {
  // Working: leaning in, both hands on the keys, one finger after the other.
  type(out, t, seed) {
    base(out, { lean: 0.12, headTilt: 0.16 });
    set(out, POSE.handL, -0.2, 0.84 + Math.max(0, Math.sin(t * 9 + seed)) * 0.03, 0.55);
    set(out, POSE.handR, 0.2, 0.84 + Math.max(0, Math.sin(t * 9 + seed + 2.2)) * 0.03, 0.55);
    out[POSE.bob] = Math.sin(t * 2 + seed) * 0.006;
  },
  // Needs you: one hand up and waving, a smile for the viewer, the head swaying a little.
  wave(out, t, seed) {
    base(out, { lean: -0.02, headTilt: -0.04, headRoll: Math.sin(t * 3) * 0.04, mouth: [Math.PI, -0.085, 1.25, 1] });
    set(out, POSE.handL, -0.24, 0.9, 0.5);
    set(out, POSE.handR, 0.44 + Math.sin(t * 7) * 0.06, 1.92, 0.12);
    set(out, POSE.elbowR, 0.3, -0.2, -1);
    out[POSE.bob] = Math.sin(t * 2 + seed) * 0.006;
  },
  // Stuck: both hands on the head, shoulders in, the mouth turned down.
  head(out, t, seed) {
    base(out, { lean: 0.22, headY: 1.45, headTilt: 0.3, mouth: [0, -0.11, 1, 1] });
    set(out, POSE.handL, -0.16, 1.62, 0.18);
    set(out, POSE.handR, 0.16, 1.62, 0.18);
    out[POSE.bob] = Math.sin(t * 2 + seed) * 0.006;
  },
  // Idle: leaning back, hands hanging, eyes shut, breathing slowly.
  recline(out, t, seed) {
    base(out, { lean: -0.32, headX: 0.02, headTilt: -0.32, headRoll: 0.18, eyes: 0.12, mouth: [Math.PI, -0.09, 0.8, 0.45], shoulderY: 0.19 });
    set(out, POSE.handL, -0.36, 0.64, -0.02);
    set(out, POSE.handR, 0.36, 0.64, -0.02);
    set(out, POSE.elbowL, -0.9, -0.2, -0.6);
    set(out, POSE.elbowR, 0.9, -0.2, -0.6);
    out[POSE.bob] = Math.sin(t * 1.6 + seed) * 0.01;
  },
  // Standing and walking: `walk` is 0 standing still, 1 at full pace; `gait` is how far into the stride.
  stand(out, t, seed, walk, gait) {
    base(out, { lean: 0.05 * walk, torsoY: 0.95 + STAND, headY: 1.5 + STAND, headTilt: 0.04 * walk, shoulderY: 0.19 });
    out[POSE.legs] = 1;
    for (const [side, phase] of [[-1, 0], [1, Math.PI]]) {
      const swing = Math.sin(gait + phase);
      set(out, side < 0 ? POSE.handL : POSE.handR, side * 0.38, 0.8, -swing * 0.22 * walk); // an arm swings against the leg on its side
      set(out, side < 0 ? POSE.elbowL : POSE.elbowR, side * 0.9, -0.2, -0.6);
      set(out, side < 0 ? POSE.footL : POSE.footR, side * 0.14, 0.065 + Math.max(0, Math.cos(gait + phase)) * 0.13 * walk, swing * 0.26 * walk);
    }
    out[POSE.bob] = Math.abs(Math.sin(gait)) * 0.035 * walk;
  },
};

/** The pose a state asks for (STATES[state].pose), or `stand`, at time `t`; `seed` keeps neighbours out of step. */
export function evalPose(kind, t, seed, out, walk = 0, gait = 0) {
  KINDS[kind](out, t, seed, walk, gait);
  return out;
}

export const newPose = () => new Float64Array(POSE_SIZE);

export function blendPose(from, to, k, out) {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = from[i] + (to[i] - from[i]) * k;
  return out;
}

export const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/**
 * Where a two-bone limb's middle joint is, for a root at `s`, an end at `h`, bone lengths `l1` and `l2`, and the joint bending
 * towards `pole`; written into `out`. A target out of reach straightens the limb.
 */
export function joint(s, h, l1, l2, pole, out) {
  const dx = h[0] - s[0];
  const dy = h[1] - s[1];
  const dz = h[2] - s[2];
  const length = Math.hypot(dx, dy, dz) || 1e-6;
  const dist = Math.min(length, l1 + l2 - 1e-3);
  const ux = dx / length;
  const uy = dy / length;
  const uz = dz / length;
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const height = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
  const k = pole[0] * ux + pole[1] * uy + pole[2] * uz;
  let px = pole[0] - ux * k;
  let py = pole[1] - uy * k;
  let pz = pole[2] - uz * k;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  out[0] = s[0] + ux * along + px * height;
  out[1] = s[1] + uy * along + py * height;
  out[2] = s[2] + uz * along + pz * height;
  return out;
}

/** Where the head is for a state, so the name tag can point at it without the scene: STATES[state].head, checked by the tests. */
export function headOf(state) {
  const out = newPose();
  evalPose(STATES[state].pose, 0, 0, out);
  return [out[POSE.headX], out[POSE.headY], out[POSE.headZ]];
}
