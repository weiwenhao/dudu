import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { issueSessionId as sessionOf, listAllIssues, listIssueSnapshot } from './issue-list.mjs';

// 未读 is about reading, not workflow (owner, 2026-11-21): it keeps every unread conversation, whatever its status; the list filters on `entry.unread` below.
const inTab = (issue, tab) => tab === 'all' || tab === 'unread' || (tab === 'backlog'
  ? issue.statusType === 'backlog' : ['todo', 'in_progress', 'in_review'].includes(issue.statusType));

/** What the owner said, as a list row shows it: the whole message on one line, cut where an agent's preview is cut. */
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * Shared phone/Desktop conversation home. Workflow and DSH's independent sidebar pins stay separate.
 * `mine(sessionId)` is what the owner said last in a session and `assistantLine()` their last `@` line to 嘟嘟's group (both `{ text, at }` or null): a list asked with `ownMessages` shows
 * whichever is newer than the agent's last finished answer, as a messaging app does (owner, 2026-11-22: "其他 APP 都会显示我发的消息", without a "你：" in front).
 */
export function createChatHome({ file, issues, assistant, activity, warm, markUnread, acknowledge, changed, mine = () => null, assistantLine = () => null, now = Date.now }) {
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

  const safely = (read) => { try { return read(); } catch { return null; } };

  function conversation(id, sessionId, title, issue, pinned, ownMessages = false) {
    const state = sessionId ? activity(sessionId) : null;
    const attention = state?.attention;
    let preview = attention?.preview ?? '';
    let receivedAt = attention?.messageAt ?? 0;
    if (ownMessages) {
      // The row is the newest message of either side. The time, and so the place of the row in the list, follow it; the red dot does not: it is the answer's (`unread` below).
      const said = [sessionId ? safely(() => mine(sessionId)) : null, id === 'assistant' ? safely(assistantLine) : null]
        .filter((line) => line && Number.isFinite(line.at)).sort((a, b) => b.at - a.at)[0];
      const text = said ? oneLine(said.text) : '';
      if (text && said.at > receivedAt) { preview = text; receivedAt = said.at; }
    }
    return {
      id, title, sessionId, ...(issue ? { issue } : {}),
      preview, receivedAt,
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
    async list(tab, row, filter, { includeStatuses = false, includePinnedConversations = false, ownMessages = false } = {}) {
      const { items: all, statuses } = await listIssueSnapshot(issues);
      const assistantId = assistant()?.sessionId ?? null; // Never create/start Dudu while listing.
      await warm([...new Set([...all.map(sessionOf), assistantId].filter(Boolean))]);
      if (closed) throw new Error('Chat home is closed');
      const pinned = pins();
      const included = filter && Object.keys(filter).length
        ? new Set((await listAllIssues(issues, { filter })).map((issue) => issue.id)) : null;
      const entries = all.map((issue) => conversation(`issue:${issue.id}`, sessionOf(issue), issue.title, row(issue), pinned, ownMessages));
      const dudu = conversation('assistant', assistantId, '嘟嘟', null, pinned, ownMessages);
      // Count conversations, once per session, across every scope, including offscreen rows.
      const unread = new Set([...entries, dudu].filter((entry) => entry.unread && entry.sessionId).map((entry) => entry.sessionId)).size;
      const filtersAssistant = Object.keys(filter ?? {}).some((key) => key !== 'completedFrom');
      // An issue with no message yet has no message time (`receivedAt` stays 0, so no date is shown): it is placed by when it was made,
      // so a new one sits at the top of the list rather than at the very bottom (owner, 2026-11-21).
      const made = new Map(all.map((issue) => [`issue:${issue.id}`, issue.createdAt ?? 0]));
      const placedAt = (entry) => entry.receivedAt || made.get(entry.id) || 0;
      const conversations = [...(tab === 'backlog' || filtersAssistant ? [] : [dudu]), ...entries.filter((entry) => inTab(entry.issue, tab) && (!included || included.has(entry.issue.id)))]
        .filter((entry) => tab !== 'unread' || entry.unread)
        .sort((a, b) => placedAt(b) - placedAt(a) || a.id.localeCompare(b.id, 'en'));
      const visible = new Set(conversations.map((entry) => entry.id));
      const shelf = includePinnedConversations
        ? new Map([dudu, ...entries].filter((entry) => entry.pinned).map((entry) => [entry.id, entry]))
        : null;
      return { outcome: 'success', tab, conversations, unreadCount: unread,
        pins: [...pinned.keys()].filter((key) => visible.has(key)),
        ...(shelf ? { pinnedConversations: [...pinned.keys()].map((key) => shelf.get(key)).filter(Boolean) } : {}),
        ...(includeStatuses && Array.isArray(statuses) ? { statuses: statuses.filter((status) => !status.archived)
          .map(({ id, type, name, color, iconProgress, isDefault }) => ({ id, type, name, color, iconProgress, isDefault })) } : {}) };
    },
    async pin(params, fail) {
      if (typeof params.pinned !== 'boolean') return fail('BAD_REQUEST');
      const resolved = await target(params, fail);
      if (closed) throw new Error('Chat home is closed');
      if (params.pinned) db.prepare('INSERT INTO pins VALUES (?, ?) ON CONFLICT(target) DO NOTHING').run(resolved.key, now());
      else db.prepare('DELETE FROM pins WHERE target = ?').run(resolved.key);
      changed?.();
      return { outcome: 'success' };
    },
    /** `source` is which screen asked, for the read log (read-log.mjs); a row's own action on the board, or a tool of Dudu's. */
    async read(params, fail, source) {
      if (typeof params.unread !== 'boolean' || typeof params.sessionId !== 'string') return fail('BAD_REQUEST');
      const resolved = await target(params, fail);
      // Reassignment cannot direct a stale row's action to a different conversation.
      if (!resolved.sessionId || resolved.sessionId !== params.sessionId) return fail('BAD_REQUEST');
      if (params.unread) await markUnread(resolved.sessionId, source);
      else {
        if (!Number.isSafeInteger(params.seq) || params.seq < -1) return fail('BAD_REQUEST');
        await acknowledge(resolved.sessionId, { seq: params.seq }, source);
      }
      return { outcome: 'success' };
    },
    close() { closed = true; db.close(); },
  };
}
