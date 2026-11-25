import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '../host/providers/index.mjs';
import { AsyncQueue } from '../host/providers/async.mjs';
import { OarNormalizer, startOarRun } from '../host/providers/oar.mjs';

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
    create({ installation, env }: { installation: { command: string }; env?: () => Record<string, string> }) {
      const driver = {
        id, name: `Fake ${id}`, route: id, path: installation.command, env, refreshed: 0, tools: [{ name: 'Bash' }, { name: 'Read' }],
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
    id: 'fake', name: 'Fake fake', route: 'fake', enabled: true, configuredPath: '', env: {}, state: 'missing', version: undefined, path: undefined, reason: 'fake-cli was not found.',
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

// The harnesses added on 2026-11-19 are off until a person switches them on: one that happens to be installed is no agent by itself.
test('a harness that is off by default is found and listed but is no route until switched on, and the choice outlives a restart', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-providers-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const start = async () => {
    const host = fakeHost();
    const provider: any = fakeProvider('rare');
    provider.defaultEnabled = false;
    const providers = await createProviders({ host, providers: [provider], folder, log: { warn() {} } });
    return { host, providers };
  };
  const first = await start();
  assert.equal(first.host.adapters.has('rare'), false, 'found, and still not a route');
  assert.deepEqual([first.providers.state().providers[0].state, first.providers.state().providers[0].enabled, first.providers.state().providers[0].defaultEnabled], ['ready', false, false]);
  await first.providers.save({ id: 'rare', enabled: true });
  assert.equal(first.host.adapters.has('rare'), true);
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'providers.json'), 'utf8')), { disabled: [], paths: {}, enabled: ['rare'] });
  await first.providers.close();

  const again = await start();
  t.after(() => again.providers.close());
  assert.equal(again.host.adapters.has('rare'), true, 'switched on is remembered');
  await again.providers.save({ id: 'rare', enabled: false });
  assert.equal(again.host.adapters.has('rare'), false);
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'providers.json'), 'utf8')), { disabled: [], paths: {} }, 'back at its default, nothing is written about it');
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

test('a provider\'s own environment variables are saved privately, outlive a restart and are what its next process is given', async (t) => {
  const { provider, providers, folder } = await setup(t);
  const file = join(folder, 'providers.json');
  const expected = { HTTPS_PROXY: 'http://127.0.0.1:7890', NO_PROXY: 'localhost,127.0.0.1' };
  await providers.save({ id: 'fake', env: 'HTTPS_PROXY=http://127.0.0.1:7890\n\n# the proxy\nexport NO_PROXY="localhost,127.0.0.1"' });
  assert.deepEqual(providers.state().providers[0].env, expected);
  assert.deepEqual(provider.created.at(-1).env(), expected, 'read when a process starts');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).env, { fake: expected });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(providers.save({ id: 'fake', env: 'HTTPS_PROXY=http://other\nnot a variable' }), /Line 2 is not NAME=value/);
  assert.deepEqual(providers.state().providers[0].env, expected, 'a refused set changes nothing');

  const again = await createProviders({ host: fakeHost(), providers: [provider], folder, log: { warn() {} } });
  t.after(() => again.close());
  assert.deepEqual(again.state().providers[0].env, expected, 'kept across a restart');
  await again.save({ id: 'fake', env: {} });
  assert.deepEqual(provider.created.at(-1).env(), {});
  assert.equal(JSON.parse(await readFile(file, 'utf8')).env, undefined, 'none left: nothing written');
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

