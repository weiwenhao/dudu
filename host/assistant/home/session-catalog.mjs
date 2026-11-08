// DSH sessions and native harness sessions share one list. A harness conversation already loaded into DSH is one row.
import { betterMatch, messageMatch } from '../../conversation-search.mjs';
import { withAbort } from '../../providers/async.mjs';
const attached = (native, local) => ({
  ...native, title: local.title || native.title, workspaceId: local.workspaceId,
  project: local.project ?? native.project, updatedAt: Math.max(native.updatedAt, local.updatedAt),
  ...(!native.evidence && local.evidence ? { evidence: local.evidence } : {}),
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
          const local = (await dsh.catalog()).find((entry) => entry.id === session.dshSessionId);
          return local ? attached(session, local) : session;
        } catch { return session; }
      }
      if (provider !== 'dsh') return null;
      return (await dsh.catalog()).find((session) => session.id === id) ?? null;
    },
    async read({ provider, id, before, query = '' } = {}, { signal = AbortSignal.timeout(10_000) } = {}) {
      if (!['claude', 'codex', 'dsh'].includes(provider) || typeof id !== 'string' || !id || id.startsWith('dudu-assistant-') ||
          typeof query !== 'string' || query.length > 1000 ||
          (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) return { outcome: 'error', code: 'invalid_session' };
      // A preview reads the original conversation. Importing, repairing and syncing its DSH copy belong to Open / Import.
      // In particular an id lookup must never run a content search of every DSH conversation before showing twenty messages.
      const read = (cursor) => {
        signal.throwIfAborted();
        return provider !== 'dsh'
          ? native.read({ provider, id, before: cursor, ...(query ? { query } : {}) }, { signal })
          : dsh.read(`dsh:${id}`, { before: cursor, ...(query ? { query } : {}), signal });
      };
      let page = await read(before);
      if (!query.trim() || before !== undefined || page.outcome !== 'success') return page;
      const latest = page;
      let best;
      let bestHit;
      const seen = new Set();
      while (page.outcome === 'success') {
        signal.throwIfAborted();
        const hit = messageMatch(page.messages, query);
        if (hit && (!bestHit || betterMatch(hit, bestHit))) {
          best = { ...page, matchIndex: hit.index };
          bestHit = hit;
          if (hit.exact) return best;
        }
        const cursor = page.nextCursor;
        if (!cursor || seen.has(cursor)) break;
        seen.add(cursor);
        page = await read(cursor);
        if (page.outcome !== 'success') return page;
      }
      return best ?? latest;
    },
    async list({ query = '', provider, limit = 200, ...options } = {}, { signal } = {}) {
      signal?.throwIfAborted();
      const nativeRead = Promise.resolve().then(() => native.list({ ...options, query, provider, limit: 500 }));
      const dshRead = Promise.resolve().then(() => dsh.catalog({ query, signal, refresh: options.refresh }));
      const results = await Promise.allSettled([
        signal ? withAbort(nativeRead, signal) : nativeRead,
        signal ? withAbort(dshRead, signal) : dshRead,
      ]);
      // A read deadline can leave one source unavailable. Keep the other source's rows; explicit caller cancellation still ends the read.
      if (signal?.aborted && signal.reason?.name !== 'TimeoutError') signal.throwIfAborted();
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
      const dshIndex = dsh.searchState?.();
      const nativeIndex = harnesses.indexing;
      return {
        ...harnesses, sessions: sorted.slice(0, Math.min(500, Math.max(1, Number(limit) || 200))).map(withIssue), total: sorted.length,
        // `unsearchable`: the conversations whose text could not be read, so a search does not look inside them. That says something about a search, not about the list.
        indexing: {
          running: Boolean(nativeIndex?.running || dshIndex?.running),
          done: (nativeIndex?.done ?? 0) + (dshIndex?.done ?? 0), total: (nativeIndex?.total ?? 0) + (dshIndex?.total ?? 0),
          unsearchable: (nativeIndex?.unsearchable ?? 0) + (dshIndex?.unsearchable ?? 0),
        },
        // `unavailable`: a source of sessions could not be listed, so the list is not complete.
        ...(results.some((result) => result.status === 'rejected') ? { unavailable: true } : {}),
      };
    },
  };
}
