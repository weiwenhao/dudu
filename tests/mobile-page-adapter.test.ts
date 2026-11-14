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

function createHarness(initialPanel = null, { delayedUI = false } = {}) {
  let now = 0;
  let currentPanel = initialPanel;
  let onMutation;
  let readyCount = 0;
  let failCount = 0;
  let timerID = 0;
  const timers = new Map<number, () => void>();
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
    __DSBOT_APP_UI__: delayedUI ? undefined : ui,
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
    performance: { now: () => now },
    queueMicrotask: (callback) => Promise.resolve().then(callback),
    setTimeout: (callback) => { const id = ++timerID; timers.set(id, callback); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    console,
  });

  return {
    get readyCount() { return readyCount; },
    get failCount() { return failCount; },
    startUI() { window.__DSBOT_APP_UI__ = ui; },
    async advance(milliseconds) {
      now += milliseconds;
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
      await this.settle();
    },
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

type Tab = { label: string; selected: boolean };

/** Runs the adapter against a stand-in DSH frontend whose clock and mutations the test controls. */
function createRouteHarness({
  page, services = {}, views = [], tabs = [] as Tab[], content = false, rightbar = false,
  groups = [] as unknown[], toolbarButtons = [] as unknown[],
  settingsSections = () => [] as any[], settingsDialog = null as any,
  overflow = false,
} = {}) {
  let now = 0;
  const listeners: Record<string, Array<(event: { detail?: unknown }) => void>> = {};
  let onMutation: ((records: unknown[]) => void) | undefined;
  let readyCount = 0;
  const categories: Array<Array<{ id: string; label: string }>> = [];
  const timers: Array<() => void> = [];
  const state = {
    content, rightbar,
    tabs, focused: null as unknown, appended: [] as any[], moreExpanded: false, menuOpens: 0,
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
  const more = {
    disabled: false,
    getAttribute: (name: string) => name === 'aria-expanded' ? String(state.moreExpanded) : null,
    click() {
      state.moreExpanded = !state.moreExpanded;
      if (state.moreExpanded) state.menuOpens += 1;
    },
  };
  const ui = {
    ctx: {
      get: (name: string) => {
        const value = (services as Record<string, unknown>)[name];
        return name === 'sidebarRight' && value
          ? { active: () => ({ id: 'active-tab' }), ...value }
          : value ?? null;
      },
      slots: { entries: (name: string) => name === 'conversation.view' ? views
        : name === 'settings.section' ? settingsSections() : [] },
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
      if (selector === '[data-shortcut-modal="settings"]') return settingsDialog;
      if (overflow && selector === '[data-slot="conversation.header"] [data-conversation-tabs]') {
        return { parentElement: { querySelector: () => more } };
      }
      if (selector === '[data-conversation-content]') return state.content ? {} : null;
      if (selector === '[data-dsbot-rightbar]') return state.rightbar ? rightbarNode : null;
      if (selector.includes('> header [class*="_toolbar"]')) {
        return toolbarButtons.length ? { querySelectorAll: () => toolbarButtons } : null;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector.includes('role="tab"')) return overflow ? [] : tabNodes();
      if (selector === '[role="menuitem"]' && state.moreExpanded) {
        return state.tabs.map((tab) => ({
          innerText: tab.label,
          getAttribute: (name: string) => name === 'aria-current' && tab.selected ? 'page' : null,
          click() {
            for (const other of state.tabs) other.selected = other === tab;
            state.moreExpanded = false;
          },
        }));
      }
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
    __DSBOT_NATIVE__: {
      ready() { readyCount += 1; }, fail() {},
      settingsCategories(value: Array<{ id: string; label: string }>) { categories.push(value); },
    },
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
    categories,
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

test('specialized conversation routes use registered IDs and localized labels, including older catalogs', async () => {
  for (const [kind, id, label] of [
    ['trace', 'trajectory', 'Trajectoire'], ['context', 'dsh-context', 'コンテキスト'],
    ['team', 'fleet', 'Équipe'], ['tools', 'tools', 'Werkzeuge'],
  ]) {
    for (const named of [true, false]) {
      const tabs = [{ label: 'Chat', selected: true }, { label, selected: false }];
      const harness = createRouteHarness({
        page: { kind, sessionId: 'session-1', ...(named && kind !== 'tools' ? { target: id } : {}) },
        services: { uiWorkspace: { async openSession() {} } },
        views: [{ options: { id, label: () => label } }], tabs, content: true,
      });
      await harness.settle();
      assert.equal(tabs[1].selected, true, `${kind}, named=${named}`);
      await harness.step(600, { mutate: false });
      assert.equal(harness.readyCount, 1, `${kind}, named=${named}`);
    }
  }
});

test('settings select the registry ID despite duplicate labels and clear a removed registry', async () => {
  let entries = ['account', 'models'].map((id) => ({ options: { id, label: () => 'Settings' } }));
  let selected = 'account';
  let clicked = false;
  const buttons = ['account', 'models'].map((id) => ({
    innerText: 'Settings', getAttribute: (name: string) => name === 'aria-current' && selected === id ? 'true' : null,
    click() { clicked = true; selected = id; },
  }));
  const dialog = {
    querySelector(selector: string) { return selector === '[data-dsbot-settings-body]' ? {} : null; },
    querySelectorAll: () => buttons,
  };
  const harness = createRouteHarness({
    page: { kind: 'settings', target: 'models' },
    services: { slots: { entries: () => [{ store: { create: () => ({
      actions: { openSection(id: string) { selected = id; } },
    }) } }] } },
    settingsSections: () => entries, settingsDialog: dialog,
  });
  await harness.settle();
  assert.equal(selected, 'models');
  assert.equal(clicked, false, 'a matching label is not a section identity');
  assert.equal(harness.readyCount, 1);
  assert.equal(harness.categories.at(-1)?.length, 2);

  entries = [];
  harness.fire('dsbot:settings-select', null);
  await harness.step(0);
  assert.equal(harness.categories.at(-1)?.length, 0, 'unloaded sections must disappear on the phone');

  const hiddenOnly = createRouteHarness({
    page: { kind: 'settings' }, settingsDialog: dialog,
    settingsSections: () => [{ options: { id: 'general', label: () => 'General' } }],
  });
  await hiddenOnly.settle();
  assert.equal(hiddenOnly.categories.at(-1)?.length, 0);
  assert.equal(hiddenOnly.readyCount, 1, 'a loaded registry with no phone sections is not still loading');
});

test('a registered view folded into More is selected once and waits for its content to settle', async () => {
  const tabs = [{ label: 'Chat', selected: true }, { label: 'Équipe', selected: false }];
  const harness = createRouteHarness({
    page: { kind: 'team', target: 'fleet', sessionId: 'session-1' },
    services: { uiWorkspace: { async openSession() {} } },
    views: [{ options: { id: 'fleet', label: () => 'Équipe' } }],
    tabs, content: true, overflow: true,
  });
  await harness.settle();
  await harness.step(600, { mutate: false });
  assert.equal(tabs[1].selected, true);
  assert.equal(harness.readyCount, 0, 'clicking the menu does not make the previous view ready');
  await harness.step(600, { mutate: false });
  assert.equal(harness.readyCount, 1);
  assert.equal(harness.state.menuOpens, 1, 'do not reopen More after selecting the view');
});
