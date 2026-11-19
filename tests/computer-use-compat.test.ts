import assert from 'node:assert/strict';
import test from 'node:test';
import { captureComputerUseProvider } from '../host/computer-use/provider-context.mjs';
import { createComputerUseProgram } from '../host/computer-use/engine.mjs';
import { installComputerUseRegistration } from '../host/computer-use/registration.mjs';
import { apply as applyProvider } from '../host/computer-use/provider.mjs';

// Contract tests only: no DSH app, model, native helper, input or GUI is started.
const initialization = 'var cua = officialFacade(() => tools.cua);';
const guidance = `official guidance

In persistent PTC, use the host-provided bridge initialization once and retain the returned objects; cua comes from that bridge and is not a preinstalled global. Use void await for observations that emit, and never stringify screenshot image bytes.

In persistent PTC, capture a large tree with const tree = await win.getAccessibilityTree({ emit: false }). Filter its lines in memory, or save it with await tools.write({ file_path: path, content: tree }) to a new workspace file. Search its contents with tools.grep({ path, pattern }) and use tools.read around a matching line. Print only the matches you need. Use element ids from the file only while that observation is current.

- cua.getCapabilities() inspects permissions without requesting them.
- sendKeyEvent holds keys only until this run_code returns; respect the user's application consent.`;
const rawPrompt = () => ({
  name: 'computer-use:dsh-cua',
  text: () => `${guidance}\n\nPersistent PTC initialization:\n\`\`\`ts\n${initialization}\n\`\`\``,
});

test('the wrapper captures official CUA registration and adapts only the native key-lifetime observer', async () => {
  const calls: any[] = [];
  const events: Record<string, any> = {};
  const ctx: any = {
    tools: { register: () => assert.fail('raw tool must not be globally registered') },
    systemPrompt: { section: () => assert.fail('guidance must stay scoped') },
    get: (name: string) => name === 'ptcRuntime' ? { retainsState: false } : { name },
    effect: (effect: any) => calls.push(effect),
    on: (name: string, handler: any) => { events[name] = handler; },
  };
  const captured = captureComputerUseProvider(ctx);
  const tool = { name: 'cua', execute() {} };
  captured.context.tools.register(tool);
  const prompt = {
    name: 'computer-use:dsh-cua',
    text: () => captured.context.get('ptcRuntime').retainsState
      ? rawPrompt().text() : 'official guidance',
  };
  captured.context.systemPrompt.section(prompt);
  const registration = captured.registrations();
  assert.equal(registration.tool, tool);
  assert.equal(registration.prompt, prompt, 'original PTC consumers retain the provider’s unmodified prompt');
  assert.equal(registration.initialization, initialization);
  assert.equal(registration.programPrompt.name, prompt.name);
  assert.equal(registration.programPrompt.interpolate, false);
  const programText = registration.programPrompt.text;
  assert.ok(programText.includes('cua_run_code'));
  assert.ok(programText.includes('cua.getCapabilities()'));
  assert.ok(programText.includes('respect the user\'s application consent'));
  assert.ok(programText.includes('Use void await for observations that emit, and never stringify screenshot image bytes.'));
  assert.doesNotMatch(programText, /\brun_code\b|tools\.(write|grep|read)\b|Persistent PTC initialization|initialize.*once/);
  assert.equal(captured.context.get('ptcRuntime').retainsState, false, 'do not change the real runtime configuration');
  captured.context.effect(() => undefined);
  assert.equal(calls.length, 1, 'native lifetimes still belong to the actual host context');
  const token = Symbol('host token');
  captured.context.on('tools/execute', async (exec: any, next: any) => {
    assert.equal(exec.name, 'run_code');
    assert.equal(exec.token, token);
    return next();
  });
  const exec = { name: 'cua_run_code', token };
  assert.equal(await events['tools/execute'](exec, async () => 'released'), 'released');
  assert.equal(exec.name, 'cua_run_code', 'do not rename the actual host execution');
});

test('on a newer host the wrapper delegates to its native implementation with the owner’s existing config', async () => {
  const config = { agentPreset: 'ptc', timeoutMs: 19000, allowedApps: [{ id: 'saved-grant' }] };
  const ctx: any = {
    get: (name: string) => name === 'configEditor' ? {
      entries: () => [{ options: { id: 'cua', name: '@deepseek-ai/dsh-experimental-cua-macos', config } }],
    } : undefined,
    loader: { import: async (name: string) => ({
      '@deepseek-ai/dsh-experimental-cua-macos': {
        Config: (value: any) => value,
        apply: (context: any, value: any) => {
          assert.equal(context, ctx);
          assert.equal(value, config);
          return 'native host';
        },
      },
      '@deepseek-ai/dsh-cua': { CuaPrograms: class {} },
      '@deepseek-ai/cordis-plugin-loader': { interpolate: (_context: any, value: any) => value },
    })[name] },
  };
  assert.equal(await applyProvider(ctx), 'native host');
});

