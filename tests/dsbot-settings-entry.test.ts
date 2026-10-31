import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

type ElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

type ClientModule = {
  id: string;
  factory: (require: (name: string) => unknown) => unknown;
};

function descendants(value: unknown): ElementNode[] {
  const result: ElementNode[] = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (typeof candidate !== 'object' || candidate === null || !('props' in candidate)) return;
    const element = candidate as ElementNode;
    if (typeof element.type === 'function') {
      visit((element.type as (props: Record<string, unknown>) => unknown)(element.props));
      return;
    }
    result.push(element);
    visit(element.props.children);
  };
  visit(value);
  return result;
}

test('dsbot registers its existing controls as a DSH Settings section', async () => {
  const source = await readFile(new URL('../host/dudu-plugin/client.js', import.meta.url), 'utf8');
  const metadata = JSON.parse(await readFile(new URL('../host/dudu-plugin/package.json', import.meta.url), 'utf8'));
  const requests: string[] = [];
  const requestBodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  const registrations: Array<{ options: Record<string, unknown>; component: Function }> = [];
  const injections: Array<() => void> = [];
  const hookState: unknown[] = [];
  const completedEffects = new Set<number>();
  let hookIndex = 0;
  let refreshState: (() => Promise<void>) | null = null;
  const lanAddress = 'http://192.168.1.12:3170/dsbot';
  const legacyLanAddress = 'ws://192.168.1.12:3170/dsbot';
  const customAddress = 'https://desktop.example/dsbot';
  const legacyCustomAddress = 'wss://desktop.example/dsbot';
  const customAddresses = [customAddress, ...Array.from({ length: 30 }, (_, index) => `https://custom-${index}.example/dsbot`)];
  let stateValue: Record<string, unknown> = {
    name: 'Test desktop',
    lanAddress: legacyLanAddress,
    addresses: [legacyLanAddress, legacyCustomAddress, ...customAddresses],
    devices: [],
  };
  let plugin: { apply: (ctx: unknown) => void } | undefined;
  const childPlugins: Array<Record<string, unknown>> = [];
  const provider = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id, name, route: id, enabled: true, configuredPath: '', state: 'ready', version: '2.1.312', path: `/home/u/.local/bin/${id}`, ...extra,
  });
  const providersValue = { providers: [provider('claude', 'Claude'), provider('codex', 'ChatGPT', { state: 'missing', version: undefined, path: undefined, reason: 'ChatGPT was not found.' })] };

  const sessionRow = (provider: string, id: string, title: string, extra: Record<string, unknown> = {}) => ({
    key: `${provider}:${id}`, provider, id, title, preview: `first prompt of ${title}`, cwd: '/home/u/Code/app', branch: 'main', updatedAt: Date.now() - 5 * 60_000, ...extra,
  });
  const sessionsValue = {
    sessions: [sessionRow('claude', 'c1', 'Fix the build'), sessionRow('codex', 'x1', 'Explain quokkas', { dshSessionId: 'session-old', evidence: { role: 'assistant', text: 'quokkas are small marsupials' } })],
    total: 2, providers: [{ id: 'claude', name: 'Claude', count: 1 }, { id: 'codex', name: 'ChatGPT', count: 1 }], home: '/home/u', indexing: { running: true, done: 3, total: 9 },
  };

  const now = Date.now();
  const overviewValues: Record<string, unknown> = {
    '/api/dudu/overview/usage': { providers: [
      { id: 'claude', name: 'Claude', state: 'ok', plan: 'Team', limited: false, windows: [
        { key: 'five_hour', label: '5 小时', used: 0.14, resetsAt: now + 3 * 3600_000, core: true },
        { key: 'seven_day', label: '每周', used: 0.334, resetsAt: now + 4 * 86_400_000, core: true },
      ] },
      { id: 'codex', name: 'ChatGPT', state: 'hidden', limited: false, windows: [] },
    ] },
    '/api/dudu/overview/running': {
      busy: [{ provider: 'claude', id: 'r1', title: 'Fix the build', cwd: '/home/u/Code/app', status: 'busy', since: now - 12 * 60_000 }],
      done: [{ provider: 'codex', id: 'r2', title: 'Explain quokkas', cwd: '/home/u/Code/zoo', status: 'done', since: now - 3 * 60_000, dshSessionId: 'session-r2' }],
      idle: [{ provider: 'claude', id: 'r3', title: 'Old chat', cwd: '/home/u/Code/old', status: 'idle', since: now - 3 * 3600_000 }, { provider: 'claude', id: 'r4', title: '', cwd: null, status: 'idle', since: now - 86_400_000 }],
      total: 4,
    },
  };

  const react = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): ElementNode {
      return { type, props: { ...(props ?? {}), children } };
    },
    useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void] {
      const index = hookIndex++;
      if (!(index in hookState)) hookState[index] = initial;
      return [hookState[index] as T, (next) => {
        hookState[index] = typeof next === 'function'
          ? (next as (current: T) => T)(hookState[index] as T)
          : next;
      }];
    },
    useEffect(effect: () => unknown) {
      const index = hookIndex++;
      if (completedEffects.has(index)) return;
      completedEffects.add(index);
      effect();
    },
    useRef<T>(initial: T) {
      const index = hookIndex++;
      if (!(index in hookState)) hookState[index] = { current: initial };
      return hookState[index] as { current: T };
    },
  };
  const primitives = {
    Button(props: Record<string, unknown>) {
      const children = Array.isArray(props.children) ? props.children : [props.children];
      return react.createElement('button', props, ...children);
    },
    Input(props: Record<string, unknown>) {
      const { className, ...inputProps } = props;
      return react.createElement('span', { className }, react.createElement('input', inputProps));
    },
  };

  const document = {
    baseURI: 'http://localhost/',
    createElement: () => ({ textContent: '', remove() {} }),
    head: { appendChild() {} },
  };
  const window = {
    __ModuleLoader__: {
      load(module: ClientModule) {
        if (module.id === 'dudu') {
          plugin = module.factory((name) => {
            if (name === 'react') return react;
            if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
            assert.fail(`unexpected client external: ${name}`);
          }) as typeof plugin;
        }
      },
    },
  };
  const context = vm.createContext({
    window,
    document,
    URL,
    Date,
    fetch: async (path: string, init?: { body?: string }) => {
      requests.push(path);
      requestBodies.push({ path, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
      if (path.startsWith('/api/dudu/providers/')) return { ok: true, json: async () => providersValue };
      if (path === '/api/dudu/sessions/list') return { ok: true, json: async () => sessionsValue };
      if (path in overviewValues) return { ok: true, json: async () => overviewValues[path] };
      if (path === '/api/dudu/sessions/load') return { ok: true, json: async () => ({ sessionId: 'session-new', workspaceId: 'ws-1', reused: false }) };
      return {
        ok: true,
        json: async () => ({
          ...stateValue,
          addresses: [...stateValue.addresses as string[]],
          devices: [...stateValue.devices as unknown[]],
        }),
      };
    },
    setInterval: (callback: () => unknown) => {
      refreshState = callback as () => Promise<void>;
      return 1;
    },
    clearInterval() {},
    // Timers of the page must not keep the test process alive when it is done.
    setTimeout: (callback: () => unknown, delay?: number) => { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
    clearTimeout,
  });

  vm.runInContext(source, context);
  assert.ok(plugin, 'client module should be captured by the app module loader');

  const ctx = {
    effect(effect: () => unknown) { effect(); },
    plugin(child: Record<string, unknown>) { childPlugins.push(child); },
    slots: {
      inject(_slot: string, activate: () => void) { injections.push(activate); },
      register(options: Record<string, unknown>, component: Function) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  plugin.apply(ctx);
  for (const activate of injections) activate();

  const section = registrations.find((entry) => entry.options.name === 'settings.section');
  const legacyPluginEntry = registrations.find((entry) => entry.options.name === 'plugins.bundle.config');
  assert.ok(section, 'a first-class settings section should be registered');
  assert.ok(legacyPluginEntry, 'the existing plugin configuration entry should remain available');
  assert.equal(section.options.id, 'dudu-mobile-control');
  assert.equal((section.options.label as () => string)(), '手机控制');
  assert.equal(section.options.order, 50);
  assert.ok(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));

  const legacyPage = legacyPluginEntry.component({ view: 'page' }) as ElementNode;
  assert.equal(legacyPage.type, section.component, 'both entry points should reuse the same Settings component');
  assert.equal(legacyPluginEntry.component({ view: 'summary' }), null);

  hookIndex = 0;
  section.component({ close() {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  hookIndex = 0;
  let view = section.component({ close() {} }) as ElementNode;
  const text = JSON.stringify(view, (_key, value) => typeof value === 'function' ? '[function]' : value);
  assert.match(text, /手机控制/);
  assert.deepEqual(requests, ['/api/dudu/state'], 'opening Settings must not generate a pairing code');

  let nodes = descendants(view);
  const nameRow = nodes.find((node) => node.props.className === 'dsbot-settings-row');
  assert.ok(nameRow, 'the computer name should use the shared two-column form row');
  assert.ok(descendants(nameRow.props.children).some((node) => node.type === 'label'
    && node.props.htmlFor === 'dsbot-computer-name'));

  let lanRow = nodes.find((node) => node.props.className === 'dsbot-settings-row dsbot-address-row dsbot-address-row--default');
  assert.ok(lanRow, 'the auto-detected LAN address should have its own row');
  let lanRowNodes = descendants(lanRow.props.children);
  assert.ok(lanRowNodes.some((node) => node.type === 'label'
    && node.props.htmlFor === 'dsbot-lan-address'),
  'the default address should label its field in the shared label column');
  assert.equal(lanRowNodes.some((node) => node.props.className === 'dsbot-field-note'), false,
    'the default address should not show the redundant automatic-detection note');
  assert.ok(lanRowNodes.some((node) => node.props.className === 'dsbot-address-field'),
    'the address input and QR action should share the aligned content column');
  const lanInput = lanRowNodes.find((node) => node.type === 'input');
  assert.equal(lanInput?.props.value, lanAddress);
  assert.equal(lanInput?.props.readOnly, true, 'the auto-detected address should be read-only');
  assert.equal(lanInput?.props['aria-label'], '内网地址');
  assert.equal(lanInput?.props.onChange, undefined);
  assert.equal(lanRowNodes.some((node) => node.props.className === 'dsbot-address-delete'), false);
  assert.match(source,
    /\.dsbot-address-row,\.dsbot-address-row--default\{grid-template-columns:minmax\(120px,1fr\) minmax\(0,2fr\)\}/,
    'all address rows should use the same grid tracks as the computer name row');

  let customRow = nodes.find((node) => node.props.className === 'dsbot-settings-row dsbot-address-row');
  assert.ok(customRow, 'custom addresses should remain editable');
  let customNodes = descendants(customRow.props.children);
  const customInput = customNodes.find((node) => node.type === 'input');
  assert.equal(customInput?.props.value, customAddress);
  assert.notEqual(customInput?.props.readOnly, true);
  assert.equal(typeof customInput?.props.onChange, 'function');
  const customButtons = customNodes.filter((node) => node.type === 'button');
  const customGenerate = customButtons.find((node) => node.props.children?.includes('生成二维码'));
  const customDelete = customButtons.find((node) => node.props['aria-label'] === '删除连接地址 2');
  assert.equal(customGenerate?.props.variant, 'primary');
  assert.equal(customGenerate?.props.size, 'sm');
  assert.equal(customDelete?.props.variant, 'ghost');
  assert.equal(typeof customDelete?.props.onClick, 'function');
  const addButton = nodes.find((node) => node.type === 'button'
    && node.props.children?.includes('添加地址'));
  assert.equal(addButton?.props.disabled, true, 'the 32-address cap includes the protected built-in address');

  assert.ok(refreshState);
  stateValue = {
    name: 'Test desktop',
    lanAddress: 'http://192.168.1.12:3170',
    addresses: [legacyLanAddress, legacyCustomAddress, ...customAddresses],
    devices: [],
  };
  await refreshState();
  hookIndex = 0;
  view = section.component({ close() {} }) as ElementNode;
  nodes = descendants(view);
  lanRow = nodes.find((node) => node.props.className === 'dsbot-settings-row dsbot-address-row dsbot-address-row--default');
  assert.ok(lanRow, 'older state responses should also protect the first LAN address');
  lanRowNodes = descendants(lanRow.props.children);
  assert.equal(lanRowNodes.find((node) => node.type === 'input')?.props.value, lanAddress);
  assert.equal(nodes.filter((node) => node.props.className === 'dsbot-settings-row dsbot-address-row').length,
    customAddresses.length, 'legacy WS aliases should normalize and deduplicate before rendering');

  const saveButton = nodes.find((node) => node.type === 'button'
    && node.props.children?.includes('保存'));
  assert.equal(typeof saveButton?.props.onClick, 'function');
  await (saveButton?.props.onClick as () => Promise<void>)();
  const saveRequest = requestBodies.find((entry) => entry.path === '/api/dudu/save');
  assert.deepEqual(saveRequest?.body.addresses, [lanAddress, ...customAddresses],
    'saving should keep the protected LAN address first and include editable custom addresses');
  assert.equal(saveButton?.props.variant, 'primary');
  assert.equal(saveButton?.props.size, 'sm');

  // Beside phone control: a section for the harnesses on this computer, and the plugin that adds the provider chip and
  // scopes the model list. That plugin waits for the services it needs, so a DSH without them still gets the rest.
  const providers = registrations.find((entry) => entry.options.id === 'dudu-providers');
  assert.ok(providers, 'the providers section should be registered');
  assert.equal(providers.options.name, 'settings.section');
  assert.equal((providers.options.label as () => string)(), '供应商');
  assert.equal(providers.options.order, 51);
  assert.deepEqual(childPlugins.map((child) => child.name), ['dudu-providers', 'dudu-sessions']);
  assert.deepEqual([...(childPlugins[0].inject as string[])], ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session']);

  hookState.length = 0;
  completedEffects.clear();
  requests.length = 0;
  requestBodies.length = 0;
  hookIndex = 0;
  providers.component({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  hookIndex = 0;
  const providersView = providers.component({}) as ElementNode;
  assert.deepEqual(requests, ['/api/dudu/providers/state']);
  const providerNodes = descendants(providersView);
  const headings = providerNodes.filter((node) => node.type === 'h3').map((node) => node.props.children);
  assert.deepEqual(headings, [['Claude'], ['ChatGPT']]);
  const textOf = (node: ElementNode) => JSON.stringify(node.props.children);
  assert.ok(providerNodes.some((node) => textOf(node) === '["可用 2.1.312"]'), 'a harness that was found shows its version');
  assert.ok(providerNodes.some((node) => textOf(node) === '["未找到"]'), 'a harness that was not found says so');
  assert.equal(providerNodes.some((node) => node.props.className === 'dsbot-muted' && textOf(node) === '["ChatGPT was not found."]'), false, 'a missing harness needs no sentence beside its status');
  const enable = providerNodes.find((node) => node.type === 'input' && node.props.id === 'dudu-provider-enabled-claude');
  assert.equal(enable?.props.checked, true);
  await (enable?.props.onChange as (event: unknown) => Promise<void>)({ target: { checked: false } });
  assert.deepEqual(requestBodies.at(-1), { path: '/api/dudu/providers/save', body: { id: 'claude', enabled: false } });
  const refresh = providerNodes.find((node) => node.type === 'button' && JSON.stringify(node.props.children).includes('重新检测'));
  await (refresh?.props.onClick as () => Promise<void>)();
  assert.equal(requests.at(-1), '/api/dudu/providers/refresh');

  // The 嘟嘟 panel: an entry among DSH's global panels and a page for it, from a plugin of its own that needs the layout,
  // the workspace navigation and the sessions service.
  const sessionsUi = childPlugins[1];
  assert.deepEqual([...(sessionsUi.inject as string[])], ['slots', 'layout', 'uiWorkspace', 'sessions']);
  const panel: Array<{ options: Record<string, unknown>; component: Function }> = [];
  const panelInjections: Array<() => void> = [];
  const created: unknown[] = [];
  const opened: unknown[] = [];
  const selected: unknown[] = [];
  const listState: { ids: string[]; byId: Record<string, unknown> } = { ids: [], byId: {} };
  const listeners = new Set<() => void>();
  (sessionsUi.apply as (ctx: unknown) => void)({
    effect(effect: () => unknown) { effect(); },
    slots: {
      inject(_slot: string, activate: () => void) { panelInjections.push(activate); },
      register(options: Record<string, unknown>, component: Function) { panel.push({ options, component }); return () => {}; },
    },
    // A DSH that announces a created session a moment later: the list gains it only after it was asked to refresh.
    sessions: {
      create: async (options: unknown) => { created.push(options); return 'session-new'; },
      refresh: async () => { listState.ids.push('session-new'); for (const listener of listeners) listener(); },
      list: { getSnapshot: () => listState, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } },
    },
    uiWorkspace: { openSession: (sessionId: unknown) => { assert.ok(listState.ids.includes(sessionId as string), 'a session is opened once the list holds it'); opened.push(sessionId); } },
    layout: { selectPanel: (panelId: unknown) => { selected.push(panelId); } },
  });
  for (const activate of panelInjections) activate();
  const entry = panel.find((item) => item.options.name === 'sidebar.panellist');
  const page = panel.find((item) => item.options.name === 'main');
  assert.deepEqual([entry?.options.id, (entry?.options.label as () => string)(), entry?.options.order], ['dudu', '嘟嘟', 20]);
  assert.equal(page?.options.key, 'dudu', 'the page is the one the entry selects');
  const glyph = entry?.component({ size: 16 }) as ElementNode;
  assert.equal(glyph.type, 'img');
  assert.match(String(glyph.props.src), /^data:image\/png;base64,/);
  assert.deepEqual([glyph.props.width, glyph.props.height], [16, 16]);

  hookState.length = 0;
  completedEffects.clear();
  requests.length = 0;
  requestBodies.length = 0;
  const pageElement = page?.component() as ElementNode;
  const render = () => { hookIndex = 0; return (pageElement.type as (props: unknown) => unknown)(pageElement.props); };
  render();
  await new Promise((resolve) => setTimeout(resolve, 30));
  let pageNodes = descendants(render());
  const said = (node: ElementNode) => JSON.stringify(descendants(node).map((child) => child.props.children));
  const byId = (id: string) => pageNodes.find((node) => node.props['data-testid'] === id);

  // The overview reads the sessions, the usage, what is running, the tokens and the phone: each on its own.
  assert.deepEqual(requestBodies.find((entry) => entry.path === '/api/dudu/sessions/list')?.body, { query: '', limit: 8, refresh: false });
  for (const path of ['/api/dudu/overview/usage', '/api/dudu/overview/running', '/api/dudu/state']) assert.ok(requests.includes(path), `${path} is read`);
  assert.equal(pageNodes.some((node) => node.type === 'h1'), false, 'no title or explanation takes the space of the overview');
  assert.equal(pageNodes.find((node) => node.type === 'input')?.props.placeholder, '搜索会话');

  const usage = byId('dudu-usage');
  assert.ok(usage && said(usage).includes('Claude') && said(usage).includes('5 小时') && said(usage).includes('每周') && said(usage).includes('14%') && said(usage).includes('33%'));
  assert.equal(said(usage).includes('ChatGPT'), false, 'a harness that cannot report usage is left out');
  assert.equal(descendants(usage).filter((node) => node.props.role === 'meter').length, 2);
  const runningCard = byId('dudu-runningcard');
  const runningRows = descendants(runningCard as ElementNode).filter((node) => node.props['data-testid'] === 'dudu-running');
  assert.deepEqual(runningRows.map((node) => node.props['data-state']), ['busy', 'done'], 'working and just finished sessions have a line each');
  assert.ok(said(runningRows[0]).includes('Fix the build') && said(runningRows[0]).includes('忙 12 分钟') && said(runningRows[0]).includes('~/Code/app'));
  assert.ok(said(runningRows[1]).includes('3 分钟前完成'));
  assert.equal(typeof runningRows[0].props.onClick, 'undefined', 'a terminal session is not opened from here');
  assert.equal(typeof runningRows[1].props.onClick, 'function', 'one that is in DSH is');
  assert.ok(said(runningCard as ElementNode).includes('另有 2 个空闲'), 'idle sessions are only counted');
  assert.ok(pageNodes.some((node) => node.props['data-testid'] === 'dudu-phone' && JSON.stringify(descendants(node).map((child) => child.props.children)).includes('手机未连接')));

  const rows = pageNodes.filter((node) => node.props['data-testid'] === 'dudu-session');
  assert.deepEqual(rows.map((node) => node.props['data-key']), ['claude:c1', 'codex:x1']);
  assert.ok(said(rows[0]).includes('Fix the build') && said(rows[0]).includes('~/Code/app'), 'a row shows its title and folder, the home folder as ~');
  assert.ok(said(rows[1]).includes('quokkas are small marsupials'), 'a match inside the conversation shows where');
  const buttonLabels = pageNodes.filter((node) => node.type === 'button' && node.props['data-testid'] === undefined).map((node) => JSON.stringify(node.props.children));
  assert.ok(buttonLabels.includes('["加载到 DSH"]') && buttonLabels.includes('["打开"]'), 'a session is loaded or, when it is there already, opened');
  assert.ok(pageNodes.some((node) => node.props.role === 'status' && JSON.stringify(node.props.children).includes('3 / 9')), 'the page says while conversations are still being read');

  // Searching gives the whole page to the answers.
  const search = pageNodes.find((node) => node.type === 'input');
  (search?.props.onChange as (event: unknown) => void)({ target: { value: 'quokkas' } });
  pageNodes = descendants(render());
  assert.equal(byId('dudu-usage'), undefined);
  assert.equal(byId('dudu-runningcard'), undefined);
  assert.equal(pageNodes.filter((node) => node.props['data-testid'] === 'dudu-session').length, 2);
  (search?.props.onChange as (event: unknown) => void)({ target: { value: '' } });
  pageNodes = descendants(render());

  // Loading writes the session on the host, then DSH's own create adopts it before it is opened.
  const load = pageNodes.find((node) => node.type === 'button' && JSON.stringify(node.props.children) === '["加载到 DSH"]');
  (load?.props.onClick as (event: unknown) => void)({ stopPropagation() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(requestBodies.find((entry) => entry.path === '/api/dudu/sessions/load')?.body, { provider: 'claude', id: 'c1' });
  // (what the page handed over was made inside the page's own realm, so compare it as plain data)
  assert.deepEqual(JSON.parse(JSON.stringify(created)), [{ sessionId: 'session-new', workspaceId: 'ws-1' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), ['session-new']);
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), [null], 'the panel is left for the conversation');
});
