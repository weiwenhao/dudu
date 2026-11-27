import { buildSessionEvents } from './session-events.mjs';
import { canReadSessionHistory, readSessionHistory } from '../../dsh-session-history.mjs';
import { userContent } from './images.mjs';

// What DSH writes as a user message for its own models, not for the harness: the person did not type it and the harness's store does not have it. Anything else (what was typed,
// a skill's expansion, a prompt the plugin sent for them) is a message both sides must agree on.
const DSH_CONTEXT = new Set(['time-context', 'runtime-context', 'agent-instructions', 'skill-catalog', 'model-selection', 'user-approval', 'repeat-tool-reminder']);
const typed = (event) => event.type === 'user/message' && event.surfaceOp === 'append' && !DSH_CONTEXT.has(event.data?.source?.kind);

// A message as the two sides can agree on it: its words, whitespace aside. Pictures stand where each side puts them (DSH writes them before the words, Claude Code after; a kept one is an
// image block, one that was lost is a marker in the text), so they count only for a message that is nothing but pictures.
const promptOf = (content) => {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []);
  const text = blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  const words = text.replaceAll('[image]', '').replace(/\s+/g, ' ').trim();
  const pictures = blocks.filter((block) => block.type === 'image').length + (text.match(/\[image\]/g)?.length ?? 0);
  return words || (pictures ? `[${pictures} pictures]` : '');
};
const supported = (block) => ['text', 'reasoning', 'tool-call'].includes(block.type);

// The TUI can finish the answer that was already imported. Consume its existing blocks, including a partial text block,
// before adding the rest. A different branch or a source behind DSH is left alone.
function remainingSteps(turn, events, known) {
  const seen = events.flatMap((event) => event.type === 'assistant/message'
    ? event.data.message.content.filter(supported).map((block) => ({ ...block }))
    : []);
  const steps = [];
  for (const step of turn.steps) {
    let input = step.input;
    // DSH writes a message typed in the middle where it arrived, at the step that began then; Claude Code at the request that took it up, which can be several steps later. A message DSH has
    // (`known`: `nativeUpdates` paired it) is not said again wherever the store puts it, and where DSH already has this step's words the message is behind them; any other is new.
    if (input && (seen.length || known?.has(input))) input = undefined;
    const blocks = [];
    for (const original of step.blocks) {
      let block = { ...original };
      while (seen.length && block) {
        const old = seen[0];
        // What the model thought is not what the two sides have to agree on: a store keeps a summary of it, DSH what streamed, and they differ in wording and in where they put it. A thought is
        // never new in what DSH already has, and one that DSH has and the store lacks goes; the words and the calls decide.
        if (block.type === 'reasoning') { if (old.type === 'reasoning') seen.shift(); block = null; continue; }
        if (old.type === 'reasoning') { seen.shift(); continue; }
        if (old.type !== block.type) return null;
        // DSH puts a paragraph break in front of an answer that continues a turn it resumed; the store has the words alone.
        if (old.type === 'text' && old.text.startsWith('\n') && !block.text.startsWith('\n')) {
          old.text = old.text.replace(/^\n+/, '');
          if (!old.text) { seen.shift(); continue; }
        }
        if (block.type === 'tool-call') {
          if (old.id !== block.id) return null;
          seen.shift();
          block = null;
        } else if (old.text.startsWith(block.text)) {
          old.text = old.text.slice(block.text.length);
          if (!old.text) seen.shift();
          block = null;
        } else if (block.text.startsWith(old.text)) {
          block.text = block.text.slice(old.text.length);
          seen.shift();
        } else return null;
      }
      if (block && (block.type === 'tool-call' || block.text)) blocks.push(block);
    }
    if (input || blocks.length) steps.push({ ...step, input, blocks });
  }
  return seen.length ? null : steps;
}

/** An unfinished tool call is published only when its real result is available. */
function available(turn) {
  const steps = [];
  for (const step of turn.steps) {
    const pending = step.blocks.findIndex((block) => block.type === 'tool-call' && !turn.results.has(block.id));
    const blocks = turn.complete === false && pending >= 0 ? step.blocks.slice(0, pending) : step.blocks;
    if (step.input || blocks.length) steps.push({ ...step, blocks, ...(turn.complete === false ? { usage: undefined } : {}) });
    if (turn.complete === false && pending >= 0) break;
  }
  return { ...turn, steps };
}

