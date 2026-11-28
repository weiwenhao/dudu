// How a message from the phone is handed to DSH: `queue` (it waits for the end of the running turn) or `steer` (it goes in at the next step).
//
// The phone said `queue` for every message. DSH's own composer says it for a conversation that is not running, and for one that works it says what the owner chose in Settings for the plain Enter
// (`busyEnter` of the `ui-conversation` entry: queue, DSH's default, or steer; `resolveSubmitMode` in DSH's `submission-policy.ts`). The owner's Desktop is set to steer, the phone ignored it,
// and a message from the phone to a conversation whose turn is held open for background work (providers/oar.mjs: the answer is given, a command still runs) waited behind that turn for as
// long as the command lived: the Desktop's own messages went in at once, the phone's stayed in the queue for good (owner, 2026-11-28, an Android emulator that never ends).
//
// The rule is DSH's, for the plain Enter: a conversation that does not run takes a normal message (queue: it starts its turn at once, so it is never seen waiting); one that runs takes
// it the way the owner chose. Anything that cannot be read (an older DSH without the settings service, a profile without the entry) is DSH's default, queue: what the phone always did.

/** The entry of DSH's profile that holds the conversation's settings. */
export const BUSY_ENTER_ENTRY = 'ui-conversation';

/** What the owner chose for the plain Enter while a conversation works: `steer` or `queue`. `settings` is DSH's settings service, or null/undefined. */
export function busyEnterOf(settings) {
  try {
    const entry = settings?.describe({ redactSecrets: true })?.find((candidate) => candidate?.ns === BUSY_ENTER_ENTRY);
    return entry?.value?.busyEnter === 'steer' ? 'steer' : 'queue';
  } catch {
    return 'queue';
  }
}

/** DSH's rule for a plain message: steer only into a conversation that runs, and only when the owner chose it. */
export function submitModeOf({ running, busyEnter }) {
  return running === true && busyEnter === 'steer' ? 'steer' : 'queue';
}

/**
 * The mode for a message to `sessionId`. `running(sessionId)` says whether DSH's agent of the session works (a held turn counts: DSH sees it as running), `settings()` gives DSH's settings
 * service. The choice is read only for a conversation that runs, so an idle one costs nothing.
 */
export function createSubmitMode({ running, settings }) {
  return {
    modeOf(sessionId) {
      let works = false;
      try { works = running(sessionId) === true; } catch { works = false; }
      if (!works) return 'queue';
      let service;
      try { service = settings?.(); } catch { service = undefined; }
      return submitModeOf({ running: works, busyEnter: busyEnterOf(service) });
    },
  };
}
