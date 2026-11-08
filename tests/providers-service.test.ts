import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '../host/providers/index.mjs';

function fakeHost() {
  const handlers = new Map<string, Set<Function>>();
  const adapters = new Map<string, any>();
  const agents = new Map<string, any>();
  const host: any = {
    adapters,
    llm: {
      registerAdapter(routes: string[], adapter: any) {
        if (routes.some(route => adapters.has(route))) throw new Error('DUPLICATE_ADAPTER');
        for (const route of routes) adapters.set(route, adapter);
        return () => { for (const route of routes) adapters.delete(route); };
      },
    },
    agents: { get: (id: string) => agents.get(id), list: () => [...agents.values()] },
    on(name: string, handler: Function) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name)!.add(handler);
      return () => handlers.get(name)!.delete(handler);
    },
    emit(name: string, ...args: any[]) { for (const handler of handlers.get(name) ?? []) handler(...args); },
    services: {},
  };
  host.agentsMap = agents;
  host.agents = { get: (id: string) => agents.get(id), list: () => [...agents.values()] };
  host.addAgent = (id: string, provider: string) => {
    const tools = new Map<string, any>();
    const agent = {
      id, options: { provider }, session: { header: {}, seq: 1, snapshotEvents: () => [{ type: 'turn/start', data: { turn: 1 } }] },
      ctx: { tools: { register(definition: any) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } } }, tools,
    };
    agents.set(id, agent);
    return agent;
  };
  return host;
}

const ready = (path = '/bin/fake-cli', version = '1.2.3') => ({ state: 'ready', path, version, installation: { command: path } });

function fakeProvider(id = 'fake', children = false) {
  const created: any[] = [];
  return {
    id, name: `Fake ${id}`, route: id, created,
    // What the provider's probe is asked, and what it answers, is set by each test.
    probes: [] as any[], detection: undefined as any,
    probe(this: any, request: any) { this.probes.push(request); return Promise.resolve(this.detection ?? ready()); },
    create({ installation }: { installation: { command: string } }) {
      const driver = {
        id, name: `Fake ${id}`, route: id, path: installation.command, refreshed: 0, tools: [{ name: 'Bash' }, { name: 'Read' }],
        refreshModels() { this.refreshed++; },
        listModels: async () => [], resolveModel: async (model: string) => ({ id: model, name: model }), start: async () => { throw new Error('not needed'); },
        ...(children ? { normalizer: () => ({ feed: () => [] }) } : {}),
      };
      created.push(driver);
      return driver;
    },
  };
}

async function setup(t: { after: (callback: () => Promise<unknown>) => void }, detection?: any) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-providers-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const host = fakeHost();
  const provider = fakeProvider();
  provider.detection = detection;
  const providers = await createProviders({ host, providers: [provider], folder, log: { warn() {} } });
  t.after(() => providers.close());
  return { host, provider, providers, folder };
}

test('a ready harness becomes a model route; a missing one does not, and says why', async (t) => {
  const missing = await setup(t, { state: 'missing', reason: 'fake-cli was not found.' });
  assert.equal(missing.host.adapters.size, 0);
  assert.deepEqual(missing.providers.state().providers[0], {
    id: 'fake', name: 'Fake fake', route: 'fake', enabled: true, configuredPath: '', state: 'missing', version: undefined, path: undefined, reason: 'fake-cli was not found.',
  });

  const found = await setup(t);
  assert.ok(found.host.adapters.has('fake'));
  assert.equal(found.providers.state().providers[0].state, 'ready');
  assert.equal(found.provider.created[0].path, '/bin/fake-cli');
});

test('turning a provider off removes its route and turning it on brings it back; the choice is saved privately', async (t) => {
  const { host, providers, folder } = await setup(t);
  await providers.save({ id: 'fake', enabled: false });
  assert.equal(host.adapters.has('fake'), false);
  assert.equal(providers.state().providers[0].enabled, false);
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'providers.json'), 'utf8')), { disabled: ['fake'], paths: {} });
  assert.equal((await stat(join(folder, 'providers.json'))).mode & 0o777, 0o600);
  await providers.save({ id: 'fake', enabled: true });
  assert.equal(host.adapters.has('fake'), true);
});

test('a configured path is what detection looks at, and a different path replaces the route', async (t) => {
  const { host, provider, providers } = await setup(t);
  provider.detection = ready('/custom/fake-cli', '2.0.0');
  await providers.save({ id: 'fake', path: ' /custom/fake-cli ' });
  assert.equal(provider.probes.at(-1).override, '/custom/fake-cli');
  assert.equal(provider.created.at(-1).path, '/custom/fake-cli');
  assert.equal(host.adapters.size, 1);
  assert.equal(provider.created.length, 2, 'a changed binary is a new route registration');
  await providers.save({ id: 'fake', path: '' });
  assert.equal(provider.probes.at(-1).override, undefined);
  await assert.rejects(providers.save({ id: 'nope', enabled: true }), /Unknown provider/);
});