test('host-served MCP tools are executable before the first step and follow the selected route', async t => {
  const { host, providers, provider } = await setup(t);
  const name = 'mcp__dudu__ask_user_question';
  host.sessionTools = { names: () => [name], close: async () => {} };
  const driver = provider.created[0];
  driver.fallbackTool = (name: string) => ({ name });
  driver.knowsTool = () => false;
  const agent = host.addAgent('question-session', 'fake');
  host.emit('agent/created', { agent });
  assert.ok(agent.tools.has(name), 'the tool exists before the model starts streaming');
  const first = agent.tools.get(name);
  // Route refresh keeps the same tool closure; changing away removes it.
  await providers.refresh();
  assert.equal(agent.tools.get(name), first);
  const late = host.addAgent('initial-provider-session', 'deepseek-official');
  host.emit('agent/created', { agent: late });
  late.options.provider = 'fake';
  host.emit('session/event', { id: late.id }, { type: 'step/start', data: { turn: 1, step: 1 } });
  assert.ok(late.tools.has(name), 'an initial provider applied after agent creation needs no model/selection event');
  host.emit('session/event', { id: agent.id }, { type: 'model/selection', data: { provider: 'deepseek-official' } });
  assert.equal(agent.tools.has(name), false);
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

test('next-step input releases a native background wait so DSH can claim and deliver it once', async t => {
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const user = (id: string, text: string) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
  for (const timing of ['before-root-end', 'after-root-end']) {
    const folder = await mkdtemp(join(tmpdir(), 'dudu-background-input-'));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const host = fakeHost();
    const agent = host.addAgent('background-session', 'fake');
    agent.inbox = { nextStep: [], nextTurn: [] };
    const original = user('first', 'Start monitoring.');
    const followup = user('second', 'How is it going?');
    const another = user('third', 'Has it finished?');
    const events: any[] = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: original }];
    host.eventsOf = async () => events;
    const provider = fakeProvider();
    const providers = await createProviders({ host, providers: [provider], folder, log: { warn() {} } });
    t.after(() => providers.close());
    const observers = new Set<Function>();
    let seq = 0;
    let starts = 0;
    let disposed = 0;
    const delivered: string[] = [];
    const inputArrived = Promise.withResolvers<void>();
    const emit = (nativeEvents: any[]) => {
      for (const observer of observers) observer({
        kind: 'frame', seq: ++seq, sessionId: 'native-monitor', agentPath: [], body: { events: nativeEvents },
      });
    };
    const session = {
      id: 'native-monitor',
      rawEvents(observer: Function) { observers.add(observer); return () => observers.delete(observer); },
      async prompt() {
        emit([{ kind: 'task_started', taskId: 'monitor', taskType: 'shell', background: true },
          { kind: 'text_delta', text: 'Monitoring.' }]);
        return { kind: 'accepted' };
      },
      async deliver(text: string, options: any) {
        delivered.push(text);
        emit([{ kind: 'turn_active' }, { kind: 'user_message', inputId: options.inputId }]);
        if (delivered.length === 2) inputArrived.resolve();
        return { landed: 'prompted', result: { kind: 'accepted' } };
      },
      abort: async () => ({ kind: 'accepted' }),
      async dispose() { disposed++; },
    };
    provider.created[0].start = (options: any) => {
      starts++;
      return startOarRun({
        runtime: { session: async () => session }, installation: {}, sessionOptions: {},
        normalizer: new OarNormalizer({ name: 'Fake', login: '' }), name: 'Fake', queuesSteer: true,
        ...options,
      });
    };
    const adapter = host.adapters.get('fake');
    const firstStream = adapter.stream({ sessionId: agent.id, messages: [original] });
    const firstChunks: any[] = [(await firstStream.next()).value];
    let firstFinished = false;
    const first = (async () => {
      for await (const chunk of firstStream) firstChunks.push(chunk);
      firstFinished = true;
    })();
    const enqueue = () => {
      agent.inbox.nextStep.push(followup, another);
      host.emit('session/event', agent.session, {
        type: 'agent/inbox/spliced', data: { target: 'next-step', inserted: [followup, another] },
      });
    };
    // Session events carry the session identity, as the real host does.
    agent.session.id = agent.id;
    if (timing === 'before-root-end') enqueue();
    emit([{ kind: 'turn_ended', outcome: { kind: 'completed' } }]);
    await flush();
    assert.equal(disposed, 0);
    if (timing === 'after-root-end') {
      assert.equal(firstFinished, false, 'without input, keep listening for native completion notifications');
      agent.inbox.nextTurn.push(user('queued', 'A later turn.'));
      host.emit('session/event', agent.session, {
        type: 'agent/inbox/spliced', data: { target: 'next-turn', inserted: agent.inbox.nextTurn },
      });
      await flush();
      assert.equal(firstFinished, false, 'the deliberately queued turn must keep its existing semantics');
      enqueue();
    }
    await flush();
    assert.equal(firstFinished, true, `${timing}: DSH must receive its step boundary before it can claim new input`);
    await first;
    assert.equal(firstChunks.at(-1).reason.kind, 'stop');
    assert.equal(firstChunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'Monitoring.');
    assert.equal(delivered.length, 0, 'inbox insertion alone must not bypass DSH admission');

    const answer = { role: 'assistant', content: [{ type: 'text', text: 'Monitoring.' }],
      source: { kind: 'model', provider: 'fake', replayState: { nativeSessionId: session.id } } };
    // DSH owns this claim and durable user/message; the plugin only releases its waiting step.
    agent.inbox.nextStep.splice(0);
    events.push({ type: 'assistant/message', data: { message: answer } },
      { type: 'user/message', data: followup }, { type: 'user/message', data: another });
    const next = (async () => {
      const chunks: any[] = [];
      for await (const chunk of adapter.stream({ sessionId: agent.id, messages: [original, answer, followup, another] })) chunks.push(chunk);
      return chunks;
    })();
    await inputArrived.promise;
    assert.deepEqual(delivered, ['How is it going?', 'Has it finished?']);
    assert.equal(starts, 1, 'new input reuses the process that owns the live monitor');
    assert.equal(disposed, 0, 'delivering input must not stop background work');
    emit([{ kind: 'task_ended', taskId: 'monitor', status: 'completed' },
      { kind: 'text_delta', text: 'It is done.' }, { kind: 'turn_ended', outcome: { kind: 'completed' } }]);
    const nextChunks = await next;
    assert.equal(nextChunks.at(-1).reason.kind, 'stop');
    assert.equal(nextChunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'It is done.');
    assert.equal(starts, 1);
    assert.deepEqual(delivered, ['How is it going?', 'Has it finished?']);
    await providers.close();
  }
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

test('foreground HTTP observation follows the current run without changing execution or leaking another session state', async t => {
  const { host, provider, providers } = await setup(t);
  const agent = host.addAgent('s1', 'fake');
  host.emit('agent/created', { agent });
  const events = new AsyncQueue();
  const started = Promise.withResolvers<void>();
  const observing = Promise.withResolvers<void>();
  provider.created[0].start = async () => {
    started.resolve();
    return {
      nativeSessionId: 'native-live',
      events: { async *[Symbol.asyncIterator]() { observing.resolve(); for (;;) { const next = await events.next(); if (next.done) return; yield next.value; } } },
      close() { events.push({ type: 'turn-end', ok: true }); events.close(); },
    };
  };
  const stream = host.adapters.get('fake').stream({
    sessionId: agent.id, messages: [{ id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'work' }] }],
  });
  const reading = stream.next();
  await started.promise;
  await observing.promise;
  assert.equal(providers.hasActiveWork(agent.id), true);
  assert.equal(providers.hasActiveWork('another'), false, 'work is scoped to its own session');
  const read = (body: unknown) => providers.handle('foreground', new Request('http://x/api/dudu/providers/foreground', {
    method: 'POST', body: JSON.stringify(body),
  }));
  assert.deepEqual(await (await read({ sessionId: agent.id })).json(), { backgroundOnly: false });
  const idle = read({ sessionId: agent.id, after: false });
  events.push({ type: 'foreground-state', active: false });
  assert.deepEqual(await (await idle).json(), { backgroundOnly: true });
  assert.equal(providers.hasActiveWork(agent.id), true, 'yielding the foreground does not make background work asleep');
  assert.deepEqual(await (await read({ sessionId: 'another' })).json(), { backgroundOnly: false });
  const resumed = read({ sessionId: agent.id, after: true });
  events.push({ type: 'foreground-state', active: true });
  assert.deepEqual(await (await resumed).json(), { backgroundOnly: false });
  assert.equal((await read({ sessionId: agent.id, after: 'false' })).status, 400);
  events.push({ type: 'foreground-state', active: false });
  await new Promise(resolve => setImmediate(resolve));
  const closing = read({ sessionId: agent.id, after: true });
  await providers.close();
  assert.equal(providers.hasActiveWork(agent.id), false);
  assert.deepEqual(await (await closing).json(), { backgroundOnly: false });
  await reading;
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
