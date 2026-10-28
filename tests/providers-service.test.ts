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
    adapters, agents,
    llm: {
      registerAdapter(routes: string[], adapter: any) {
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
    const agent = { id, options: { provider }, ctx: { tools: { register(definition: any) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } } }, tools };
    agents.set(id, agent);
    return agent;
  };
  return host;
}

function fakeDriver(id = 'fake') {
  const created: any[] = [];
  return {
    id, name: `Fake ${id}`, route: id, binary: `${id}-cli`, minVersion: '1.0.0', created,
    create({ path }: { path: string }) {
      const closed: string[] = [];
      const driver = { id, name: `Fake ${id}`, route: id, path, closed, tools: [{ name: 'Bash' }, { name: 'Read' }], listModels: async () => [], resolveModel: async (model: string) => ({ id: model, name: model }), start: async () => { throw new Error('not needed'); } };
      created.push(driver);
      return driver;
    },
  };
}

async function setup(t: { after: (callback: () => Promise<unknown>) => void }, detections: Record<string, any>) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-providers-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const host = fakeHost();
  const driver = fakeDriver();
  const calls: any[] = [];
  const providers = await createProviders({
    host, drivers: [driver], folder,
    detect: async (request: any) => { calls.push(request); return detections.current ?? { state: 'ready', path: '/bin/fake-cli', version: '1.2.3' }; },
    log: { warn() {} },
  });
  t.after(() => providers.close());
  return { host, driver, providers, folder, calls };
}

test('a ready harness becomes a model route; a missing one does not, and says why', async (t) => {
  const missing = await setup(t, { current: { state: 'missing', reason: 'fake-cli was not found.' } });
  assert.equal(missing.host.adapters.size, 0);
  assert.deepEqual(missing.providers.state().providers[0], {
    id: 'fake', name: 'Fake fake', route: 'fake', enabled: true, configuredPath: '', state: 'missing', version: undefined, path: undefined, reason: 'fake-cli was not found.',
  });

  const ready = await setup(t, {});
  assert.ok(ready.host.adapters.has('fake'));
  assert.equal(ready.providers.state().providers[0].state, 'ready');
  assert.equal(ready.driver.created[0].path, '/bin/fake-cli');
});

test('turning a provider off removes its route and turning it on brings it back; the choice is saved privately', async (t) => {
  const { host, providers, folder } = await setup(t, {});
  await providers.save({ id: 'fake', enabled: false });
  assert.equal(host.adapters.has('fake'), false);
  assert.equal(providers.state().providers[0].enabled, false);
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'providers.json'), 'utf8')), { disabled: ['fake'], paths: {} });
  assert.equal((await stat(join(folder, 'providers.json'))).mode & 0o777, 0o600);
  await providers.save({ id: 'fake', enabled: true });
  assert.equal(host.adapters.has('fake'), true);
});

test('a configured path is what detection looks at, and a different path replaces the route', async (t) => {
  const detections: any = {};
  const { host, driver, providers, calls } = await setup(t, detections);
  detections.current = { state: 'ready', path: '/custom/fake-cli', version: '2.0.0' };
  await providers.save({ id: 'fake', path: ' /custom/fake-cli ' });
  assert.equal(calls.at(-1).override, '/custom/fake-cli');
  assert.equal(driver.created.at(-1).path, '/custom/fake-cli');
  assert.equal(host.adapters.size, 1);
  assert.equal(driver.created.length, 2, 'a changed binary is a new route registration');
  await providers.save({ id: 'fake', path: '' });
  assert.equal(calls.at(-1).override, undefined);
  await assert.rejects(providers.save({ id: 'nope', enabled: true }), /Unknown provider/);
});

test('an agent gets mirror tools while its route is the harness, from creation or from a later selection', async (t) => {
  const { host } = await setup(t, {});
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

test('disposing an agent removes its tools and stops its harness run', async (t) => {
  const { host } = await setup(t, {});
  const agent = host.addAgent('s1', 'fake');
  host.emit('agent/created', { agent });
  assert.equal(agent.tools.size, 2);
  host.emit('agent/disposed', { agent });
  assert.equal(agent.tools.size, 0);
});

test('agents that exist when the plugin loads are covered, and closing leaves nothing registered', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-providers-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const host = fakeHost();
  const early = host.addAgent('s1', 'fake');
  const providers = await createProviders({ host, drivers: [fakeDriver()], folder, detect: async () => ({ state: 'ready', path: '/bin/x', version: '1.0.0' }), log: { warn() {} } });
  assert.equal(early.tools.size, 2);
  await providers.close();
  assert.equal(host.adapters.size, 0);
  assert.equal(early.tools.size, 0);
});

test('the settings page talks to it with JSON actions and gets a plain error for a bad request', async (t) => {
  const { providers } = await setup(t, {});
  const state = await (await providers.handle('state')).json();
  assert.equal(state.providers[0].id, 'fake');
  const bad = await providers.handle('save', new Request('http://x/api/dudu/providers/save', { method: 'POST', body: JSON.stringify({ id: 'nope' }) }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Unknown provider/);
  assert.equal((await providers.handle('other')).status, 404);
});
