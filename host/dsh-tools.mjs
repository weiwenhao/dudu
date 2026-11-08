/** Keep Dudu's scoped tools native without changing the host or its other agents. */
export async function useNativeTools(ctx, agentCtx) {
  const tools = agentCtx.tools;
  if (typeof tools.presentAs === 'function') return tools.presentAs('native');
  if (typeof tools.setExecutor !== 'function') return;
  const { NativeToolExecutor } = await ctx.loader.import('@deepseek-ai/dsh-tool-executor-native');
  return tools.setExecutor(new NativeToolExecutor(agentCtx));
}

/** DSH 0.2.2 moved tools.execute from one invocation to an executor-owned batch. */
export async function executeNativeTool(tools, call) {
  if (typeof tools.selectExecutor !== 'function') return tools.execute(call);
  const batch = await tools.execute({
    agent: call.agent, signal: call.signal, toolSet: call.toolSet,
    calls: [{ type: 'tool-call', id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) }],
  });
  const result = batch.results.find((entry) => entry.callId === call.callId)?.result;
  if (!result) throw Object.assign(new Error('UNSUPPORTED'), { code: 'UNSUPPORTED' });
  return result;
}
