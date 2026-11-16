import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { issueSessionId as sessionOf, listAllIssues } from './issue-list.mjs';

const inTab = (issue, tab) => tab === 'all' || (tab === 'backlog'
  ? issue.statusType === 'backlog' : ['todo', 'in_progress', 'in_review'].includes(issue.statusType));

/** Shared phone/Desktop conversation home. Workflow and DSH's independent sidebar pins stay separate. */
export function createChatHome({ file, issues, assistant, activity, warm, markUnread, acknowledge, now = Date.now }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) { db.close(); throw new Error('chat-home.db is newer than this code'); }
  db.exec('CREATE TABLE IF NOT EXISTS pins (target TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID;');
  if (version === 0) db.exec("BEGIN IMMEDIATE; INSERT OR IGNORE INTO pins VALUES ('assistant', 0); PRAGMA user_version = 1; COMMIT;");
  const readPins = db.prepare('SELECT target, at FROM pins ORDER BY at, target');
  const readPin = db.prepare('SELECT 1 FROM pins WHERE target = ?');
  const pins = () => new Map(readPins.all().map((entry) => [entry.target, entry.at]));
  let closed = false;

  function conversation(id, sessionId, title, issue, pinned) {
    const state = sessionId ? activity(sessionId) : null;
    const attention = state?.attention;
    return {
      id, title, sessionId, ...(issue ? { issue } : {}),
      preview: attention?.preview ?? '', receivedAt: attention?.messageAt ?? 0,
      sessionState: state?.sessionState ?? 'idle', deepSleep: state?.deepSleep === true,
      unread: state?.unread === true, readSeq: attention?.seq ?? -1, pinned: pinned.has(id),
    };
  }

  async function target(params, fail) {
    if (params.target === 'assistant') return { key: 'assistant', sessionId: assistant()?.sessionId ?? null };
    if (typeof params.target !== 'string' || !/^issue:[1-9]\d*$/.test(params.target)) return fail('BAD_REQUEST');
    const id = Number(params.target.slice(6));
    if (!Number.isSafeInteger(id)) return fail('BAD_REQUEST');
    const answer = await issues('get', { id, logLimit: 1 });
    if (answer?.outcome !== 'success' || !answer.issue) return fail('NOT_FOUND');
    return { key: params.target, sessionId: sessionOf(answer.issue) };
  }

  return {
    isPinned: (target) => Boolean(readPin.get(target)),
    async list(tab, row, filter) {
      const all = await listAllIssues(issues);
      const assistantId = assistant()?.sessionId ?? null; // Never create/start Dudu while listing.
      await warm([...new Set([...all.map(sessionOf), assistantId].filter(Boolean))]);
      if (closed) throw new Error('Chat home is closed');
      const pinned = pins();
      const included = filter && Object.keys(filter).length
        ? new Set((await listAllIssues(issues, filter)).map((issue) => issue.id)) : null;
      const entries = all.map((issue) => conversation(`issue:${issue.id}`, sessionOf(issue), issue.title, row(issue), pinned));
      const dudu = conversation('assistant', assistantId, '嘟嘟', null, pinned);
      // Count conversations, once per session, across every scope, including offscreen rows.
      const unread = new Set([...entries, dudu].filter((entry) => entry.unread && entry.sessionId).map((entry) => entry.sessionId)).size;
      const filtersAssistant = Object.keys(filter ?? {}).some((key) => key !== 'completedFrom');
      const conversations = [...(tab === 'backlog' || filtersAssistant ? [] : [dudu]), ...entries.filter((entry) => inTab(entry.issue, tab) && (!included || included.has(entry.issue.id)))]
        .sort((a, b) => b.receivedAt - a.receivedAt || a.id.localeCompare(b.id, 'en'));
      return { outcome: 'success', tab, conversations, unreadCount: unread,
        pins: [...pinned.keys()].filter((key) => conversations.some((entry) => entry.id === key)) };
    },
    async pin(params, fail) {
      if (typeof params.pinned !== 'boolean') return fail('BAD_REQUEST');
      const resolved = await target(params, fail);
      if (closed) throw new Error('Chat home is closed');
      if (params.pinned) db.prepare('INSERT INTO pins VALUES (?, ?) ON CONFLICT(target) DO NOTHING').run(resolved.key, now());
      else db.prepare('DELETE FROM pins WHERE target = ?').run(resolved.key);
      return { outcome: 'success' };
    },
    async read(params, fail) {
      if (typeof params.unread !== 'boolean' || typeof params.sessionId !== 'string') return fail('BAD_REQUEST');
      const resolved = await target(params, fail);
      // Reassignment cannot direct a stale row's action to a different conversation.
      if (!resolved.sessionId || resolved.sessionId !== params.sessionId) return fail('BAD_REQUEST');
      if (params.unread) await markUnread(resolved.sessionId);
      else {
        if (!Number.isSafeInteger(params.seq) || params.seq < -1) return fail('BAD_REQUEST');
        await acknowledge(resolved.sessionId, { seq: params.seq });
      }
      return { outcome: 'success' };
    },
    close() { closed = true; db.close(); },
  };
}