test('replacing a native provider drains its child route before registering another observation adapter', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-provider-team-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const host = fakeHost();
  host.agents.create = host.agents.resume = async () => { throw new Error('No native work requested.'); };
  host.flushSession = async () => {};
  const provider = fakeProvider('fake', true);
  const providers = await createProviders({ host, providers: [provider], folder, log: { warn() {} } });
  t.after(() => providers.close());
  assert.equal(host.adapters.has('dudu-fake-child'), true);
  provider.detection = ready('/custom/next-cli', '2.0.0');
  await providers.save({ id: 'fake', path: '/custom/next-cli' });
  assert.equal(provider.created.length, 2);
  assert.equal(host.adapters.size, 2);
  await providers.save({ id: 'fake', enabled: false });
  assert.equal(host.adapters.size, 0);
  await providers.save({ id: 'fake', enabled: true });
  assert.equal(host.adapters.size, 2);
  await providers.close();
  assert.equal(host.adapters.size, 0);
});

test('an agent gets mirror tools while its route is the harness, from creation or from a later selection', async (t) => {
  const { host } = await setup(t);
  const born = host.addAgent('s1', 'fake');
  host.emit('agent/created', { agent: born });
  assert.deepEqual([...born.tools.keys()], ['Bash', 'Read']);

  const other = host.addAgent('s2', 'deepseek-official');
  host.emit('agent/created', { agent: other });
  assert.equal(other.tools.size, 0);

  // The new-session screen is a live blank session: the choice of provider arrives as a logged selection.
  host.emit('session/event', { id: 's2' }, { type: 'model/selection', data: { provider: 'fake', model: 'm' } });
  assert.deepEqual([...other.tools.keys()], ['Bash', 'Read']);
  host.emit('session/event', { id: 's2' }, { type: 'model/selection', data: { provider: 'deepseek-official', model: 'x' } });
  assert.equal(other.tools.size, 0);
  host.emit('session/event', { id: 's1' }, { type: 'turn/start', data: {} });
  assert.equal(born.tools.size, 2, 'unrelated events change nothing');
});

test('only a harness agent shadows compact, and changing its provider removes the scoped command', async (t) => {
  const { host, providers } = await setup(t);
  const agent = host.addAgent('compact-session', 'fake');
  const commands = new Map<string, any>();
  const original = {
    definitionId: 'host-compact', name: 'compact', description: 'Compact older conversation history',
    handler: () => ({ kind: 'success', text: 'Host compact' }),
  };
  agent.ctx.inject = (dependencies: string[], apply: Function) => {
    assert.deepEqual(dependencies, ['commands']);
    apply({ commands: {
      find: (target: unknown, name: string) => {
        assert.equal(target, agent);
        return commands.get(name) ?? original;
      },
      register: (definition: any) => {
        assert.equal(commands.has(definition.name), false);
        commands.set(definition.name, definition);
        return () => { if (commands.get(definition.name) === definition) commands.delete(definition.name); };
      },
    } });
    return { dispose: async () => {} };
  };
  host.emit('agent/created', { agent });
  const guarded = commands.get('compact');
  assert.equal(guarded.definitionId, original.definitionId);
  assert.equal(guarded.description, original.description);
  const result = await guarded.handler();
  assert.equal(result.kind, 'error');
  assert.match(result.text, /Manual compaction is not available for Fake fake through OAR/);
  assert.deepEqual(original.handler(), { kind: 'success', text: 'Host compact' });
  host.emit('session/event', { id: agent.id }, { type: 'model/selection', data: { provider: 'deepseek-official' } });
  assert.equal(commands.size, 0);
  host.emit('session/event', { id: agent.id }, { type: 'model/selection', data: { provider: 'fake' } });
  assert.equal(commands.size, 1);
  await providers.save({ id: 'fake', enabled: false });
  assert.equal(commands.size, 0);
  await providers.save({ id: 'fake', enabled: true });
  assert.equal(commands.size, 1);
  host.emit('agent/disposed', { agent });
  assert.equal(commands.size, 0);
});

test('disposing an agent removes its tools and stops its harness run', async (t) => {
  const { host } = await setup(t);
  const agent = host.addAgent('s1', 'fake');
  host.emit('agent/created', { agent });
  assert.equal(agent.tools.size, 2);
  host.emit('agent/disposed', { agent });
  assert.equal(agent.tools.size, 0);
});

