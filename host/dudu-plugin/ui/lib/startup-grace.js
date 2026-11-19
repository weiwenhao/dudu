// The plugin answers nothing for a few seconds after DSH starts or the plugin is updated, and the page can open in that gap. A read that has never worked
// therefore keeps the loading state it already has and asks again every second, and is called failed only after STARTUP_GRACE_MS. A read that has worked
// keeps what it has; the polls that follow bring a later failure back on their own.
export const STARTUP_GRACE_MS = 45_000;
export const STARTUP_RETRY_MS = 1000;

const wait = (ms, signal) => new Promise((resolve) => {
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal?.addEventListener('abort', done, { once: true });
});

/** Runs `run` until it works, for at most `graceMs`; the last failure is thrown once the time is up, or when `signal` aborts. */
export async function untilStarted(run, { graceMs = STARTUP_GRACE_MS, retryMs = STARTUP_RETRY_MS, signal } = {}) {
  const deadline = Date.now() + graceMs;
  for (;;) {
    try { return await run(); } catch (error) {
      if (signal?.aborted || Date.now() + retryMs > deadline) throw error;
    }
    await wait(retryMs, signal);
    signal?.throwIfAborted();
  }
}
