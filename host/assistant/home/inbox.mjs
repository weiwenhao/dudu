// A waiting session is an input too. No model, no transcript write: its question becomes an issue with a source link.
import { issueStatusForSession } from './issue-state.mjs';

export function createSessionInbox({ issues, adopt, observe, links }) {
  const tails = new Map();
  let closed = false;
  const keyOf = (snapshot) => {
    const native = /^(claude|codex):(.+)$/s.exec(snapshot?.key ?? '');
    const dshId = snapshot?.dshSessionId ?? (native ? links?.get(native[1], native[2]) : null);
    return dshId ? `dsh:${dshId}` : snapshot?.key;
  };
  async function reflect(snapshot) {
    const key = keyOf(snapshot);
    if (!key || key.startsWith('dsh:dudu-assistant-')) return null;
    const [provider, ...parts] = String(snapshot.key ?? key).split(':');
    if (key.startsWith('dsh:') && links?.removed?.(key.slice(4))) return null;
    let issue = issues.findBySession(key).issue;
    if (!issue && key !== snapshot.key) issue = issues.findBySession(snapshot.key).issue;
    const nativeKey = key.startsWith('dsh:') ? links?.nativeKey?.(key.slice(4)) : null;
    if (!issue && nativeKey) issue = issues.findBySession(nativeKey).issue;
    if (issue && ['done', 'canceled'].includes(issue.status)) return issue;
    if (issue && issue.session !== key) issue = issues.update(issue.id, { session: key }, { actor: 'dudu' }).issue ?? issue;
    if (!issue) {
      const native = nativeKey ? /^(claude|codex):(.+)$/s.exec(nativeKey) : null;
      if (links?.hidden?.(provider, parts.join(':')) || (native && links?.hidden?.(native[1], native[2]))) return null;
      if (snapshot.state !== 'waiting_owner' || !snapshot.pending?.text?.trim()) return null;
      const result = issues.add({
        title: (snapshot.title || snapshot.pending.text).slice(0, 300),
        brief: (snapshot.excerpt ?? '').slice(0, 2000), source: 'session', sourceRef: snapshot.key,
        status: issueStatusForSession(snapshot.state), ask: snapshot.pending.text.slice(0, 2000),
        agent: snapshot.cwd ? (['claude', 'codex', 'deepseek'].includes(snapshot.agent) ? snapshot.agent : ['claude', 'codex'].includes(snapshot.provider) ? snapshot.provider : 'deepseek') : null,
        session: key, project: snapshot.cwd ? { name: snapshot.cwd.split(/[\\/]/).filter(Boolean).at(-1) || snapshot.cwd, path: snapshot.cwd } : null,
      }, { actor: 'dudu' });
      issue = result.issue;
      if (!issue) return null;
    }
    await adopt?.(issue);
    // DSH's question waterfall does the reflection itself after adoption.
    if (snapshot.provider !== 'dsh') await observe?.(issue, snapshot);
    return issue;
  }
  return {
    accept(snapshot) {
      if (closed) return Promise.resolve(null);
      const key = keyOf(snapshot);
      const run = (tails.get(key) ?? Promise.resolve()).then(() => reflect(snapshot));
      const tail = run.catch(() => {});
      tails.set(key, tail);
      void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
      return run;
    },
    async close() { closed = true; await Promise.allSettled([...tails.values()]); },
  };
}

export function createSessionFolding({ sessions, onClose, now = Date.now, afterMs = 24 * 60 * 60_000, intervalMs = 60_000, log = console }) {
  let running = null;
  let closed = false;
  function tick() {
    if (closed) return Promise.resolve();
    running ??= (async () => {
      for (const key of sessions.keys()) {
        if (closed) break;
        const snapshot = sessions.snapshotOf(key);
        if (!snapshot || snapshot.closed || !['waiting_owner', 'error'].includes(snapshot.state) || now() - snapshot.stateSince < afterMs) continue;
        const result = await sessions.close(key, { stop: snapshot.state === 'waiting_owner' });
        if (result.outcome === 'success') await onClose?.(key);
      }
    })().catch((error) => log.warn?.(`[dudu] An idle session could not be folded away: ${error.message}`)).finally(() => { running = null; });
    return running;
  }
  const timer = intervalMs > 0 ? setInterval(() => { void tick(); }, intervalMs) : null;
  timer?.unref?.();
  return {
    tick,
    async close() { closed = true; clearInterval(timer); await running; },
  };
}
