/** DSH's public lifecycle supports durable archival, not physical deletion of append-only session logs. */
export function createSessionCleanup({ links, issues, registry, forget, suspend }) {
  return async (issue) => {
    const keys = new Set([issue.session, ...(issue.sessions ?? []).map((session) => session.key)].filter(Boolean));
    const targets = [];
    for (const key of keys) {
      const [provider, ...parts] = key.split(':');
      const id = parts.join(':');
      const sessionId = provider === 'dsh' ? id : links.get(provider, id);
      const aliases = [key, sessionId && `dsh:${sessionId}`, sessionId && links.nativeKey(sessionId)].filter(Boolean);
      if (aliases.some((alias) => issues.sessionOwners(alias).some((owner) => owner !== issue.id))) continue;
      targets.push({ provider, id, sessionId });
    }
    // Ignore stop events during cleanup without discarding a question if DSH refuses the archival.
    const restore = suspend?.(issue);
    try {
      for (const target of targets) {
        if (target.sessionId) await registry().archiveSession(target.sessionId, { stopActivity: true });
        await links.retire(target);
      }
      forget(issue);
    } catch (error) {
      await restore?.();
      throw error;
    }
  };
}