const openTurn = (events) => {
  const start = events.findLast((event) => event.type === 'turn/start');
  return start && start.seq > (events.findLast((event) => event.type === 'turn/end')?.seq ?? -1) ? start : null;
};

/** Append only native history after the last shared user turn. Existing DSH events are never rewritten. */
export function nativeUpdates({ events, history, route, sessionId }) {
  history = { ...history, turns: history.turns.map(available) };
  const users = events.filter(typed);
  if (!history.turns.length) return [];
  // A history that is only the end of the conversation (`partial`: a long one is read from its end) is matched against the end of what DSH has. From the start, its first
  // prompt would match an earlier, identical one ("go on") and the update would be missed.
  const inputs = history.turns.reduce((count, item) => count + 1 + item.steps.filter((step) => step.input).length, 0);
  let cursor = history.partial ? Math.max(0, users.length - inputs) : 0;
  let matched = -1;
  let last;
  let first;
  const known = new Set();
  for (let index = 0; index < history.turns.length; index++) {
    const prompt = promptOf(userContent(history.turns[index]));
    const found = users.findIndex((event, i) => i >= cursor && promptOf(event.data.content) === prompt);
    if (found < 0) continue;
    cursor = found + 1;
    matched = index;
    first = last = users[found];
    for (const { input } of history.turns[index].steps) {
      if (!input) continue;
      const next = users.findIndex((event, i) => i >= cursor && promptOf(event.data.content) === promptOf(userContent(input)));
      if (next < 0) break;
      cursor = next + 1;
      last = users[next];
      known.add(input);
    }
  }
  // DSH has an input not yet visible in the TUI store, or the TUI was rewound onto another branch.
  if (users.length && (!last || last !== users.at(-1))) return [];
  const opened = openTurn(events);
  if (opened && (!first || opened.seq < first.seq && events.findLast((event) => event.type === 'request/header')?.seq > first.seq)) return [];
  const steps = first ? remainingSteps(history.turns[matched], events.filter((event) => event.seq > first.seq), known) : [];
  if (!steps) return [];
  const previousEnd = events.findLast((event) => event.type === 'turn/end');
  const previousReply = events.findLast((event) => event.type === 'assistant/message')?.data.message.source.replayState;
  const recovered = first && !opened && previousEnd?.data.reason.kind === 'interrupted' &&
    (previousReply?.nativeComplete === false && previousReply.nativeTurnId === history.turns[matched].id ||
      first.data.id === `dudu-native:${route}:${history.id}:${history.turns[matched].id}` && history.turns[matched].complete === false);
  const turns = first ? [
    ...(steps.length || recovered || opened && history.turns[matched].complete !== false
      ? [{ ...history.turns[matched], continuation: true, steps }] : []),
    ...history.turns.slice(matched + 1),
  ] : history.turns;
  if (!turns.length) return [];
  const selection = events.findLast((event) => event.type === 'model/selection')?.data;
  const turnOffset = events.reduce((number, event) => Math.max(number, event.data?.turn ?? 0), 0);
  return buildSessionEvents({
    history: { ...history, turns }, route, sessionId, model: selection?.model ?? history.model ?? 'default',
    configure: false, reserveHead: !events.some((event) => event.surfaceOp), offset: events.length, turnOffset, after: events.at(-1)?.time ?? 0,
    ...(opened ? { resume: { step: events.reduce((number, event) => event.data?.turn === opened.data.turn ? Math.max(number, event.data.step ?? 0) : number, 0) } } : {}),
  }).events;
}

/** Whether the agent of a session that is live in DSH is working (or waiting for an answer): its session is not to be synchronized now. */
export const busy = (live) => Boolean(live) && live.status !== 'idle';

/**
 * A synchronization that is put off says why: `unsupported` when this DSH cannot be synchronized into at all (no way to read a session's history, no way to hold the
 * session, a reservation of another shape), which no amount of waiting changes; anything else is for the moment (`busy`), and is tried again soon.
 */
const putOff = (reason = 'busy') => ({ deferred: true, reason });

