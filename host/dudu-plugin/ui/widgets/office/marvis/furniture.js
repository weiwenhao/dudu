// The furniture: the activity area's (the water bar and the treadmills of marvis-office's column; the added column's modules, the toilet and the
// door), the sleeping room, and a desk group for each seat. The sprites, their positions and their scales are those of useScene.ts and
// useWorkstation.ts of marvis-office (SOURCE.md), where they are the atlas's.
import { AnimatedSprite, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { ADDED_STRIPS, BALCONY_CROP, DOOR, MODULES, OLD_WALL, OLD_WALL_WEST, ORIGINAL_X, SLEEP_FRONT, SLEEP_ROOM, SOFA_FRONT, TOILET, TREADMILL, TREADMILL_LEFT, TREADMILLS, WATER_BAR_Y } from '../layout.js';

const DESK_SCALE = 0.3; // a desk group and its chair
const PERSON_SCALE = 0.45; // the screen's and the effect's frame, which the animation sheets were drawn for
const WALL_THICKNESS = 24; // the sleeping room's wall, as it is drawn (the atlas's own walls are thin)
const FAR = 100000; // the wall goes on far past the plane: the canvas shows more than the plane when the widget is wider or taller than it
const SCENERY = [['water_bar.png', WATER_BAR_Y, 0]]; // [name, y (the frame's top), how far to the left of its column]

/** The things of marvis-office's column, one sprite each, and the treadmills: three copies of its picture (the balcony and the toilet are modules: createModules). */
export function createScenery(atlas) {
  const layer = new Container();
  for (const [name, y, left] of SCENERY) {
    const sprite = new Sprite(atlas[name]);
    sprite.x = ORIGINAL_X + left;
    sprite.y = y;
    layer.addChild(sprite);
  }
  // the treadmills: the picture of the atlas's one, from its row `cut` (the rows above it are floor) to its row `bottom` (the rows below are floor too), `pitch` apart
  // down the column, each below the last one's shadow (a sprite sheet's frames are in plane units: the sheet is 2x)
  const treadmill = atlas['treadmill.png'];
  const part = new Texture({ source: treadmill.source, frame: new Rectangle(treadmill.frame.x, treadmill.frame.y + TREADMILL.cut, treadmill.frame.width, TREADMILL.bottom - TREADMILL.cut) });
  TREADMILLS.forEach(({ picture }, index) => {
    const sprite = new Sprite(part);
    if (index === 0) sprite.once('destroyed', () => part.destroy(false)); // (they share the picture's source: only what it listens to on it goes)
    sprite.x = ORIGINAL_X - TREADMILL_LEFT;
    sprite.y = picture;
    layer.addChild(sprite);
  });
  // marvis-office's column has a wall along its west side (the one that stood between the two columns of the rest area): floor covers it where
  // the added column's pictures do not (they are drawn over this layer, and do not touch each other: the spare height of the column is between them).
  layer.addChild(new Graphics().rect(OLD_WALL_WEST.x0, OLD_WALL_WEST.y0, OLD_WALL_WEST.x1 - OLD_WALL_WEST.x0, OLD_WALL_WEST.y1 - OLD_WALL_WEST.y0).fill({ color: 0xf7f7f7 }));
  return layer;
}

/**
 * The rest area's modules that were drawn for this widget, one sprite each (at 2x, as the atlas is), the toilet, which is the atlas's, the door
 * in the sleeping room's wall, and the PS5 sofa's back and arms apart.
 */
export function createModules(textures, atlas) {
  const layer = new Container();
  for (const { name, x, y } of MODULES) {
    // the balcony's picture starts with floor, which would cover the last treadmill's shadow: it is drawn without its first rows (the pictures are 2x)
    const crop = name === 'balcony' ? BALCONY_CROP : 0;
    const texture = textures[name];
    const part = crop ? new Texture({ source: texture.source, frame: new Rectangle(texture.frame.x, texture.frame.y + crop * 2, texture.frame.width, texture.frame.height - crop * 2) }) : texture;
    const sprite = new Sprite(part);
    if (crop) sprite.once('destroyed', () => part.destroy(false)); // (it shares the picture's source: only what it listens to on it goes)
    sprite.scale.set(0.5);
    sprite.x = x;
    sprite.y = y + crop;
    layer.addChild(sprite);
  }
  // marvis-office's column has a wall on its left (the one that stood between the two columns of the rest area): it is covered by floor (the page's
  // colour, the same as the plane's); what of it is west of x 0 is under the added column's pictures, which hide it (and, between them, `createScenery`'s patch).
  const patch = new Graphics().rect(OLD_WALL.x0, OLD_WALL.y0, OLD_WALL.x1 - OLD_WALL.x0, OLD_WALL.y1 - OLD_WALL.y0).fill({ color: 0xf7f7f7 });
  layer.addChild(patch);
  for (const strip of ADDED_STRIPS) layer.addChild(new Graphics().rect(strip.x0, strip.y0, strip.x1 - strip.x0, strip.y1 - strip.y0).fill({ color: 0xf7f7f7 }));
  const toilet = new Sprite(atlas['toilet.png']); // drawn after the PS5 corner, as the toilet was drawn after the treadmill: its picture overlaps by a few rows
  toilet.x = TOILET.x;
  toilet.y = TOILET.y;
  layer.addChild(toilet);
  const door = new Sprite(textures.door);
  door.scale.set(0.5);
  door.x = DOOR.sprite.x;
  door.y = DOOR.sprite.y;
  layer.addChild(door);
  const sofa = new Sprite(textures.ps5Sofa);
  sofa.scale.set(0.5);
  sofa.x = SOFA_FRONT.x;
  sofa.y = SOFA_FRONT.y;
  return { layer, sofa };
}

/**
 * The sleeping room: its floor and its eight beds (one sprite); the blankets, which are drawn over the sleepers; and the partition wall, as
 * thick as it is drawn, over all of it. The room has no wall of its own on the west, and no dark over it (it had a half-clear grey plane, which the
 * owner asked to be taken off, 2026-11-04: it looked abrupt): the floor is the rest area's, so the canvas shows no strip beside the plane.
 */
export function createSleepRoom(textures) {
  const room = new Sprite(textures.sleep);
  room.scale.set(0.5);
  room.x = SLEEP_ROOM.x;
  room.y = SLEEP_ROOM.y;
  const blankets = new Sprite(textures.sleepFront);
  blankets.scale.set(0.5);
  blankets.x = SLEEP_FRONT.x;
  blankets.y = SLEEP_FRONT.y;
  return { room, blankets, walls: createSleepWalls(WALL_THICKNESS) };
}

/**
 * A desk group at `desk` ({ x, y, boss }): its shadow, the desk and the monitor (`base`), and the chair, which is drawn above the person
 * so the back of it hides their lower half. The boss's is bigger and its monitor is always lit.
 */
export function createDesk(atlas, desk) {
  const sprite = (name, x, y, alpha = 1) => {
    const item = new Sprite(atlas[name]);
    item.x = x;
    item.y = y;
    item.alpha = alpha;
    return item;
  };
  const base = new Container();
  const chair = new Container();
  base.x = chair.x = desk.x;
  base.y = chair.y = desk.y;
  base.addChild(sprite(desk.boss ? 'shadow_boss.png' : 'shadow.png', -216, desk.boss ? 256 : 181, desk.boss ? 0.8 : 0.72));
  base.addChild(sprite(desk.boss ? 'desk_boss.png' : 'desk.png', 0, 0));
  chair.addChild(sprite(desk.boss ? 'chair_boss.png' : 'chair.png', desk.boss ? 187 : 197, desk.boss ? 257 : 187));
  if (desk.boss) base.addChild(sprite('screen.png', 184, -18));
  base.addChild(desk.boss ? sprite('screen_on.png', 190.8, -10.4) : sprite('screen.png', 184, -95));
  base.scale.set(DESK_SCALE);
  chair.scale.set(DESK_SCALE);
  return { base, chair };
}

/**
 * What plays at a desk: the animation on its monitor (`screen`) and the ticket above it (`effect`). Both are a container at the desk's
 * person origin holding one animated sprite at a time (WorkstationScreen and WorkstationEffect of marvis-office); `play` puts a new one
 * in place of the last, `clear` takes it away. The sprites are driven by the office's own clock (`tick`), not by PixiJS' shared ticker,
 * so that they stop when the office does.
 */
export function createDeskPlayers(desk) {
  const origin = { x: desk.x - 24, y: desk.y - 9 }; // roleProfile.position: the desk group's offset taken back
  const make = (defaults) => {
    const container = new Container();
    container.x = origin.x;
    container.y = origin.y;
    container.scale.set(PERSON_SCALE);
    let current = null;
    return {
      container,
      play(frames, options = {}) {
        const { x = 0, y = 0, scale = 1, speed = 0.35, loop = true } = { ...defaults, ...options };
        const next = new AnimatedSprite(frames, false);
        next.x = x;
        next.y = y;
        next.scale.set(scale);
        next.animationSpeed = speed;
        next.loop = loop;
        next.play();
        container.addChild(next);
        current?.destroy();
        current = next;
      },
      clear() {
        current?.destroy();
        current = null;
      },
      tick(ticker) { current?.update(ticker); },
      get playing() { return current !== null; },
    };
  };
  // the monitor's animation is placed at (180, -40) at 1.28 (agentActionDefinitionOverrides of marvis-office); the ticket is drawn in place
  return { screen: make({ x: 180, y: -40, scale: 1.28 }), effect: make({}) };
}

/**
 * The wall between the sleeping room and the rest area, as thick as it is drawn: a flat strip of light grey (the atlas draws a wall as a flat
 * strip too, a thin one) with a bright edge on the lit side and a dark one on the room's side, from the top of the canvas to the bottom of it,
 * with the door's opening in it.
 */
export function createSleepWalls(thickness) {
  const g = new Graphics();

  const strip = (centre, y0, y1) => {
    const x0 = centre - thickness / 2;
    g.rect(x0, y0, thickness, y1 - y0).fill({ color: 0xe8e9ec });
    g.rect(x0 + thickness - 1.6, y0, 1.6, y1 - y0).fill({ color: 0xffffff }); // the bright edge on the lit side
    g.rect(x0, y0, 1.6, y1 - y0).fill({ color: 0xc9cdd4 }); // the edge on the room's side
  };
  strip(SLEEP_ROOM.wall, -FAR, DOOR.y0);
  strip(SLEEP_ROOM.wall, DOOR.y1, FAR);
  g.label = 'sleep-walls';
  return g;
}