test('compatibility registration preserves other agents and the existing PTC raw tool scope', async () => {
  const agents = [
    { session: { id: 'dudu-assistant-owner' }, preset: 'standard' },
    { session: { id: 'issue-123' }, preset: 'standard' },
    { session: { id: 'dudu-assistant-task-123' }, preset: 'standard' },
    { session: { id: 'dudu-assistant-intake-123' }, preset: 'standard' },
    { session: { id: 'existing-ptc' }, preset: 'ptc' },
  ].map((agent) => ({ ...agent, ctx: {} }));
  const rootHooks: Record<string, any> = {};
  const registered = new Map<any, any[]>();
  const scopes: any[] = [];
  const rootEffects: any[] = [];
  const warnings: any[] = [];
  let programError: Error | null = null;
  const tool = { name: 'cua' };
  const prompt = { name: 'computer-use:dsh-cua', text: 'official guidance' };
  const makeFork = (run: () => any) => {
    const ready = Promise.resolve().then(run);
    return { then: ready.then.bind(ready), dispose: async () => {} };
  };
  const ctx: any = {
    loader: { import: async () => ({
      createScope: (_parent: any, agent: any) => {
        const effects: any[] = [];
        const scope: any = {
          disposed: false,
          dispose: async () => { scope.disposed = true; for (const effect of effects.reverse()) await effect(); },
          ctx: {
            tools: { register: (definition: any) => {
              const definitions = registered.get(agent) ?? [];
              registered.set(agent, [...definitions, definition]);
            } },
            systemPrompt: { section: (section: any) => assert.equal(section, prompt) },
            get: () => ({}),
            effect: (effect: any) => effects.push(effect()),
            inject: (_dependencies: any, apply: any) => makeFork(() => apply(scope.ctx)),
          },
        };
        scopes.push(scope);
        return scope;
      },
    }) },
    agentPresets: { composedPreset: (context: any) => agents.find((agent) => agent.ctx === context)?.preset },
    agents: { list: () => agents, get: (id: string) => agents.find((agent) => agent.session.id === id) },
    logger: { warn: (error: any) => warnings.push(error) },
    on: (name: string, handler: any) => { rootHooks[name] = handler; },
    effect: (effect: any) => rootEffects.push(effect()),
    inject: (_dependencies: any, apply: any) => {
      const ready = Promise.resolve().then(() => apply(ctx));
      const fork = { then: ready.then.bind(ready), dispose: async () => {} };
      (ctx as any).ready = ready;
      return fork;
    },
  };
  await installComputerUseRegistration(ctx, {
    tool, prompt, programPrompt: prompt, agentPreset: 'ptc', initialization,
    createProgram: async (_context: any, binding: any, setup: string) => {
      assert.equal(binding, tool);
      assert.equal(setup, initialization);
      if (programError) throw programError;
      return { name: 'cua_run_code' };
    },
  });
  await ctx.ready;
  assert.equal(registered.get(agents[0])[0].name, 'cua_run_code');
  assert.equal(registered.get(agents[4])[0], tool);
  assert.equal(registered.has(agents[1]), false);
  assert.equal(registered.has(agents[2]), false);
  assert.equal(registered.has(agents[3]), false);
  agents[0].preset = 'ptc';
  await rootHooks['agent-preset/selected'](agents[0].session.id);
  assert.equal(scopes[0].disposed, true, 'retire the previous scoped program before replacing it');
  assert.equal(registered.get(agents[0]).at(-1), tool);
  programError = new Error('incompatible runtime');
  const added = { session: { id: 'dudu-assistant-other' }, preset: 'standard', ctx: {} };
  agents.push(added);
  await rootHooks['agent/created']({ agent: added });
  assert.deepEqual(warnings, [programError], 'report a failed optional capability without failing ordinary agent creation');
  assert.equal(registered.has(added), false, 'failed program initialization never exposes the raw capability');
  for (const dispose of rootEffects.reverse()) await dispose();
  assert.ok(scopes.every((scope) => scope.disposed), 'join every remaining agent scope on provider disposal');
});

