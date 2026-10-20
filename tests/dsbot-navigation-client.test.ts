import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { sanitizeSnapshot } from '../host/native-navigation.mjs';

type Props = Record<string, unknown>;
type ReactElement = { type: unknown; props: Props };
type ClientModule = { id: string; factory: (require: (name: string) => unknown) => unknown };

const kebab: Record<string, string> = {
  strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule',
};

/** The tree DOM would hold after React renders: tag, attributes and children, nothing else. */
class FakeElement {
  tagName: string;
  attributes: Record<string, string>;
  children: FakeElement[];
  constructor(tagName: string, attributes: Record<string, string>, children: FakeElement[]) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.children = children;
  }
  getAttribute(name: string) { return name in this.attributes ? this.attributes[name] : null; }
  hasAttribute(name: string) { return name in this.attributes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  /** A comma-separated list of tag names, as the client asks; `*` is every descendant. */
  private matches(selector: string) {
    return selector.split(',').map((part) => part.trim()).some((part) => part === '*' || part === this.tagName);
  }
  querySelector(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  cloneNode(): FakeElement {
    return new FakeElement(this.tagName, { ...this.attributes }, this.children.map((child) => child.cloneNode()));
  }
  get outerHTML(): string {
    const attributes = Object.entries(this.attributes).map(([key, value]) => ` ${key}="${value}"`).join('');
    return `<${this.tagName}${attributes}>${this.children.map((child) => child.outerHTML).join('')}</${this.tagName}>`;
  }
}

function render(node: unknown): FakeElement[] {
  if (Array.isArray(node)) return node.flatMap(render);
  if (typeof node !== 'object' || node === null || !('props' in node)) return [];
  const element = node as ReactElement;
  if (typeof element.type === 'function') return render((element.type as (props: Props) => unknown)(element.props));
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(element.props)) {
    if (key === 'children' || value === undefined) continue;
    attributes[kebab[key] ?? key] = String(value);
  }
  return [new FakeElement(String(element.type), attributes, render(element.props.children))];
}

/** DSH's icon components: a stroke icon whose svg root carries fill="none" and the stroke width. */
const Line = ({ size = 16, strokeWidth = 1.3 }: Props) => ({
  type: 'svg',
  props: {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', strokeWidth,
    children: [
      { type: 'path', props: { d: 'M6 8.25C7.5 8.25 8.75 7 8.75 5.5Z', stroke: 'currentColor' } },
      { type: 'path', props: { d: 'M1 14.5C1 11.5 3.5 10.25 6 10.25', stroke: 'currentColor' } },
    ],
  },
});
const Solid = () => ({
  type: 'svg',
  props: {
    viewBox: '0 0 24 24',
    children: [{
      type: 'g', props: {
        fill: 'var(--dsw-icon)',
        children: [{ type: 'circle', props: { cx: 12, cy: 12, r: 6 } },
          { type: 'defs', props: { children: [{ type: 'path', props: { d: 'M0 0' } }] } }],
      },
    }],
  },
});

/** What dsh-context's sidebar icon is: a full square in the ink, cut into bars by a mask. Read as shapes it is a block. */
const Masked = () => ({
  type: 'svg',
  props: {
    viewBox: '0 0 1024 1024',
    children: [
      { type: 'defs', props: { children: [{ type: 'mask', props: { id: 'bars', children: [
        { type: 'rect', props: { width: 1024, height: 1024, fill: '#fff' } },
        { type: 'rect', props: { x: 80, y: 20, width: 100, height: 980, fill: '#000' } },
      ] } }] } },
      { type: 'rect', props: { width: 1024, height: 1024, fill: 'currentColor', mask: 'url(#bars)' } },
    ],
  },
});
const Clipped = () => ({
  type: 'svg',
  props: {
    viewBox: '0 0 16 16',
    children: [{ type: 'g', props: { 'clip-path': 'url(#frame)', children: [{ type: 'circle', props: { cx: 8, cy: 8, r: 8 } }] } }],
  },
});
const Gradient = () => ({
  type: 'svg',
  props: { viewBox: '0 0 16 16', children: [{ type: 'rect', props: { width: 16, height: 16, fill: 'url(#sheen)' } }] },
});

/** A real PNG header of the given size, which is all the host checks. */
function pngBase64(width = 64, height = 64) {
  const bytes = Buffer.alloc(45);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write('IEND', 37, 'latin1');
  return bytes.toString('base64');
}

