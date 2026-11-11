// "Fill in context" on a record of the Collector: the plugin asks the collector's own session to go back to the source and read the conversation around the record. That runs in the
// background, from ten seconds to a few minutes, so the page starts it (`inbox/complete`) and then reads the record every few seconds (`inbox/get`: `completing`, `completeError`)
// until it ends. While it runs nothing else about the record changes; when it ends the record holds more text or context and `completing` is false.
import { abortable } from '../lib/abortable.js';

export const EVERY = 3_000; // how often the record is read while its completion runs
export const GIVE_UP = 4 * 60_000; // how long a completion is waited for
const ASK_MS = 15_000; // how long one call to the plugin is waited for (the marks of this widget wait as long), so that a call that never comes back cannot keep the busy sign up

/**
 * What one reading of the record says, `waited` ms into the wait: 'wait' (the completion runs still, or the reading did not come: ask again), 'done', or 'failed' (the plugin ended it
 * with a reason, or it was still not over when the waiting was given up). A reading that says it is over is believed even when it comes late.
 */
export function completionStep(result, waited) {
  const record = result?.outcome === 'success' ? result.record : null;
  if (record && !record.completing) return record.completeError ? 'failed' : 'done';
  return waited >= GIVE_UP ? 'failed' : 'wait';
}

/**
 * The completions this page is waiting on, in the shape `useSyncExternalStore` wants: the snapshot is `{ running: Set of record ids, ended: Map of id to how many completions of that
 * record have ended here }`. `start(record)` asks the plugin to begin one and waits for it; `follow(id)` waits for one that is running already (the open record says so); `stop()` ends
 * the waiting (the page is going). `whenFailed(handler)` sets what is called when one could not be started, ended with a reason, or was given up on: `handler(reason)`, the plugin's own words
 * when it gave some (English), else an empty string.
 */
export function createCompletions({ request, now = Date.now, askMs = ASK_MS }) {
  let onFailed = () => {};
  let snapshot = { running: new Set(), ended: new Map() };
  const listeners = new Set();
  const jobs = new Map();
  const publish = (next) => { snapshot = next; for (const listener of listeners) listener(); };
  // One call to the plugin about one record: its answer, or null when it did not come (an error, or no answer in time).
  const ask = async (action, id) => {
    const signal = AbortSignal.timeout(askMs);
    try { return await abortable(request(action, { id }, { signal }), signal); } catch { return null; }
  };

  // One job for each record being waited on, from the click (the busy sign is up at once) to the end.
  function begin(id) {
    if (jobs.has(id)) return null;
    const job = { live: true, timer: 0 };
    jobs.set(id, job);
    publish({ ...snapshot, running: new Set(snapshot.running).add(id) });
    return job;
  }
  // `failed` is null when it worked, else the reason (the plugin's own words, or '' when it said none).
  function end(id, job, failed) {
    if (jobs.get(id) !== job) return;
    job.live = false;
    clearTimeout(job.timer);
    jobs.delete(id);
    const running = new Set(snapshot.running);
    running.delete(id);
    publish({ running, ended: new Map(snapshot.ended).set(id, (snapshot.ended.get(id) ?? 0) + 1) });
    if (failed !== null) onFailed(failed);
  }
  function watch(id, job) {
    const since = now();
    const look = async () => {
      const result = await ask('inbox/get', id);
      if (!job.live) return;
      const step = completionStep(result, now() - since);
      if (step === 'wait') job.timer = setTimeout(look, EVERY); else end(id, job, step === 'failed' ? String(result?.record?.completeError ?? '') : null);
    };
    job.timer = setTimeout(look, EVERY);
  }

  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    async start(record) {
      const { id } = record;
      const job = begin(id);
      if (!job) return;
      const answer = await ask('inbox/complete', id);
      // Not started (the plugin says it is busy, or its answer did not come): one for this record may be running all the same, started from the phone say; the record tells.
      const running = (answer?.outcome === 'success' && answer.started === true) || (await ask('inbox/get', id))?.record?.completing === true;
      if (!job.live) return;
      if (running) watch(id, job); else end(id, job, String(answer?.message ?? ''));
    },
    follow(id) { const job = begin(id); if (job) watch(id, job); },
    whenFailed(handler) { onFailed = handler; },
    stop() { for (const job of jobs.values()) { job.live = false; clearTimeout(job.timer); } jobs.clear(); },
  };
}
