// Loading the scene's images (useActionTextures.ts of marvis-office, for data URLs and without Vue's import.meta.glob). What the office keeps in memory is
// a few small pictures instead of the big sheets it comes from (measured on 2026-11-04: the sheets took about 0.5 GB beside a blank page), and not one
// pixel of any of them is changed:
//  - a picture is decoded off the main thread into an ImageBitmap made from the bytes of its data URL (nothing is fetched: a data URL asked of fetch() is a
//    request that a page's content security policy can refuse, a Blob is not asked of anything), and the bitmap is closed as soon as the graphics card has its
//    copy. An <img> that has been decoded is kept by the browser, beside the card's copy, for as long as the page lives;
//  - a sheet that is mostly empty (a monitor's animation is 145 frames of 120 x 59 on a sheet of 2048 x 2048; a person has 22 frames on a sheet of 66 cells; the
//    atlas, 4096 x 4096, has 12) is copied, frame by frame, into a picture just big enough, and only that goes to the card. The copy is drawn on a canvas of the
//    processor's (`willReadFrequently`), not the card's: on the card's, the browser sends every whole sheet to the card as a picture and keeps it, in the page
//    and in the graphics process, long after the sheet is closed (170 MB and 330 MB measured on 2026-11-04 with Chrome's memory dump);
//  - the furniture (the atlas, and the pictures of the rest area and the sleeping room that never move) is only there to be drawn once, into one picture of
//    the size of the canvas (scene.js: flatten): `unloadFurniture` lets go of it, `reloadFurniture` brings it back for the next time (the widget is resized);
//  - a person's sheet is decoded when somebody of that look is first there.
import { ImageSource, Rectangle, Spritesheet, Texture } from 'pixi.js';
import { ATLAS, MODULE_IMAGES, PEOPLE, PEOPLE_IMAGES, SCREENS, TICKET } from './assets.js';

// What a picture with transparency needs to look as it did through <img>: the card's own premultiplying on upload does not apply to a bitmap.
const BITMAP = { premultiplyAlpha: 'premultiply' };
const SHEET_WIDTH = 2048; // how wide a packed sheet of frames is made at most
// How high a sheet of the furniture is made at most (a frame that is higher has a sheet to itself). The card is sent one sheet at a time, and the browser
// keeps room in the page and in the graphics process for the biggest it was ever sent: the atlas whole (64 MB) left 64 MB of shared memory behind
// (Chrome's memory dump, 2026-11-04).
const FURNITURE_HEIGHT = 1100;
const GAP = 2; // clear space round every frame of a packed sheet, as the atlas has: the card blends the edge of a picture with what is next to it (and clamps at the sheet's edge)
const CHAIRS = ['chair.png']; // the atlas's frames that stay (the desks' chairs are drawn over the people); the rest is drawn once
const FLAT_MODULES = ['pingpong', 'ps5', 'balcony', 'door', 'sleep']; // the modules that never move: drawn once, with the atlas

const canBitmap = (url) => typeof createImageBitmap === 'function' && typeof url === 'string' && /^data:[^,;]*;base64,/.test(url);

/** The bytes of a base64 data URL as a Blob. */
function blobOf(url) {
  if (!canBitmap(url)) throw new Error('The office needs createImageBitmap and its pictures as base64 data URLs.');
  const comma = url.indexOf(',');
  const type = url.slice(5, comma).split(';')[0] || 'application/octet-stream';
  const text = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return new Blob([bytes], { type });
}

/** Rectangles [width, height] set in rows no wider than `limit`, `gap` apart and from the edge: where each goes, and how big the whole is. */
export function shelves(sizes, limit, gap = 0) {
  const at = [];
  let x = gap;
  let y = gap;
  let row = 0;
  let width = 0;
  for (const [w, h] of sizes) {
    if (x > gap && x + w + gap > limit) { x = gap; y += row + gap; row = 0; }
    at.push([x, y]);
    x += w + gap;
    row = Math.max(row, h);
    width = Math.max(width, x);
  }
  return { at, width, height: y + row + gap };
}

/**
 * Rectangles [width, height] set in rows, in as many sheets as it takes: none wider than `width` or higher than `height` (a rectangle bigger than that is alone in
 * its sheet), `gap` apart and from the edge, the highest first. For each sheet: which rectangles (their places in `sizes`), where each goes, and how big it is.
 */
