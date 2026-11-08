// The Office widget's PixiJS scene: the application on the widget's canvas, the plane of marvis-office fitted into it, the loop, and what
// the widget asks of it. The scene itself (furniture, desks, people) is marvis/office.js; this file loads its images, draws it as often
// as is needed and no oftener (not while it is out of sight), and tells the widget where each head is on the canvas.
import { Application, Container, RenderTexture, Sprite } from 'pixi.js';
import { DESKS, fitScene, SCENE, toCanvas } from './layout.js';
import { createOffice } from './marvis/office.js';
import { createLibrary } from './marvis/textures.js';

// The canvas has no colour of its own: marvis-office's plane has no floor, the widget's page is the floor (#f7f7f7). A canvas that is opaque is
// black until the first picture is drawn, which waits for the images; this one shows the page's colour until then (and after it is resized).
const MAX_FPS = 30;
const MAX_RESOLUTION = 2;

/**
 * Makes the scene on `canvas` (which the caller made and will remove). Everything it needs is loaded in the background: until it is there
 * the canvas is plain, and `onFailed` is called if no renderer can be made. Returns what the widget asks of it. `antialias` is the card's multisampling: on
 * an ordinary screen only, since at two device pixels to a CSS pixel it makes no difference anyone can see (measured on 2026-11-04: a few specks on
 * the whole picture) and its buffers are about 55 MB of the graphics process. `flatten` (on unless a test turns it off) draws the furniture, which never
 * changes, once into one picture of the canvas's size and lets go of the pictures it is made of (most of the office's memory); see `flatten` below.
 */