/** Use the live Session's publication path when attached; cold sessions use an exclusively owned persistence handle. */
export function createNativeSync({ persistence, controller = () => undefined, query = () => undefined, agents = () => undefined, refresh, onHistoryAppended, pollMs = 5000 }) {
  const held = new Map();
  return async ({ sessionId, history, route, checkpoint }) => {
    let live = agents()?.get(sessionId);
    const store = persistence();
    // Attach before publishing an open tail: the standard resume path otherwise treats it as a crash.
    if (!live && history.turns.some((turn) => turn.complete === false)) {
      const resolved = await controller()?.resolveAgent?.(sessionId);
      live = resolved?.agent ?? agents()?.get(sessionId);
      if (!live) return putOff();
    }
    if (live) {
      if (busy(live)) return putOff();
      const append = async (owner) => {
        const { signal } = owner;
        const services = { controller: controller(), query: query() };
        if (!canReadSessionHistory(services)) return putOff('unsupported');
        const inspected = await readSessionHistory(services, sessionId);
        if (!inspected || signal?.aborted || live.status !== 'idle' || live.session.seq !== inspected.events.length) return putOff();
        const updates = nativeUpdates({ events: inspected.events, history, route, sessionId });
        // DSH rc.5 keeps a separate turn counter in its maintenance reservation. Its public append path updates projections,
        // but not that counter. Refuse other driver shapes rather than let the next prompt reuse an imported turn number.
        const reservation = live.phase;
        if (reservation?.kind !== 'maintenance' || !Number.isSafeInteger(reservation.lastTurn) ||
            Object.getOwnPropertyDescriptor(reservation, 'lastTurn')?.writable !== true) return putOff('unsupported');
        for (const event of updates) {
          const opts = event.surfaceOp ? { surfaceOp: event.surfaceOp, ...(event.sourceEventSeqs ? { sourceEventSeqs: event.sourceEventSeqs } : {}) } : undefined;
          if (opts) live.session.append(event.type, event.data, opts);
          else live.session.append(event.type, event.data);
          if (event.type === 'turn/start') reservation.lastTurn = Math.max(reservation.lastTurn, event.data.turn);
        }
        owner.open = openTurn([...inspected.events, ...updates]);
        if (updates.length) {
          await store.flush?.();
          onHistoryAppended?.(sessionId, updates);
        }
        if (!owner.open) owner.release.resolve();
        return { updated: updates.length > 0 };
      };
      const owned = held.get(sessionId);
      if (owned?.live === live) return append(owned);
      if (typeof live.runMaintenance !== 'function') return putOff('unsupported');
      if (live.phase?.kind === 'maintenance') return putOff();
      const ready = Promise.withResolvers();
      const job = live.runMaintenance(async (signal) => {
        const owner = { live, signal, release: Promise.withResolvers(), open: null };
        held.set(sessionId, owner);
        const release = () => owner.release.resolve();
        signal?.addEventListener('abort', release, { once: true });
        // New DSH input ends observation before its own loop starts. Never leave an orphaned native turn blocking input.
        const unsubscribe = live.ctx?.on?.('agent/inbox/inserted', release);
        let timer;
        try {
          ready.resolve(await append(owner));
          if (owner.open) {
            if (refresh) {
              timer = setInterval(() => { void Promise.resolve(refresh({ sessionId, history, route })).catch(() => {}); }, pollMs);
              timer.unref?.();
            }
            await owner.release.promise;
          }
        } finally {
          clearInterval(timer);
          unsubscribe?.();
          signal?.removeEventListener('abort', release);
          if (owner.open) {
            live.session.append('turn/end', { turn: owner.open.data.turn, reason: { kind: 'interrupted' } });
            await store.flush?.();
          }
          if (held.get(sessionId) === owner) held.delete(sessionId);
        }
      });
      void job.catch(ready.reject);
      return ready.promise;
    }
    const handle = await store.open(sessionId, 'write');
    try {
      // A resume may have started while the persistence writer was being acquired.
      if (agents()?.get(sessionId)) return putOff();
      const { events } = await handle.read();
      const updates = nativeUpdates({ events, history, route, sessionId });
      if (updates.length) {
        await handle.append(updates);
        await handle.flush();
        onHistoryAppended?.(sessionId, updates);
      }
      // Optional derived-cache barrier, while this handle still owns the exact journal.
      await checkpoint?.();
      return { updated: updates.length > 0 };
    } finally { await handle.close(); }
  };
}
