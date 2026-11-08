// How often a connector is collected, and the small scheduler that does it (docs/assistant.md 3.1, "定时").
//
//   parseFrequency('15m' | '2h' | '1d' | '0 9-18 * * 1-5') -> { ok: true, frequency: { kind: 'every', ms, text } | { kind: 'cron', expression, text } } | { ok: false, message }
//   nextDue(frequency, lastStartedAt, now) -> ms      when the next collection is due; with no earlier collection: now
//   createScheduler({ list, lastStarted, run, now, tickMs, firstMs, log }) -> { start, tick, runNow, dispose }
//
//     list()           the connectors as the registry lists them: [{ id, frequency: text | null }] (no text is every 30 minutes)
//     lastStarted(id)  when the last collection of that connector started (ms), or null
//     run(id)          async: collect, store, triage and hand out one connector; its answer is passed back to runNow
//
// Collections run one at a time, in the order they came due. A connector that is already waiting or running is not queued again; a
// restart that finds one overdue runs it once, not once per missed time. A failed collection is not retried before its next time.
// DSH's own dsh-schedule is not used: it wakes a session with a reminder, it does not run the plugin's code, and the default composition
// does not carry it.
import { cronProblem, nextCron } from './cron.mjs';

export const DEFAULT_EVERY_MS = 30 * 60_000;
export const MIN_EVERY_MS = 5 * 60_000;
const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };
// The two things a person can be told, in words the settings page translates (ui/strings.js).
export const ASK = 'Give how often, such as 30m, 2h or 1d, or a cron expression such as 0 9 * * 1-5.';
export const TOO_OFTEN = 'The shortest time between collections is 5 minutes.';

export function parseFrequency(input) {
  const text = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { ok: false, message: ASK };
  const every = /^(\d{1,4})\s*([mhd])$/i.exec(text);
  if (every) {
    const ms = Number(every[1]) * UNITS[every[2].toLowerCase()];
    if (ms < MIN_EVERY_MS) return { ok: false, message: TOO_OFTEN };
    return { ok: true, frequency: { kind: 'every', ms, text: `${every[1]}${every[2].toLowerCase()}` } };
  }
  if (/^\d/.test(text) && !/\s/.test(text)) return { ok: false, message: ASK };
  if (cronProblem(text)) return { ok: false, message: ASK };
  // The floor holds for an expression too: look at the gaps between the next few times it names.
  let at = Date.now();
  for (let n = 0; n < 8; n++) {
    const next = nextCron(text, at);
    if (next === null) break;
    if (n > 0 && next - at < MIN_EVERY_MS) return { ok: false, message: TOO_OFTEN };
    at = next;
  }
  return { ok: true, frequency: { kind: 'cron', expression: text, text } };
}

const DEFAULT = { kind: 'every', ms: DEFAULT_EVERY_MS, text: '30m' };

/** The frequency a connector entry has: the one it wrote, or every 30 minutes. A frequency that cannot be read is the default. */
export function frequencyOf(text) {
  if (!text) return DEFAULT;
  const parsed = parseFrequency(text);
  return parsed.ok ? parsed.frequency : DEFAULT;
}

export function nextDue(frequency, lastStartedAt, now) {
  if (lastStartedAt == null) return now;
  if (frequency.kind === 'every') return lastStartedAt + frequency.ms;
  return nextCron(frequency.expression, lastStartedAt) ?? Number.POSITIVE_INFINITY;
}

export function createScheduler({ list, lastStarted, run, now = Date.now, tickMs = 60_000, firstMs = 60_000, log = console }) {
  const waiting = []; // { id, resolve }
  const started = new Map(); // id -> ms, so that a collection that began a moment ago is not due again before its row is written
  let current = null; // { id, promise } of the collection that is running
  let draining = null;
  let timer = null;
  let first = null;
  let closed = false;

  const queued = (id) => waiting.find((entry) => entry.id === id) ?? null;

  async function drain() {
    while (!closed && waiting.length) {
      const entry = waiting.shift();
      current = entry;
      started.set(entry.id, now());
      try {
        entry.resolve(await run(entry.id));
      } catch (error) {
        log.warn?.(`[dudu] Collecting ${entry.id} failed: ${error?.message ?? error}`);
        entry.resolve({ outcome: 'error', message: String(error?.message ?? error) });
      } finally {
        current = null;
      }
    }
    for (const entry of waiting.splice(0)) entry.resolve({ outcome: 'no_op', message: 'The scheduler was shut down.' });
  }

  function enqueue(id) {
    if (closed) return Promise.resolve({ outcome: 'no_op', message: 'The scheduler was shut down.' });
    const there = queued(id) ?? (current?.id === id ? current : null);
    if (there) return there.promise;
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    waiting.push({ id, resolve, promise });
    draining ??= drain().finally(() => { draining = null; });
    return promise;
  }

  /** Queues every connector that is due, and answers when the queue is empty. */
  async function tick() {
    if (closed) return;
    let connectors = [];
    try {
      connectors = list() ?? [];
    } catch (error) {
      log.warn?.(`[dudu] The connectors could not be listed for collection: ${error?.message ?? error}`);
    }
    const at = now();
    const due = [];
    for (const connector of connectors) {
      if (current?.id === connector.id || queued(connector.id)) continue;
      const last = Math.max(lastStarted(connector.id) ?? 0, started.get(connector.id) ?? 0) || null;
      if (nextDue(frequencyOf(connector.frequency), last, at) <= at) due.push(enqueue(connector.id));
    }
    await Promise.all(due);
  }

  return {
    start() {
      if (timer || closed) return;
      first = setTimeout(() => { void tick(); }, firstMs);
      timer = setInterval(() => { void tick(); }, tickMs);
      first.unref?.();
      timer.unref?.();
    },
    tick,
    runNow: enqueue,
    async dispose() {
      closed = true;
      clearTimeout(first);
      clearInterval(timer);
      timer = null;
      await draining;
    },
  };
}
