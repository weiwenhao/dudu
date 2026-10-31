import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Which sessions are running right now. Claude Code keeps a registry of its live processes (one small file per process, with
// its session, folder, busy or idle, and since when), so for Claude this is exact whether the session runs in a terminal or in
// DSH. Codex keeps no such registry; the Codex runs DSH itself started are known to DSH.

export function claudeSessionRegistry(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'sessions');
}

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

/** The live Claude Code processes, one entry per session. A file left by a process that has gone is not a running session. */
export async function listRunningClaude({ directory = claudeSessionRegistry(), alive = isAlive } = {}) {
  let names;
  try { names = await readdir(directory); } catch { return []; }
  const sessions = new Map();
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    let entry;
    try { entry = JSON.parse(await readFile(join(directory, name), 'utf8')); } catch { continue; }
    if (!Number.isInteger(entry?.pid) || typeof entry.sessionId !== 'string' || !alive(entry.pid)) continue;
    const item = {
      provider: 'claude', id: entry.sessionId, name: typeof entry.name === 'string' ? entry.name : '',
      cwd: typeof entry.cwd === 'string' ? entry.cwd : null, status: entry.status === 'busy' ? 'busy' : 'idle',
      since: [entry.statusUpdatedAt, entry.updatedAt, entry.startedAt].find(Number.isFinite) ?? null,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0, background: entry.kind === 'bg',
    };
    const known = sessions.get(item.id);
    if (!known || item.updatedAt >= known.updatedAt) sessions.set(item.id, item);
  }
  return [...sessions.values()];
}

/** A session that finished a moment ago is worth a line of its own; one that has been idle for long is only counted. */
export const RECENT_MS = 10 * 60_000;

/**
 * The running sessions as the overview shows them: the ones working now, the ones that finished a moment ago, and how many
 * others sit idle. `titleOf` names a session; `dshSessionOf` says which DSH session holds it, when one does.
 */
export function summarizeRunning({ claude, dshRuns = [], titleOf = () => undefined, dshSessionOf = () => undefined, now = Date.now() }) {
  const items = new Map();
  const add = (item) => items.set(`${item.provider}:${item.id}`, item);
  for (const session of claude) add({ ...session });
  // A Codex run DSH started is busy while it runs; a Claude one is already in the registry, with its own status.
  for (const run of dshRuns) {
    if (!run.nativeSessionId || items.has(`${run.route}:${run.nativeSessionId}`)) continue;
    add({ provider: run.route, id: run.nativeSessionId, name: '', cwd: run.cwd ?? null, status: 'busy', since: run.startedAt ?? now, updatedAt: run.startedAt ?? now, background: false });
  }
  const view = (item) => {
    const dshSessionId = dshSessionOf(item.provider, item.id);
    return {
      provider: item.provider, id: item.id, title: titleOf(item.provider, item.id) || item.name || '', cwd: item.cwd, status: item.status, since: item.since,
      ...(dshSessionId ? { dshSessionId } : {}),
    };
  };
  const all = [...items.values()];
  const busy = all.filter((item) => item.status === 'busy').sort((a, b) => (a.since ?? 0) - (b.since ?? 0)).map(view);
  const done = all.filter((item) => item.status !== 'busy' && Number.isFinite(item.since) && now - item.since <= RECENT_MS && !item.background)
    .sort((a, b) => b.since - a.since).map((item) => ({ ...view(item), status: 'done' }));
  const shownKeys = new Set([...busy, ...done].map((item) => `${item.provider}:${item.id}`));
  const idle = all.filter((item) => !shownKeys.has(`${item.provider}:${item.id}`)).sort((a, b) => b.updatedAt - a.updatedAt).map(view);
  return { busy, done, idle, total: all.length };
}
