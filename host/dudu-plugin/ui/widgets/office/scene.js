// The Office widget's three.js scene: a small model of an office with one person at a desk for each Active issue. Everything is
// built from basic shapes (rounded boxes, capsules, spheres); the floor's wood grain and the sky in the windows are painted on a
// canvas at run time. No models, no textures to load. The camera is fixed (camera.js); the light theme is day, the dark one night.
//
// This is the only file that imports three, and what it imports is named, so the bundler keeps only what is used.
//
// Few draw calls however many people there are: the room's fixed parts are merged into three meshes, and every kind of part of a
// person (torsos, heads, arms, ...) is one InstancedMesh with an instance for each person. A person is a small tree of plain
// Object3D nodes that the pose moves; every frame their matrices are copied into the instances.
import {
  ACESFilmicToneMapping, AdditiveBlending, BufferAttribute, CanvasTexture, CapsuleGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DirectionalLight, DoubleSide, DynamicDrawUsage, Euler, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Quaternion, Raycaster, RepeatWrapping,
  RingGeometry, Scene, ShadowMaterial, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fitCamera, project, roomBox } from './camera.js';
import { boardCounts, deskGrid, doorPosition, look, plan, roomSize, routeBetween, routeToDoor, seatPosition, shirtOf, stateOf, STATES, TAG_ABOVE_HEAD } from './layout.js';
import { THEMES } from './palette.js';
import { ARM, blendPose, ease, evalPose, joint, LEG, newPose, POSE } from './pose.js';

const TAU = Math.PI * 2;
const STATIC_TIME = 0.6; // the moment the still picture (reduced motion) shows: the one the design frames were drawn at
const BLEND = 0.4; // seconds a person takes to change pose
const WALK_SPEED = 2.5; // units a second
const FRAME_BUSY = 1000 / 30; // someone types, waves or walks: at most 30 frames a second
const FRAME_CALM = 100; // only breathing: ten is plenty
const SPARE_PEOPLE = 12; // people on their way in or out beyond one for each desk
const CROWD = 8; // more people than this changing places at once just change, without walking

const SUN_DIRECTION = new Vector3(4.5, 8, 6).normalize();
const HOVER_COLOR = 0x4176e6;

// --- small helpers
const ZERO = new Matrix4().makeScale(0, 0, 0);
const UP = new Vector3(0, 1, 0);

/** A transform from a position, an Euler rotation and a scale (a number or three). */
const placed = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => {
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  return new Matrix4().compose(new Vector3(...position), new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2])), new Vector3(...s));
};
/** Transforms applied in order, the first outermost: chain(room, door, part) puts the part in the door in the room. */
const chain = (...matrices) => matrices.reduce((outer, inner) => outer.clone().multiply(inner));
const at = (x, y, z) => placed([x, y, z]);

// How round the corners are drawn follows how round they are: a radius of a few pixels needs no more than a bevel.
const rounded = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, r >= 0.035 ? 3 : r >= 0.02 ? 2 : 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

function paint(geometry, hex) {
  const color = new Color(hex);
  const count = geometry.attributes.position.count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { values[i * 3] = color.r; values[i * 3 + 1] = color.g; values[i * 3 + 2] = color.b; }
  geometry.setAttribute('color', new BufferAttribute(values, 3));
}

/** Collects shapes with a colour and a transform each, and merges those that share a material into one geometry. */
function mergedBuilder() {
  const buckets = { matte: [], metal: [], basic: [] };
  const put = (bucket, geometry, hex, matrix) => { geometry.applyMatrix4(matrix); paint(geometry, hex); buckets[bucket].push(geometry); };
  return {
    // a rounded box comes without an index; the others have one, and a merge needs all or none
    box: (bucket, [w, h, d], hex, matrix, r) => { const raw = rounded(w, h, d, r); const indexed = mergeVertices(raw); raw.dispose(); put(bucket, indexed, hex, matrix); },
    cylinder: (bucket, top, bottom, height, hex, matrix) => put(bucket, new CylinderGeometry(top, bottom, height, 28), hex, matrix),
    sphere: (bucket, radius, hex, matrix, widthSegments = 24, heightSegments = 18) => put(bucket, new SphereGeometry(radius, widthSegments, heightSegments), hex, matrix),
    merged(bucket) {
      const list = buckets[bucket];
      if (!list.length) return null;
      const geometry = mergeGeometries(list, false);
      for (const part of list) part.dispose();
      buckets[bucket] = [];
      return geometry;
    },
  };
}

