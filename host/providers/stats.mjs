import { z } from 'zod';
import { firstToken, isHarnessMessage } from '../conversation-timing.mjs';

// Harness usage covers a native turn (including work outside the root's final message), while DSH timestamps the
// replay of each message. Those are different measurements: their quotient is not a model's generation speed.
const totals = z.object({ decodeMs: z.number().nonnegative(), decodeTokens: z.number().nonnegative() });
const schema = totals.extend({
  openStep: z.object({
    turn: z.number(), step: z.number(), first: z.number().nullable(),
  }).nullable(),
});

// A separate projection corrects existing logs as well as new ones, without rewriting session events or token accounting.
export const harnessTimingProjection = {
  key: 'duduHarnessTiming',
  stateVersion: 1,
  stateSchema: schema,
  init: () => ({ decodeMs: 0, decodeTokens: 0, openStep: null }),
  apply(state, event) {
    const data = event.data ?? {};
    if (event.type === 'step/start') return { ...state, openStep: { turn: data.turn, step: data.step, first: null } };
    if (event.type === 'step/end' || event.type === 'turn/end') return state.openStep ? { ...state, openStep: null } : state;
    const open = state.openStep;
    if (!open || open.turn !== data.turn || open.step !== data.step) return state;
    if (event.type === 'assistant/attempt' && open.first === null) {
      const first = firstToken(data.stream);
      return first === undefined ? state : { ...state, openStep: { ...open, first } };
    }
    if (event.type !== 'assistant/message') return state;
    const first = open.first ?? firstToken(data.stream);
    const output = data.usage?.outputTokens;
    const measured = isHarnessMessage(data.message) && first !== undefined && Number.isFinite(output) && output >= 0;
    return {
      decodeMs: state.decodeMs + (measured ? Math.max(0, event.time - first) : 0),
      decodeTokens: state.decodeTokens + (measured ? output : 0),
      openStep: null,
    };
  },
  wire: { viewSchema: totals, view: ({ decodeMs, decodeTokens }) => ({ decodeMs, decodeTokens }) },
};