export function sheetsOf(sizes, width, height, gap = 0) {
  const order = sizes.map((_, index) => index).sort((a, b) => sizes[b][1] - sizes[a][1] || sizes[b][0] - sizes[a][0] || a - b);
  const sheets = [];
  let sheet = null;
  for (const index of order) {
    const [w, h] = sizes[index];
    let place = null;
    if (sheet) {
      let { x, y, row } = sheet;
      if (x > gap && x + w + gap > width) { x = gap; y += row + gap; row = 0; }
      if (y + h + gap <= height) place = { x, y, row };
    }
    if (!place) {
      sheet = { items: [], at: [], x: gap, y: gap, row: 0, width: 0, height: 0 };
      sheets.push(sheet);
      place = { x: gap, y: gap, row: 0 };
    }
    Object.assign(sheet, place);
    sheet.items.push(index);
    sheet.at.push([sheet.x, sheet.y]);
    sheet.x += w + gap;
    sheet.row = Math.max(sheet.row, h);
    sheet.width = Math.max(sheet.width, sheet.x);
    sheet.height = sheet.y + sheet.row + gap;
  }
  return sheets.map(({ items, at, width: sheetWidth, height: sheetHeight }) => ({ items, at, width: sheetWidth, height: sheetHeight }));
}

/**
 * A person's sheet holds 22 frames in the cells of a sheet of 66 (the rows of the poses are as long as the longest pose); the frames go side by side in a
 * sheet of six columns. `cells[i]` is the i-th frame: its pose, its number in the pose and where it is in the sheet it comes from; `layout` where it goes.
 */
export const PEOPLE_SHEET = (() => {
  const [width, height] = PEOPLE.cell;
  const cells = [];
  for (const [name, pose] of Object.entries(PEOPLE.poses)) for (let k = 0; k < pose.frames; k++) cells.push({ pose: name, k, x: k * width, y: pose.row * height, w: width, h: height });
  const layout = shelves(cells.map((cell) => [cell.w, cell.h]), 6 * (width + GAP) + GAP, GAP);
  return { cells, layout, size: [layout.width, layout.height] };
})();

/**
 * The cells of a picture, copied side by side into a picture of their own (`whole` is not closed here). The surface is a canvas that the processor draws,
 * not the graphics card (`willReadFrequently`): drawn on the card's, every whole sheet would be sent there as a picture and kept by the browser's caches, in
 * the page and in the graphics process, long after the sheet is closed (measured on 2026-11-04 with Chrome's memory dump: 170 MB and 330 MB).
 */
async function copyCells(whole, rects, layout) {
  const surface = new OffscreenCanvas(layout.width, layout.height);
  const context = surface.getContext('2d', { willReadFrequently: true });
  rects.forEach((rect, i) => context.drawImage(whole, rect.x, rect.y, rect.w, rect.h, layout.at[i][0], layout.at[i][1], rect.w, rect.h));
  const bitmap = await createImageBitmap(surface, BITMAP);
  surface.width = surface.height = 0;
  return bitmap;
}

async function packedBitmap(blob, rects, layout) {
  const whole = await createImageBitmap(blob, BITMAP);
  try { return await copyCells(whole, rects, layout); } finally { whole.close(); }
}

async function loadSheet(texture, sheet) {
  const spritesheet = new Spritesheet(texture, sheet);
  await spritesheet.parse();
  return spritesheet;
}

const destroySheet = (spritesheet) => spritesheet.destroy(true);
const destroyTexture = (texture) => texture.destroy(true);
/** Where a frame is in its sheet. (A frame the packer turned a quarter round is stored `h` wide and `w` high; its entry keeps `w` and `h` as they are.) */
const rectOf = (frame) => (frame.rotated
  ? { x: frame.frame.x, y: frame.frame.y, w: frame.frame.h, h: frame.frame.w }
  : { x: frame.frame.x, y: frame.frame.y, w: frame.frame.w, h: frame.frame.h });
/** The entry of a frame that was moved to `at` in a packed sheet. */
const moved = (frame, at) => ({ ...frame, frame: { x: at[0], y: at[1], w: frame.frame.w, h: frame.frame.h } });

