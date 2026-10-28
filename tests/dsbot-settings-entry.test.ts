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
  assert.deepEqual(childPlugins.map((child) => child.name), ['dudu-providers']);
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
});
