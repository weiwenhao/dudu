import { withAbort } from '../../providers/async.mjs';
import { sessionStorageWitness } from '../../session-storage-witness.mjs';

const textOf = (content) => typeof content === 'string' ? content
  : (Array.isArray(content) ? content : []).filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validFacts = (value) => record(value) && record(value.lastTurn) && record(value.latest)
  && [null, 'answer', 'error', 'aborted'].includes(value.lastTurn.last)
  && (value.lastTurn.at === null || Number.isFinite(value.lastTurn.at))
  && (value.title === null || record(value.title) && typeof value.title.title === 'string'
    && Number.isSafeInteger(value.title.seq) && Number.isFinite(value.title.at))
  && ['me', 'agent'].every((side) => value.latest[side] === undefined
    || record(value.latest[side]) && typeof value.latest[side].text === 'string' && Number.isFinite(value.latest[side].at));

/** Small, exact facts used by title reconciliation, lifecycle restore and conversation previews. */
export function sessionFacts(events) {
  let title = null;
  let start;
  let startIndex = -1;
  let end;
  let endIndex = -1;
  let ending;
  const latest = {};
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (!title && event.type === 'session/title') title = { title: event.data.title, seq: event.seq, at: event.time };
    if (!end && event.type === 'turn/end') { end = event; endIndex = index; }
    if (!start && event.type === 'assistant/message' && ending === undefined) {
      const said = textOf(event.data?.message?.content);
      if (said.trim()) ending = said;
    }
    if (!start && event.type === 'turn/start') {
      start = event;
      startIndex = index;
      // An answer from a previous turn must not become the latest turn's ending.
      ending ??= '';
    }
    const message = event.data?.message ?? event.data;
    const side = event.type === 'user/message' && message?.source?.kind === 'user' ? 'me' : event.type === 'assistant/message' ? 'agent' : null;
    if (side && !latest[side]) {
      const text = textOf(message?.content ?? event.data?.content);
      if (text.trim()) latest[side] = { text, at: Number.isFinite(event.time) ? event.time : 0 };
    }
    if (title && start && end && latest.me && latest.agent) break;
  }
  let lastTurn = { last: null, at: null };
  if (start || end) {
    const ended = endIndex > startIndex ? end : null;
    const kind = ended?.data?.reason?.kind;
    lastTurn = {
      last: !ended ? 'aborted' : kind === 'completed' || kind === 'max-tokens' ? 'answer' : kind === 'error' ? 'error' : 'aborted',
      at: (ended ?? start).time ?? null,
      ...(kind === 'error' ? { error: ended.data.reason.error?.message } : {}),
      ...(ending ? { ending } : {}),
    };
  }
  return { title, lastTurn, latest };
}

/**
 * Cache only detached facts, never a second copy of tool outputs or the complete journal.
 * Disk entries require the same physical journal and header; opaque persistence
 * revisions are used only within their providing service instance.
 * Live facts are bound to the actual Session object and its current event count.
 */
export function createSessionFacts({ read, persistence, live, cache, log = console }) {
  const lifetime = new AbortController();
  const memory = new Map();
  const flights = new Map();
  let warned = false;
  const warn = () => { if (!warned) { warned = true; log.warn?.('[dudu] Session metadata cache is unavailable.'); } };
  const keyOf = (id) => `session-facts:v1:${id}`;
  const same = (left, right) => left?.storage === right?.storage && left?.revision === right?.revision
    && left?.header === right?.header && left?.witness === right?.witness;
  const remember = (id, entry) => {
    memory.delete(id);
    memory.set(id, entry);
    if (memory.size > 64) memory.delete(memory.keys().next().value);
  };
  const readOnce = async (id, current, source) => {
    if (!source && current?.witness) {
      const saved = await cache.metadata(keyOf(id)).catch(() => { warn(); return null; });
      if (saved?.witness === current.witness && saved.header === current.header && validFacts(saved.facts)) {
        remember(id, { ...current, facts: saved.facts });
        return saved.facts;
      }
    }
    const history = await read(id, lifetime.signal);
    const facts = sessionFacts(history.events);
    const encoded = JSON.stringify(facts);
    if (encoded.length > 256 * 1024) return facts; // preserve unusually large text, without retaining it
    if (source && live(id) === source && source.seq === current.seq) remember(id, { ...current, source, facts });
    else if (!source && current && history.source === 'prepared' && history.revision === current.revision
      && JSON.stringify(history.header) === current.header) {
      const storage = persistence();
      const after = await storage?.stat(id, { signal: lifetime.signal });
      const witness = await sessionStorageWitness(after, lifetime.signal);
      if ((storage?.identity ?? storage) === current.storage && after?.revision === current.revision
        && JSON.stringify(after.header) === current.header && witness === current.witness) {
        const entry = { ...current, facts };
        if (witness) await cache.saveMetadata(keyOf(id), { header: current.header, witness, facts }).catch(warn);
        remember(id, entry);
      }
    }
    return facts;
  };
  return {
    async read(id, signal) {
      signal?.throwIfAborted();
      lifetime.signal.throwIfAborted();
      const source = live(id);
      const storage = persistence();
      const stored = source ? null : await storage?.stat?.(id, { signal: signal ?? lifetime.signal });
      const witness = source ? null : await sessionStorageWitness(stored, signal ?? lifetime.signal);
      signal?.throwIfAborted();
      lifetime.signal.throwIfAborted();
      const current = source ? { seq: source.seq } : typeof stored?.revision === 'string'
        ? { revision: stored.revision, header: JSON.stringify(stored.header), witness, storage: storage?.identity ?? storage } : null;
      const saved = memory.get(id);
      if (source ? saved?.source === source && saved.seq === source.seq : current && !saved?.source && same(saved, current)) return saved.facts;
      const version = source ?? JSON.stringify(current && [current.revision, current.header, current.witness]);
      let flight = flights.get(id);
      if (!flight || flight.version !== version || flight.storage !== current?.storage || source && flight.seq !== source.seq) {
        const promise = readOnce(id, current, source).finally(() => { if (flights.get(id)?.promise === promise) flights.delete(id); });
        flight = { version, storage: current?.storage, seq: source?.seq, promise };
        flights.set(id, flight);
      }
      return signal ? withAbort(flight.promise, signal) : flight.promise;
    },
    async close() {
      lifetime.abort();
      await Promise.allSettled([...flights.values()].map((flight) => flight.promise));
      memory.clear();
    },
  };
}