/**
 * The furniture: the atlas's frames that are only drawn once (all but the chairs), set in sheets of at most `SHEET_WIDTH` x `FURNITURE_HEIGHT`. `names[i]` is a
 * frame, `rects[i]` where it is in the atlas, `sheets` where each sheet's frames go (`items` are places in `names`).
 */
export const FURNITURE = (() => {
  const names = Object.keys(ATLAS.sheet.frames).filter((name) => !CHAIRS.includes(name));
  const rects = names.map((name) => rectOf(ATLAS.sheet.frames[name]));
  return { names, rects, sheets: sheetsOf(rects.map((rect) => [rect.w, rect.h]), SHEET_WIDTH, FURNITURE_HEIGHT, GAP) };
})();

/** The frames of an animation, in order (the sheets name them `name_00000`, `name_00001`, ...). */
const framesOf = (spritesheet) => Object.entries(spritesheet.textures)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, texture]) => texture);

/**
 * What one office needs: the furniture (`atlas`: texture by name), the animations on demand (`screen(name)`, `ticket()`: frames), the new column
 * (`modules()`: textures by name) and the people (`people()`: their frames by pose). Everything is this library's own (a second office, the preview of the
 * add-widget dialog, loads its own: the pictures are closed once uploaded, so there is nothing worth sharing). Call `release(renderer)` now and then while
 * the office draws, `unloadFurniture()` once the furniture has been drawn into the picture that stands for it (and `reloadFurniture()` before it is drawn
 * again), `reload()` when its graphics context comes back, and `dispose()` when it is gone. `onLoad` is called when a person's sheet has arrived (the
 * office has to be drawn again).
 */
