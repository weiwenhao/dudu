import { HarnessFailure, manualCompactionError } from './harness-bridge.mjs';

/** The command registry owns its visible lifecycle; maintenance keeps new user work queued until the native writer is released. */
export function registerHarnessCommands(agent, bridge) {
  if (!agent.ctx.inject) return () => {};
  let unregister;
  const binding = agent.ctx.inject(['commands'], (ctx) => {
    const compact = ctx.commands.find(agent, 'compact');
    if (!compact) return;
    unregister = ctx.commands.register({
      ...compact,
      handler: async (invocation) => {
        if (!bridge.driver.compact || typeof agent.runMaintenance !== 'function') return { kind: 'error', text: manualCompactionError(bridge.driver.name).message };
        if (invocation.rawInput.trim()) return { kind: 'error', text: 'Usage: /compact (no arguments)' };
        let operation;
        let signal;
        try {
          operation = agent.runMaintenance(async (agentSignal) => {
            signal = AbortSignal.any([agentSignal, invocation.signal]);
            const compacted = await bridge.compact(agent.id, { signal });
            return compacted ? { kind: 'success' } : { kind: 'success', text: 'No compactable history yet.' };
          });
        } catch {
          return { kind: 'error', text: 'Compaction is unavailable because this process has an active compaction, or the agent is not idle.' };
        }
        try { return await operation; }
        catch (error) {
          if (signal?.aborted) return { kind: 'error', text: 'Compaction cancelled.' };
          if (error instanceof HarnessFailure) return { kind: 'error', text: error.message };
          throw error;
        }
      },
    });
  });
  return () => {
    unregister?.();
    void binding.dispose();
  };
}
