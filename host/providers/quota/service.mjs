// The subscription quota, asked for only when somebody asks (owner, 2026-11-11: "只有点击图标才会触发额度检查，平时不会检查"): a person opens the quota panel, or asks 嘟嘟 for the card.
// A reading starts the agents' own programs and calls their servers, which limit how often they answer, so each source is asked for at most once in `floorMs` (15 minutes: the owner asked for "至少 10 分钟才能请求一次"
// and then, on 2026-11-11, "改成 15 分钟"), counted from the last ASK, a failed one included. What is shown is what the last reading that worked said, with its time; a source whose sign-in is gone, or that has nothing to read, is not shown at all.
//
// `sources()` is the list of what can be read, built from the providers that are found and enabled (and DSH's own DeepSeek accounts); each source is `{ id, agent, name, read(signal) }` and `read` resolves to
// `{ state: 'ok', plan?, kind?: 'balance', windows?, balance? }`, `{ state: 'login' }` or `{ state: 'none' }`, or throws. Nothing here names an agent: a provider that is added later brings its own `read`.

export const FLOOR = 15 * 60_000;
const TIMEOUT = 45_000;

export function createQuota({ store, sources, now = Date.now, floorMs = FLOOR, timeoutMs = TIMEOUT, log = console }) {
  const inflight = new Map();

  async function listed() {
    try { return (await sources()).filter((source) => source && typeof source.id === 'string' && typeof source.read === 'function'); } catch (error) {
      log.warn?.(`[dudu] The quota sources could not be listed: ${error?.message ?? error}`);
      return [];
    }
  }

  function start(source) {
    store.begin(source.id, now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('The reading took too long.')), timeoutMs);
    const run = (async () => {
      try {
        const reading = await source.read(controller.signal);
        if (reading?.state === 'ok') store.succeed(source.id, now(), reading);
        else store.clear(source.id, reading?.state === 'login' ? 'login' : 'none');
      } catch (error) {
        store.fail(source.id);
        log.warn?.(`[dudu] The quota of ${source.id} could not be read: ${error?.message ?? error}`);
      } finally {
        clearTimeout(timer);
        inflight.delete(source.id);
      }
    })();
    inflight.set(source.id, run);
  }

  function viewOf(list) {
    const providers = [];
    for (const source of list) {
      const row = store.get(source.id);
      // what is shown: a reading that worked, even if the last attempt after it did not; nothing for a sign-in that is gone, nothing to read, or nothing read yet
      if (!row?.data || !['ok', 'error'].includes(row.state)) continue;
      providers.push({
        id: source.id, agent: source.agent ?? source.id, name: source.name, plan: row.data.plan ?? '',
        ...(row.data.kind ? { kind: row.data.kind } : {}), windows: row.data.windows ?? [], ...(row.data.balance ? { balance: row.data.balance } : {}),
        // when the plan's paid time ends, only while that is still ahead: a reading kept from before it passed says nothing of now
        ...(Number.isFinite(row.data.until) && row.data.until > now() ? { until: row.data.until } : {}),
        readAt: row.readAt,
      });
    }
    const times = providers.map((provider) => provider.readAt).filter(Number.isFinite);
    return { providers, refreshing: list.some((source) => inflight.has(source.id)), readAt: times.length ? Math.min(...times) : null };
  }

  return {
    /**
     * The quota as the stored readings have it. `ask` is a person asking now: each source not asked for within the floor is read in the background (the answer does not wait for it:
     * `refreshing` says one is under way); `wait` also waits for those readings, for a snapshot that is made once (the card in the chat).
     */
    async request({ ask = false, wait = false } = {}) {
      const list = await listed();
      if (ask) {
        for (const source of list) {
          if (inflight.has(source.id)) continue;
          const row = store.get(source.id);
          if (row && now() - row.triedAt < floorMs) continue;
          start(source);
        }
      }
      if (wait) await Promise.allSettled(list.filter((source) => inflight.has(source.id)).map((source) => inflight.get(source.id)));
      return viewOf(list);
    },
    /** Resolves once the readings under way have ended (for tests). */
    settled: () => Promise.allSettled([...inflight.values()]),
    close: () => store.close(),
  };
}