test('provider shutdown releases a live writer before an unfinished refresh and waits for its actual exit', { timeout: 10_000 }, async (t) => {
  const { host, provider, providers } = await setup(t);
  const agent = host.addAgent('s1', 'fake');
  host.emit('agent/created', { agent });
  const started = Promise.withResolvers<void>();
  const closing = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const refreshStarted = Promise.withResolvers<void>();
  const refreshed = Promise.withResolvers<any>();
  const driver = provider.created[0];
  driver.start = async () => {
    return {
      nativeSessionId: 'native-live',
      events: { async *[Symbol.asyncIterator]() { started.resolve(); await released.promise; } },
      async close() { closing.resolve(); await released.promise; },
    };
  };
  const stream = host.adapters.get('fake').stream({
    sessionId: agent.id, messages: [{ id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'work' }] }],
  });
  const reading = stream.next();
  await started.promise;
  await new Promise((resolve) => setImmediate(resolve));
  provider.probe = () => { refreshStarted.resolve(); return refreshed.promise; };
  const refreshing = providers.refresh();
  await refreshStarted.promise;
  let stopped = false;
  const disposal = providers.close();
  assert.equal(providers.close(), disposal, 'every caller waits for the same shutdown');
  disposal.then(() => { stopped = true; });
  t.after(() => { refreshed.resolve(ready()); released.resolve(); });
  await closing.promise;
  assert.equal(host.adapters.size, 0, 'no new work can enter while native teardown proceeds');
  assert.equal(stopped, false);
  refreshed.resolve(ready());
  await refreshing;
  assert.equal(stopped, false, 'finishing the probe is not a native exit receipt');
  released.resolve();
  await Promise.all([disposal, reading]);
  assert.equal(stopped, true);
  assert.equal(provider.created.length, 1, 'a late probe must not register a replacement during shutdown');
});

test('restored agents use the durable selected provider instead of the host default', async (t) => {
  const { host } = await setup(t);
  host.providerOf = (agent: any) => agent.selection?.provider;
  const restored = host.addAgent('restored', 'deepseek-official');
  restored.selection = { provider: 'fake' };
  host.emit('agent/created', { agent: restored });
  assert.deepEqual([...restored.tools.keys()], ['Bash', 'Read']);
});

test('a request registers the executing harness tools when the cached host options use another route', async (t) => {
  const { host } = await setup(t);
  const restored = host.addAgent('restored', 'deepseek-official');
  host.emit('agent/created', { agent: restored });
  const steps = host.adapters.get('fake').stream({
    sessionId: restored.id, messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Check tools.' }] }],
  });
  await assert.rejects(steps.next(), /not needed/);
  assert.deepEqual([...restored.tools.keys()], ['Bash', 'Read']);
});

test('refresh and provider replacement remove stale mirror closures and bind the current bridge', async (t) => {
  const { host, provider, providers } = await setup(t);
  const agent = host.addAgent('s1', 'fake');
  host.emit('agent/created', { agent });
  const first = agent.tools.get('Bash');
  await providers.save({ id: 'fake', enabled: false });
  assert.equal(agent.tools.size, 0);
  await providers.save({ id: 'fake', enabled: true });
  assert.equal(agent.tools.size, 2);
  assert.notEqual(agent.tools.get('Bash'), first);
  const second = agent.tools.get('Bash');
  provider.detection = ready('/updated/fake-cli');
  await providers.refresh();
  assert.equal(agent.tools.size, 2);
  assert.notEqual(agent.tools.get('Bash'), second);
});

test('partial registration failure rolls back tools and can be retried', async (t) => {
  const { host } = await setup(t);
  const agent = host.addAgent('s1', 'fake');
  const register = agent.ctx.tools.register;
  agent.ctx.tools.register = (definition: any) => {
    if (definition.name === 'Read') throw new Error('Fixture registration failure.');
    return register(definition);
  };
  assert.throws(() => host.emit('agent/created', { agent }), /registration failure/);
  assert.equal(agent.tools.size, 0);
  agent.ctx.tools.register = register;
  host.emit('agent/created', { agent });
  assert.equal(agent.tools.size, 2);
});

test('agents that exist when the plugin loads are covered, and closing leaves nothing registered', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-providers-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const host = fakeHost();
  const early = host.addAgent('s1', 'fake');
  const providers = await createProviders({ host, providers: [fakeProvider()], folder, log: { warn() {} } });
  assert.equal(early.tools.size, 2);
  await providers.close();
  assert.equal(host.adapters.size, 0);
  assert.equal(early.tools.size, 0);
});

test('the settings page talks to it with JSON actions and gets a plain error for a bad request', async (t) => {
  const { providers } = await setup(t);
  const state = await (await providers.handle('state')).json();
  assert.equal(state.providers[0].id, 'fake');
  const bad = await providers.handle('save', new Request('http://x/api/dudu/providers/save', { method: 'POST', body: JSON.stringify({ id: 'nope' }) }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Unknown provider/);
  assert.equal((await providers.handle('other')).status, 404);
});

test('refreshing asks a harness that is still the same for its models again', async (t) => {
  const { provider, providers } = await setup(t);
  assert.equal(provider.created[0].refreshed, 0);
  await providers.refresh();
  assert.equal(provider.created.length, 1, 'the same binary keeps its registration');
  assert.equal(provider.created[0].refreshed, 1);
});

test('the harnesses that are found and enabled are what the sessions list reads from', async (t) => {
  const { providers } = await setup(t);
  const sources = providers.sources();
  assert.deepEqual(sources.map((source: any) => [source.id, source.name, source.route, source.command]), [['fake', 'Fake fake', 'fake', '/bin/fake-cli']]);
  assert.equal(typeof sources[0].driver.listModels, 'function');
  await providers.save({ id: 'fake', enabled: false });
  assert.deepEqual(providers.sources(), [], 'a harness that is turned off has no sessions to show');
});
