// The furniture: the water bar and the treadmill down the left, and a desk group for each seat. The sprites, their positions
// and their scales are those of useScene.ts and useWorkstation.ts of marvis-office (SOURCE.md).
import { AnimatedSprite, Container, Sprite } from 'pixi.js';
import { DOOR, MODULES, SOFA_FRONT, TOILET } from '../layout.js';

const DESK_SCALE = 0.3; // a desk group and its chair
const PERSON_SCALE = 0.45; // the screen's and the effect's frame, which the animation sheets were drawn for
const SCENERY = [['water_bar.png', 30], ['treadmill.png', 290]]; // x is 0, y is the frame's top

/** The things of the original column, one sprite each (the third, the toilet, has moved to the new column: createModules). */
export function createScenery(atlas) {
  const layer = new Container();
  for (const [name, y] of SCENERY) {
    const sprite = new Sprite(atlas[name]);
    sprite.y = y;
    layer.addChild(sprite);
  }
  return layer;
}

/**
 * The rest area's new modules, one sprite each (they are drawn at 2x, as the atlas is), the toilet, which is the atlas's, the door in the
 * original column's west wall, and the PS5 sofa's back and arms apart.
 */
export function createModules(textures, atlas) {
  const layer = new Container();
  for (const { name, x, y } of MODULES) {
    const sprite = new Sprite(textures[name]);
    sprite.scale.set(0.5);
    sprite.x = x;
    sprite.y = y;
    layer.addChild(sprite);
  }
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
