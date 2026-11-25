import { z } from 'zod';
import { attentionForEvent, EMPTY_ATTENTION } from './session-state.mjs';

// A durable assistant message may be commentary before more tools. Publish it only at turn completion.
const attentionSchema = z.object({
  seq: z.number().int().min(-1), at: z.number().nonnegative(),
  kind: z.enum(['none', 'message', 'question', 'error']),
  turn: z.number().int().min(-1), step: z.number().int().min(-1), digest: z.string(),
});
const schema = attentionSchema.extend({
  preview: z.string().default(''), messageAt: z.number().nonnegative().default(0),
  through: z.number().int().min(-1).default(-1),
  readableSeq: z.number().int().min(-1).default(-1),
  pending: attentionSchema.extend({ preview: z.string() }).nullable().default(null),
});

export const sessionActivityProjection = {
  key: 'duduSessionActivity',
  stateVersion: 3,
  stateSchema: schema,
  init: () => ({ ...EMPTY_ATTENTION, preview: '', messageAt: 0, through: -1, readableSeq: -1, pending: null }),
  apply(state, event) {
    if (!Number.isSafeInteger(event?.seq) || event.seq <= Math.max(state.seq, state.through ?? -1)) return state;
    if (event.type === 'turn/start') return { ...state, pending: null, through: event.seq };
    if (event.type === 'turn/end') {
      const pending = state.pending;
      const matches = pending && (!Number.isSafeInteger(event.data?.turn) || pending.turn < 0 || pending.turn === event.data.turn);
      if (pending && !matches) return { ...state, through: event.seq };
      const ended = { ...state, pending: null, through: event.seq };
      const failure = attentionForEvent(event);
      if (failure) return { ...ended, ...failure, readableSeq: failure.seq };
      if (!matches || !['completed', 'max-tokens'].includes(event.data?.reason?.kind)) return ended;
      const completedAt = Math.max(pending.at, Number.isFinite(event.time) ? event.time : 0);
      const { preview, ...attention } = pending;
      return { ...ended, ...(pending.seq >= state.seq ? { ...attention, at: completedAt } : {}), preview, messageAt: completedAt };
    }
    const next = attentionForEvent(event);
    if (!next) return state;
    // Questions still need the owner while the agent waits; they do not reorder the message list.
    if (next.kind !== 'message') return { ...state, ...next, through: event.seq, readableSeq: next.seq };
    const text = (event.data?.message?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const paragraph = text.trim().split(/\n\s*\n/).at(-1) ?? '';
    return { ...state, through: event.seq, readableSeq: next.seq,
      pending: { ...next, preview: paragraph.replace(/\s+/g, ' ').slice(0, 300) } };
  },
  wire: { viewSchema: schema, view: (state) => state },
};

/**
 * What `ctx.sessionProjections.register(sessionActivityProjection)` gave back, as something that reads one session's state.
 * DSH 0.2.2 hands out a handle with `stateOf(session)`. DSH 0.2.1 hands out only the function that unregisters it, and the state
 * is read by key through the registry (DSH 0.2.2 keeps that call too, as a deprecated one, which is why it is not used there).
 * Nothing to read it with: undefined, as when there is no registry at all.
 */
export function activityReaderOf(registered, projections) {
  if (typeof registered?.stateOf === 'function') return registered;
  if (registered && typeof projections?.stateOf === 'function') {
    return { stateOf: (session) => projections.stateOf(session, sessionActivityProjection.key) };
  }
  return undefined;
}
