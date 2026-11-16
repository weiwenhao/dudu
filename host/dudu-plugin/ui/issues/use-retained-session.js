import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Importing a native TUI session changes its stored key, while the retained DSH conversation stays the same. */
export function retainedSessionIdentity(issue, attempt, current = null) {
  if (current?.issueId === issue.id && current.attempt === attempt && current.reference?.sessionId
    && issue.session === `dsh:${current.reference.sessionId}`) return current.identity;
  return `${issue.id}:${issue.session ?? ''}:${attempt}`;
}

/** Polling an issue's title/state must never release and resume its already-open composer. */
export function useRetainedSession(issue, resolveSession, actions, attempt = 0) {
  const [state, setState] = useState(null);
  const identity = retainedSessionIdentity(issue, attempt, state?.actions === actions ? state : null);
  const resolution = useRef(null);
  useLayoutEffect(() => { resolution.current = { issue, resolveSession }; });
  useEffect(() => {
    const { issue: openingIssue, resolveSession: resolve } = resolution.current;
    let active = true;
    let retained;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Session opening timed out.', 'TimeoutError')), 15_000);
    void (async () => {
      try {
        const target = await resolve(openingIssue, { signal: controller.signal });
        if (!active) return;
        retained = await actions.retainSession(target, { signal: controller.signal });
        if (active) setState({ identity, actions, issueId: openingIssue.id, attempt, reference: retained, failed: false });
        else retained.release();
      } catch { if (active) setState({ identity, actions, issueId: openingIssue.id, attempt, reference: null, failed: true }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); retained?.release(); };
  }, [identity, actions, attempt]);
  return state?.identity === identity && state.actions === actions ? state : { reference: null, failed: false };
}