// --- textures painted at run time
function plankTexture(T) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d');
  const base = new Color(T.floor);
  for (let i = 0; i < 8; i++) {
    const k = 0.93 + ((i * 37) % 7) / 60;
    g.fillStyle = `#${base.clone().multiplyScalar(k).getHexString()}`; g.fillRect(i * 64, 0, 64, 512);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(i * 64, 0, 2, 512);
    for (let j = 0; j < 3; j++) { g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(i * 64, (i * 131 + j * 197) % 480, 64, 2); }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function skyTexture(T, night) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 160;
  const g = canvas.getContext('2d');
  const gradient = g.createLinearGradient(0, 0, 0, 160);
  gradient.addColorStop(0, T.skyTop); gradient.addColorStop(1, T.skyBot);
  g.fillStyle = gradient; g.fillRect(0, 0, 256, 160);
  if (!night) {
    g.fillStyle = 'rgba(255,255,255,.95)';
    for (const [cx, cy, r] of [[60, 50, 18], [82, 46, 24], [108, 54, 16], [190, 90, 16], [212, 86, 22], [236, 94, 13]]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); }
    g.fillStyle = '#c8e6c0'; g.beginPath(); g.moveTo(0, 160); g.lineTo(0, 138); g.quadraticCurveTo(70, 118, 140, 140); g.quadraticCurveTo(200, 128, 256, 142); g.lineTo(256, 160); g.fill();
  } else {
    g.fillStyle = '#fff';
    const random = (n) => { const v = Math.sin(n * 91.7) * 43758.5; return v - Math.floor(v); };
    for (let i = 0; i < 46; i++) { g.globalAlpha = 0.4 + random(i) * 0.6; g.fillRect(random(i + 1) * 256, random(i + 2) * 110, 1.6, 1.6); }
    g.globalAlpha = 1; g.fillStyle = '#f4f1da'; g.beginPath(); g.arc(196, 44, 14, 0, TAU); g.fill();
    g.fillStyle = '#1b2352'; g.beginPath(); g.arc(202, 40, 12, 0, TAU); g.fill();
    g.fillStyle = '#10163a'; g.beginPath(); g.moveTo(0, 160); g.lineTo(0, 130); g.lineTo(24, 110); g.lineTo(40, 128); g.lineTo(70, 100); g.lineTo(96, 126); g.lineTo(130, 112); g.lineTo(170, 132); g.lineTo(200, 104); g.lineTo(256, 130); g.lineTo(256, 160); g.fill();
    g.fillStyle = 'rgba(255,214,140,.9)';
    for (const [wx, wy] of [[30, 124], [76, 120], [138, 126], [206, 122], [226, 128]]) g.fillRect(wx, wy, 3, 3);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.45, 'rgba(255,255,255,0.4)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient; g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

// --- the board on the wall: three columns of notes (Todo, In Progress, In Review), a note for each issue, six at most in a column
function boardGeometry(T, counts) {
  const builder = mergedBuilder();
  const tilted = (x, y, z, rz) => placed([x, y, z], [0, 0, rz]);
  builder.box('matte', [3.1, 1.7, 0.06], T.frame, at(0, 0, 0), 0.02);
  builder.box('matte', [2.98, 1.58, 0.02], T.board, at(0, 0, 0.03), 0.01);
  const notes = [0xffd166, 0x7bd88f, 0x8fb4ff];
  let n = 0;
  counts.forEach((count, column) => {
    const x0 = -0.98 + column * 0.98;
    builder.box('matte', [0.8, 0.05, 0.012], 0xb9bfce, at(x0, 0.64, 0.046), 0.004);
    for (let i = 0; i < Math.min(count, 6); i++) {
      const x = x0 + (i % 2 ? 0.21 : -0.21) + (((i * 7 + column) % 3) - 1) * 0.012;
      builder.box('matte', [0.36, 0.2, 0.012], notes[column], tilted(x, 0.4 - Math.floor(i / 2) * 0.28, 0.048, ((n++ * 37) % 9 - 4) * 0.012), 0.008);
    }
  });
  return builder.merged('matte');
}

// --- a person's parts: one InstancedMesh each. `color` fixed, or absent: every person has their own
const PARTS = {
  torso: { geometry: () => new CapsuleGeometry(0.27, 0.3, 8, 18), rough: 0.85, per: 1 },
  upper: { geometry: () => new CapsuleGeometry(0.075, 0.2, 6, 12), rough: 0.85, per: 2 },
  fore: { geometry: () => new CapsuleGeometry(0.066, 0.2, 6, 12), rough: 0.7, per: 2 },
  hand: { geometry: () => new SphereGeometry(0.07, 16, 12), rough: 0.7, per: 2 },
  skull: { geometry: () => new SphereGeometry(0.235, 28, 22), rough: 0.7, per: 1 },
  hair: { geometry: () => new SphereGeometry(0.25, 28, 18, 0, TAU, 0, Math.PI * 0.56), rough: 0.6, per: 1 },
  bun: { geometry: () => new SphereGeometry(0.1, 24, 18), rough: 0.78, per: 1 },
  brim: { geometry: () => rounded(0.3, 0.03, 0.18, 0.012), rough: 0.78, per: 1 },
  rim: { geometry: () => new TorusGeometry(0.058, 0.012, 8, 20), rough: 0.5, per: 2, color: 0x23232b },
  bridge: { geometry: () => rounded(0.05, 0.01, 0.01), rough: 0.78, per: 1, color: 0x23232b },
  eye: { geometry: () => new SphereGeometry(0.03, 12, 10), rough: 0.5, per: 2, color: 0x23232b },
  mouth: { geometry: () => new TorusGeometry(0.045, 0.01, 6, 14, Math.PI), rough: 0.5, per: 1, color: 0x23232b },
  cheek: { geometry: () => new SphereGeometry(0.03, 10, 8), rough: 0.9, per: 2, color: 0xf09a8a },
  thigh: { geometry: () => new CapsuleGeometry(0.075, 0.18, 6, 12), rough: 0.8, per: 2, color: 0x3a3f52 },
  shin: { geometry: () => new CapsuleGeometry(0.066, 0.2, 6, 12), rough: 0.8, per: 2, color: 0x3a3f52 },
  shoe: { geometry: () => new SphereGeometry(0.07, 16, 12), rough: 0.6, per: 2, color: 0x23232b },
};
const SHIRT_PARTS = new Set(['torso', 'upper', 'brim']); // the parts that are the colour of the agent

function makePools(group, people, keep) {
  const pools = {};
  for (const [key, spec] of Object.entries(PARTS)) {
    const mesh = new InstancedMesh(keep(spec.geometry()), keep(new MeshStandardMaterial({ color: spec.color ?? 0xffffff, roughness: spec.rough })), people * spec.per);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, ZERO);
    const size = mesh.count;
    mesh.count = 0; // only the instances in use are drawn
    group.add(mesh);
    pools[key] = { mesh, free: Array.from({ length: size }, (_, i) => size - 1 - i), live: new Uint8Array(size), dirty: true };
  }
  return pools;
}

function takeInstance(pool) {
  const index = pool.free.pop();
  if (index === undefined) return undefined;
  pool.live[index] = 1;
  if (index >= pool.mesh.count) pool.mesh.count = index + 1;
  return index;
}

function freeInstance(pool, index) {
  pool.mesh.setMatrixAt(index, ZERO);
  pool.live[index] = 0;
  pool.free.push(index);
  while (pool.mesh.count > 0 && !pool.live[pool.mesh.count - 1]) pool.mesh.count--;
  pool.dirty = true;
}

// --- a person
const scratch = { s: [0, 0, 0], h: [0, 0, 0], e: [0, 0, 0], pole: [0, 0, 0], hip: [0, 0, 0], knee: [0, 0, 0], direction: new Vector3() };
const tint = new Color();

