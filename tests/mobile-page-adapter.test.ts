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

type Tab = { label: string; selected: boolean };

/** Runs the adapter against a stand-in DSH frontend whose clock and mutations the test controls. */
function createRouteHarness({
  page, services = {}, views = [], tabs = [] as Tab[], content = false, rightbar = false,
  groups = [] as unknown[], toolbarButtons = [] as unknown[],
} = {}) {
  let now = 0;
  const listeners: Record<string, Array<(event: { detail?: unknown }) => void>> = {};
  let onMutation: (() => void) | undefined;
  let readyCount = 0;
  const timers: Array<() => void> = [];
  const state = { content, rightbar, tabs, focused: null as unknown, appended: [] as any[] };
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
      get: (name: string) => (services as Record<string, unknown>)[name] ?? null,
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
      if (selector === '[data-dsbot-rightbar]') return state.rightbar ? { childElementCount: 1 } : null;
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
      if (mutate) onMutation?.();
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

test('a right-dock entry opens its tab in the session and shows the right column on its own', async () => {
  const opened: string[] = [];
  const harness = createRouteHarness({
    page: { kind: 'dock', sessionId: 'session-1', target: 'example-board:open' },
    services: {
      uiWorkspace: { async openSession(id: string) { opened.push(`session:${id}`); } },
      sidebarRight: { async openTab(kind: string) { opened.push(`tab:${kind}`); } },
    },
  });
  assert.equal('dsbotPageSession' in harness.dataset, false, 'the right column stays visible for a dock page');
  await harness.settle();
  assert.deepEqual(opened, ['session:session-1', 'tab:example-board']);
  assert.equal(harness.readyCount, 0);

  harness.state.rightbar = true;
  await harness.step(100);
  assert.equal(harness.readyCount, 0);
  await harness.step(700, { mutate: false });
  assert.equal(harness.readyCount, 1);
  assert.deepEqual(opened, ['session:session-1', 'tab:example-board'], 'the tab is opened once');
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

test('a dock that is not ready yet is tried again, not left waiting, and the tab is opened once', async () => {
  let attempts = 0;
  const opened: string[] = [];
  const harness = createRouteHarness({
    page: { kind: 'dock', sessionId: 'session-1', target: 'terminal:new' },
    services: {
      uiWorkspace: { async openSession() {} },
      sidebarRight: {
        openTab(kind: string) {
          attempts += 1;
          if (attempts < 3) throw new Error('no Session on screen yet');
          opened.push(kind);
        },
      },
    },
  });
  await harness.settle();
  await harness.step(200);
  await harness.step(200);
  await harness.step(200);
  assert.deepEqual(opened, ['terminal']);
  assert.equal(attempts, 3, 'two refusals, one success, and no further attempts');
});

test('a tab of that kind that is already open is shown again, and a column that was folded is unfolded', async () => {
  const calls: string[] = [];
  const harness = createRouteHarness({
    page: { kind: 'dock', sessionId: 'session-1', target: 'terminal:new' },
    services: {
      uiWorkspace: { async openSession() {} },
      sidebarRight: {
        openTabs: {
          getSnapshot: () => [
            { sessionId: 'other-session', tabId: 'tab-1', kind: 'terminal' },
            { sessionId: 'session-1', tabId: 'tab-2', kind: 'browser' },
            { sessionId: 'session-1', tabId: 'tab-7', kind: 'terminal' },
          ],
        },
        isExpanded: () => false,
        toggleExpanded() { calls.push('toggle'); },
        focus(id: string) { calls.push(`focus:${id}`); },
        openTab(kind: string) { calls.push(`open:${kind}`); },
      },
    },
  });
  await harness.settle();
  assert.deepEqual(calls, ['toggle', 'focus:tab-7']);

  const fresh: string[] = [];
  const other = createRouteHarness({
    page: { kind: 'dock', sessionId: 'session-1', target: 'browser:new' },
    services: {
      uiWorkspace: { async openSession() {} },
      sidebarRight: {
        openTabs: { getSnapshot: () => [{ sessionId: 'session-1', tabId: 'tab-7', kind: 'terminal' }] },
        isExpanded: () => true,
        focus(id: string) { fresh.push(`focus:${id}`); },
        openTab(kind: string) { fresh.push(`open:${kind}`); },
      },
    },
  });
  await other.settle();
  assert.deepEqual(fresh, ['open:browser'], 'no tab of that kind yet: one is opened');
});

function terminalPage({ activeKind = 'terminal', writable = true } = {}) {
  const written: string[] = [];
  const view = writable ? { write(data: string) { written.push(data); } } : {};
  const harness = createRouteHarness({
    page: { kind: 'dock', sessionId: 'session-1', target: 'terminal:new' },
    services: {
      uiWorkspace: { async openSession() {} },
      sidebarRight: {
        openTab() {},
        active: () => ({ id: 'tab-1', kind: activeKind }),
      },
      webTerminals: { views: new Map([['session-1', new Map([['tab-1', view]])]]) },
    },
  });
  const xterm = { classList: { contains: (name: string) => name === 'xterm-helper-textarea' } };
  return { harness, written, xterm };
}

async function readyDock(harness: ReturnType<typeof createRouteHarness>) {
  await harness.settle();
  harness.state.rightbar = true;
  await harness.step(100);
  await harness.step(700, { mutate: false });
  assert.equal(harness.readyCount, 1);
}

test('the terminal keys appear while a terminal holds the keyboard, and write through its own view', async () => {
  const { harness, written, xterm } = terminalPage();
  await readyDock(harness);
  assert.equal(harness.state.appended.length, 0, 'no bar until a terminal is focused');

  harness.state.focused = xterm;
  harness.dispatchOnDocument('focusin');
  await harness.step(100, { mutate: false });
  assert.equal(harness.state.appended.length, 1);
  assert.ok('data-dsbot-keys-visible' in harness.rootAttributes);
  const bar = harness.state.appended[0];
  assert.equal(bar.attributes['data-dsbot-keys'], '');
  assert.deepEqual(bar.children.map((button: any) => button.textContent), ['Esc', 'Tab', '^C', '^D', '↑', '↓', '←', '→']);

  // A press must not move focus away from the terminal.
  let prevented = 0;
  const press = (label: string) => {
    const button = bar.children.find((child: any) => child.textContent === label);
    button.listeners.pointerdown[0]({ preventDefault() { prevented += 1; } });
  };
  for (const label of ['Esc', 'Tab', '^C', '^D', '↑', '↓', '←', '→']) press(label);
  assert.deepEqual(written, ['\u001b', '\t', '\u0003', '\u0004', '\u001b[A', '\u001b[B', '\u001b[D', '\u001b[C']);
  assert.equal(prevented, 8);
  const [first] = bar.children;
  first.listeners.mousedown[0]({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 9);

  // A click with a pointer behind it was already handled; one without (assistive technology) is not.
  first.listeners.click[0]({ detail: 1 });
  assert.equal(written.length, 8);
  first.listeners.click[0]({ detail: 0 });
  assert.equal(written.length, 9);

  harness.state.focused = null;
  harness.dispatchOnDocument('focusout');
  await harness.step(100, { mutate: false });
  assert.equal('data-dsbot-keys-visible' in harness.rootAttributes, false);
  assert.equal(harness.state.appended.length, 1, 'the bar is kept and only hidden');
});

test('the terminal keys stay away unless the active tab is a terminal whose view can write', async () => {
  for (const options of [{ activeKind: 'browser' }, { writable: false }]) {
    const { harness, xterm } = terminalPage(options);
    await readyDock(harness);
    harness.state.focused = xterm;
    harness.dispatchOnDocument('focusin');
    await harness.step(100, { mutate: false });
    assert.equal(harness.state.appended.length, 0, JSON.stringify(options));
    assert.equal('data-dsbot-keys-visible' in harness.rootAttributes, false);
  }

  // Focus in some other field of a dock page is not a terminal.
  const { harness } = terminalPage();
  await readyDock(harness);
  harness.state.focused = { classList: { contains: () => false } };
  harness.dispatchOnDocument('focusin');
  await harness.step(100, { mutate: false });
  assert.equal(harness.state.appended.length, 0);
});

test('pages that are not docks never listen for focus or build the terminal keys', async () => {
  const harness = createRouteHarness({ page: { kind: 'panel', target: 'schedules' } });
  harness.dispatchOnDocument('focusin');
  await harness.step(100, { mutate: false });
  assert.equal(harness.state.appended.length, 0);
});
