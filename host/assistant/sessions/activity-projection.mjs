import { z } from 'zod';

// DSH owns folding, caching and publishing this value with its normal session projections.
// "done" is how the last turn ended; work-state.mjs reads it as blocked (the boss's turn), as it does for a profile that saved it long ago.
// A turn that has just started changes nothing (owner, 2026-11-05: no special state for the moment after sending); a turn that ends in anything but an answer or an
// error was stopped or interrupted, which needs the owner.
const schema = z.object({
  state: z.enum(['idle', 'blocked', 'done']),
  at: z.number().nonnegative(),
});

export const agentActivityProjection = {
  key: 'duduAgentActivity',
  stateVersion: 2,
  stateSchema: schema,
  init: () => ({ state: 'idle', at: 0 }),
  apply(state, event) {
    if (event.type === 'turn/start') return state;
    if (event.type !== 'turn/end') return state;
    const kind = event.data?.reason?.kind;
    return {
      state: ['completed', 'max-tokens'].includes(kind) ? 'done' : 'blocked',
      at: event.time,
    };
  },
  wire: { viewSchema: schema, view: (state) => state },
};
