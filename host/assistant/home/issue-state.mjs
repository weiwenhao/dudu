/** Stopped work awaits boss or Dudu, including unfinished, failed and imported work. */
export function issueStatusForSession(state) {
  if (state === 'running') return 'in_progress';
  if (['waiting_owner', 'finished', 'idle', 'error'].includes(state)) return 'in_review';
  return null;
}