async function setup({
  page = false, failDock = false, developerTools = true, rejectFirst = false,
  sidebarIcons = [] as Array<{ id: string; component: unknown }>, drawingFails = false,
} = {}) {
  const source = await readFile(new URL('../host/dsbot-plugin/client.js', import.meta.url), 'utf8');
  const posts: Array<{ path: string; body: Record<string, any> }> = [];
  // A virtual clock, so timers fire in the order and at the times a browser would run them.
  const timers = new Map<number, { fn: () => void; ms: number; due: number; repeat: boolean }>();
  let timerId = 0;
  let now = 0;
  const listeners = new Map<string, Set<() => void>>();
  const on = (name: string) => (listener: () => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
    return () => { set.delete(listener); };
  };

  const entries = new Map<string, Array<{ options: Props; component?: unknown; registrant?: string }>>([
    ['sidebar.panellist', [
      { options: { id: 'schedules', order: 10, label: () => '自动化任务' }, component: Line, registrant: '@deepseek-ai/dsh-client-ui-schedule' },
      { options: { id: 'plugins', order: 0, label: () => '插件' }, component: Line },
      { options: { id: 'insight', order: 20, label: () => '上下文洞察' }, component: Solid, registrant: 'example-insight' },
      ...sidebarIcons.map(({ id, component }, index) => ({ options: { id, order: 30 + index, label: () => id }, component })),
    ]],
    ['conversation.view', [
      { options: { id: 'chat', order: 0, label: () => '对话' } },
      { options: { id: 'trajectory', order: 10, label: () => '轨迹' } },
      { options: { id: 'notes', order: 40, label: '笔记' }, registrant: 'example-notes' },
    ]],
    ['settings.section', [
      { options: { id: 'models', order: 10, label: () => '模型' } },
      { options: { id: 'misc', order: 20, label: () => '其他' } },
      { options: { id: 'dsbot-mobile-control', order: 50, label: () => '手机控制' } },
    ]],
  ]);
  const guide = [
    { kind: 'files', id: 'workspace', commandId: 'workspace.files', order: 10, title: () => '工作区文件', providerId: 'files-pkg' },
    { kind: 'terminal', id: 'new', order: 20, title: () => '新建终端', providerId: 'terminal-pkg' },
  ];
  const requireModule = (name: string): unknown => {
    switch (name) {
      case 'react': return {
        createElement: (type: unknown, props: Props | null, ...children: unknown[]) => ({ type, props: { ...(props ?? {}), children } }),
        useEffect() {}, useRef: (initial: unknown) => ({ current: initial }), useState: (initial: unknown) => [initial, () => {}],
      };
      case '@deepseek-ai/dsh-client-ui-primitives': return {
        Button() { return null; }, Input() { return null; },
        IconDataOutlineMedium: Line, IconSettingsOutlineMedium: Solid,
      };
      case '@deepseek-ai/dsh-client-ui-slots': return {
        resolveSlotLabel(value: unknown) { return typeof value === 'function' ? (value as () => string)() : value; },
      };
      case 'react-dom': return { flushSync: (callback: () => void) => callback() };
      case 'react-dom/client': return {
        createRoot(container: { children: FakeElement[]; querySelector: (selector: string) => FakeElement | null }) {
          return {
            render(element: unknown) { container.children = render(element); },
            unmount() { container.children = []; },
          };
        },
      };
      default: throw new Error(`unexpected client external: ${name}`);
    }
  };

  let plugin: { apply: (ctx: unknown) => void } | undefined;
  const window: Record<string, unknown> = {
    __ModuleLoader__: { load(module: ClientModule) { plugin = module.factory(requireModule) as typeof plugin; } },
  };
  if (page) window.__DSBOT_PAGE__ = { id: 'page', kind: 'trace' };
  // What the browser would be asked to draw, and what it answers.
  const drawn: string[] = [];
  const canvases: Array<{ width: number; height: number }> = [];
  class FakeImage {
    onload?: () => void;
    onerror?: () => void;
    set src(value: string) {
      drawn.push(decodeURIComponent(value.slice(value.indexOf(',') + 1)));
      queueMicrotask(() => (drawingFails ? this.onerror?.() : this.onload?.()));
    }
  }
  const context = vm.createContext({
    window, URL, Date, JSON, Array, Object, Number, String, Math, Promise, encodeURIComponent, queueMicrotask,
    Image: FakeImage,
    XMLSerializer: class { serializeToString(element: FakeElement) { return element.outerHTML; } },
    document: {
      baseURI: 'http://localhost/',
      head: { appendChild() {} },
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          const canvas = {
            width: 0, height: 0,
            getContext: () => ({ drawImage() {} }),
            toDataURL: () => `data:image/png;base64,${pngBase64(canvas.width, canvas.height)}`,
          };
          canvases.push(canvas);
          return canvas;
        }
        return {
          children: [] as FakeElement[], textContent: '', remove() {},
          querySelector(selector: string) {
            for (const child of this.children) {
              const found = child.querySelector(selector);
              if (found) return found;
            }
            return null;
          },
        };
      },
    },
    setTimeout: (fn: () => void, ms: number) => { timers.set(++timerId, { fn, ms, due: now + ms, repeat: false }); return timerId; },
    clearTimeout: (id: number) => { timers.delete(id); },
    setInterval: (fn: () => void, ms: number) => { timers.set(++timerId, { fn, ms, due: now + ms, repeat: true }); return timerId; },
    clearInterval: (id: number) => { timers.delete(id); },
    fetch: async (path: string, init: { body: string }) => {
      posts.push({ path, body: JSON.parse(init.body) });
      if (rejectFirst && posts.length === 1) return { ok: false, json: async () => ({ error: 'host restarting' }) };
      return { ok: true, json: async () => ({ changed: true }) };
    },
  });
  vm.runInContext(source, context);
  assert.ok(plugin);

  const effects: Array<() => unknown> = [];
  const disposers: Array<() => void> = [];
  const ctx = {
    effect(callback: () => unknown) { effects.push(callback); const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose as () => void); },
    slots: {
      inject() {}, register() { return () => {}; },
      entries: (name: string) => entries.get(name) ?? [],
      entriesOfSlot: (name: string) => entries.get(name) ?? [],
      subscribe: (name: string, listener: () => void) => on(name)(listener),
    },
    locale: { subscribe: on('locale') },
    configForms: { developerTools: { enabled: { getSnapshot: () => developerTools, subscribe: on('developerTools') } } },
    sidebarRightTabs: {
      guide: () => { if (failDock) throw new Error('registry unavailable'); return guide; },
      subscribe: on('dock'),
    },
  };
  plugin.apply(ctx);

  /** Let `ms` of browser time pass, running each timer when it falls due, then settle the requests. */
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      const [id, timer] = next;
      now = timer.due;
      if (timer.repeat) timer.due += timer.ms; else timers.delete(id);
      timer.fn();
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    }
    now = target;
  };
  const debounced = () => [...timers.values()].filter((timer) => !timer.repeat && timer.ms === 500).length;
  return { posts, advance, listeners, entries, guide, disposers, timers, debounced, drawn, canvases };
}

