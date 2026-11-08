import { setImmediate as yieldToHost } from 'node:timers/promises';
import { createCachedContentIndex } from '../../providers/native/cached-content-index.mjs';
import { readSessionHistory } from '../../dsh-session-history.mjs';

const textOf = (content) => typeof content === 'string' ? content
  : (Array.isArray(content) ? content : []).filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n');

/** Read-only fallback for DSH deployments whose own session-query index is disabled. No model, activation, or session writes. */
export function createDshContentSearch({ controller, query, watch, file, log = console, diagnostics }) {
  const index = createCachedContentIndex({ file });
  const dirty = new Set();
  // Failed reads stay stopped. Only an explicit refresh clears them; ordinary list polling never retries them.
  const unreadable = new Map(); // id -> { reason }
  // A conversation that keeps changing (a session that is running) was read whole again on every list refresh: a 105 MB session of 39k events is seconds of work a
  // time, for as long as the session runs and the list stays open. When a read took a fifth of a second or more, the next one waits twenty times as long (at most five
  // minutes), so the search never spends more than a twentieth of the time on one conversation; a small one is read again at once, as before.
  const HEAVY_MS = 200;
  const DUTY = 20;
  const MOST_WAIT = 5 * 60_000;
  const reads = new Map(); // id -> { at, ms }: when it was last read for the search, and how long that took
  const due = (id) => { const last = reads.get(id); return !last || last.ms < HEAVY_MS || Date.now() - last.at >= Math.min(MOST_WAIT, DUTY * last.ms); };
  const lifetime = new AbortController();
  const loading = new Map();
  let pending;
  let unwatch;
  let progress = { running: false, done: 0, total: 0, unsearchable: 0, failed: false };
  const stamp = (row) => `${row.updatedAt}:${row.seq ?? ''}`;
  const current = (row) => !dirty.has(row.id) && index.stamp(row.id) === stamp(row) && index.messageStamp(row.id) === stamp(row);
  // Its words are in the index, though not the newest ones (it is waiting for its next read): it can be searched.
  const searchable = (row) => index.has(row.id);
  const settle = (rows) => {
    const missing = rows.filter((row) => !current(row) && !searchable(row)).length;
    progress = { running: false, done: rows.length - missing, total: rows.length, unsearchable: missing, failed: missing > 0 };
  };
  const remember = (id, version, messages) => index.set(id, version, {
    user: messages.filter((message) => message.role === 'user').map((message) => message.text).join('\n'),
    assistant: messages.filter((message) => message.role === 'assistant').map((message) => message.text).join('\n'),
    messages,
  });
  const load = (id, version) => {
    if (loading.has(id)) return loading.get(id);
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]);
    const task = (async () => {
      const { events, meta } = await readSessionHistory({ controller: controller(), query: query?.() }, id, signal);
      if (meta?.origin === 'subagent' || meta?.parentSession) throw Object.assign(new Error('Invalid session'), { code: 'invalid_session' });
      const messages = [];
      for (const event of events) {
        const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : null;
        const text = role ? textOf(event.data?.message?.content ?? event.data?.content) : '';
        if (text.trim()) messages.push({ role, ...(Number.isFinite(event.time) ? { at: event.time } : {}), text });
      }
      await remember(id, version ?? `${events.at(-1)?.time ?? 0}:`, messages);
    })().finally(() => { loading.delete(id); });
    loading.set(id, task);
    return task;
  };
  return {
    ready: index.ready,
    snapshot: index.snapshot,
    saveSnapshot: index.saveSnapshot,
    messageStamp: index.messageStamp,
    page: index.page,
    load,
    update(rows, { refresh = false } = {}) {
      if (lifetime.signal.aborted) return;
      if (refresh) { unreadable.clear(); reads.clear(); }
      unwatch ??= watch?.((id) => { dirty.add(id); });
      const present = new Set(rows.map((row) => row.id));
      for (const key of index.keys()) if (!present.has(key)) { index.delete(key); dirty.delete(key); }
      for (const key of unreadable.keys()) if (!present.has(key)) unreadable.delete(key);
      for (const key of reads.keys()) if (!present.has(key)) reads.delete(key);
      if (pending) return;
      const todo = rows.map((row) => ({ row, stamp: stamp(row) })).filter(({ row }) => !current(row) && !unreadable.has(row.id) && due(row.id));
      if (!todo.length) { settle(rows); return; }
      const reading = new Set(todo.map(({ row }) => row.id));
      const waiting = rows.filter((row) => !current(row) && !reading.has(row.id) && !searchable(row)).length; // the ones that are waiting for their next try
      progress = { running: true, done: rows.length - todo.length - waiting, total: rows.length, unsearchable: waiting, failed: waiting > 0 };
      pending = (async () => {
        for (const { row, stamp } of todo) {
          if (lifetime.signal.aborted) break;
          dirty.delete(row.id);
          const began = Date.now();
          try {
            await load(row.id, stamp);
            reads.set(row.id, { at: Date.now(), ms: Date.now() - began });
            unreadable.delete(row.id);
            progress.done++;
          } catch (error) {
            if (lifetime.signal.aborted) break;
            const text = error instanceof Error ? error.message : String(error);
            unreadable.set(row.id, { reason: text });
            diagnostics?.record({ event: 'session.index.failure', provider: 'dsh', id: row.id, error });
            log.warn?.(`[dudu] Conversation search cannot read DSH session ${row.id}: ${/[.!?]$/.test(text) ? text : `${text}.`} Automatic retry is disabled.`);
          }
          await yieldToHost();
        }
      })().finally(() => { if (lifetime.signal.aborted) progress = { ...progress, running: false }; else settle(rows); pending = undefined; });
    },
    async find(terms) {
      const matches = await Promise.all(terms.map((term) => index.find(term)));
      const keys = [...(matches[0]?.keys() ?? [])].filter((id) => matches.every((items) => items.has(id)));
      return index.evidence(keys, terms.join(' '));
    },
    // `ready`: everything is read. `searchable`: there is text to search in at all (some conversations may be missing, which the progress says): a search asks the index and
    // nothing else, so it is quick; only while there is nothing indexed yet does it ask DSH's own, slow search for the answer.
    state: () => ({ ...progress, ready: !progress.running && !progress.failed && progress.done === progress.total && index.size > 0, searchable: index.size > 0 }),
    settled: async () => { await pending; await index.flush(); },
    async close() { lifetime.abort(); unwatch?.(); await pending; await Promise.allSettled([...loading.values()]); await index.close(); },
  };
}
