import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { MOBILE_PAGE_SCRIPT } from '../host/mobile-page-adapter.mjs';

function pluginPanel({ busy = false, marker = null, loading = false } = {}) {
  return {
    getAttribute(name) {
      return name === 'aria-busy' ? String(busy) : null;
    },
    querySelector(selector) {
      if (selector === '[data-plugin-loading]') return loading ? {} : null;
      if (selector.startsWith('[data-plugin-package]')) {
        return marker === 'package' ? {} : null;
      }
      if (selector === '[data-plugin-group] li, [data-plugin-group] button') {
        return marker === 'group' ? {} : null;
      }
      if (selector === '[class*="_empty"]') return marker === 'empty' ? {} : null;
      if (selector === '[role="alert"]') return marker === 'error' ? {} : null;
      if (selector === '[role="status"]') return marker === 'status' ? {} : null;
      return null;
    },
  };
}

function createHarness(initialPanel = null) {
  let currentPanel = initialPanel;
  let onMutation;
  let readyCount = 0;
  let failCount = 0;
  let timerID = 0;
  const body = {};
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId: 'plugins' }) },
    selectPanel() {},
  };
  const ui = { ctx: { get: (name) => name === 'layout' ? layout : null } };
  const document = {
    body,
    documentElement: { dataset: {} },
    querySelector(selector) {
      if (selector === '[data-slot="main"]') return { textContent: 'Plugins' };
      if (selector === '[data-plugin-panel]') return currentPanel;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
  };
  class TestMutationObserver {
    constructor(callback) { onMutation = callback; }
    observe() {}
    disconnect() {}
  }
  const window = {
    __DSBOT_PAGE__: { kind: 'plugins' },
    __DSBOT_APP_UI__: ui,
    __DSBOT_NATIVE__: {
      ready() { readyCount += 1; },
      fail() { failCount += 1; },
    },
    addEventListener() {},
    removeEventListener() {},
  };

  runInNewContext(MOBILE_PAGE_SCRIPT, {
    window,
    document,
    MutationObserver: TestMutationObserver,
    performance: { now: () => 0 },
    queueMicrotask: (callback) => Promise.resolve().then(callback),
    setTimeout: () => ++timerID,
    clearTimeout() {},
    console,
  });

  return {
    get readyCount() { return readyCount; },
    get failCount() { return failCount; },
    async settle() {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    },
    async update(panel) {
      currentPanel = panel;
      onMutation?.([]);
      await this.settle();
    },
  };
}

test('plugin readiness ignores main-area text and the loading skeleton', async () => {
  const harness = createHarness();
  await harness.settle();
  assert.equal(harness.readyCount, 0, 'the page heading alone is not ready');

  await harness.update(pluginPanel({ busy: true, loading: true }));
  assert.equal(harness.readyCount, 0, 'a busy plugin panel with its skeleton is not ready');

  await harness.update(pluginPanel({ loading: true }));
  assert.equal(harness.readyCount, 0, 'the skeleton marker blocks readiness during a state transition');

  await harness.update(pluginPanel());
  assert.equal(harness.readyCount, 0, 'an empty panel without a settled state is not ready');
  assert.equal(harness.failCount, 0, 'readiness remains pending until the normal route deadline');
});

test('plugin readiness accepts loaded plugin cards and groups', async () => {
  const harness = createHarness();
  await harness.settle();
  await harness.update(pluginPanel({ marker: 'package' }));
  assert.equal(harness.readyCount, 1);

  const groupedHarness = createHarness();
  await groupedHarness.settle();
  await groupedHarness.update(pluginPanel({ marker: 'group' }));
  assert.equal(groupedHarness.readyCount, 1);
});

test('plugin readiness accepts the settled empty and error states', async () => {
  for (const marker of ['empty', 'error', 'status']) {
    const harness = createHarness();
    await harness.settle();
    await harness.update(pluginPanel({ marker }));
    assert.equal(harness.readyCount, 1, `${marker} state should settle the route`);
  }
});

