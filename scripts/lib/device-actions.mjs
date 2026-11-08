// What the phone's diagnostics say about "I tapped and nothing happened for a while" (owner, 2026-11-07). The app logs every tap (`user.tap`: where, and how long the
// touch waited for the main thread before the app saw it), every press and hold (`user.hold`), every request it makes to the computer (`http.request.complete`: the
// method and how long it took) and every time the main thread was busy for a quarter of a second or more (`ui.main_thread_stall`). This puts them side by side: for
// each tap, the requests that started right after it and how long the longest took to come back, and whether the main thread stalled around it. Pure: no files, no
// clock. Times are the records' `timestamp` (milliseconds, UTC).

const START_AFTER_TAP_MS = 800; // a request that starts this soon after a tap is taken to be the tap's
const START_BEFORE_TAP_MS = 150; // (the clocks of one process agree, but a record is written when the thing is over)
const STALL_WINDOW_MS = [-200, 3000]; // a stall this near a tap is counted with it

const timeOf = (entry) => (Number.isFinite(entry?.timestamp) ? entry.timestamp : Date.parse(entry?.timestamp ?? ''));

/**
 * @param entries the records of the diagnostics log, in any order
 * @param options `since` (ms; earlier records are left out), `slowMs` (a wait this long or longer is slow; default 1000)
 * @returns { taps, slow, stalls, requests }: every tap with what followed it, the slow ones longest first, the main thread's stalls, and the requests that no tap explains
 */
export function analyzeActions(entries, { since = -Infinity, slowMs = 1000 } = {}) {
  const records = entries.filter((entry) => timeOf(entry) >= since).sort((a, b) => timeOf(a) - timeOf(b));
  const requests = records
    .filter((entry) => entry.event === 'http.request.complete' && Number.isFinite(entry.elapsedMs))
    .map((entry) => ({ method: entry.method ?? '?', ms: Math.round(entry.elapsedMs), start: timeOf(entry) - entry.elapsedMs, end: timeOf(entry), code: entry.code }));
  const stalls = records.filter((entry) => entry.event === 'ui.main_thread_stall' && Number.isFinite(entry.elapsedMs)).map((entry) => ({ at: timeOf(entry), ms: Math.round(entry.elapsedMs) }));
  const taps = records.filter((entry) => entry.event === 'user.tap' || entry.event === 'user.hold').map((entry) => {
    const at = timeOf(entry);
    const hold = entry.event === 'user.hold';
    // the record of a tap is written when the app sees the touch: `elapsedMs` is how long the touch waited for the main thread (a hold: how long the finger stayed)
    const touchAt = hold ? at : at - (entry.elapsedMs ?? 0);
    const followed = requests.filter((request) => request.start >= touchAt - START_BEFORE_TAP_MS && request.start <= touchAt + START_AFTER_TAP_MS).sort((a, b) => a.start - b.start);
    const waitMs = followed.length ? Math.round(Math.max(...followed.map((request) => request.end)) - touchAt) : 0;
    const near = stalls.filter((stall) => stall.at >= touchAt + STALL_WINDOW_MS[0] && stall.at <= touchAt + STALL_WINDOW_MS[1]);
    const geometry = entry.geometry ?? {};
    return {
      at: touchAt, kind: hold ? 'hold' : 'tap', x: geometry.tapX, y: geometry.tapY, screen: [geometry.screenWidth, geometry.screenHeight],
      inputLatencyMs: hold ? 0 : Math.round(entry.elapsedMs ?? 0), holdMs: hold ? Math.round(entry.elapsedMs ?? 0) : 0,
      requests: followed.map(({ method, ms, code }) => ({ method, ms, ...(code ? { code } : {}) })), waitMs, stalledMs: near.length ? Math.max(...near.map((stall) => stall.ms)) : 0,
    };
  });
  const explained = new Set(taps.flatMap((tap) => tap.requests.map((request) => `${request.method}:${request.ms}`)));
  return {
    taps,
    slow: taps.filter((tap) => tap.kind === 'tap' && (tap.waitMs >= slowMs || tap.inputLatencyMs >= 250 || tap.stalledMs > 0)).sort((a, b) => Math.max(b.waitMs, b.stalledMs, b.inputLatencyMs) - Math.max(a.waitMs, a.stalledMs, a.inputLatencyMs)),
    stalls,
    requests: requests.filter((request) => !explained.has(`${request.method}:${request.ms}`)),
  };
}

/** A few lines for the terminal: the slowest taps, what they asked the computer, and how many stalls the main thread had. */
export function describeActions(result, { zone = 8 * 3_600_000, limit = 12 } = {}) {
  const clock = (ms) => new Date(ms + zone).toISOString().slice(11, 23);
  const lines = [`${result.taps.length} touches (${result.taps.filter((tap) => tap.kind === 'tap').length} taps), ${result.stalls.length} main-thread stalls, ${result.slow.length} slow taps.`];
  for (const tap of result.slow.slice(0, limit)) {
    const asked = tap.requests.map((request) => `${request.method} ${request.ms} ms`).join(', ') || 'no request';
    lines.push(`  ${clock(tap.at)}  (${tap.x}, ${tap.y}) of ${tap.screen.join('x')}: waited ${tap.waitMs} ms for ${asked}${tap.inputLatencyMs >= 250 ? `; the app saw the touch ${tap.inputLatencyMs} ms late` : ''}${tap.stalledMs ? `; main thread stalled ${tap.stalledMs} ms` : ''}`);
  }
  return lines.join('\n');
}