function between(node, a, b) {
  node.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  scratch.direction.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  node.quaternion.setFromUnitVectors(UP, scratch.direction);
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * One person. `seat` is the desk that is theirs; `home` the desk they sit at or have just stood up from (null while coming in).
 * `mode`: seated; sitting (settling into the seat's pose); rising (getting up); walking.
 */
function makePerson(office, issue, seat) {
  const { pools } = office;
  const slots = [];
  const root = new Object3D();
  const spec = look(issue.id);
  const take = (parent, key, hex, into = slots) => {
    const pool = pools[key];
    const index = takeInstance(pool);
    if (index === undefined) throw new Error(`The office has no room for another ${key}.`);
    if (hex != null) { pool.mesh.setColorAt(index, tint.set(hex)); pool.mesh.instanceColor.needsUpdate = true; }
    const node = new Object3D();
    parent.add(node);
    into.push({ pool, index, node, key });
    return node;
  };
  const shirt = shirtOf(issue.agent);
  const torso = take(root, 'torso', shirt); torso.scale.set(1.05, 1, 0.78);
  const head = new Object3D(); root.add(head);
  take(head, 'skull', spec.skin);
  const hair = take(head, 'hair', spec.hair); hair.rotation.x = -0.28; hair.position.set(0, 0.012, -0.012);
  if (spec.style === 'bun') take(head, 'bun', spec.hair).position.set(0, 0.27, -0.12);
  if (spec.style === 'glasses') {
    take(head, 'rim').position.set(-0.085, 0.01, 0.222);
    take(head, 'rim').position.set(0.085, 0.01, 0.222);
    take(head, 'bridge').position.set(0, 0.012, 0.226);
  }
  if (spec.style === 'cap') take(head, 'brim', shirt).position.set(0, 0.1, 0.2);
  const eyeL = take(head, 'eye'); eyeL.position.set(-0.085, 0, 0.222);
  const eyeR = take(head, 'eye'); eyeR.position.set(0.085, 0, 0.222);
  const mouth = take(head, 'mouth'); mouth.position.set(0, -0.085, 0.222);
  for (const side of [-1, 1]) { const cheek = take(head, 'cheek'); cheek.scale.set(1.3, 0.7, 0.4); cheek.position.set(side * 0.14, -0.05, 0.2); }
  const arms = [-1, 1].map((side) => ({ side, upper: take(root, 'upper', shirt), fore: take(root, 'fore', spec.skin), hand: take(root, 'hand', spec.skin) }));
  // legs only exist while the person is up: a seated person has none to draw
  const legSlots = [];
  let legs = null;
  const growLegs = () => { legs = [-1, 1].map((side) => ({ side, thigh: take(root, 'thigh', null, legSlots), shin: take(root, 'shin', null, legSlots), shoe: take(root, 'shoe', null, legSlots) })); };
  const dropLegs = () => {
    for (const { pool, index, node } of legSlots) { root.remove(node); freeInstance(pool, index); }
    legSlots.length = 0;
    legs = null;
  };

  const person = {
    id: issue.id, state: stateOf(issue), agent: issue.agent ?? null, seat, home: null, root, slots, blinking: false,
    x: 0, z: 0, yaw: 0, yawTarget: 0, mode: 'seated', kind: null, leaving: false, leaveWhenSeated: false, gone: false,
    route: null, pending: null, delay: 0,
    pose: newPose(), snapshot: newPose(), target: newPose(), blend: 1, walkAmount: 0, gait: 0, seed: seat * 1.7, anchor: [0, 0, 0], proxies: [],

    get calm() { return person.mode === 'seated' || person.mode === 'sitting'; },
    /** Whether anything about the person moves, so the scene should draw at full pace. */
    get busy() { return !person.calm || person.pending || person.blend < 1 || person.kind === 'type' || person.kind === 'wave'; },

    setKind(kind, instant) {
      if (kind === person.kind) return;
      person.kind = kind;
      person.snapshot.set(person.pose);
      person.blend = instant ? 1 : 0;
    },
    /** Sit at a seat in the pose of the state, without any walking. */
    place(index) {
      const here = seatPosition(index, office.grid);
      Object.assign(person, { seat: index, home: index, x: here.x, z: here.z, yaw: 0, yawTarget: 0, mode: 'seated', route: null, pending: null, walkAmount: 0 });
      person.setKind(STATES[person.state].pose, true);
    },
    /** What the issue says now: the state is a pose, the agent the colour of the clothes. */
    refresh(issue) {
      const state = stateOf(issue);
      if (state !== person.state) {
        person.state = state;
        if (person.calm && !person.pending) person.setKind(STATES[state].pose);
      }
      if ((issue.agent ?? null) !== person.agent) {
        person.agent = issue.agent ?? null;
        const hex = shirtOf(person.agent);
        for (const { pool, index, key } of slots) if (SHIRT_PARTS.has(key)) { pool.mesh.setColorAt(index, tint.set(hex)); pool.mesh.instanceColor.needsUpdate = true; }
      }
    },
    /** What to do next, once at rest at `home`: leave, or walk to the desk that is theirs now. */
    dispatch(delay) {
      if (person.pending || person.home == null || !person.calm) return;
      if (person.leaveWhenSeated) person.pending = { path: routeToDoor(person.home, office.grid), exit: true };
      else if (person.seat !== person.home) person.pending = { path: routeBetween(person.home, person.seat, office.grid), to: person.seat };
      else return;
      person.delay = delay;
    },
    /** Come in at the door, walk to the seat and sit. */
    enter(path, delay) {
      const first = path[0];
      Object.assign(person, { x: first.x, z: first.z, mode: 'walking', route: { path, i: 0, d: 0, to: person.seat, exit: false }, delay, walkAmount: 1 });
      person.yaw = person.yawTarget = Math.atan2(path[1].x - first.x, path[1].z - first.z);
      person.setKind('stand', true);
    },
    begin() {
      person.route = { ...person.pending, i: 0, d: 0 };
      person.pending = null;
      person.leaving = !!person.route.exit;
      person.mode = 'rising';
      person.setKind('stand');
    },
    update(t, dt, still) {
      if (person.pending) { person.delay -= dt; if (person.delay <= 0) person.begin(); }
      if (person.mode === 'rising' && person.blend >= 1) person.mode = 'walking';
      if (person.mode === 'walking') { if (person.delay > 0) person.delay -= dt; else person.advance(dt); }
      person.yaw = still ? person.yawTarget : person.yaw + wrapAngle(person.yawTarget - person.yaw) * Math.min(1, dt * 12);
      person.updatePose(t, dt, still);
      if (person.mode === 'sitting' && person.blend >= 1) person.mode = 'seated';
    },
    advance(dt) {
      const route = person.route;
      let step = WALK_SPEED * dt;
      while (step > 0 && route.i < route.path.length - 1) {
        const a = route.path[route.i];
        const b = route.path[route.i + 1];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 1e-6) { route.i++; route.d = 0; continue; }
        person.yawTarget = Math.atan2(b.x - a.x, b.z - a.z);
        const left = length - route.d;
        if (step >= left) { step -= left; person.gait += left * 7; route.i++; route.d = 0; person.x = b.x; person.z = b.z; }
        else { route.d += step; person.gait += step * 7; person.x = a.x + ((b.x - a.x) * route.d) / length; person.z = a.z + ((b.z - a.z) * route.d) / length; step = 0; }
      }
      const arrived = route.i >= route.path.length - 1;
      person.walkAmount += ((arrived ? 0 : 1) - person.walkAmount) * Math.min(1, dt * 10);
      if (arrived) person.arrive();
    },
    arrive() {
      const { exit, to } = person.route;
      person.route = null;
      if (exit) { person.gone = true; return; }
      const here = seatPosition(to, office.grid);
      Object.assign(person, { home: to, x: here.x, z: here.z, yawTarget: 0, walkAmount: 0, mode: 'sitting' });
      person.setKind(STATES[person.state].pose);
      person.dispatch(0.1);
    },
    updatePose(t, dt, still) {
      const { pose, target } = person;
      evalPose(person.kind, t, person.seed, target, person.walkAmount, person.gait);
      if (person.blend < 1) {
        person.blend = still ? 1 : Math.min(1, person.blend + dt / BLEND);
        blendPose(person.snapshot, target, ease(person.blend), pose);
      } else pose.set(target);
      person.apply(t, still);
    },
    apply(t, still) {
      const P = person.pose;
      const bob = P[POSE.bob];
      root.position.set(person.x, 0, person.z);
      root.rotation.y = person.yaw;
      torso.position.set(0, P[POSE.torsoY] + bob, P[POSE.torsoZ]); torso.rotation.x = P[POSE.lean];
      head.position.set(P[POSE.headX], P[POSE.headY] + bob, P[POSE.headZ]); head.rotation.set(P[POSE.headTilt], 0, P[POSE.headRoll]);
      // an eye blinks for a seventh of a second every few seconds, each person on their own beat
      const period = 3.4 + (person.seed % 1.9);
      const phase = ((t + person.seed * 0.7) % period) / 0.14;
      const blink = still || phase >= 1 ? 1 : 1 - 0.88 * Math.sin(Math.PI * phase);
      person.blinking = blink < 0.7;
      eyeL.scale.set(1, P[POSE.eyes] * blink, 1); eyeR.scale.set(1, P[POSE.eyes] * blink, 1);
      mouth.rotation.z = P[POSE.mouthTurn]; mouth.position.y = P[POSE.mouthY]; mouth.scale.set(P[POSE.mouthWidth], P[POSE.mouthHeight], 1);
      const { s, h, e, pole } = scratch;
      for (const { side, upper, fore, hand } of arms) {
        const hands = side < 0 ? POSE.handL : POSE.handR;
        const elbows = side < 0 ? POSE.elbowL : POSE.elbowR;
        s[0] = side * 0.3; s[1] = P[POSE.torsoY] + bob + P[POSE.shoulderY]; s[2] = P[POSE.lean] * -0.1;
        h[0] = P[hands]; h[1] = P[hands + 1]; h[2] = P[hands + 2];
        pole[0] = P[elbows]; pole[1] = P[elbows + 1]; pole[2] = P[elbows + 2];
        joint(s, h, ARM[0], ARM[1], pole, e);
        between(upper, s, e); between(fore, e, h); hand.position.set(h[0], h[1], h[2]);
      }
      const standing = P[POSE.legs] > 0.5;
      if (standing && !legs) growLegs();
      else if (!standing && legs) dropLegs();
      for (const { side, thigh, shin, shoe } of legs ?? []) {
        const feet = side < 0 ? POSE.footL : POSE.footR;
        const { hip, knee } = scratch;
        hip[0] = side * 0.14; hip[1] = P[POSE.torsoY] + bob - 0.37; hip[2] = P[POSE.torsoZ];
        h[0] = P[feet]; h[1] = P[feet + 1]; h[2] = P[feet + 2];
        pole[0] = 0; pole[1] = 0; pole[2] = 1;
        joint(hip, h, LEG[0], LEG[1], pole, knee);
        between(thigh, hip, knee); between(shin, knee, h);
        shoe.position.set(h[0], h[1] + 0.01, h[2] + 0.05); shoe.scale.set(1, 0.7, 1.5);
      }
      root.updateMatrixWorld(true);
      for (const { pool, index, node } of slots) { pool.mesh.setMatrixAt(index, node.matrixWorld); pool.dirty = true; }
      for (const { pool, index, node } of legSlots) { pool.mesh.setMatrixAt(index, node.matrixWorld); pool.dirty = true; }
      // where the name tag points: just above the head, steady while the person breathes
      const cos = Math.cos(person.yaw);
      const sin = Math.sin(person.yaw);
      person.anchor[0] = person.x + P[POSE.headX] * cos + P[POSE.headZ] * sin;
      person.anchor[1] = P[POSE.headY] + TAG_ABOVE_HEAD;
      person.anchor[2] = person.z - P[POSE.headX] * sin + P[POSE.headZ] * cos;
    },
    dispose() {
      dropLegs();
      for (const { pool, index } of slots) freeInstance(pool, index);
      slots.length = 0;
    },
  };
  person.setKind(STATES[person.state].pose, true);
  return person;
}

// --- the office: the room, its desks, and the people in them
function createOffice({ scene, T, grid }) {
  const owned = [];
  const keep = (resource) => { owned.push(resource); return resource; };
  const group = new Group();
  scene.add(group);
  const { width: W, depth: D } = roomSize(grid);
  const wz = -D / 2 + 0.2;

  // light: the sky, a sun with shadows over the whole room, and at night warm lamps under the ceiling
  const lights = [new HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2])];
  const sun = new DirectionalLight(T.sun[0], T.sun[1]);
  const radius = 0.54 * Math.hypot(W, D, 3.6) + 0.6;
  const distance = Math.max(15.4, radius * 2.1);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(distance);
  sun.castShadow = true;
  const mapSize = radius > 9.5 ? 4096 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: Math.max(1, distance - radius - 2), far: distance + radius + 2 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025;
  lights.push(sun);
  if (T.night) {
    const across = Math.max(1, Math.round(W / 11.7));
    const down = Math.max(1, Math.round(D / 7.75));
    for (let i = 0; i < across; i++) for (let j = 0; j < down && lights.length < 8; j++) {
      const fill = new PointLight(0xffd9a0, 6.0, 16, 2);
      fill.position.set(((i + 0.5) / across - 0.5) * W, 3.4, ((j + 0.5) / down - 0.5) * D + 1.4);
      lights.push(fill);
    }
  }
  for (const light of lights) group.add(light);

  // the fixed parts: each shape's colour is in its vertices, so a few materials do
  const matte = keep(new MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
  const metal = keep(new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.45 }));
  const flat = keep(new MeshBasicMaterial({ vertexColors: true }));
  const solid = (geometry, material, shadows = true) => {
    if (!geometry) return null;
    const mesh = new Mesh(keep(geometry), material);
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
    return mesh;
  };

  const room = mergedBuilder();
  room.box('matte', [W, 0.5, D], T.slab, at(0, -0.27, 0), 0.06);
  room.box('matte', [W - 0.1, 0.06, D - 0.1], T.floor, at(0, 0, 0), 0.025);
  room.box('matte', [W - 2.6, 0.02, D - 2.2], T.rug, at(0, 0.044, 0.05), 0.01);
  room.box('matte', [W, 3.0, 0.2], T.wall, at(0, 1.5, -D / 2 + 0.1), 0.04);
  room.box('matte', [0.2, 3.0, D], T.wallSide, at(-W / 2 + 0.1, 1.5, 0), 0.04);
  room.box('matte', [W - 0.2, 0.12, 0.05], T.trim, at(0.1, 0.07, -D / 2 + 0.225), 0.01);

  // windows along the back wall, as many as fit between the clock and the board
  const panes = [];
  const first = -W * 0.25 - 3.0 * Math.floor((-W * 0.25 - (-W / 2 + 1.5) - 1.35) / 3.0);
  for (let x = first; x + 1.35 <= W / 2 - 3.85 - 0.2; x += 3.0) {
    const casement = placed([x, 1.75, wz]);
    room.box('matte', [2.5, 1.6, 0.1], T.trim, casement, 0.03);
    room.box('matte', [0.05, 1.4, 0.04], T.trim, chain(casement, at(0, 0, 0.07)), 0.01);
    room.box('matte', [2.3, 0.05, 0.04], T.trim, chain(casement, at(0, 0, 0.07)), 0.01);
    room.box('matte', [2.7, 0.07, 0.22], T.trim, chain(casement, at(0, -0.84, 0.1)), 0.02);
    panes.push(new PlaneGeometry(2.3, 1.4).applyMatrix4(chain(casement, at(0, 0, 0.056))));
  }

  // the clock, the door's frame with the dark doorway behind its panel, the exit sign
  const clock = placed([-W / 2 + 0.9, 2.45, wz]);
  const faceUp = placed([0, 0, 0], [Math.PI / 2, 0, 0]);
  room.cylinder('matte', 0.27, 0.27, 0.06, T.frame, chain(clock, faceUp));
  room.cylinder('matte', 0.24, 0.24, 0.03, 0xffffff, chain(clock, at(0, 0, 0.025), faceUp));
  room.box('matte', [0.03, 0.15, 0.01], 0x23232b, chain(clock, at(0, 0.07, 0.05)), 0.005);
  room.box('matte', [0.025, 0.2, 0.01], 0x23232b, chain(clock, placed([0.07, 0.04, 0.056], [0, 0, -1.0])), 0.005);
  const doorAt = doorPosition(grid);
  const door = placed([doorAt.x, 0, doorAt.z], [0, Math.PI / 2, 0]);
  room.box('matte', [1.2, 2.35, 0.12], T.trim, chain(door, at(0, 1.175, 0)), 0.03);
  room.box('basic', [0.96, 2.2, 0.01], 0x12141b, chain(door, at(0, 1.125, 0.062)), 0.004);
  room.box('basic', [0.34, 0.12, 0.02], 0x5bd08f, chain(door, at(0, 2.5, 0.05)), 0.01);

  // plants and the coffee corner
  const plant = (x, z, scale) => {
    const spot = placed([x, 0, z], [0, 0, 0], scale);
    room.cylinder('matte', 0.26, 0.2, 0.34, T.pot, chain(spot, at(0, 0.17, 0)));
    room.cylinder('matte', 0.23, 0.23, 0.02, 0x4d3b30, chain(spot, at(0, 0.34, 0)));
    for (const [px, py, pz, r] of [[0, 0.75, 0, 0.3], [-0.18, 0.6, 0.05, 0.22], [0.2, 0.62, -0.04, 0.24], [0.05, 0.5, 0.18, 0.2], [-0.08, 0.52, -0.2, 0.2], [0, 1.0, 0, 0.2]]) {
      room.sphere('matte', r, T.leaf, chain(spot, placed([px, py, pz], [0, 0, 0], [1, 1.25, 1])), 16, 12);
    }
  };
  plant(W / 2 - 0.7, -D / 2 + 0.8, 1.15);
  plant(W / 2 - 0.6, D / 2 - 0.7, 0.9);
  const coffee = placed([-W / 2 + 0.7, 0, -D / 2 + 1.2], [0, Math.PI / 2, 0]);
  room.box('matte', [0.9, 0.06, 0.5], T.desk, chain(coffee, at(0, 0.78, 0)), 0.02);
  for (const [x, z] of [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]]) room.box('matte', [0.05, 0.76, 0.05], T.deskLeg, chain(coffee, at(x, 0.38, z)), 0.01);
  room.box('matte', [0.34, 0.42, 0.3], 0x3d4252, chain(coffee, at(-0.1, 1.02, 0)), 0.04);
  room.box('matte', [0.3, 0.06, 0.26], 0x2b2f3d, chain(coffee, at(-0.1, 1.26, 0)), 0.02);
  room.cylinder('matte', 0.025, 0.025, 0.07, 0xb8bcc8, chain(coffee, at(-0.1, 0.9, 0.12)));
  room.cylinder('matte', 0.05, 0.04, 0.08, 0xffffff, chain(coffee, at(-0.1, 0.85, 0.12)));
  room.sphere('basic', 0.014, 0x9dffbd, chain(coffee, at(0.02, 1.1, 0.152)), 12, 8);

  // the desks: the fixed parts here; each one's chair, lamp and laptop light are moved and lit one by one below
  const chair = mergedBuilder();
  chair.box('matte', [0.62, 0.09, 0.56], T.chair, at(0, 0.45, 0), 0.04);
  chair.box('matte', [0.58, 0.6, 0.09], T.chair, placed([0, 0.84, -0.3], [-0.1, 0, 0]), 0.04);
  chair.cylinder('matte', 0.03, 0.03, 0.3, T.deskLeg, at(0, 0.26, 0));
  chair.cylinder('matte', 0.3, 0.3, 0.035, T.deskLeg, at(0, 0.06, 0));
  const lamp = placed([0.66, 0.785, 0.9]);
  const lid = placed([0, 0.805, 0.8], [0.28, 0, 0]);
  const seats = [];
  for (let k = 0; k < grid.capacity; k++) {
    const { x, z } = seatPosition(k, grid);
    const desk = placed([x, 0, z]);
    room.box('matte', [1.7, 0.07, 0.86], T.desk, chain(desk, at(0, 0.75, 0.72)), 0.03);
    room.box('matte', [1.56, 0.5, 0.04], T.desk, chain(desk, at(0, 0.46, 1.12)), 0.015);
    for (const sx of [-0.78, 0.78]) room.box('matte', [0.05, 0.72, 0.8], T.deskLeg, chain(desk, at(sx, 0.36, 0.72)), 0.015);
    room.box('metal', [0.52, 0.02, 0.34], 0xc9ccd6, chain(desk, at(0, 0.795, 0.62)), 0.008);
    room.box('metal', [0.52, 0.34, 0.018], 0xd7dae2, chain(desk, lid, at(0, 0.17, 0)), 0.008);
    room.cylinder('matte', 0.07, 0.08, 0.03, T.deskLeg, chain(desk, lamp, at(0, 0.015, 0)));
    room.cylinder('matte', 0.012, 0.012, 0.34, T.deskLeg, chain(desk, lamp, at(0, 0.19, 0)));
    room.cylinder('matte', 0.045, 0.04, 0.09, 0xf6f1e6, chain(desk, at(-0.62, 0.835, 0.92)));
    seats.push({
      index: k, x, z, desk,
      chair: { z: 0.18, rotation: 0, targetZ: 0.18, targetRotation: 0, shown: '' },
      light: { hue: new Color(0x9ad0ff), hueTarget: new Color(0x9ad0ff), lit: 0, target: 0, shown: '' },
    });
  }
  solid(room.merged('matte'), matte);
  solid(room.merged('metal'), metal);
  solid(room.merged('basic'), flat, false);

  if (panes.length) {
    const glass = mergeGeometries(panes, false);
    for (const pane of panes) pane.dispose();
    group.add(new Mesh(keep(glass), keep(new MeshBasicMaterial({ map: keep(skyTexture(T, T.night)) }))));
  }
  const planks = keep(plankTexture(T));
  planks.repeat.set((W - 0.3) / 4, (D - 0.3) / 4);
  const floor = new Mesh(keep(new PlaneGeometry(W - 0.3, D - 0.3)), keep(new MeshStandardMaterial({ map: planks, roughness: 0.85 })));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.032; floor.receiveShadow = true;
  group.add(floor);
  const catcher = new Mesh(keep(new PlaneGeometry(80, 80)), keep(new ShadowMaterial({ opacity: T.shadow })));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = -0.525; catcher.receiveShadow = true;
  group.add(catcher);

  // the door's panel swings open for anyone who goes in or out
  const doorGroup = new Group();
  doorGroup.position.set(doorAt.x, 0, doorAt.z); doorGroup.rotation.y = Math.PI / 2;
  const hinge = new Group(); hinge.position.set(-0.5, 0, 0);
  const panel = new Mesh(keep(rounded(1.0, 2.25, 0.08, 0.02)), keep(new MeshStandardMaterial({ color: T.door, roughness: 0.78 })));
  panel.position.set(0.5, 1.125, 0.05); panel.castShadow = panel.receiveShadow = true;
  const knob = new Mesh(keep(new SphereGeometry(0.05, 24, 18)), keep(new MeshStandardMaterial({ color: 0xd8d3c4, roughness: 0.35, metalness: 0.6 })));
  knob.position.set(0.86, 1.05, 0.12);
  hinge.add(panel, knob); doorGroup.add(hinge); group.add(doorGroup);
  const doorway = { open: 0 };

  // the little board on the wall, redrawn when the counts change
  const boardMesh = new Mesh(new PlaneGeometry(1, 1), matte);
  boardMesh.position.set(W / 2 - 2.3, 1.7, wz);
  boardMesh.castShadow = boardMesh.receiveShadow = true;
  group.add(boardMesh);
  let boardKey = '';
  const setBoard = (counts) => {
    const key = counts.join(',');
    if (key === boardKey) return;
    boardKey = key;
    boardMesh.geometry.dispose();
    boardMesh.geometry = boardGeometry(T, counts);
  };
  owned.push({ dispose: () => boardMesh.geometry.dispose() });

  // chairs, and the lamp, shade and laptop light of each desk: instances, each with a colour
  const chairs = new InstancedMesh(keep(chair.merged('matte')), matte, grid.capacity);
  chairs.instanceMatrix.setUsage(DynamicDrawUsage); chairs.frustumCulled = false; chairs.castShadow = chairs.receiveShadow = true;
  group.add(chairs);
  const lit = (geometry, material, local, shadows = false) => {
    const mesh = new InstancedMesh(keep(geometry), keep(material), grid.capacity);
    mesh.frustumCulled = false; mesh.castShadow = shadows;
    for (const seat of seats) { mesh.setMatrixAt(seat.index, chain(seat.desk, local)); mesh.setColorAt(seat.index, tint.set(0xffffff)); }
    group.add(mesh);
    return mesh;
  };
  const bulbs = lit(new SphereGeometry(0.035, 16, 12), new MeshBasicMaterial(), chain(lamp, at(-0.07, 0.35, 0)));
  const leds = lit(rounded(0.1, 0.012, 0.008, 0.004), new MeshBasicMaterial(), chain(lid, at(0, 0.17, 0.012)));
  const shades = lit(new ConeGeometry(0.09, 0.09, 20, 1, true), new MeshStandardMaterial({ roughness: 0.5, side: DoubleSide }), chain(lamp, placed([-0.05, 0.38, 0], [0, 0, 0.5])), true);
  const glowMap = keep(glowTexture());
  const glowGeometries = [keep(new PlaneGeometry(1.8, 1.2)), keep(new PlaneGeometry(3.2, 2.6))];
  for (const seat of seats) {
    seat.glow = [[0.792, 0.15, 0.8], [0.052, 0, 0.9]].map(([y, dx, dz], i) => {
      const material = keep(new MeshBasicMaterial({ map: glowMap, transparent: true, opacity: 0, depthWrite: false, ...(T.night && { blending: AdditiveBlending }) }));
      const mesh = new Mesh(glowGeometries[i], material);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(seat.x + dx, y, seat.z + dz); mesh.renderOrder = 2; mesh.visible = false;
      group.add(mesh);
      return mesh;
    });
  }

  // the people, and the ring under whoever the pointer is on
  const limit = grid.capacity + SPARE_PEOPLE;
  const pools = makePools(group, limit, keep);
  const proxyMaterial = keep(new MeshBasicMaterial());
  const proxyBody = keep(new CylinderGeometry(0.42, 0.42, 1.95, 12));
  const proxyDesk = keep(rounded(1.8, 0.8, 0.9, 0.05));
  const ring = new Mesh(keep(new RingGeometry(1.05, 1.13, 64)), keep(new MeshBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0.9 })));
  const disc = new Mesh(keep(new CircleGeometry(1.05, 64)), keep(new MeshBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0.16 })));
  for (const part of [ring, disc]) { part.rotation.x = -Math.PI / 2; part.scale.set(1.3, 1, 0.95); part.visible = false; group.add(part); }

  const office = { grid, pools, seats, people: new Map(), leaving: new Set(), hoverId: null, tagsDirty: true, shadowDirty: true, moving: false };
  const everyone = () => [...office.people.values(), ...office.leaving];

  const chairMatrix = (seat) => placed([seat.x, 0, seat.z + seat.chair.z], [0, seat.chair.rotation, 0]);
  seats.forEach((seat) => chairs.setMatrixAt(seat.index, chairMatrix(seat)));

  // the lamp, the chair and the swivel of a desk follow whoever is at it
  const SHOWN = new Color();
  const OFF_BULB = new Color(0x9a9eab);
  const OFF_LED = new Color(0xb5b9c6);
  const SHADE = new Color(0xe8eaf0);
  function showLight(seat) {
    const { light, glow, index } = seat;
    bulbs.setColorAt(index, SHOWN.copy(OFF_BULB).lerp(tint.copy(light.hue).multiplyScalar(1.6), light.lit));
    leds.setColorAt(index, SHOWN.copy(OFF_LED).lerp(tint.copy(light.hue).multiplyScalar(1.8), light.lit));
    shades.setColorAt(index, SHOWN.copy(SHADE).lerp(tint.copy(SHADE).lerp(light.hue, 0.35), light.lit));
    bulbs.instanceColor.needsUpdate = leds.instanceColor.needsUpdate = shades.instanceColor.needsUpdate = true;
    glow.forEach((mesh, i) => {
      mesh.visible = light.lit > 0.01;
      mesh.material.color.copy(light.hue);
      mesh.material.opacity = T.glow[i] * light.lit;
    });
  }
  seats.forEach(showLight);

  function claimSeats() {
    for (const seat of seats) { seat.chair.targetZ = 0.18; seat.chair.targetRotation = 0; seat.light.target = 0; }
    for (const person of everyone()) {
      const home = seats[person.home];
      if (home) {
        const near = Math.hypot(person.x - home.x, person.z - home.z) < 1.2;
        if (person.calm) {
          home.chair.targetZ = 0;
          home.chair.targetRotation = person.state === 'idle' ? 0.3 : 0;
          const color = STATES[person.state].lamp;
          if (color == null) home.light.target = 0;
          else { home.light.hueTarget.set(color); if (home.light.lit < 0.02) home.light.hue.copy(home.light.hueTarget); home.light.target = 1; }
        } else if (near) home.chair.targetZ = -0.45;
      }
      const destination = person.route && !person.route.exit ? seats[person.route.to] : null;
      if (destination && destination !== home) destination.chair.targetZ = -0.45;
    }
  }

  const stagger = { leave: 0, move: 0.12, enter: 0.3 };

  /** Make the office what `issues` calls for. With `animate`, people walk (in, out, to new seats); without, they are just there. */
  office.setIssues = (issues, animate) => {
    const prev = [...office.people.values()].map((person) => ({ id: person.id, seat: person.seat }));
    const next = plan(prev, issues, grid);
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    if (next.move.length + next.enter.length + next.leave.length > CROWD) animate = false;
    setBoard(boardCounts(issues));
    for (const { id } of next.stay) office.people.get(id).refresh(byId.get(id));
    for (const { id, to } of next.move) {
      const person = office.people.get(id);
      person.refresh(byId.get(id));
      person.seat = to;
      if (!animate) person.place(to);
      else person.dispatch(stagger.move);
    }
    for (const { id } of next.leave) {
      const person = office.people.get(id);
      office.people.delete(id);
      if (!person) continue;
      if (!animate) { person.dispose(); continue; }
      person.leaveWhenSeated = true;
      person.leaving = true;
      office.leaving.add(person);
      person.dispatch(stagger.leave);
    }
    for (const person of [...office.leaving]) if (office.people.size + office.leaving.size > limit - next.enter.length) { office.leaving.delete(person); person.dispose(); }
    for (const { id, seat, path } of next.enter) {
      const person = makePerson(office, byId.get(id), seat);
      office.people.set(id, person);
      if (animate) person.enter(path, stagger.enter); else person.place(seat);
    }
    claimSeats();
    office.tagsDirty = office.shadowDirty = true;
  };

  /** One step of everything that moves. Returns whether anything does, so the scene knows how often to draw. */
  office.update = (t, dt, still) => {
    let busy = false;
    let moving = false;
    for (const person of office.people.values()) {
      person.update(t, dt, still);
      busy ||= person.busy;
      moving ||= !person.calm || person.blend < 1;
    }
    for (const person of office.leaving) {
      person.update(t, dt, still);
      busy = moving = true;
      if (person.gone) { office.leaving.delete(person); person.dispose(); office.tagsDirty = true; }
    }
    // the door opens for anyone near it
    const near = everyone().some((person) => (person.mode === 'walking' || person.leaving) && Math.hypot(person.x - doorAt.x, person.z - doorAt.z) < 1.7);
    const target = near && !still ? 1 : 0;
    doorway.open = still ? 0 : doorway.open + (target - doorway.open) * Math.min(1, dt * 7);
    if (Math.abs(doorway.open - target) > 1e-3) busy = true;
    hinge.rotation.y = -1.5 * doorway.open;
    // chairs slide and swivel, lamps fade
    claimSeats();
    const k = still ? 1 : 1 - Math.exp(-dt * 9);
    let chairsMoved = false;
    for (const seat of seats) {
      const { chair: c, light } = seat;
      c.z += (c.targetZ - c.z) * k; c.rotation += (c.targetRotation - c.rotation) * k;
      if (Math.abs(c.targetZ - c.z) > 1e-3 || Math.abs(c.targetRotation - c.rotation) > 1e-3) busy = true;
      const where = `${c.z.toFixed(4)}${c.rotation.toFixed(4)}`;
      if (where !== c.shown) { c.shown = where; chairs.setMatrixAt(seat.index, chairMatrix(seat)); chairsMoved = true; }
      light.lit += (light.target - light.lit) * k;
      light.hue.lerp(light.hueTarget, light.target ? k : 0);
      if (Math.abs(light.lit - light.target) < 5e-3) light.lit = light.target; else busy = true;
      const shown = `${light.lit.toFixed(3)}${light.hue.getHex()}`;
      if (shown !== light.shown) { light.shown = shown; showLight(seat); }
    }
    if (chairsMoved) chairs.instanceMatrix.needsUpdate = true;
    for (const pool of Object.values(pools)) if (pool.dirty) { pool.mesh.instanceMatrix.needsUpdate = true; pool.dirty = false; }
    const hovered = office.hoverId == null ? null : office.people.get(office.hoverId);
    for (const part of [ring, disc]) { part.visible = !!hovered; if (hovered) part.position.set(hovered.x, 0.075, hovered.z + 0.5); }
    office.moving = moving;
    return busy;
  };

  office.tags = () => [...office.people.values()].map((person) => ({ id: person.id, state: person.state, anchor: person.anchor }));

  /** The shapes a ray can hit: a cylinder for each person and a box for their desk, tagged with the issue. */
  office.pickables = () => {
    const out = [];
    for (const [id, person] of office.people) {
      if (!person.proxies.length) {
        person.proxies = [new Mesh(proxyBody, proxyMaterial), new Mesh(proxyDesk, proxyMaterial)];
        for (const proxy of person.proxies) proxy.userData = { id };
      }
      const [body, desk] = person.proxies;
      body.position.set(person.x, 0.97, person.z);
      const spot = seats[person.seat];
      desk.position.set(spot.x, 0.4, spot.z + 0.72);
      for (const proxy of person.proxies) { proxy.updateMatrixWorld(true); out.push(proxy); }
    }
    return out;
  };

  office.dispose = () => {
    scene.remove(group);
    for (const person of everyone()) person.dispose();
    for (const pool of Object.values(pools)) pool.mesh.dispose();
    for (const mesh of [chairs, bulbs, leds, shades]) mesh.dispose();
    for (const resource of owned) resource.dispose();
    for (const light of lights) light.shadow?.map?.dispose();
  };
  return office;
}