export function createOfficeScene({ canvas, reducedMotion = false, width, height, antialias = (globalThis.devicePixelRatio || 1) < 2, flatten: flat = true, onTags, onFailed, onContextLost, onContextRestored }) {
  const state = {
    width: Math.max(1, width), height: Math.max(1, height), still: Boolean(reducedMotion), issues: [], populated: false,
    hover: null, disposed: false, lost: false, inView: true, docVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    app: null, viewport: null, office: null, library: null, textures: null, fit: null, tags: new Map(), frames: 0, dirty: true,
    flattening: false, flattenAgain: false, flattenTimer: null, flattens: 0, background: null, backgroundFit: null,
  };

  const active = () => Boolean(state.app) && !state.disposed && !state.lost && !state.flattening && state.inView && state.docVisible && Boolean(state.office);

  function layout() {
    state.fit = fitScene(SCENE, state.width, state.height);
    if (!state.viewport) return;
    state.viewport.scale.set(state.fit.scale);
    state.viewport.position.set(state.fit.x, state.fit.y);
  }

  function tagPositions() {
    if (!state.office || !state.fit) return [];
    return state.office.tags().map(({ id, state: s, x, y }) => ({ id, state: s, ...toCanvas(state.fit, { x, y }) }));
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

  /** Once the graphics card has a picture, the page's decoded copy of it is let go of (see marvis/textures.js: it is as much memory again). */
  const settle = () => { if (state.app && state.library) state.library.release(state.app.renderer); };

  /** The office's clock, in step with the application's ticker. */
  function tick(ticker) {
    if (!state.office) return;
    state.office.update(Math.min(0.1, ticker.deltaMS / 1000), ticker);
    state.frames += 1;
    if (state.frames % 10 === 1) settle(); // the pictures that were drawn in the frames before
    reportTags(false);
  }

  /** Runs the loop while somebody can see it; a still scene (reduced motion) is drawn once for each change instead. */
  function sync() {
    const { app } = state;
    if (!app) return;
    if (active() && !state.still) {
      if (!app.ticker.started) app.ticker.start();
      return;
    }
    if (app.ticker.started) app.ticker.stop();
    if (active() && state.dirty) {
      state.dirty = false;
      app.render();
      settle();
      reportTags(true);
    }
  }
  const wake = () => { state.dirty = true; sync(); };

  /**
   * Draws the furniture (the pictures of the scenery and the desks, which never change) once into one picture of the canvas's size, and lets go of the
   * pictures it is made of: they were most of the memory of the office (the atlas alone is 64 MB on the card). What moves is drawn over it as before, and the
   * picture is the same as the furniture drawn every time, pixel for pixel, since it is drawn at the canvas's own size and put back one to one. Done again,
   * a moment after the widget stops being resized (or the pixel ratio changes, or the context comes back), for the new size.
   */
  async function flatten() {
    const { app, office, library } = state;
    if (!flat || !app || !office || !library || state.disposed) return;
    if (state.flattening) { state.flattenAgain = true; return; }
    state.flattening = true;
    try {
      await library.reloadFurniture();
      if (state.disposed || state.office !== office || !state.app) return;
      const { layers } = office;
      const still = [layers.scenery, layers.desks];
      const moving = [layers.screens, layers.people, layers.chairs, layers.walls, layers.effects];
      const shown = [...still, ...moving].map((layer) => layer.visible);
      for (const layer of still) layer.visible = true;
      for (const layer of moving) layer.visible = false;
      const old = state.background;
      if (old) old.visible = false;
      layout();
      const target = RenderTexture.create({ width: state.width, height: state.height, resolution: app.renderer.resolution, antialias });
      try {
        app.renderer.render({ container: app.stage, target, clear: true });
      } finally {
        [...still, ...moving].forEach((layer, i) => { layer.visible = shown[i]; });
        if (old) old.visible = true;
      }
      const next = new Sprite(target);
      app.stage.addChildAt(next, 0);
      if (old) { app.stage.removeChild(old); old.destroy({ texture: true, textureSource: true }); }
      state.background = next;
      state.backgroundFit = { scale: state.fit.scale, x: state.fit.x, y: state.fit.y };
      for (const layer of still) layer.visible = false;
      library.unloadFurniture();
      state.flattens += 1;
    } catch {
      // (the furniture is drawn as it was, picture by picture, if it was never flattened; if it was, the old picture stays until the next try)
    } finally {
      state.flattening = false;
      if (!state.disposed) {
        if (state.flattenAgain) { state.flattenAgain = false; scheduleFlatten(); }
        wake();
      }
    }
  }

  /** A moment after the last change of size, the furniture is drawn again for the canvas as it is now. */
  function scheduleFlatten() {
    if (!flat || !state.background) return;
    clearTimeout(state.flattenTimer);
    state.flattenTimer = setTimeout(() => { flatten(); }, 300);
  }

  /** Until it is, the picture of the furniture of the canvas as it was is set to where the plane is now (it is blurred, if the plane is bigger). */
  function retarget() {
    const { background, backgroundFit, fit } = state;
    if (!background || !backgroundFit || !fit) return;
    const k = fit.scale / backgroundFit.scale;
    background.scale.set(k);
    background.position.set(fit.x - backgroundFit.x * k, fit.y - backgroundFit.y * k);
  }

  function build() {
    const { app, textures } = state;
    if (!app || !textures) return;
    if (state.office) {
      state.viewport.removeChild(state.office.root);
      state.office.dispose();
    }
    if (state.background) { // (the picture of the furniture is lost with the context it was made in, and is made again with the office)
      app.stage.removeChild(state.background);
      state.background.destroy({ texture: true, textureSource: true });
      state.background = null;
      state.backgroundFit = null;
    }
    state.office = createOffice({
      atlas: textures.atlas, modules: textures.modules, people: textures.people, still: state.still,
      // A monitor's animation is loaded when its desk first plays one; once the office has put it on the monitor, a still office is drawn again.
      screen: (name) => state.library.screen(name).then((frames) => { setTimeout(wake, 0); return frames; }),
      ticket: () => state.library.ticket().then((frames) => { setTimeout(wake, 0); return frames; }),
    });
    state.viewport.addChild(state.office.root);
    state.office.setHover(state.hover);
    layout();
    state.office.setIssues(state.issues, false);
    state.populated = state.office.people.size > 0;
    state.tags = new Map();
    if (flat) flatten(); else wake(); // (nothing is drawn while the furniture is being flattened: see `active`)
    reportTags(true);
  }

  // --- start: the application, then the images, then the office
  async function start() {
    try {
      const app = new Application();
      // The office is flat: nothing in it is masked or sorted by depth, so its canvas has neither buffer (15 to 20 MB less in the graphics process, measured on
      // 2026-11-04). PixiJS asks for a stencil buffer itself, so the context is made here and handed to it; it warns once that masks may not render correctly.
      const context = canvas.getContext('webgl2', { alpha: true, antialias, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' });
      await app.init({
        canvas, ...(context ? { context } : {}), antialias, backgroundAlpha: 0, width: state.width, height: state.height, autoStart: false,
        resolution: Math.min(MAX_RESOLUTION, globalThis.devicePixelRatio || 1), autoDensity: true, preference: 'webgl',
      });
      if (state.disposed) { app.destroy(false, { children: true, texture: false }); return; }
      app.ticker.maxFPS = MAX_FPS;
      app.ticker.add(tick);
      state.app = app;
      state.viewport = new Container();
      app.stage.addChild(state.viewport);
      state.library = createLibrary({ onLoad: wake });
      const [atlas, modules, people] = await Promise.all([state.library.atlas(), state.library.modules(), state.library.people()]);
      if (state.disposed) return;
      state.textures = { atlas, modules, people };
      build();
    } catch {
      if (!state.disposed) onFailed?.();
    }
  }

  // draw only while someone can see it: the canvas on screen, the page not hidden
  let observer = null;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      const seen = entries[entries.length - 1].isIntersecting;
      if (seen === state.inView) return;
      state.inView = seen;
      wake();
    });
    observer.observe(canvas);
  }
  const onVisibility = () => { state.docVisible = document.visibilityState !== 'hidden'; wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  // moving the window to another screen, or zooming the page, changes the pixel ratio without changing the size of the canvas
  let pixels = globalThis.devicePixelRatio;
  const onWindowResize = () => {
    if (globalThis.devicePixelRatio === pixels || !state.app) return;
    pixels = globalThis.devicePixelRatio;
    state.app.renderer.resolution = Math.min(MAX_RESOLUTION, pixels || 1);
    state.app.renderer.resize(state.width, state.height);
    scheduleFlatten();
    wake();
  };
  window.addEventListener('resize', onWindowResize);
  const lose = (event) => { event.preventDefault(); state.lost = true; sync(); onContextLost?.(); };
  // The card has lost every picture; the page let go of its copies, so they are decoded again before anything is drawn. And PixiJS' text (the Zs of
  // whoever sleeps) does not come back with a context, so the office is made again, from the same pictures, with the same people at their places.
  const restore = () => {
    const back = () => {
      if (state.disposed) return;
      state.lost = false;
      if (state.textures) build();
      wake();
      onContextRestored?.();
    };
    if (state.library) state.library.reload().then(back, back); else back();
  };
  canvas.addEventListener('webglcontextlost', lose);
  canvas.addEventListener('webglcontextrestored', restore);

  layout();
  start();

  return {
    /** The issues to show; those in Todo, In Progress and In Review sit, in the order of the list. (`board` is for the totals: not drawn.) */
    setIssues(issues) {
      state.issues = Array.isArray(issues) ? issues : [];
      if (!state.office) return;
      // the first list that has anyone in it just appears; later changes walk
      const walk = state.populated && active() && !state.still;
      state.office.setIssues(state.issues, walk);
      if (state.office.people.size) state.populated = true;
      wake();
      reportTags(true);
    },
    resize(w, h) {
      state.width = Math.max(1, w);
      state.height = Math.max(1, h);
      state.app?.renderer.resize(state.width, state.height);
      layout();
      retarget();
      scheduleFlatten();
      wake();
      reportTags(true);
    },
    setBoardLabels() {},
    setHover(id) {
      state.hover = id ?? null;
      state.office?.setHover(state.hover);
      wake();
    },
    /** The issue of the person at this point of the canvas (CSS pixels from its top left corner), or null. */
    pick(x, y) {
      if (!state.office || !state.fit) return null;
      return state.office.pick((x - state.fit.x) / state.fit.scale, (y - state.fit.y) / state.fit.scale);
    },
    /** Where each name tag's tip goes on the canvas: just above the head of its person. */
    tagPositions,
    setTheme() {},
    setReducedMotion(still) {
      if (still === state.still) return;
      state.still = still;
      state.office?.setStill(still);
      wake();
    },
    /** What the scene holds, for tests. */
    stats() {
      return {
        frames: state.frames, running: Boolean(state.app?.ticker.started), disposed: state.disposed, lost: state.lost, desks: DESKS,
        people: state.office ? state.office.people.size : 0, ready: Boolean(state.office), flattened: Boolean(state.background) && !state.flattening, flattens: state.flattens, pictures: state.library?.stats() ?? null,
      };
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      clearTimeout(state.flattenTimer);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onWindowResize);
      canvas.removeEventListener('webglcontextlost', lose);
      canvas.removeEventListener('webglcontextrestored', restore);
      state.app?.ticker.stop();
      state.office?.dispose();
      state.library?.dispose();
      if (state.background) { state.app?.stage.removeChild(state.background); state.background.destroy({ texture: true, textureSource: true }); state.background = null; }
      state.app?.destroy(false, { children: true, texture: false });
      state.app = null;
      state.office = null;
    },
  };
}
