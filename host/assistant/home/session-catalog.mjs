// DSH sessions and native harness sessions share one list. A harness conversation already loaded into DSH is one row.
const attached = (native, local) => ({
  ...native, title: local.title || native.title, workspaceId: local.workspaceId,
  project: local.project ?? native.project, updatedAt: Math.max(native.updatedAt, local.updatedAt),
});

/**
 * `issues` is optional: `findBySession(key)` as the issues library has it. A row whose session an issue already manages carries
 * `issue: { id, ref }`, so the page can show the reference and open that issue instead of taking the session over again.
 */
export function createSessionCatalog({ native, dsh, issues }) {
  const issueOf = (session) => {
    for (const key of [session.dshSessionId ? `dsh:${session.dshSessionId}` : null, session.key]) {
      const issue = key ? issues?.findBySession(key)?.issue : null;
      if (issue) return { id: issue.id, ref: issue.ref };
    }
    return null;
  };
  const withIssue = (session) => { const issue = issueOf(session); return issue ? { ...session, issue } : session; };
  return {
    async get({ provider, id }) {
      if (['claude', 'codex'].includes(provider)) {
        const session = await native.describe({ provider, id });
        if (!session?.dshSessionId) return session;
        try {
          const local = (await dsh.catalog({ query: session.dshSessionId })).find((entry) => entry.id === session.dshSessionId);
          return local ? attached(session, local) : session;
        } catch { return session; }
      }
      if (provider !== 'dsh') return null;
      return (await dsh.catalog({ query: id })).find((session) => session.id === id) ?? null;
    },
    async read({ provider, id, before } = {}) {
      if (!['claude', 'codex', 'dsh'].includes(provider) || typeof id !== 'string' || !id || id.startsWith('dudu-assistant-') ||
          (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) return { outcome: 'error', code: 'invalid_session' };
      const session = await this.get({ provider, id });
      if (!session) return { outcome: 'error', code: 'session_unreadable' };
      if (!session.dshSessionId) return native.read({ provider, id, before });
      const synchronized = await native.sync?.({ sessionIds: [session.dshSessionId] });
      const replacement = synchronized?.replacements?.find((entry) => entry.previousId === session.dshSessionId);
      return dsh.read(`dsh:${replacement?.sessionId ?? session.dshSessionId}`, { before, fresh: true });
    },
    async list({ query = '', provider, limit = 200, ...options } = {}) {
      const results = await Promise.allSettled([
        native.list({ ...options, query, provider, limit: 500 }),
        dsh.catalog({ query }),
      ]);
      if (results.every((result) => result.status === 'rejected')) throw results[0].reason;
      const harnesses = results[0].status === 'fulfilled' ? results[0].value : { sessions: [], providers: [] };
      const local = results[1].status === 'fulfilled' ? results[1].value : [];
      const byDsh = new Map(local.map((session) => [session.dshSessionId, session]));
      const sessions = harnesses.sessions.map((session) => {
        const local = byDsh.get(session.dshSessionId);
        if (!local) return session;
        byDsh.delete(session.dshSessionId);
        return attached(session, local);
      });
      // A linked harness row can be filtered out by its metadata query even though DSH's own search matched it.
      sessions.push(...byDsh.values());
      const unique = new Map();
      for (const session of sessions) {
        if (provider && session.provider !== provider) continue;
        const key = session.dshSessionId ?? session.key;
        if (!unique.has(key)) unique.set(key, session);
      }
      const sorted = [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      return { ...harnesses, sessions: sorted.slice(0, Math.min(500, Math.max(1, Number(limit) || 200))).map(withIssue), total: sorted.length };
    },
  };
}
