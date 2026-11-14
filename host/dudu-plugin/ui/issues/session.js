import { abortable } from '../lib/abortable.js';

/** Readable history can still be archived. Always restore through the issue's hook before opening its composer. */
export async function resolveIssueSession(request, _actions, issue, { signal } = {}) {
  const [, ...rest] = String(issue.session ?? '').split(':');
  const id = rest.join(':');
  if (!id) throw new Error('The issue has no session.');
  const target = await request('issues/resume', { id: issue.id }, { signal });
  if (typeof target?.sessionId !== 'string' || !target.sessionId || !['success', 'no_op'].includes(target.outcome)) {
    throw new Error(target?.message || 'The session could not be put back.');
  }
  return target;
}

/** Only a successful read awaiting a native identity is polled; failed auxiliary reads stop until the issue is reopened. */
export function watchIssueSession(request, { id, agent }, receive) {
  const controller = new AbortController();
  let timer;
  const read = async () => {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    try {
      const result = await abortable(request('issues/session', { id }, { signal }), signal);
      if (controller.signal.aborted || result?.outcome !== 'success') return;
      receive(result);
      // Harness identity may arrive after DSH has already created its session.
      if (!controller.signal.aborted && ['claude', 'codex', 'pi'].includes(agent) && !result.command) timer = setTimeout(read, 5000);
    } catch { /* The copy command stays unavailable; do not retry a failed read. */ }
  };
  void read();
  return () => { controller.abort(); clearTimeout(timer); };
}
