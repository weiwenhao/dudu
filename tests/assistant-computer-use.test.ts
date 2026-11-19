import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConversation } from '../host/assistant/home/conversation.mjs';
import { executeNativeTool } from '../host/dsh-tools.mjs';

// Only scripted DSH services: no host instance, model, desktop helper or GUI is started.
const stepTools = (agent: any, names: string[]) => ({
  view: (scope: any) => new Map(scope === agent ? names.map((name) => [name, { name }]) : []),
});

function world(t: any, capability: 'absent' | 'disabled' | 'legacy' | 'enabled') {
  const folder = mkdtempSync(join(tmpdir(), 'dudu-cua-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'conversation.json');
  const model = { provider: 'deepseek', model: 'flash' };
  const sessionId = 'dudu-assistant-cua-unit';
  writeFileSync(file, JSON.stringify({ sessionId, created: true, agentPreset: 'ptc' }));
  const registered = new Map<string, any>();
  const inherited = ['bash', 'mcp__mail__search', 'plugin_install'];
  const hooks: Record<string, any> = {};
  const seen: any = {
    mounts: [], restrictions: [], selections: [], nativeCalls: [], disposed: false,
    provider: capability === 'enabled' || capability === 'legacy',
  };
  let preset = 'ptc';
  let selected: any = null;
  const agent: any = {
    status: 'idle', options: model,
    session: { id: sessionId, seq: 0, append(type: string, data: any) {
      this.seq++;
      if (type === 'agent-preset/selected') preset = data.agentPreset;
    } },
  };
  const scope: any = {
    tools: {
      restrict: ({ allow }: any) => { seen.restrictions.push(allow); return () => {}; },
      guard: (guard: any) => { seen.guard = guard; },
      register: (tool: any) => { registered.set(tool.name, tool); },
      setExecutor: (executor: any) => { seen.selections.push(executor); selected = executor; },
    },
    systemPrompt: { suppressRuntimeContext() {}, variable() {} },
    on: (name: string, handler: any) => { hooks[name] = handler; },
  };
  class NativeToolExecutor {
    constructor(context: any) { assert.equal(context, scope); }
    async execute(input: any) {
      seen.nativeCalls.push(input);
      const call = input.calls[0];
      const denied = seen.guard({ name: call.name, agent: input.agent, toolSet: input.toolSet });
      return { results: [{ callId: call.id, result: { isError: Boolean(denied), content: [{ type: 'text', text: denied ?? 'host result' }] } }] };
    }
  }
  const tools = {
    view: () => ({ restrictableNames: inherited }),
    schemas: (scope: any, toolSet: any) => [
      ...inherited.filter((name) => seen.restrictions.at(-1)?.includes(name)).map((name) => ({ name })),
      ...registered.values(),
    ].filter((tool) => !toolSet || toolSet.view(scope).has(tool.name)),
    get: () => ({ annotations: { readOnlyHint: true } }),
    selectExecutor: () => selected,
    execute: (input: any) => {
      assert.ok(selected, 'connector calls keep using the selected native executor');
      return selected.execute(input);
    },
  };
  const ctx: any = {
    on: () => () => {},
    ...(capability === 'absent' ? {} : { get: (name: string) => {
      assert.equal(name, 'computerUse');
      return seen.provider ? { providerName: 'dsh-cua' } : {};
    } }),
    tools, loader: { import: async (name: string) => {
      assert.equal(name, '@deepseek-ai/dsh-tool-executor-native');
      return { NativeToolExecutor };
    } },
    agentPresets: { mount: async (context: any, id: string) => {
      assert.equal(context, scope);
      seen.mounts.push(id);
      return { id };
    } },
    sessionProjections: { stateOf: (_session: any, name: string) => name === 'agentPreset' ? preset : { pending: model } },
    sessionController: { modelCatalog: async () => ({ default: model, groups: [{ id: model.provider, models: [{ id: model.model }] }] }) },
    sessionQuery: { readSession: async () => ({ events: [] }) },
    agents: { resume: async (input: any) => {
      assert.equal(input.resumeSessionId, sessionId);
      await input.setup(scope, agent);
      // Optional host contributions may arrive after setup, on agent/created.
      if (capability === 'enabled') inherited.push('cua_run_code');
      // A raw global/legacy binding is insufficient and must stay hidden.
      if (seen.provider) inherited.push('cua');
      hooks['tools/change']();
      return { agent, dispose: async () => { seen.disposed = true; } };
    } },
  };
  const assistant = {
    folder, memory: { context: () => ({ files: [], skills: [] }) },
    settings: { value: () => ({ model, permission: 'danger-full-access' }) },
    connectors: { dudu: { list: (): any => ({ connectors: [] }) } },
  };
  const conversation = createConversation({
    ctx, assistant, issues: { list: () => ({ items: [] }), counts: () => ({}) },
    assignment: {}, dashboard: {}, dsh: {}, file,
  });
  t.after(() => conversation.close());
  return { conversation, assistant, agent, registered, inherited, hooks, seen, file };
}

for (const capability of ['absent', 'disabled', 'legacy', 'enabled'] as const) {
  test(`Dudu stays native with ${capability} host Computer Use`, async (t) => {
    const { conversation, assistant, agent, registered, inherited, hooks, seen, file } = world(t, capability);
    const enabled = capability === 'enabled';
    const state = await conversation.ensure();
    assert.equal(state.sessionId, agent.session.id, 'keep the existing conversation and history');
    assert.deepEqual(seen.mounts, ['standard']);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).agentPreset, 'standard');
    assert.equal(seen.selections.length, 1, 'Computer Use never replaces the main native executor');
    assert.deepEqual(seen.restrictions[0], ['bash', 'mcp__mail__search', 'plugin_install']);
    assert.deepEqual(seen.restrictions.at(-1), enabled ? ['bash', 'cua_run_code', 'mcp__mail__search', 'plugin_install'] : ['bash', 'mcp__mail__search', 'plugin_install']);
    assert.equal(seen.guard({ name: 'issues_list', agent }), undefined);
    assert.equal(seen.guard({ name: 'bash', agent }), undefined);
    assert.ok(seen.guard({ name: 'run_code', agent }));
    assert.ok(seen.guard({ name: 'run_code', parent: {}, agent }));
    assert.equal(seen.guard({ name: 'plugin_install', parent: {}, agent }), undefined, 'inherit host capabilities in the standard session scope');
    assert.ok(seen.guard({ name: 'plugin_install', parent: {}, agent, toolSet: stepTools(agent, ['bash']) }), 'inherited capabilities retain the host admission mask');
    assert.ok(seen.guard({ name: 'not_registered', parent: {}, agent }), 'a parent token grants no missing capability');
    assert.ok(seen.guard({ name: 'cua', agent }));
    assert.equal(seen.guard({ name: 'cua_run_code', agent }) === undefined, enabled);
    const toolSet = stepTools(agent, ['bash']);
    assert.ok(seen.guard({ name: 'cua_run_code', agent, toolSet }), 'retain the step admission mask');

    const sections = ['deployment:persona-prefix', 'tools:ptc-only', 'computer-use:dsh-cua', 'tools:sdk']
      .map((name) => ({ name, text: `host-owned ${name}`, interpolate: false }));
    const assembly = await hooks['system-prompt/assemble']({}, {}, async () => ({ sections, contexts: [], variables: { cwd: assistant.folder } }));
    assert.equal(assembly.sections[0].name, 'dudu:context');
    assert.deepEqual(assembly.sections.slice(1), enabled ? [sections[2]] : [], 'keep the official CUA guidance without general PTC-only instructions');
    assert.equal(assembly.variables.cwd, assistant.folder);

    await assert.rejects(conversation.dshConnectors.call('mcp__mail__search', {}), /inside the assistant/);
    const signal = new AbortController().signal;
    assistant.connectors.dudu.list = () => conversation.dshConnectors.call('mcp__mail__search', { query: 'owner' });
    assert.equal(JSON.parse(await registered.get('connector_list').execute({}, { agent, callId: 'nested', signal, toolSet: undefined })), 'host result');
    assert.equal(seen.nativeCalls.length, 1);
    assert.equal(seen.nativeCalls[0].agent, agent);
    assert.equal(seen.nativeCalls[0].signal, signal);
    assert.equal(seen.nativeCalls[0].calls[0].name, 'mcp__mail__search');

    if (enabled) inherited.splice(inherited.indexOf('cua_run_code'), 1);
    hooks['tools/change']();
    assert.ok(seen.guard({ name: 'cua_run_code', agent }), 'an unloaded standalone tool stops being callable');
    await conversation.close();
    assert.equal(seen.disposed, true);
  });
}