export function createLibrary({ onLoad } = {}) {
  // { source, make, state, flat }: `make` decodes the picture again (a lost context needs it again); `state` is 'blank' (not decoded yet: a person's sheet
  // before that person is there), 'open' (decoded, waiting for the card), 'closed' (the card has it) or 'unloaded' (furniture the card let go of as well)
  const pictures = [];
  const loaded = new Map(); // key -> promise of what was loaded (an animation asked for twice is loaded once)
  const destroyers = [];
  const lazy = []; // the pictures of the people's sheets
  const placeholders = []; // the clear pictures that stand in for them
  const loading = new Set(); // the sheets that are being decoded now
  let disposed = false;

  /** A texture of the picture that `make` decodes. */
  async function textureOf(make, flat = false) {
    const bitmap = await make();
    if (disposed) { bitmap.close(); throw new Error('The library is gone.'); }
    const texture = Texture.from(bitmap, true);
    const { source } = texture;
    // Pixi asks the resource for the picture's size whenever it wants it, and a closed bitmap says 0: tell it once and for all. It also lets go of a
    // texture that has not been drawn for a minute and uploads it again from the resource when it is drawn: not from a closed one.
    Object.defineProperty(source, 'resourceWidth', { value: bitmap.width, configurable: true });
    Object.defineProperty(source, 'resourceHeight', { value: bitmap.height, configurable: true });
    source.autoGarbageCollect = false;
    pictures.push({ source, make, state: 'open', flat });
    return texture;
  }
  const decoded = (image) => { const blob = blobOf(image); return () => createImageBitmap(blob, BITMAP); };

  // The atlas is 4096 x 4096 (64 MB decoded): it is decoded once for everything that is made from it at the same time (the furniture's sheets and the chairs) and
  // closed when the last of them is done. `fromAtlas(work)` calls `work(bitmap)`; a `fromAtlas` round a number of them (a batch) keeps the bitmap for all.
  let atlasBlob = null;
  let atlasBitmap = null;
  let atlasUses = 0;
  async function fromAtlas(work) {
    atlasUses++;
    atlasBlob ??= blobOf(ATLAS.image);
    atlasBitmap ??= createImageBitmap(atlasBlob, BITMAP);
    const mine = atlasBitmap;
    try {
      return await work(await mine);
    } finally {
      if (--atlasUses === 0) { atlasBitmap = null; mine.then((bitmap) => bitmap.close(), () => {}); }
    }
  }
  /** A picture of the given frames of the atlas, copied side by side (what `make` is for them). */
  const fromTheAtlas = (rects, layout) => () => fromAtlas((whole) => copyCells(whole, rects, layout));

  /** The frames of a sheet copied into a sheet just big enough (the highest first, so that a row has no more empty space than it must), as a Spritesheet of the same frames under the same names. */
  const packed = ({ image, sheet }) => async () => {
    const frames = Object.entries(sheet.frames);
    const [layout] = sheetsOf(frames.map(([, frame]) => { const rect = rectOf(frame); return [rect.w, rect.h]; }), SHEET_WIDTH, Infinity, GAP);
    const rects = layout.items.map((item) => rectOf(frames[item][1]));
    const blob = blobOf(image);
    const texture = await textureOf(() => packedBitmap(blob, rects, layout));
    const data = {
      frames: Object.fromEntries(layout.items.map((item, i) => [frames[item][0], moved(frames[item][1], layout.at[i])])),
      meta: { ...sheet.meta, size: { w: layout.width, h: layout.height } },
    };
    return loadSheet(texture, data);
  };

  const once = (key, load, destroy) => {
    if (!loaded.has(key)) {
      loaded.set(key, load().then((value) => {
        if (disposed) destroy(value);
        else destroyers.push(() => destroy(value));
        return value;
      }));
    }
    return loaded.get(key);
  };

  /** Decodes a person's sheet and puts it in place of the clear picture; the card gets it with the next draw (or at once, if it has the clear one). */
  function start(picture) {
    if (picture.state !== 'blank') return;
    picture.state = 'loading';
    const job = picture.make().then((bitmap) => {
      if (disposed) { bitmap.close(); return; }
      const { source } = picture;
      Object.defineProperty(source, 'resourceWidth', { value: bitmap.width, configurable: true }); // (what the closed bitmap will no longer say)
      Object.defineProperty(source, 'resourceHeight', { value: bitmap.height, configurable: true });
      source.resource = bitmap;
      picture.state = 'open';
      source.update(); // uploads it, if the card had the clear picture
      onLoad?.(); // and the office draws again: a still one would otherwise show nobody until something else changed
    }, () => { picture.state = 'blank'; }).finally(() => loading.delete(job));
    loading.add(job);
  }

  const furniture = () => pictures.filter((picture) => picture.flat);
  const remake = async (picture) => {
    const bitmap = await picture.make();
    if (disposed) { bitmap.close(); return; }
    picture.source.resource = bitmap;
    picture.state = 'open';
  };

  return {
    /**
     * The furniture, by frame name. The atlas itself never goes to the card: the frames that are only drawn once go there in a few sheets of their own (see
     * FURNITURE), and the two that stay, the chairs, in one more.
     */
    atlas: () => once('atlas', () => fromAtlas(async () => {
      const entries = (names, rects, layout) => ({
        frames: Object.fromEntries(names.map((name, i) => [name, moved(ATLAS.sheet.frames[name], layout.at[i])])),
        meta: { ...ATLAS.sheet.meta, size: { w: layout.width, h: layout.height } },
      });
      const chairRects = CHAIRS.map((name) => rectOf(ATLAS.sheet.frames[name]));
      const chairLayout = shelves(chairRects.map((rect) => [rect.w, rect.h]), SHEET_WIDTH, GAP);
      const sheets = FURNITURE.sheets.map((sheet) => {
        const rects = sheet.items.map((item) => FURNITURE.rects[item]);
        return { make: fromTheAtlas(rects, sheet), flat: true, data: entries(sheet.items.map((item) => FURNITURE.names[item]), rects, sheet) };
      });
      sheets.push({ make: fromTheAtlas(chairRects, chairLayout), flat: false, data: entries(CHAIRS, chairRects, chairLayout) });
      const spritesheets = await Promise.all(sheets.map(async ({ make, flat, data }) => loadSheet(await textureOf(make, flat), data)));
      if (disposed) { spritesheets.forEach(destroySheet); throw new Error('The library is gone.'); }
      destroyers.push(...spritesheets.map((spritesheet) => () => destroySheet(spritesheet)));
      return Object.assign({}, ...spritesheets.map((spritesheet) => spritesheet.textures));
    }), () => {}),
    screen: async (name) => framesOf(await once(`screen:${name}`, packed(SCREENS[name]), destroySheet)),
    ticket: async () => framesOf(await once('ticket', packed(TICKET), destroySheet)),
    async modules() {
      const entries = await Promise.all(Object.entries(MODULE_IMAGES).map(async ([name, image]) => [name, await once(`module:${name}`, () => textureOf(decoded(image), FLAT_MODULES.includes(name)), destroyTexture)]));
      return Object.fromEntries(entries);
    },
    /**
     * The 16 people: for each, its frames by pose (`{ walk: [texture], sit_type: [texture], ... }`). A person's frames are copied into a sheet of their own
     * (`PEOPLE_SHEET`), which is decoded when its look is first asked for (people[look]): until then, and for a look nobody has, it is a clear one-pixel
     * picture of the sheet's size that the card never even gets, and its frames are cut from it as they will be from the real one (the office draws eight
     * people at most, of sixteen looks).
     */
    async people() {
      const { cells, layout, size } = PEOPLE_SHEET;
      const clear = await createImageBitmap(new ImageData(1, 1));
      placeholders.push(clear);
      const looks = PEOPLE_IMAGES.map((image) => {
        const blob = blobOf(image);
        const source = new ImageSource({ resource: clear, width: size[0], height: size[1] }); // its size is the sheet's; its picture is the clear one's, which the card pads
        source.autoGarbageCollect = false;
        const picture = { source, make: () => packedBitmap(blob, cells, layout), state: 'blank', flat: false };
        pictures.push(picture);
        lazy.push(picture);
        const frames = {};
        cells.forEach((cell, i) => { (frames[cell.pose] ??= [])[cell.k] = new Texture({ source, frame: new Rectangle(layout.at[i][0], layout.at[i][1], cell.w, cell.h) }); });
        return { picture, frames };
      });
      const result = [];
      looks.forEach(({ picture, frames }, index) => Object.defineProperty(result, index, { enumerable: true, get() { start(picture); return frames; } }));
      return result;
    },
    /** Lets go of the decoded copy of each picture that the graphics card of `renderer` has by now (a picture that was never drawn is kept; the furniture is not touched). */
    release(renderer) {
      for (const picture of pictures) {
        if (picture.flat || picture.state !== 'open' || !picture.source._gpuData?.[renderer.uid]) continue;
        picture.source.resource?.close?.();
        picture.state = 'closed';
      }
    },
    /** Lets go of the furniture, in the page and on the card: it has been drawn into the picture that stands for it. */
    unloadFurniture() {
      for (const picture of furniture()) {
        if (picture.state === 'open') picture.source.resource?.close?.();
        if (picture.state !== 'unloaded') { picture.source.unload(); picture.state = 'unloaded'; }
      }
    },
    /** Decodes the furniture again, to be drawn once more (it is uploaded again when it is drawn). */
    async reloadFurniture() {
      const pending = furniture().filter((picture) => picture.state === 'unloaded');
      if (pending.length) await fromAtlas(() => Promise.all(pending.map(remake)));
    },
    /** Resolves when no person's sheet is being decoded any more (for tests that draw the office and want everybody in it). */
    async settled() { while (loading.size) await Promise.all([...loading]); },
    /** How many pictures there are, and how many of them are closed, not decoded yet and let go of altogether (for tests). */
    stats: () => ({
      pictures: pictures.length, closed: pictures.filter((picture) => picture.state === 'closed').length,
      blank: pictures.filter((picture) => picture.state === 'blank').length, unloaded: pictures.filter((picture) => picture.state === 'unloaded').length,
    }),
    /** Decodes again what was let go of, for a graphics context that was lost and came back: it uploads everything again from the resources (the furniture is `reloadFurniture`'s). */
    async reload() {
      const pending = pictures.filter((picture) => !picture.flat && picture.state === 'closed');
      if (pending.length) await fromAtlas(() => Promise.all(pending.map(remake)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const picture of pictures) if (picture.state === 'open') picture.source.resource?.close?.();
      for (const picture of lazy) picture.source.destroy();
      for (const clear of placeholders) clear.close();
      for (const destroy of destroyers) destroy();
      destroyers.length = 0;
      pictures.length = 0;
      lazy.length = 0;
      placeholders.length = 0;
    },
  };
}
