import { useLayoutEffect, useRef, useState } from 'react';
import { abortable } from '../lib/abortable.js';

/** Importing a native TUI session changes its stored key, while the retained DSH conversation stays the same. */
export function retainedSessionIdentity(issue, attempt, current = null) {
  if (current?.issueId === issue.id && current.attempt === attempt && current.reference?.sessionId
    && issue.session === `dsh:${current.reference.sessionId}`) return current.identity;
  return `${issue.id}:${issue.session ?? ''}:${attempt}`;
}

/** Own only the visible preview reference; the host-history cache owns its separate reference. */
export function watchRetainedSession(issue, resolve, actions, receive, { cached = true } = {}) {
  let active = true;
  let retained;
  let sessionId;
  let stage = 'resume';
  const began = Date.now();
  const controller = new AbortController();
  const release = () => { retained?.release(); retained = undefined; };
  const publish = () => receive({ reference: retained, failed: false });
  void (async () => {
    try {
      // Only a ready generation in DSH's live unarchived set can be shown now.
      retained = cached ? actions.retainCachedSession?.(issue) : undefined;
      if (retained) publish();
      // Resume still records the owner's touch and checks the current assignment.
      const target = await abortable(resolve(issue, { signal: controller.signal }), controller.signal);
      if (!active) return;
      sessionId = target.sessionId;
      stage = 'history';
      if (retained?.sessionId === target.sessionId) await abortable(retained.ready, controller.signal);
      else {
        const next = await actions.retainSession(target, { signal: controller.signal, issue, onStage: (value) => { stage = value; } });
        if (!active) { next.release(); return; }
        release();
        retained = next;
        publish();
      }
    } catch (error) {
      if (active) {
        release();
        // DSH owns opening/reconnect and reports actual failures. A large cold log can legitimately
        // take longer than fifteen seconds; elapsed time must not permanently discard its result.
        // No titles, prompts, paths or raw upstream error text go into the renderer diagnostic.
        try {
          actions.sessionOpenFailed?.({
            stage, issueId: issue.id,
            ...(/^[A-Za-z0-9_-]{1,160}$/.test(sessionId ?? '') ? { sessionId } : {}),
            elapsedMs: Math.max(0, Date.now() - began),
            reason: error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'AbortError' ? 'cancelled' : 'open_failed',
          });
        } catch { /* diagnostics must not prevent the existing error/retry state */ }
        receive({ reference: null, failed: true });
      }
    }
  })();
  return () => { active = false; controller.abort(); release(); };
}

/** Polling an issue's title/state must never release and resume its already-open composer. */
export function useRetainedSession(issue, resolveSession, actions, attempt = 0) {
  const [state, setState] = useState(null);
  const identity = retainedSessionIdentity(issue, attempt, state?.actions === actions ? state : null);
  const resolution = useRef(null);
  useLayoutEffect(() => { resolution.current = { issue, resolveSession }; });
  useLayoutEffect(() => {
    const { issue: openingIssue, resolveSession: resolve } = resolution.current;
    return watchRetainedSession(openingIssue, resolve, actions,
      value => setState({ identity, actions, issueId: openingIssue.id, attempt, ...value }), { cached: attempt === 0 });
  }, [identity, actions, attempt]);
  return state?.identity === identity && state.actions === actions ? state : { reference: null, failed: false };
}
