// The Office scene's fixed camera as plain numbers: where it stands, where it looks, and where a point of the room lands on the
// canvas. scene.js sets its three.js camera from `fitCamera` and the name tags are placed with `project`, so a tag is on its
// person whether the scene is loaded, running, or replaced by the picture shown without WebGL.

const FOV = 28.5; // degrees, vertical
const NEAR = 0.1;
const FAR = 200;
const DIRECTION = [0.3, 0.78, 1]; // from the middle of the room towards the camera: a little right, well above, in front
const MARGIN = 0.96; // the room fills this much of the canvas, each way

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const length = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / length, a[1] / length, a[2] / length]; };

/** The room as a box: the slab under the floor to just above the walls. */
export function roomBox({ width, depth }) {
  return { min: [-width / 2, -0.52, -depth / 2], max: [width / 2, 3.1, depth / 2] };
}

// What three's lookAt builds: z points back from the target, x to the right, y up.
function basisOf(position, target) {
  const z = unit([position[0] - target[0], position[1] - target[1], position[2] - target[2]]);
  const x = unit(cross([0, 1, 0], z));
  return { x, y: cross(z, x), z };
}

// A point in the picture before the final shift, -1..1 each way.
function ndcOf(camera, point) {
  const d = [point[0] - camera.position[0], point[1] - camera.position[1], point[2] - camera.position[2]];
  const depth = -dot(d, camera.basis.z);
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  return { x: dot(d, camera.basis.x) / depth / (tan * camera.aspect), y: dot(d, camera.basis.y) / depth / tan, depth };
}

const corners = ({ min, max }) => {
  const out = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
};

function extent(camera, points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const { x, y } = ndcOf(camera, point);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * The camera that shows the whole `box` as large as the canvas allows and in its middle: move back until the box's corners fit,
 * then shift the picture so their middle is the canvas's middle (three's setViewOffset: `shift` is in -1..1 units).
 */
export function fitCamera(box, width, height) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const target = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
  const direction = unit(DIRECTION);
  const points = corners(box);
  const camera = { fov: FOV, near: NEAR, far: FAR, aspect: width / height, width, height, target, position: [0, 0, 0], basis: null, shift: [0, 0], distance: 16 };
  const place = () => {
    camera.position = target.map((v, i) => v + direction[i] * camera.distance);
    camera.basis = basisOf(camera.position, target);
  };
  for (let i = 0; i < 40; i++) {
    place();
    const { minX, maxX, minY, maxY } = extent(camera, points);
    camera.distance *= Math.max((maxX - minX) / 2, (maxY - minY) / 2) / MARGIN;
  }
  place();
  const { minX, maxX, minY, maxY } = extent(camera, points);
  camera.shift = [(minX + maxX) / 2, (minY + maxY) / 2];
  return camera;
}

/** Where a point of the room is on the canvas, in CSS pixels from its top left corner, and how far from the camera. */
export function project(camera, point) {
  const { x, y, depth } = ndcOf(camera, point);
  return { x: ((x - camera.shift[0]) * 0.5 + 0.5) * camera.width, y: (-(y - camera.shift[1]) * 0.5 + 0.5) * camera.height, depth };
}