function createSettingsHarness({ target = 'market', delayedSelection = false } = {}) {
  let now = 0;
  let readyCount = 0;
  let failCount = 0;
  let observed: unknown;
  let mutation: (() => void) | undefined;
  let timerID = 0;
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, Set<(event: { detail?: unknown }) => void>>();
  const state = { open: true, active: 'market', requested: '', openCount: 0 };
  const sections = ['market', 'models'].map(id => ({ options: { id, label: id } }));
  const body = {};
  const sectionBody = { setAttribute() {}, querySelector() { return null; } };
  const buttons = sections.map(({ options: { id } }) => ({
    textContent: id,
    getAttribute(name: string) { return name === 'aria-current' ? String(state.active === id) : null; },
    click() {
      state.requested = id;
      if (!delayedSelection) state.active = id;
    },
  }));
  const dialog = {
    querySelector(selector: string) {
      if (selector === '[class*="_content"]' || selector === '[data-dsbot-settings-body]') return sectionBody;
      if (selector === 'nav') return { setAttribute() {}, querySelectorAll: () => buttons };
      return null;
    },
    querySelectorAll(selector: string) { return selector === 'nav button' ? buttons : []; },
  };
  const shell = { actions: {
    open() { state.open = true; state.openCount += 1; },
    openSection(id: string) { state.open = true; state.active = id; state.openCount += 1; },
  } };
  const slots = { entries(name: string) {
    if (name === 'settings.section') return sections;
    if (name === 'sidebar.settings') return [{ store: { create: () => shell } }];
    return [];
  } };
  const document = {
    body,
    documentElement: { dataset: {} },
    querySelector(selector: string) {
      return selector === '[data-shortcut-modal="settings"]' && state.open ? dialog : null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
  };
  class SettingsObserver {
    constructor(callback: () => void) { mutation = callback; }
    observe(target: unknown) { observed = target; }
    disconnect() { observed = undefined; }
  }
  const window = {
    __DSBOT_PAGE__: { kind: 'settings', target },
    __DSBOT_MOBILE_PAGE_ADAPTER__: undefined as { close: () => void } | undefined,
    __DSBOT_APP_UI__: { ctx: { slots, get: (name: string) => name === 'slots' ? slots : null } },
    __DSBOT_NATIVE__: {
      ready() { readyCount += 1; },
      fail() { failCount += 1; },
      settingsCategories() {},
    },
    addEventListener(name: string, callback: (event: { detail?: unknown }) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
    },
    removeEventListener(name: string, callback: (event: { detail?: unknown }) => void) {
      listeners.get(name)?.delete(callback);
    },
  };
  runInNewContext(MOBILE_PAGE_SCRIPT, {
    window, document, MutationObserver: SettingsObserver, performance: { now: () => now },
    queueMicrotask: (callback: () => void) => Promise.resolve().then(callback),
    setTimeout: (callback: () => void) => { timers.set(++timerID, callback); return timerID; },
    clearTimeout: (id: number) => timers.delete(id), console,
  });
  const settle = async () => { for (let index = 0; index < 16; index += 1) await Promise.resolve(); };
  return {
    state,
    get readyCount() { return readyCount; },
    get failCount() { return failCount; },
    settle,
    fire(name: string, detail?: unknown) { listeners.get(name)?.forEach(callback => callback({ detail })); },
    async closeDialog() {
      state.open = false;
      if (observed === body) mutation?.();
      await settle();
    },
    async step(milliseconds = 200) {
      now += milliseconds;
      if (observed === body || (observed === dialog && state.open)) mutation?.();
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach(callback => callback());
      await settle();
    },
    close() { window.__DSBOT_MOBILE_PAGE_ADAPTER__!.close(); },
  };
}

test('settings restores its requested section when the dialog disappears after a failed market request', async () => {
  const harness = createSettingsHarness();
  await harness.settle();
  assert.equal(harness.readyCount, 1);
  await harness.closeDialog();
  await harness.step();
  assert.equal(harness.state.open, true, 'removing the dialog must restore settings instead of exposing the DSH home');
  assert.equal(harness.state.active, 'market');
  assert.equal(harness.readyCount, 2);
  assert.equal(harness.failCount, 0);
});

test('returning to hidden settings restores the same category and waits for its selection to render', async () => {
  const harness = createSettingsHarness({ delayedSelection: true });
  await harness.settle();
  harness.fire('dsbot:visibility', false);
  await harness.closeDialog();
  assert.equal(harness.state.open, false, 'a hidden page does not reopen its dialog');
  harness.state.active = 'models';
  harness.fire('dsbot:visibility', true);
  await harness.step();
  assert.equal(harness.state.open, true);
  assert.equal(harness.state.requested, 'market');
  assert.equal(harness.readyCount, 1, 'a different settings category is not ready');
  harness.state.active = 'market';
  await harness.step();
  assert.equal(harness.readyCount, 2);
});

test('an unavailable settings section never reports another category as ready', async () => {
  const harness = createSettingsHarness({ target: 'removed-plugin' });
  await harness.settle();
  assert.equal(harness.readyCount, 0);
  await harness.step(28_001);
  assert.equal(harness.failCount, 1);
});

test('closing the settings adapter cancels recovery and ignores later visibility events', async () => {
  const harness = createSettingsHarness();
  await harness.settle();
  harness.close();
  await harness.closeDialog();
  harness.fire('dsbot:visibility', true);
  await harness.step(30_000);
  assert.equal(harness.state.open, false);
  assert.equal(harness.readyCount, 1);
  assert.equal(harness.failCount, 0);
});

type Tab = { label: string; selected: boolean };

/** Runs the adapter against a stand-in DSH frontend whose clock and mutations the test controls. */
function createRouteHarness({
  page, services = {}, views = [], tabs = [] as Tab[], content = false, rightbar = false,
  groups = [] as unknown[], toolbarButtons = [] as unknown[],
} = {}) {
  let now = 0;
  const listeners: Record<string, Array<(event: { detail?: unknown }) => void>> = {};
  let onMutation: ((records: unknown[]) => void) | undefined;
  let readyCount = 0;
  const timers: Array<() => void> = [];
  const state = {
    content, rightbar,
    tabs, focused: null as unknown, appended: [] as any[],
  };
  const rightbarNode = {
    contains: () => false,
    querySelectorAll: () => [],
  };
  const documentListeners: Record<string, Array<() => void>> = {};
  const rootAttributes: Record<string, string> = {};
  const element = (tag: string) => {
    const node: any = {
      tag, children: [] as any[], style: {}, attributes: {} as Record<string, string>,
      listeners: {} as Record<string, Array<(event: unknown) => void>>, textContent: '', type: '', removed: false,
      setAttribute(name: string, value: string) { node.attributes[name] = value; },
      addEventListener(name: string, listener: (event: unknown) => void) { (node.listeners[name] ??= []).push(listener); },
      appendChild(child: unknown) { node.children.push(child); return child; },
      remove() { node.removed = true; },
    };
    return node;
  };
  const tabNodes = () => state.tabs.map((tab) => ({
    disabled: false,
    innerText: tab.label,
    textContent: tab.label,
    getAttribute: (name: string) => name === 'aria-selected' ? String(tab.selected) : null,
    click() { for (const other of state.tabs) other.selected = other === tab; },
  }));
  const ui = {
    ctx: {
      get: (name: string) => {
        const value = (services as Record<string, unknown>)[name];
        return name === 'sidebarRight' && value
          ? { active: () => ({ id: 'active-tab' }), ...value }
          : value ?? null;
      },
      slots: { entries: (name: string) => name === 'conversation.view' ? views : [] },
    },
  };
  const document = {
    body: { appendChild(node: unknown) { state.appended.push(node); } },
    documentElement: {
      dataset: {} as Record<string, string>,
      toggleAttribute(name: string, force: boolean) { if (force) rootAttributes[name] = ''; else delete rootAttributes[name]; },
    },
    get activeElement() { return state.focused; },
    createElement: element,
    querySelector(selector: string) {
      if (selector === '[data-conversation-content]') return state.content ? {} : null;
      if (selector === '[data-dsbot-rightbar]') return state.rightbar ? rightbarNode : null;
      if (selector.includes('> header [class*="_toolbar"]')) {
        return toolbarButtons.length ? { querySelectorAll: () => toolbarButtons } : null;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector.includes('role="tab"')) return tabNodes();
      if (selector.includes('[role="group"]')) return groups;
      return [];
    },
    addEventListener(name: string, listener: () => void) { (documentListeners[name] ??= []).push(listener); },
    removeEventListener() {},
  };
  class TestMutationObserver {
    constructor(callback: () => void) { onMutation = callback; }
    observe() {}
    disconnect() {}
  }
  const window = {
    __DSBOT_PAGE__: page,
    __DSBOT_APP_UI__: ui,
    __DSBOT_NATIVE__: { ready() { readyCount += 1; }, fail() {} },
    addEventListener(name: string, listener: (event: { detail?: unknown }) => void) {
      (listeners[name] ??= []).push(listener);
    },
    removeEventListener() {},
  };
  runInNewContext(MOBILE_PAGE_SCRIPT, {
    window, document, MutationObserver: TestMutationObserver,
    performance: { now: () => now },
    queueMicrotask: (callback: () => void) => Promise.resolve().then(callback),
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
    clearTimeout() {},
    console,
  });
  const settle = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
  return {
    state,
    get readyCount() { return readyCount; },
    get dataset() { return document.documentElement.dataset; },
    get rootAttributes() { return rootAttributes; },
    /** The page itself dispatches an event, as focus moving would. */
    dispatchOnDocument(name: string) { (documentListeners[name] ?? []).forEach((listener) => listener()); },
    /** The app dispatches an event into the page, as `evaluateJavaScript` does. */
    fire(name: string, detail?: unknown) { (listeners[name] ?? []).forEach((listener) => listener({ detail })); },
    settle,
    /** The page changes (DSH rendered something), then `ms` pass and the adapter looks again. */
    async step(ms: number, { mutate = true } = {}) {
      if (mutate) onMutation?.([{ target: rightbarNode }]);
      now += ms;
      timers.splice(0).forEach((callback) => callback());
      await settle();
    },
  };
}

test('a sidebar panel from another plugin is selected by its id and is ready once DSH has stopped drawing it', async () => {
  const selected: string[] = [];
  let active = 'plugins';
  const harness = createRouteHarness({
    page: { kind: 'panel', target: 'insight' },
    services: {
      layout: {
        panelInfo: { getSnapshot: () => ({ activePanelId: active }) },
        selectPanel(id: string) { selected.push(id); active = id; },
      },
    },
  });
  await harness.settle();
  assert.deepEqual(selected, ['insight']);
  assert.equal(harness.readyCount, 0);
  assert.equal(harness.dataset.dsbotPageKind, 'panel');
  assert.equal('dsbotPageSession' in harness.dataset, false);

  await harness.step(200);
  assert.equal(harness.readyCount, 0, 'DSH was still drawing the panel a moment ago');
  await harness.step(600, { mutate: false });
  assert.equal(harness.readyCount, 1);
});

test('a conversation view from another plugin is opened in its session and picked by the label DSH gives it', async () => {
  const opened: string[] = [];
  const tabs: Tab[] = [{ label: '对话', selected: true }, { label: '笔记', selected: false }];
  const harness = createRouteHarness({
    page: { kind: 'view', sessionId: 'session-1', target: 'notes' },
    services: { uiWorkspace: { async openSession(id: string) { opened.push(id); } } },
    views: [
      { options: { id: 'chat', label: () => '对话' } },
      { options: { id: 'notes', label: () => '笔记' } },
    ],
    tabs,
  });
  assert.equal('dsbotPageSession' in harness.dataset, true, 'the conversation chrome is hidden like the other session pages');
  await harness.settle();
  assert.deepEqual(opened, ['session-1']);
  await harness.step(200);
  assert.equal(tabs[1].selected, true, 'the plugin tab was clicked');
  assert.equal(harness.readyCount, 0, 'its content has not appeared yet');

  harness.state.content = true;
  await harness.step(100);
  assert.equal(harness.readyCount, 0, 'and it has not stopped changing');
  await harness.step(600, { mutate: false });
  assert.equal(harness.readyCount, 1);
});

test('a view that DSH does not list for this session never becomes ready', async () => {
  const tabs: Tab[] = [{ label: '对话', selected: true }];
  const harness = createRouteHarness({
    page: { kind: 'view', sessionId: 'session-1', target: 'missing' },
    services: { uiWorkspace: { async openSession() {} } },
    views: [{ options: { id: 'chat', label: () => '对话' } }],
    tabs,
    content: true,
  });
  await harness.settle();
  await harness.step(5000);
  assert.equal(harness.readyCount, 0);
  assert.equal(tabs[0].selected, true);
});

test("the toolbar's + presses DSH's add-plugin button although the page's own header is hidden on the phone", async () => {
  let added = 0;
  const primary = { disabled: false, click() { added += 1; } };
  const group = {
    getAttribute: (name: string) => (name === 'aria-label' ? '添加插件' : null),
    querySelector: (selector: string) => (selector === 'button' ? primary : null),
  };
  const harness = createRouteHarness({ page: { kind: 'plugins' }, groups: [group] });
  await harness.settle();

  harness.fire('dsbot:command', 'add');
  assert.equal(added, 1);
  harness.fire('dsbot:command', 'refresh');
  harness.fire('dsbot:command', undefined);
  assert.equal(added, 1, 'only the add command does anything');

  primary.disabled = true;
  harness.fire('dsbot:command', 'add');
  assert.equal(added, 1, 'a disabled button is left alone');
});

test('while an install runs the plus reaches the button that reopens its progress', async () => {
  const clicked: string[] = [];
  const refresh = { disabled: false, click() { clicked.push('refresh'); } };
  const progress = { disabled: false, click() { clicked.push('progress'); } };
  const harness = createRouteHarness({ page: { kind: 'plugins' }, toolbarButtons: [refresh, progress] });
  await harness.settle();
  harness.fire('dsbot:command', 'add');
  assert.deepEqual(clicked, ['progress']);
});

test('only the plugin page answers the add command', async () => {
  let added = 0;
  const group = {
    getAttribute: () => '添加插件',
    querySelector: () => ({ disabled: false, click() { added += 1; } }),
  };
  const harness = createRouteHarness({ page: { kind: 'panel', target: 'insight' }, groups: [group] });
  await harness.settle();
  harness.fire('dsbot:command', 'add');
  assert.equal(added, 0);
});
