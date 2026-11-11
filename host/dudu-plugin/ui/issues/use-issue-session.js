import { useEffect, useState } from 'react';
import { watchIssueSession } from './session.js';

/** The Properties row and the conversation header use the same persisted native continuation identity. */
export function useIssueSession(request, issue) {
  const id = issue?.id;
  const key = issue?.session;
  const agent = issue?.agent;
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!key) return undefined;
    return watchIssueSession(request, { id, agent }, (value) => setSession({ id, key, value }));
  }, [id, key, agent, request]);
  return session && session.id === id && session.key === key ? session.value : null;
}
