// Task and collector sessions deliberately share the assistant prefix for list
// hiding; they are separate consumers and must not inherit this capability.
const isMainConversation = (id) => id.startsWith('dudu-assistant-') &&
  !id.startsWith('dudu-assistant-task-') && !id.startsWith('dudu-assistant-intake-');

/** Keep the old raw-tool scope; add a program capability only to Dudu's standard conversation. */
export async function installComputerUseRegistration(ctx, { tool, prompt, programPrompt, agentPreset, initialization, createProgram }) {
  const { createScope } = await ctx.loader.import('@deepseek-ai/dsh-scope');
  if (agentPreset === false) {
    ctx.tools.register(tool);
    ctx.systemPrompt.section(prompt);
  }
  const consumer = ctx.inject(['agentPresets'], async (base) => {
    const scopes = new Map();
    let closing = false;
    const sync = async (agent) => {
      if (closing) return;
      const preset = base.agentPresets.composedPreset(agent.ctx);
      const mode = isMainConversation(agent.session.id) && preset === 'standard' ? 'program'
        : agentPreset !== false && preset === agentPreset ? 'raw' : null;
      const previous = scopes.get(agent);
      if (previous?.mode === mode) return;
      scopes.delete(agent);
      await previous?.scope.dispose();
      if (mode === null || closing) return;
      const scope = createScope(agent.ctx, agent);
      const entry = { mode, scope };
      scopes.set(agent, entry);
      scope.ctx.effect(() => () => {
        if (scopes.get(agent) === entry) scopes.delete(agent);
      }, 'dudu.computer-use.agent');
      if (mode === 'raw') {
        scope.ctx.tools.register(tool);
        scope.ctx.systemPrompt.section(prompt);
      } else {
        const program = scope.ctx.inject(['ptcRuntime', 'tools', 'systemPrompt', 'loader'], async (programCtx) => {
          const definition = await createProgram(programCtx, tool, initialization);
          programCtx.tools.register(definition);
          programCtx.systemPrompt.section(programPrompt);
        });
        if (scope.ctx.get('ptcRuntime')) {
          // This optional plugin reports its own failed startup. Do not let a
          // program/runtime incompatibility roll back the ordinary chat agent.
          try { await program; } catch (error) { base.logger.warn(error); }
        }
      }
    };
    base.effect(() => async () => {
      closing = true;
      await Promise.all([...scopes.values()].map(({ scope }) => scope.dispose()));
      scopes.clear();
    }, 'dudu.computer-use.scopes');
    base.on('agent/created', ({ agent }) => sync(agent));
    base.on('agent-preset/selected', (id) => {
      const agent = base.agents.get(id);
      if (agent) return sync(agent);
    });
    await Promise.all(base.agents.list().map(sync));
  });
  ctx.effect(() => () => consumer.dispose(), 'dudu.computer-use.registration');
}