// --- the scene: renderer, camera, loop
export function createOfficeScene({ canvas, theme = 'light', reducedMotion = false, width = 300, height = 200, cols = 6, rows = 4, onTags, onContextLost, onContextRestored }) {
  // The context is made here, not by three, so that a browser without WebGL fails quietly: three logs an error when it cannot make one.
  const context = canvas.getContext('webgl2', { alpha: true, depth: true, stencil: false, antialias: true, powerPreference: 'low-power' });
  if (!context) throw new Error('WebGL is not available.');
  const renderer = new WebGLRenderer({ canvas, context });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = ACESFilmicToneMapping;
  const scene = new Scene();
  const camera = new PerspectiveCamera(28.5, 1.5, 0.1, 200);
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  const state = {
    theme, still: reducedMotion, width: Math.max(1, width), height: Math.max(1, height), grid: deskGrid(cols, rows), issues: [], populated: false,
    office: null, view: null, time: 0, hover: null, disposed: false, lost: false, inView: true,
    docVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    dirty: true, raf: 0, last: 0, busy: true, frames: 0, shadowTick: 0, tags: new Map(), observer: null, viewDirty: false, gridChanged: false,
  };

  function applyView() {
    const { width: w, height: h } = state;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const view = (state.view = fitCamera(roomBox(roomSize(state.grid)), w, h));
    camera.aspect = view.aspect; camera.fov = view.fov; camera.near = view.near; camera.far = view.far;
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    camera.setViewOffset(w, h, (view.shift[0] * w) / 2, (-view.shift[1] * h) / 2, w, h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  /** (Re)build the office for the current theme and desk grid, with everyone at their seat. */
  function build() {
    state.office?.dispose();
    const T = THEMES[state.theme] ?? THEMES.light;
    renderer.toneMappingExposure = T.exposure;
    state.office = createOffice({ scene, T, grid: state.grid });
    state.office.hoverId = state.hover;
    state.office.setIssues(state.issues, false);
    state.dirty = true;
  }

  // A size or desk count that changed is applied once, when it is next needed, however many times it changed since the last frame
  // (dragging the edge of the widget changes it at every pointer move).
  function ensureView() {
    if (!state.viewDirty) return;
    state.viewDirty = false;
    applyView();
    if (state.gridChanged) { state.gridChanged = false; build(); }
    state.office.tagsDirty = true;
  }

  const active = () => !state.disposed && !state.lost && state.inView && state.docVisible;

  function tagPositions() {
    ensureView();
    if (!state.office || !state.view) return [];
    return state.office.tags().map(({ id, state: s, anchor }) => ({ id, state: s, ...project(state.view, anchor) }));
  }

  function reportTags(force) {
    if (!onTags || !state.office) return;
    const list = tagPositions();
    let changed = force || list.length !== state.tags.size;
    for (const { id, x, y } of list) {
      const old = state.tags.get(id);
      if (!old || Math.abs(old.x - x) > 0.4 || Math.abs(old.y - y) > 0.4) changed = true;
    }
    if (!changed) return;
    state.tags = new Map(list.map((tag) => [tag.id, tag]));
    onTags(list);
  }

  function renderNow(dt) {
    ensureView();
    const office = state.office;
    if (!office) return;
    if (!state.still) state.time += dt;
    state.busy = office.update(state.still ? STATIC_TIME : state.time, state.still ? 0 : dt, state.still);
    state.shadowTick++;
    if (office.shadowDirty || state.dirty || (state.busy ? state.shadowTick % 3 === 0 : state.shadowTick % 6 === 0)) { renderer.shadowMap.needsUpdate = true; office.shadowDirty = false; }
    renderer.render(scene, camera);
    state.frames++;
    state.dirty = false;
    if (office.tagsDirty || office.moving) { reportTags(office.tagsDirty); office.tagsDirty = false; }
  }

  function frame(now) {
    state.raf = 0;
    if (!active()) return;
    if (state.still) {
      if (state.dirty) renderNow(0);
      return; // nothing moves: wait for the next change
    }
    const interval = state.busy ? FRAME_BUSY : FRAME_CALM;
    const elapsed = state.last ? now - state.last : interval;
    if (elapsed >= interval - 4) {
      state.last = now;
      renderNow(Math.min(0.1, elapsed / 1000));
    }
    schedule();
  }

  function schedule() {
    if (state.raf || !active() || (state.still && !state.dirty)) return;
    state.raf = requestAnimationFrame(frame);
  }

  function wake() { state.last = 0; state.dirty = true; schedule(); }

  // draw only while someone can see it: the canvas on screen, the page not hidden
  if (typeof IntersectionObserver === 'function') {
    state.observer = new IntersectionObserver((entries) => {
      const seen = entries[entries.length - 1].isIntersecting;
      if (seen === state.inView) return;
      state.inView = seen;
      if (seen) wake();
    });
    state.observer.observe(canvas);
  }
  const onVisibility = () => { state.docVisible = document.visibilityState !== 'hidden'; if (state.docVisible) wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  // moving the window to another screen, or zooming the page, changes the pixel ratio without changing the size of the canvas
  let pixels = globalThis.devicePixelRatio;
  const onWindowResize = () => { if (globalThis.devicePixelRatio !== pixels && state.office) { pixels = globalThis.devicePixelRatio; applyView(); wake(); } };
  window.addEventListener('resize', onWindowResize);
  const lose = (event) => { event.preventDefault(); state.lost = true; onContextLost?.(); };
  const restore = () => { state.lost = false; wake(); onContextRestored?.(); };
  canvas.addEventListener('webglcontextlost', lose);
  canvas.addEventListener('webglcontextrestored', restore);

  applyView();
  build();
  schedule();

  return {
    /** The issues to show; those in Todo, In Progress and In Review sit, in the order of the list. */
    setIssues(issues) {
      state.issues = Array.isArray(issues) ? issues : [];
      if (!state.office) return;
      // the first list that has anyone in it just appears; later changes walk
      const walk = state.populated && active() && !state.still;
      state.office.setIssues(state.issues, walk);
      if (state.office.people.size) state.populated = true;
      wake();
    },
    resize(w, h, c = state.grid.columns + 2, r = state.grid.rows + 1) {
      const grid = deskGrid(c, r);
      if (grid.columns !== state.grid.columns || grid.rows !== state.grid.rows) state.gridChanged = true;
      Object.assign(state, { width: Math.max(1, w), height: Math.max(1, h), grid, viewDirty: true });
      wake();
    },
    setHover(id) {
      state.hover = id ?? null;
      if (state.office) state.office.hoverId = state.hover;
      wake();
    },
    /** The issue of the person at this point of the canvas (CSS pixels from its top left corner), or null. */
    pick(x, y) {
      ensureView();
      if (!state.office) return null;
      pointer.set((x / state.width) * 2 - 1, -(y / state.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(state.office.pickables(), false)[0];
      return hit ? hit.object.userData.id : null;
    },
    /** Where each name tag's tip goes on the canvas: just above the head of its person. */
    tagPositions,
    setTheme(next) {
      if (next === state.theme) return;
      state.theme = next;
      build();
      wake();
    },
    setReducedMotion(still) {
      if (still === state.still) return;
      state.still = still;
      if (still) build(); // everyone to their seat, in their still pose
      wake();
    },
    /** What the renderer holds, for tests: geometries and textures are 0 once disposed. */
    stats() {
      const { memory, render, programs } = renderer.info;
      const { office } = state;
      return {
        geometries: memory.geometries, textures: memory.textures, programs: programs ? programs.length : 0, calls: render.calls, triangles: render.triangles,
        frames: state.frames, running: !!state.raf, busy: state.busy, disposed: state.disposed, lost: state.lost,
        people: office ? office.people.size : 0, leaving: office ? office.leaving.size : 0, walking: office ? [...office.people.values()].filter((person) => !person.calm).length : 0,
        blinking: office ? [...office.people.values()].filter((person) => person.blinking && person.pose[POSE.eyes] > 0.5).length : 0,
      };
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onWindowResize);
      canvas.removeEventListener('webglcontextlost', lose);
      canvas.removeEventListener('webglcontextrestored', restore);
      state.office?.dispose();
      state.office = null;
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