test('only an active standalone Computer Use dispatch can invoke its private CUA binding', async (t) => {
  const { conversation, agent, hooks, seen } = world(t, 'enabled');
  await conversation.ensure();
  const root = { name: 'cua_run_code', token: Symbol('root'), rootCallId: 'cua-one', agent };
  const nested = { name: 'cua', parent: root.token, rootCallId: root.rootCallId, agent };
  assert.ok(seen.guard(nested), 'an arbitrary parent token is not authorization');
  await hooks['tools/execute'](root, async () => {
    assert.equal(seen.guard(nested), undefined);
    assert.ok(seen.guard({ ...nested, agent: {} }), 'another agent cannot reuse the parent token');
    assert.ok(seen.guard({ ...nested, rootCallId: 'other' }), 'another root call cannot reuse the token');
    assert.ok(seen.guard({ ...nested, name: 'run_code' }), 'the entry does not grant a general program transport');
    assert.equal(seen.guard({ ...nested, name: 'plugin_install' }), undefined, 'the ordinary inherited capability is still available');
    assert.ok(seen.guard({ ...nested, name: 'not_registered' }), 'Computer Use does not invent additional capabilities');
    assert.ok(seen.guard({ ...nested, name: 'bash', toolSet: stepTools(agent, ['cua']) }), 'nested calls retain their admission mask');
    seen.provider = false;
    assert.ok(seen.guard(nested), 'provider removal also revokes an active binding');
    seen.provider = true;
  });
  assert.ok(seen.guard(nested), 'the token expires when the program settles');
  await assert.rejects(hooks['tools/execute'](root, async () => { throw new Error('cancelled'); }), /cancelled/);
  assert.ok(seen.guard(nested), 'failed and cancelled dispatches release their binding too');

  const hidden = { ...root, toolSet: stepTools(agent, ['bash']) };
  await hooks['tools/execute'](hidden, async () => {
    assert.ok(seen.guard(nested), 'a program hidden by the step cannot acquire a private binding');
  });
});

test('programmatic native calls retain legacy dispatch and propagate modern errors and missing results', async () => {
  const call = { name: 'read', arguments: { path: '/work/file' }, callId: 'read-one', toolSet: stepTools(undefined, ['read']), signal: new AbortController().signal };
  const legacy = { execute: async (input: any) => { assert.equal(input, call); return 'legacy result'; } };
  assert.equal(await executeNativeTool(legacy, call), 'legacy result');
  const failure = { isError: true, content: [{ type: 'text', text: 'denied by host' }] };
  const modern = { selectExecutor() {}, execute: async (input: any) => {
    assert.equal(input.toolSet, call.toolSet);
    assert.equal(input.signal, call.signal);
    assert.equal(input.calls[0].arguments, JSON.stringify(call.arguments));
    return { results: [{ callId: call.callId, result: failure }] };
  } };
  assert.equal(await executeNativeTool(modern, call), failure);
  await assert.rejects(executeNativeTool({ ...modern, execute: async () => ({ results: [] }) }, call), { code: 'UNSUPPORTED' });
});