test('the pinned PTC transport binds only CUA and preserves host call identity, images and isolated state ownership', async () => {
  const effects: any[] = [];
  const events: any[] = [];
  const observed: any = {};
  const original = Symbol('original');
  class HarnessError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  }
  class Pipeline {
    source: any;
    constructor(_context: any, source: any) {
      this.source = source;
      observed.source = source;
      assert.equal(source.get('bash'), undefined);
      assert.equal(source.get('cua_run_code'), undefined);
      assert.equal(source.get('cua', undefined, { view: () => new Map([['bash', { name: 'bash' }]]) }), undefined);
    }
    executionMode() { return { kind: 'exclusive' }; }
    async prepare(input: any) { observed.input = input; return { kind: 'dispatch', exec: input }; }
    async dispatch(exec: any) {
      const value = await this.source.get(exec.name, exec.agent, exec.toolSet).execute(exec.arguments, exec);
      return { kind: 'post-result', result: {
        isError: false, value, content: [{ type: 'image', attachment: { id: 'host-image' } }],
      } };
    }
    async complete(_exec: any, result: any) { return result.result; }
  }
  const namespaces: any = {
    '@deepseek-ai/cordis': { symbols: { original } },
    '@deepseek-ai/dsh-brand': { brandString: (value: any) => value },
    '@deepseek-ai/dsh-llm': { HarnessError, createUserMessage: (value: any) => value },
    '@deepseek-ai/dsh-sandbox': {
      ESCALATION_TARGETS: [], validateEscalationArgs() {},
      approveEscalation: () => assert.fail('no implicit escalation'),
    },
    '@deepseek-ai/dsh-scope': { scopeTarget: (tools: any) => tools },
    '@deepseek-ai/dsh-tools': {
      RUN_CODE_NAME: 'run_code', TOOL_ABORTED: 'ABORTED',
      defineTool: (definition: any) => definition,
      projectToolSchema: (definition: any) => ({ name: definition.name, parameters: definition.parameters }),
      parameterSchemaSpecToJsonSchema: (value: any) => value,
    },
    '@deepseek-ai/dsh-tools/pipeline': { ToolExecutionPipeline: Pipeline, toolErrorMessage: (error: any) => error.message },
    '@deepseek-ai/dsh-util-values': { deepFreeze: (value: any) => value, snapshotJsonValue: (value: any) => structuredClone(value) },
  };
  const runtime: any = {
    language: 'typescript', retainsState: true, programFormat: 'function-body',
    timeout: { defaultMs: 60000, maxMs: 60000 },
    resolve: (request: any) => { observed.request = request; return { ...request, timeoutMs: 60000 }; },
    run: async (spec: any) => {
      assert.deepEqual(Object.keys(spec.bindings[0].functions), ['cua']);
      const value = await spec.bindings[0].functions.cua({ method: 'getCapabilities', params: {} });
      return { logs: ['official result'], value };
    },
    release: async (owner: any) => { observed.released = owner; },
  };
  const registered = new Map<string, any>();
  const ctx: any = {
    loader: { import: async (name: string) => { assert.ok(namespaces[name], name); return namespaces[name]; } },
    get: (name: string) => name === 'ptcRuntime' ? runtime : name === 'workingDirectory' ? { ensure: async () => '/work' } : undefined,
    tools: {
      executable: (name: string, scope: any, toolSet: any) =>
        (toolSet === undefined ? registered : toolSet.view(scope)).get(name),
    },
    logger: { warn: () => assert.fail('unexpected engine warning') },
    on() {},
    effect: (effect: any) => effects.push(effect()),
    waterfall: async (_scope: any, _name: string, _dispatch: any, next: any) => next(),
  };
  const tool = { name: 'cua', parameters: { type: 'object' }, execute: async (args: any) => {
    assert.equal(args.method, 'getCapabilities');
    return { platform: 'macos' };
  } };
  const program = await createComputerUseProgram(ctx, tool, initialization);
  registered.set(program.name, program);
  const agent = { session: { id: 'dudu-assistant-unit', append: (type: any, data: any) => events.push({ type, data }) }, ctx };
  const contexts: any[] = [];
  let admitted = true;
  const toolSet = {
    dispose: () => { admitted = false; },
    view: (scope: any) => new Map(admitted && scope === agent ? [[program.name, program]] : []),
  };
  const exec: any = {
    callId: 'one', rootCallId: 'one', token: Symbol('host-execution'), agent,
    signal: new AbortController().signal,
    toolSet,
    deferContext: (context: any) => contexts.push(context),
    concludeTurn: () => assert.fail('not a terminal tool'),
  };
  const output = await program.execute({ code: 'await cua.getCapabilities()', description: 'Inspect desktop capabilities' }, exec);
  assert.equal(program.name, 'cua_run_code');
  assert.deepEqual(output.result, { platform: 'macos' });
  assert.equal(observed.input.agent, agent);
  assert.equal(observed.input.parent, exec.token);
  assert.equal(observed.input.toolSet, exec.toolSet);
  assert.equal(observed.input.rootCallId, exec.rootCallId);
  assert.ok(observed.request.program.startsWith(initialization));
  assert.notEqual(observed.request.stateOwner, agent, 'Computer Use state is separate from the main agent’s other programs');
  assert.equal(contexts[0].content[0].attachment.id, 'host-image', 'forward the real host image reference');
  assert.deepEqual(events.map((event) => event.type), ['tool/ptc-dispatch-start', 'tool/ptc-dispatch']);
  assert.equal(observed.source.get('cua', agent, toolSet), tool);
  assert.equal(observed.source.get('cua', {}, toolSet), undefined, 'step admission belongs to the exact calling scope');
  toolSet.dispose();
  assert.equal(observed.source.get('cua', agent, toolSet), undefined, 'settled step admission cannot reopen the private binding');
  registered.delete(program.name);
  assert.equal(observed.source.get('cua', agent), undefined, 'withdrawal of the program revokes its private binding');
  for (const dispose of effects.reverse()) await dispose();
  assert.equal(observed.released, observed.request.stateOwner);
});
