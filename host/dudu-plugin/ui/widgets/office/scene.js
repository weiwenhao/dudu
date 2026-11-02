// The Office widget's PixiJS scene: the application on the widget's canvas, the plane of marvis-office fitted into it, the loop, and what
// the widget asks of it. The scene itself (furniture, desks, people) is marvis/office.js; this file loads its images, draws it as often
// as is needed and no oftener (not while it is out of sight), and tells the widget where each head is on the canvas.
import { Application, Container } from 'pixi.js';
import { DESKS, fitScene, SCENE, toCanvas } from './layout.js';
import { createOffice } from './marvis/office.js';
import { createLibrary } from './marvis/textures.js';

// The canvas has no colour of its own: marvis-office's plane has no floor, the widget's page is the floor (#f7f7f7). A canvas that is opaque is
// black until the first picture is drawn, which waits for the images; this one shows the page's colour until then (and after it is resized).
const MAX_FPS = 30;
const MAX_RESOLUTION = 2;

/**
 * Makes the scene on `canvas` (which the caller made and will remove). Everything it needs is loaded in the background: until it is there
 * the canvas is plain, and `onFailed` is called if no renderer can be made. Returns what the widget asks of it.
 */
export function createOfficeScene({ canvas, reducedMotion = false, width, height, onTags, onFailed, onContextLost, onContextRestored }) {
  const state = {
    width: Math.max(1, width), height: Math.max(1, height), still: Boolean(reducedMotion), issues: [], populated: false,
    hover: null, disposed: false, lost: false, inView: true, docVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    app: null, viewport: null, office: null, library: null, textures: null, fit: null, tags: new Map(), frames: 0, dirty: true,
  };

  const active = () => Boolean(state.app) && !state.disposed && !state.lost && state.inView && state.docVisible && Boolean(state.office);

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

  /** The office's clock, in step with the application's ticker. */
  function tick(ticker) {
    if (!state.office) return;
    state.office.update(Math.min(0.1, ticker.deltaMS / 1000), ticker);
    state.frames += 1;
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
      reportTags(true);
    }
  }
  const wake = () => { state.dirty = true; sync(); };

  function build() {
    const { app, textures } = state;
    if (!app || !textures) return;
    if (state.office) {
      state.viewport.removeChild(state.office.root);
      state.office.dispose();
    }
    state.office = createOffice({
      atlas: textures.atlas, modules: textures.modules, people: textures.people, still: state.still,
      screen: (name) => state.library.screen(name), ticket: () => state.library.ticket(),
    });
    state.viewport.addChild(state.office.root);
    state.office.setHover(state.hover);
    layout();
    state.office.setIssues(state.issues, false);
    state.populated = state.office.people.size > 0;
    state.tags = new Map();
    wake();
    reportTags(true);
  }

  // --- start: the application, then the images, then the office
  async function start() {
    try {
      const app = new Application();
      await app.init({
        canvas, antialias: true, backgroundAlpha: 0, width: state.width, height: state.height, autoStart: false,
        resolution: Math.min(MAX_RESOLUTION, globalThis.devicePixelRatio || 1), autoDensity: true, preference: 'webgl',
      });
      if (state.disposed) { app.destroy(false, { children: true, texture: false }); return; }
      app.ticker.maxFPS = MAX_FPS;
      app.ticker.add(tick);
      state.app = app;
      state.viewport = new Container();
      app.stage.addChild(state.viewport);
      state.library = createLibrary();
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
    wake();
  };
  window.addEventListener('resize', onWindowResize);
  const lose = (event) => { event.preventDefault(); state.lost = true; sync(); onContextLost?.(); };
  const restore = () => { state.lost = false; wake(); onContextRestored?.(); };
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
        people: state.office ? state.office.people.size : 0, ready: Boolean(state.office),
      };
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onWindowResize);
      canvas.removeEventListener('webglcontextlost', lose);
      canvas.removeEventListener('webglcontextrestored', restore);
      state.app?.ticker.stop();
      state.office?.dispose();
      state.library?.dispose();
      state.app?.destroy(false, { children: true, texture: false });
      state.app = null;
      state.office = null;
    },
  };
}
