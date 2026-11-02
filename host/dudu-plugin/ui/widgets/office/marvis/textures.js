// Loading the scene's images (useActionTextures.ts of marvis-office, for data URLs and without Vue's import.meta.glob). An image is decoded
// by the browser's own <img>, as the pet's picture is, rather than fetched by PixiJS' loader: a data URL asked of fetch() is a request that a
// page's content security policy can refuse, one given to <img> is not. A sheet is loaded once for the whole page however many offices draw
// it (the add-widget preview and the dashboard can show one each) and let go of when the last one is gone.
import { Rectangle, Spritesheet, Texture } from 'pixi.js';
import { ATLAS, MODULE_IMAGES, PEOPLE, PEOPLE_IMAGES, SCREENS, TICKET } from './assets.js';

const shared = new Map(); // key -> { users, value: Promise }

function acquire(key, load) {
  let entry = shared.get(key);
  if (!entry) {
    entry = { users: 0, value: load() };
    shared.set(key, entry);
  }
  entry.users += 1;
  return entry.value;
}

function release(key, destroy) {
  const entry = shared.get(key);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  shared.delete(key);
  entry.value.then(destroy).catch(() => {});
}

async function loadTexture(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return Texture.from(image);
}

async function loadSheet({ image, sheet }) {
  const spritesheet = new Spritesheet(await loadTexture(image), sheet);
  await spritesheet.parse();
  return spritesheet;
}

const destroySheet = (spritesheet) => spritesheet.destroy(true);
const destroyTexture = (texture) => texture.destroy(true);

/** The frames of an animation, in order (the sheets name them `name_00000`, `name_00001`, ...). */
const framesOf = (spritesheet) => Object.entries(spritesheet.textures)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, texture]) => texture);

/**
 * What one office needs: the furniture (`atlas`: texture by name), the animations on demand (`screen(name)`, `ticket()`: frames), the new
 * column (`modules()`: textures by name) and the people (`people()`: their frames by pose). Call `dispose()` when the office is
 * gone.
 */
export function createLibrary() {
  const held = [];
  let disposed = false;
  const hold = (key, load, destroy) => {
    held.push([key, destroy]);
    return acquire(key, load);
  };
  return {
    atlas: async () => (await hold('atlas', () => loadSheet(ATLAS), destroySheet)).textures,
    screen: async (name) => framesOf(await hold(`screen:${name}`, () => loadSheet(SCREENS[name]), destroySheet)),
    ticket: async () => framesOf(await hold('ticket', () => loadSheet(TICKET), destroySheet)),
    async modules() {
      const entries = await Promise.all(Object.entries(MODULE_IMAGES).map(async ([name, image]) => [name, await hold(`module:${name}`, () => loadTexture(image), destroyTexture)]));
      return Object.fromEntries(entries);
    },
    /** The 16 people: for each, its frames by pose (`{ walk: [texture], sit_type: [texture], ... }`), cut from its sheet. */
    async people() {
      const sheets = await Promise.all(PEOPLE_IMAGES.map((image, index) => hold(`person:${index}`, () => loadTexture(image), destroyTexture)));
      const [width, height] = PEOPLE.cell;
      return sheets.map((sheet) => Object.fromEntries(Object.entries(PEOPLE.poses).map(([name, pose]) => [
        name, Array.from({ length: pose.frames }, (_, k) => new Texture({ source: sheet.source, frame: new Rectangle(k * width, pose.row * height, width, height) })),
      ])));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [key, destroy] of held) release(key, destroy);
      held.length = 0;
    },
  };
}
