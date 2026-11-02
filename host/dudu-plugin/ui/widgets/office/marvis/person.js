// A person: one of the owner's 16 clay avatars, completed into a whole person (the sheet they come from has only their busts) and drawn
// from the side we see them from. The poses were rendered once, offline, from a 3D model of each (.local/office3d/people3d); this file
// shows one frame of one pose, mirrored when it should face the other way, and builds what goes with it (a shadow, a hover ring, Zs).
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { PEOPLE } from './assets.js';

/** Three Zs that rise and fade, one after the other (they are what the mascot's sleeping animation draws beside it). */
function createZs() {
  const zs = new Container();
  for (const [letter, size] of [['z', 13], ['Z', 17], ['Z', 21]]) {
    const text = new Text({ text: letter, style: { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: size, fontWeight: '700', fill: 0x6b7280 } });
    text.anchor.set(0.5, 1);
    zs.addChild(text);
  }
  zs.visible = false;
  return zs;
}

/**
 * The pieces of person number `look` at (0, 0), which is where their feet are, or their hips when the pose sits: the container to put on
 * the plane, the `body` (what breathes), and `show(pose, frame, flip)`. `frames` is { pose: [texture] } of their sheet.
 */
export function createPerson(look, frames) {
  const scale = 1 / PEOPLE.pxPerUnit; // a sheet is drawn at 1.6 pixels to a unit of the plane
  const container = new Container();
  const shadow = new Graphics().ellipse(0, 0, 21, 5.5).fill({ color: 0x000000, alpha: 0.13 });
  const ring = new Graphics().ellipse(0, 0, 30, 9).stroke({ width: 2, color: 0x2f6fed, alpha: 0.9 });
  const body = new Container();
  const sprite = new Sprite(frames.sit_type[0]);
  const zs = createZs();
  body.addChild(sprite, zs);
  container.addChild(ring, shadow, body);
  ring.visible = false;
  shadow.visible = false;
  const [cellWidth, cellHeight] = PEOPLE.cell;
  const person = {
    container, body, sprite, shadow, ring, zs,
    show(pose, frame, flip = false) {
      const { anchor } = PEOPLE.poses[pose];
      const textures = frames[pose];
      sprite.texture = textures[frame % textures.length];
      sprite.anchor.set(anchor[0] / cellWidth, anchor[1] / cellHeight);
      sprite.scale.set(flip ? -scale : scale, scale);
    },
    /** How many plane units this person is tall from where they stand, in a pose (the name tag points above it). */
    topOf: (pose) => PEOPLE.tops[pose][look],
    /** Whether a pose sits (and is drawn from the hips up, the chair or the sofa hiding the rest). */
    seated: (pose) => PEOPLE.poses[pose].seated,
  };
  person.show('sit_type', 0);
  return person;
}
