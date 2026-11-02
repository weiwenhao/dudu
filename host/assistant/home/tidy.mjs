// One idle boundary for automatic memory consolidation. No model call until there is a new conversation turn.
export function createIdleTidy({ memory, busy, now = Date.now, idleMs = 5 * 60_000, everyMs = 60_000, log = console }) {
  let touchedAt = null;
  let generation = 0;
  let completed = 0;
  let running = null;
  let closed = false;
  async function tick() {
    if (closed || running || generation === completed || touchedAt === null || now() - touchedAt < idleMs || busy()) return;
    const current = memory();
    if (!current) return;
    const batch = generation;
    running = Promise.resolve().then(() => current.tidy({ apply: true })).then((result) => {
      if (result.outcome === 'success' || result.outcome === 'no_op') completed = result.more ? batch - 1 : batch;
      else log.warn?.(`[dudu] Memory tidy did not finish: ${result.message}`);
      return result;
    }).catch((error) => log.warn?.(`[dudu] Memory tidy failed: ${error.message}`)).finally(() => { running = null; });
    return running;
  }
  const timer = everyMs > 0 ? setInterval(() => { void tick(); }, everyMs) : null;
  timer?.unref?.();
  return {
    touch() { touchedAt = now(); generation++; },
    tick,
    get running() { return running !== null; },
    async close() { closed = true; clearInterval(timer); await running; },
  };
}
