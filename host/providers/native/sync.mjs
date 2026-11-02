import { buildSessionEvents } from './session-events.mjs';
import { userContent } from './images.mjs';

const promptOf = (content) => (typeof content === 'string' ? content : (content ?? []).map((block) => block.type === 'text' ? block.text : block.type === 'image' ? '[image]' : '').join('\n')).replace(/\s+/g, ' ').trim();
const supported = (block) => ['text', 'reasoning', 'tool-call'].includes(block.type);

// The TUI can finish the answer that was already imported. Consume its existing blocks, including a partial text block,
// before adding the rest. A different branch or a source behind DSH is left alone.
function remainingSteps(turn, events) {
  const seen = events.flatMap((event) => event.type === 'assistant/message'
    ? event.data.message.content.filter(supported).map((block) => ({ ...block }))
    : event.type === 'user/message' && event.surfaceOp === 'append' ? [{ type: 'input', text: promptOf(event.data.content) }] : []);
  const steps = [];
  for (const step of turn.steps) {
    let input = step.input;
    if (input && seen.length) {
      if (seen[0].type !== 'input' || seen[0].text !== promptOf(userContent(input))) return null;
      seen.shift();
      input = undefined;
    }
    const blocks = [];
    for (const original of step.blocks) {
      let block = { ...original };
      while (seen.length && block) {
        const old = seen[0];
        if (old.type !== block.type) return null;
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
  const users = events.filter((event) => event.type === 'user/message' && event.surfaceOp === 'append');
  if (!history.turns.length) return [];
  let cursor = 0;
  let matched = -1;
  let last;
  let first;
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
    }
  }
  // DSH has an input not yet visible in the TUI store, or the TUI was rewound onto another branch.
  if (users.length && (!last || last !== users.at(-1))) return [];
  const opened = openTurn(events);
  if (opened && (!first || opened.seq < first.seq && events.findLast((event) => event.type === 'request/header')?.seq > first.seq)) return [];
  const steps = first ? remainingSteps(history.turns[matched], events.filter((event) => event.seq > first.seq)) : [];
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

/** Use the live Session's publication path when attached; cold sessions use an exclusively owned persistence handle. */
export function createNativeSync({ persistence, controller = () => undefined, agents = () => undefined, refresh, pollMs = 5000 }) {
  const held = new Map();
  return async ({ sessionId, history, route }) => {
    let live = agents()?.get(sessionId);
    const store = persistence();
    // Attach before publishing an open tail: the standard resume path otherwise treats it as a crash.
    if (!live && history.turns.some((turn) => turn.complete === false)) {
      const resolved = await controller()?.resolveAgent?.(sessionId);
      live = resolved?.agent ?? agents()?.get(sessionId);
      if (!live) return { deferred: true };
    }
    if (live) {
      if (live.status !== 'idle') return { deferred: true };
      const append = async (owner) => {
        const { signal } = owner;
        const inspected = await controller()?.inspect(sessionId);
        if (!inspected || signal?.aborted || live.status !== 'idle' || live.session.seq !== inspected.events.length) return { deferred: true };
        const updates = nativeUpdates({ events: inspected.events, history, route, sessionId });
        // DSH rc.5 keeps a separate turn counter in its maintenance reservation. Its public append path updates projections,
        // but not that counter. Refuse other driver shapes rather than let the next prompt reuse an imported turn number.
        const reservation = live.phase;
        if (reservation?.kind !== 'maintenance' || !Number.isSafeInteger(reservation.lastTurn) ||
            Object.getOwnPropertyDescriptor(reservation, 'lastTurn')?.writable !== true) return { deferred: true };
        for (const event of updates) {
          const opts = event.surfaceOp ? { surfaceOp: event.surfaceOp, ...(event.sourceEventSeqs ? { sourceEventSeqs: event.sourceEventSeqs } : {}) } : undefined;
          if (opts) live.session.append(event.type, event.data, opts);
          else live.session.append(event.type, event.data);
          if (event.type === 'turn/start') reservation.lastTurn = Math.max(reservation.lastTurn, event.data.turn);
        }
        owner.open = openTurn([...inspected.events, ...updates]);
        if (updates.length) await store.flush?.();
        if (!owner.open) owner.release.resolve();
        return { updated: updates.length > 0 };
      };
      const owned = held.get(sessionId);
      if (owned?.live === live) return append(owned);
      if (typeof live.runMaintenance !== 'function' || live.phase?.kind === 'maintenance') return { deferred: true };
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
      if (agents()?.get(sessionId)) return { deferred: true };
      const { events } = await handle.read();
      const updates = nativeUpdates({ events, history, route, sessionId });
      if (updates.length) { await handle.append(updates); await handle.flush(); }
      return { updated: updates.length > 0 };
    } finally { await handle.close(); }
  };
}