test('DSH reports its real registries: labels, icons, views and dock entries, in a snapshot the plugin accepts', async () => {
  const { posts, advance } = await setup();
  await advance(600);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/api/dsbot/nav');
  const snapshot = posts[0].body;
  assert.equal(snapshot.schemaVersion, 1);

  assert.deepEqual(snapshot.sidebar.map((item: any) => [item.id, item.title, item.order, item.source]), [
    ['schedules', '自动化任务', 10, '@deepseek-ai/dsh-client-ui-schedule'],
    ['plugins', '插件', 0, undefined],
    ['insight', '上下文洞察', 20, 'example-insight'],
  ]);
  // A stroke icon keeps what its svg root declares for its shapes.
  assert.deepEqual(snapshot.sidebar[0].icon, {
    viewBox: [0, 0, 16, 16],
    nodes: [
      { tag: 'path', d: 'M6 8.25C7.5 8.25 8.75 7 8.75 5.5Z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
      { tag: 'path', d: 'M1 14.5C1 11.5 3.5 10.25 6 10.25', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
    ],
  });
  // A solid icon: groups are flattened, unsupported elements dropped, a css variable becomes currentColor.
  assert.deepEqual(snapshot.sidebar[2].icon, {
    viewBox: [0, 0, 24, 24],
    nodes: [{ tag: 'circle', cx: 12, cy: 12, r: 6, fill: 'currentColor', stroke: 'none' }],
  });

  assert.deepEqual(snapshot.views.map((item: any) => [item.id, item.title]), [
    ['chat', '对话'], ['trajectory', '轨迹'], ['notes', '笔记'],
  ]);
  assert.deepEqual(snapshot.dock, [
    { kind: 'files', entryId: 'workspace', commandId: 'workspace.files', title: '工作区文件', order: 10, source: 'files-pkg' },
    { kind: 'terminal', entryId: 'new', commandId: undefined, title: '新建终端', order: 20, source: 'terminal-pkg' },
  ].map((item) => JSON.parse(JSON.stringify(item))));

  // Settings icons follow DSH's own mapping by section id, with its gear for the rest.
  assert.deepEqual(snapshot.settings.map((item: any) => [item.id, item.title, item.icon?.viewBox?.join(',')]), [
    ['models', '模型', '0,0,16,16'],
    ['misc', '其他', '0,0,24,24'],
    ['dsbot-mobile-control', '手机控制', '0,0,24,24'],
  ]);

  // And the plugin keeps it, routed for the phone.
  const lists = sanitizeSnapshot(snapshot);
  assert.deepEqual(lists?.sidebar.map((item: any) => item.open), [
    { web: { page: 'plugins' } },
    { native: 'schedule', web: { page: 'panel', target: 'schedules' } },
    { web: { page: 'panel', target: 'insight' } },
  ]);
  assert.deepEqual(lists?.views.map((item: any) => item.open), [
    { native: 'chat' }, { web: { page: 'trace' } }, { web: { page: 'view', target: 'notes' } },
  ]);
  assert.deepEqual(lists?.dock.map((item: any) => [item.id, item.open]), [
    ['files:workspace', { native: 'files' }],
    ['terminal:new', { web: { page: 'dock', target: 'terminal:new' } }],
  ]);
  assert.deepEqual(lists?.settings.map((item: any) => item.id), ['models', 'misc']);
});

test('a plugin that adds a tab or a panel later reaches the phone without any app change', async () => {
  const { posts, advance, listeners, entries } = await setup();
  await advance(600);
  assert.equal(posts.length, 1);

  entries.get('conversation.view')!.push({ options: { id: 'board', order: 50, label: () => '看板' } });
  entries.get('sidebar.panellist')!.push({ options: { id: 'new-panel', order: 30, label: () => '新面板' }, component: Line });
  for (const name of ['conversation.view', 'sidebar.panellist']) [...(listeners.get(name) ?? [])].forEach((listener) => listener());
  await advance(600);

  assert.equal(posts.length, 2);
  assert.ok(posts[1].body.views.some((item: any) => item.id === 'board' && item.title === '看板'));
  assert.ok(posts[1].body.sidebar.some((item: any) => item.id === 'new-panel' && item.icon));
});

test('a burst of registry changes becomes one report, and an unchanged registry reports nothing', async () => {
  const { posts, advance, listeners, debounced, entries } = await setup();
  await advance(600);
  assert.equal(posts.length, 1);

  for (let index = 0; index < 5; index += 1) {
    [...(listeners.get('conversation.view') ?? [])].forEach((listener) => listener());
  }
  assert.equal(debounced(), 1, 'the debounce timer is restarted, not stacked');
  await advance(600);
  assert.equal(posts.length, 1, 'nothing differs from what the plugin already has');

  // While DSH is still loading plugins the module looks again; unchanged lists still cost nothing.
  await advance(30_000);
  assert.equal(posts.length, 1);

  entries.get('conversation.view')!.pop();
  [...(listeners.get('conversation.view') ?? [])].forEach((listener) => listener());
  [...(listeners.get('conversation.view') ?? [])].forEach((listener) => listener());
  await advance(600);
  assert.equal(posts.length, 2);
});

test('a refused report is retried by the periodic refresh', async () => {
  const { posts, advance } = await setup({ rejectFirst: true });
  await advance(600);
  assert.equal(posts.length, 1);
  await advance(5 * 60 * 1000);
  assert.equal(posts.length, 2, 'the same snapshot is sent again once the host answers');
});

test('the Trajectory tab is left out while developer tools are off, as in DSH itself', async () => {
  const { posts, advance } = await setup({ developerTools: false });
  await advance(600);
  assert.deepEqual(posts[0].body.views.map((item: any) => item.id), ['chat', 'notes']);
});

test('one unreadable registry does not stop the others from being reported', async () => {
  const { posts, advance } = await setup({ failDock: true });
  await advance(600);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.dock, undefined, 'the plugin keeps the dock list it already has');
  assert.ok(posts[0].body.sidebar.length > 0);
  assert.ok(posts[0].body.views.length > 0);
});

test('phone pages that run this module inside their own frontend never report', async () => {
  const { posts, advance, timers } = await setup({ page: true });
  await advance(60_000);
  assert.equal(posts.length, 0);
  assert.equal(timers.size, 0);
});

test('disposing the module stops its timers and unsubscribes from DSH', async () => {
  const { disposers, timers, listeners } = await setup();
  assert.ok(timers.size > 0);
  for (const dispose of disposers) dispose();
  assert.equal(timers.size, 0);
  for (const set of listeners.values()) assert.equal(set.size, 0);
});


test('an icon the shapes cannot express is drawn by the browser and sent as a picture, never as a solid block', async () => {
  const { posts, advance, drawn, canvases } = await setup({
    sidebarIcons: [
      { id: 'masked', component: Masked }, { id: 'clipped', component: Clipped }, { id: 'sheen', component: Gradient },
    ],
  });
  await advance(600);
  assert.equal(posts.length, 1);
  const sidebar = Object.fromEntries(posts[0].body.sidebar.map((item: any) => [item.id, item.icon]));

  for (const id of ['masked', 'clipped', 'sheen']) {
    assert.equal(sidebar[id].nodes.length, 0, `${id}: no shapes to draw as a block`);
    assert.equal(sidebar[id].png, pngBase64(64, 64), `${id}: the browser's drawing`);
    assert.deepEqual([sidebar[id].width, sidebar[id].height], [64, 64]);
  }
  assert.deepEqual(sidebar.masked.viewBox, [0, 0, 64, 64]);
  assert.equal(drawn.length, 3);
  // It is drawn in black, at the size the phone wants, from a copy that keeps the mask.
  assert.match(drawn[0], /color:#000/u);
  assert.match(drawn[0], /<mask id="bars">/u);
  assert.match(drawn[0], /viewBox="0 0 1024 1024"/u);
  assert.deepEqual(canvases.map((canvas) => [canvas.width, canvas.height]), [[64, 64], [64, 64], [64, 64]]);

  // The plain icons next to it are still shapes.
  assert.ok(sidebar.plugins.nodes.length > 0);
  assert.equal(sidebar.plugins.png, undefined);
  assert.equal(sidebar.insight.png, undefined);

  // And the plugin keeps the picture.
  const lists = sanitizeSnapshot(posts[0].body);
  const masked = lists?.sidebar.find((item: any) => item.id === 'masked');
  assert.equal(masked?.icon?.png, pngBase64(64, 64));
});

test('an icon the browser cannot draw is left out, so the phone shows its own glyph instead of a block', async () => {
  const { posts, advance } = await setup({ sidebarIcons: [{ id: 'masked', component: Masked }], drawingFails: true });
  await advance(600);
  const item = posts[0].body.sidebar.find((entry: any) => entry.id === 'masked');
  assert.ok(item, 'the entry itself is still listed');
  assert.equal(item.icon, undefined);
  assert.ok(posts[0].body.sidebar.find((entry: any) => entry.id === 'plugins').icon, 'the others keep theirs');
});

test('a drawn icon is remembered, so a later report does not draw it again', async () => {
  const { posts, advance, drawn, listeners, entries } = await setup({ sidebarIcons: [{ id: 'masked', component: Masked }] });
  await advance(600);
  assert.equal(drawn.length, 1);
  entries.get('conversation.view')!.pop();
  [...(listeners.get('conversation.view') ?? [])].forEach((listener) => listener());
  await advance(600);
  assert.equal(posts.length, 2);
  assert.equal(drawn.length, 1, 'the same markup is not drawn twice');
  assert.equal(posts[1].body.sidebar.find((entry: any) => entry.id === 'masked').icon.png, pngBase64(64, 64));
});

test('only a handful of icons are ever drawn, so a plugin cannot make the report grow without limit', async () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    id: `m${index}`,
    // Each differs, so none is a cache hit.
    component: () => ({ type: 'svg', props: { viewBox: '0 0 16 16', children: [
      { type: 'rect', props: { width: 16 - index, height: 16, fill: 'currentColor', mask: 'url(#a)' } }] } }),
  }));
  const { posts, advance, drawn } = await setup({ sidebarIcons: many });
  await advance(600);
  assert.equal(drawn.length, 12);
  const withPicture = posts[0].body.sidebar.filter((item: any) => item.icon?.png);
  assert.equal(withPicture.length, 12);
  assert.ok(Buffer.byteLength(JSON.stringify(posts[0].body), 'utf8') < 512 * 1024, 'it fits what the host accepts');
});
