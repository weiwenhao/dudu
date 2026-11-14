// The records a collection brought back, kept in issues.db next to the issues they became (docs/assistant.md 3.1, "存" and "读").
//
//   migrateInbox(db)                       the tables; run by the issues schema's migrations, safe to run twice
//   const inbox = createInbox(db, { now })
//
//   ingest(connector, records, { runId })  records from normalizeRecords. One row per (connector, source id, version); a row that is there
//                                          already is only counted. A conversation (`record.conversation`) whose row is still waiting (not ignored,
//                                          not shared) takes the messages it did not have, instead of a second row. A record that says `update` is an item given again to
//                                          change what the inbox kept of it: the fields it gives replace the row's (the newest row of that item's id that is not deleted, else the
//                                          newest of the conversation it is in, `thread:<thread>`), whatever its state; the owner's marks, its issue and its number stay, no row
//                                          is made, and one that would change nothing is only counted. -> { added: [row], updated: [row], seen, missed } (`missed`: updates for an
//                                          item the inbox does not have)
//   pending(connector, limit)              the rows not yet judged, oldest first, each with `known` (what is already known of its source id
//                                          and its thread: { issueId, verdict } | null)
//   judge(id, { verdict: 'issue' | 'note' | 'ignore', issueId, reason })   the one judgement a row gets
//   fail(id)                               the model could not judge it; after 3 tries it is let go -> true when it was let go
//   issueFor(connector, sourceId)          the issue this source id became, or null
//   list({ connector, state, thread, issue, since, limit, cursor })   -> { items (no text), nextCursor }
//   search(q, { connector, limit })        full text, Chinese included -> [row without text]
//   get(id, { around, summary })           -> { record, thread: [rows of the same thread, without text] } | null; summary skips body and thread
//   forIssue(issueId)                      the rows that became or fed this issue
//   dropUntouched(connector)               the rows of a collector that was removed which the owner never dealt with (the widget's "待处理": no issue, not ignored, not
//                                          handled, not deleted) are deleted for good; what the owner marked or made an issue of stays -> the number deleted
//   prune()                                30 days after judgement the text of a row that has no issue is cleared; a year after, the row goes
//   browse({ tab, connector, since, limit, cursor })   the collector widget's list: tab todo | done | ignored, newest first -> { items, nextCursor, facets }
//   ignore(id) / restore(id)               the owner's own mark: a row that is ignored is no one's to judge, and is listed under "ignored"
//   done(id) / remove(id)                  the owner's other two marks, for a row that has no issue: dealt with by themselves (listed under "done"), or wrong
//                                          (gone from every list; the row stays, so that the same message is not collected again). restore(id) takes any of
//                                          the three marks off: a deleted row is back where it was, an ignored or handled one is waiting again
//   link(id, { issueId, verdict })         the owner made an issue of the row (verdict 'issue') or shared it to one (verdict 'note')
//   lastMe(connector)                      who the owner is on that source, as the latest collection that said so named them: { name, id } | null
//   startRun / finishRun / lastRun / lastFinished / lastGood / lastStarted   collect_runs: one row per collection of a connector
//
// A row is 'new' until judged, then 'done' (verdict, issue, reason), or 'let_go' (the model could not judge it three times) or 'dropped'
// (more than 1,000 waited for one connector: the oldest are given up). Text is not taken as an instruction anywhere in here.
// The owner's marks sit beside that and change none of it: `ignored_at` (the owner ignored it), `done_at` (they dealt with it themselves, no issue made),
// `deleted_at` (it was wrong) and `by_owner` (the owner, not 嘟嘟, decided the issue).
import { matchQuery, segment } from '../segment.mjs';
import { addMessages, mergeMessages, newestSaid, titleFromText } from './records.mjs';

export const KEEP_TEXT_MS = 30 * 86_400_000;
export const KEEP_ROW_MS = 365 * 86_400_000;
export const MAX_PENDING = 1000;
export const TRIES = 3;

export function migrateInbox(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS inbox_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector TEXT NOT NULL,
    source_id TEXT NOT NULL,
    version TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    thread TEXT NOT NULL DEFAULT '',
    at INTEGER,
    text TEXT NOT NULL DEFAULT '',
    context TEXT,
    more TEXT NOT NULL DEFAULT '',
    truncated INTEGER NOT NULL DEFAULT 0,
    collected_at INTEGER NOT NULL,
    run_id INTEGER,
    state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','done','let_go','dropped')),
    verdict TEXT CHECK (verdict IN ('issue','note','ignore')),
    issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    judged_at INTEGER,
    tries INTEGER NOT NULL DEFAULT 0,
    cleared INTEGER NOT NULL DEFAULT 0,
    UNIQUE (connector, source_id, version)
  );
  CREATE INDEX IF NOT EXISTS inbox_pending ON inbox_records(connector, id) WHERE state = 'new';
  CREATE INDEX IF NOT EXISTS inbox_thread ON inbox_records(connector, thread, id) WHERE thread <> '';
  CREATE INDEX IF NOT EXISTS inbox_issue ON inbox_records(issue_id) WHERE issue_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS inbox_judged ON inbox_records(judged_at) WHERE state <> 'new';
  -- Words are split by the application (segment.mjs); rowid is the record id; contentless, so the text is not stored twice.
  CREATE VIRTUAL TABLE IF NOT EXISTS inbox_fts USING fts5(title, text, author, content = '', contentless_delete = 1, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE IF NOT EXISTS collect_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connector TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    ok INTEGER,
    added INTEGER NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 0,
    rejected INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    notes_changed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS collect_runs_connector ON collect_runs(connector, id);
  `);
}

/** The owner's marks on a record. Safe to run twice (ALTER TABLE is not). */
export function migrateInboxOwner(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(inbox_records)').all().map((column) => column.name));
  if (!columns.has('ignored_at')) db.exec('ALTER TABLE inbox_records ADD COLUMN ignored_at INTEGER');
  if (!columns.has('by_owner')) db.exec('ALTER TABLE inbox_records ADD COLUMN by_owner INTEGER NOT NULL DEFAULT 0');
}

/** The owner's two newer marks: `done_at` (dealt with, no issue needed) and `deleted_at` (wrong: in no list, the row kept against being collected again). Safe to run twice. */
export function migrateInboxMarks(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(inbox_records)').all().map((column) => column.name));
  if (!columns.has('done_at')) db.exec('ALTER TABLE inbox_records ADD COLUMN done_at INTEGER');
  if (!columns.has('deleted_at')) db.exec('ALTER TABLE inbox_records ADD COLUMN deleted_at INTEGER');
}

/** What a collection says of a record and of the owner: `to_me` (is it meant for them), `handled` (is it dealt with), and `me` of a run. Safe to run twice. */
export function migrateInboxSignals(db) {
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  const records = columns('inbox_records');
  if (!records.has('to_me')) db.exec('ALTER TABLE inbox_records ADD COLUMN to_me INTEGER');
  if (!records.has('handled')) db.exec('ALTER TABLE inbox_records ADD COLUMN handled INTEGER');
  if (!columns('collect_runs').has('me')) db.exec('ALTER TABLE collect_runs ADD COLUMN me TEXT');
}

// What the widget's tabs hold. A row with an issue is handled, whoever decided it, and so is one the owner marked handled; one without is waiting, or ignored
// by the owner. A row the owner deleted is in none of them.
const OPEN = 'ignored_at IS NULL AND done_at IS NULL AND deleted_at IS NULL'; // the owner has not put a mark on it
const TABS = Object.freeze({
  todo: `issue_id IS NULL AND ${OPEN}`,
  done: 'deleted_at IS NULL AND (issue_id IS NOT NULL OR done_at IS NOT NULL)',
  ignored: 'issue_id IS NULL AND ignored_at IS NOT NULL AND done_at IS NULL AND deleted_at IS NULL',
});
const SHOWN_AT = 'COALESCE(at, collected_at)'; // the time the row shows: its own, else when it was collected

const COLUMNS = 'id, connector, source_id, version, kind, title, author, url, thread, at, text, context, more, truncated, collected_at, state, verdict, issue_id, reason, judged_at, tries, cleared, ignored_at, done_at, deleted_at, by_owner, to_me, handled';
const LIGHT = 'id, connector, source_id, version, kind, title, author, url, thread, at, truncated, collected_at, state, verdict, issue_id, reason, judged_at, cleared, ignored_at, done_at, deleted_at, by_owner, to_me, handled';

const json = (text) => {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const view = (row) => row ? ({
  id: row.id, ref: `r${row.id}`, connector: row.connector, sourceId: row.source_id, version: row.version, kind: row.kind, title: row.title,
  from: row.author, url: row.url, thread: row.thread, at: row.at, collectedAt: row.collected_at, state: row.state, verdict: row.verdict,
  issueId: row.issue_id, reason: row.reason, judgedAt: row.judged_at, truncated: Boolean(row.truncated), cleared: Boolean(row.cleared),
  ignoredAt: row.ignored_at ?? null, doneAt: row.done_at ?? null, deletedAt: row.deleted_at ?? null, byOwner: Boolean(row.by_owner),
  toMe: row.to_me == null ? null : Boolean(row.to_me), handled: row.handled == null ? null : Boolean(row.handled),
  ...('text' in row ? { text: row.text, context: json(row.context), more: row.more } : {}),
}) : null;

export function createInbox(db, { now = Date.now } = {}) {
  const statements = new Map();
  const sql = (text) => {
    let statement = statements.get(text);
    if (!statement) statements.set(text, statement = db.prepare(text));
    return statement;
  };
  const transaction = (work) => {
    if (db.isTransaction) return work();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  };
  const indexed = (record) => [segment(record.title), segment(record.text), segment(record.author)];

  /**
   * An item given again with `update` (see `ingest`): the row it changes is the newest one of that item's id that is not deleted, else the newest of its conversation (`thread:<thread>`). Returns the row after the change, 'same' when nothing differs, or null when
   * the inbox has no such item. A row whose text was cleared (`prune`) keeps it cleared: only the fields that are not text change.
   */
  function change(connector, record) {
    const find = (sourceId) => sql(`SELECT ${COLUMNS} FROM inbox_records WHERE connector = ? AND deleted_at IS NULL AND source_id = ? ORDER BY id DESC LIMIT 1`).get(connector, sourceId);
    const row = find(record.sourceId) ?? (record.thread ? find(`thread:${record.thread}`) : undefined); // the item's own id first, else the conversation it is in
    if (!row) return null;
    const { changes } = record;
    const set = [];
    const values = [];
    const put = (column, value, before) => {
      if (value === undefined || value === before) return false;
      set.push(`${column} = ?`);
      values.push(value);
      return true;
    };
    const titled = put('title', changes.title, row.title);
    const named = put('author', changes.author, row.author);
    put('url', changes.url, row.url);
    put('at', changes.at, row.at);
    put('more', changes.more, row.more);
    let worded = false;
    if (!row.cleared) {
      worded = put('text', changes.text, row.text);
      if (worded) put('truncated', record.truncated ? 1 : 0, row.truncated);
      put('context', changes.context ? JSON.stringify(changes.context) : undefined, row.context);
    }
    if (!set.length) return 'same';
    sql(`UPDATE inbox_records SET ${set.join(', ')} WHERE id = ?`).run(...values, row.id);
    if (titled || named || worded) {
      const kept = sql('SELECT title, text, author FROM inbox_records WHERE id = ?').get(row.id);
      sql('DELETE FROM inbox_fts WHERE rowid = ?').run(row.id);
      sql('INSERT INTO inbox_fts (rowid, title, text, author) VALUES (?,?,?,?)').run(row.id, ...indexed(kept));
    }
    return view(sql(`SELECT ${COLUMNS} FROM inbox_records WHERE id = ?`).get(row.id));
  }

  function ingest(connector, records, { runId = null } = {}) {
    const added = [];
    const updated = [];
    const changes = [];
    let seen = 0;
    let missed = 0;
    const at = now();
    const signal = (value) => (value === true ? 1 : value === false ? 0 : null);
    transaction(() => {
      for (const record of records) {
        if (record.update) {
          changes.push(record);
          continue;
        }
        // Looked up first: an insert that is ignored would still use up a record number (AUTOINCREMENT), and the numbers are what the model answers with.
        if (sql('SELECT 1 FROM inbox_records WHERE connector = ? AND source_id = ? AND version = ?').get(connector, record.sourceId, record.version)) {
          seen++;
          continue;
        }
        // The talk of a conversation goes on in the row that waits for the owner; once the owner has dealt with it (ignored it, shared it), new talk is a new row.
        const open = record.conversation
          ? sql(`SELECT id, text, author, to_me, truncated FROM inbox_records WHERE connector = ? AND source_id = ? AND state = 'new' AND issue_id IS NULL AND ${OPEN} ORDER BY id DESC LIMIT 1`).get(connector, record.sourceId)
          : null;
        if (open) {
          const more = addMessages(open.text, record.text);
          if (!more.added) {
            seen++;
            continue;
          }
          const names = [...new Set([...open.author.split('、'), ...(record.author ?? '').split('、')].filter(Boolean))].join('、').slice(0, 200);
          const toMe = open.to_me === 1 || record.toMe === true ? 1 : open.to_me === 0 || record.toMe === false ? 0 : null;
          sql('UPDATE inbox_records SET version = ?, title = ?, author = ?, url = ?, at = ?, text = ?, more = ?, truncated = ?, collected_at = ?, run_id = ?, to_me = ?, handled = ? WHERE id = ?')
            .run(record.version, record.title, names, record.url, record.at, more.text, record.more ?? '', open.truncated || more.cut || record.truncated ? 1 : 0, at, runId, toMe, signal(record.handled), open.id);
          sql('DELETE FROM inbox_fts WHERE rowid = ?').run(open.id);
          sql('INSERT INTO inbox_fts (rowid, title, text, author) VALUES (?,?,?,?)').run(open.id, ...indexed({ ...record, author: names, text: more.text }));
          updated.push(view(sql(`SELECT ${COLUMNS} FROM inbox_records WHERE id = ?`).get(open.id)));
          continue;
        }
        const result = sql(`INSERT INTO inbox_records (connector, source_id, version, kind, title, author, url, thread, at, text, context, more, truncated, collected_at, run_id, to_me, handled)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(connector, record.sourceId, record.version, record.kind, record.title, record.author ?? '', record.url, record.thread, record.at,
            record.text, record.context?.length ? JSON.stringify(record.context) : null, record.more ?? '', record.truncated ? 1 : 0, at, runId,
            signal(record.toMe), signal(record.handled));
        const id = Number(result.lastInsertRowid);
        sql('INSERT INTO inbox_fts (rowid, title, text, author) VALUES (?,?,?,?)').run(id, ...indexed(record));
        added.push(view(sql(`SELECT ${COLUMNS} FROM inbox_records WHERE id = ?`).get(id)));
      }
      // Last, so that an answer that brings the talk of a thread and also says what changed of its item ends with what it said of the item.
      for (const record of changes) {
        const done = change(connector, record);
        if (done === null) missed++;
        else if (done === 'same') seen++;
        else {
          // a row the talk went on in a moment ago is one row that changed, not two
          const place = updated.findIndex((row) => row.id === done.id);
          if (place >= 0) updated[place] = done;
          else updated.push(done);
        }
      }
      // More waiting than there is room for: the oldest are given up, so that a model that is down for a week does not make a backlog.
      const extra = sql(`SELECT COUNT(*) AS n FROM inbox_records WHERE connector = ? AND state = 'new' AND ${OPEN}`).get(connector).n - MAX_PENDING;
      if (extra > 0) sql(`UPDATE inbox_records SET state = 'dropped', judged_at = ? WHERE id IN (SELECT id FROM inbox_records WHERE connector = ? AND state = 'new' AND ${OPEN} ORDER BY id LIMIT ?)`).run(at, connector, extra);
    });
    return { added, updated, seen, missed };
  }

  /**
   * What a session read around one record, when the owner asked for more of its context (the Collector's button): for a row that is a conversation, the messages of that talk come into its text, in the order
   * of their times and each once; for any other row, the context the session read becomes its `context`. It is that row, whatever its state: nothing is added and no row is made.
   * `records` come from normalizeRecords. -> { outcome, added }
   */
  function addContext(id, given) {
    const records = given.filter((record) => !record.update); // an answer that says `update` is not what was asked for
    const row = sql(`SELECT ${COLUMNS} FROM inbox_records WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!row) return { outcome: 'needs_clarification', code: 'unknown_record', message: 'There is no record with that number.' };
    let added = 0;
    transaction(() => {
      if (row.source_id.startsWith('thread:')) {
        const talks = records.filter((record) => record.conversation);
        const talk = talks.find((record) => record.sourceId === row.source_id) ?? (talks.length === 1 ? talks[0] : null);
        const merged = talk ? mergeMessages(row.text, talk.text) : null;
        if (!merged?.added) return;
        sql('UPDATE inbox_records SET text = ?, truncated = ? WHERE id = ?').run(merged.text, row.truncated || merged.cut ? 1 : 0, row.id);
        sql('DELETE FROM inbox_fts WHERE rowid = ?').run(row.id);
        sql('INSERT INTO inbox_fts (rowid, title, text, author) VALUES (?,?,?,?)').run(row.id, ...indexed({ title: row.title, text: merged.text, author: row.author }));
        added = merged.added;
        return;
      }
      const same = records.find((record) => record.sourceId === row.source_id) ?? records[0];
      const context = same?.context ?? [];
      if (!context.length) return;
      sql('UPDATE inbox_records SET context = ? WHERE id = ?').run(JSON.stringify(context), row.id);
      added = context.length;
    });
    return { outcome: 'success', added };
  }

  /**
   * Gives the rows that were kept without a title the first words of what they say (`titleFromText`; the session left the title out of some records before the answer was checked for it,
   * and the Collector showed them as blank rows: 135, 136, 149), and puts them in the word index again. A row whose text is gone (`prune`) has nothing to say and stays as it is.
   * Safe to run twice. -> the number of rows given a title
   */
  function repairTitles() {
    const blank = sql("SELECT id, text, author FROM inbox_records WHERE trim(title) = '' AND trim(text) <> ''").all();
    let filled = 0;
    transaction(() => {
      for (const row of blank) {
        const title = titleFromText(newestSaid(row.text));
        if (!title) continue;
        sql('UPDATE inbox_records SET title = ? WHERE id = ?').run(title, row.id);
        sql('DELETE FROM inbox_fts WHERE rowid = ?').run(row.id);
        sql('INSERT INTO inbox_fts (rowid, title, text, author) VALUES (?,?,?,?)').run(row.id, ...indexed({ title, text: row.text, author: row.author }));
        filled++;
      }
    });
    return filled;
  }

  function known(row) {
    const same = sql("SELECT issue_id AS issueId, verdict FROM inbox_records WHERE connector = ? AND source_id = ? AND state = 'done' AND id <> ? ORDER BY id DESC LIMIT 1").get(row.connector, row.source_id, row.id);
    if (same) return { ...same, where: 'source' };
    if (!row.thread) return null;
    const thread = sql("SELECT issue_id AS issueId, verdict FROM inbox_records WHERE connector = ? AND thread = ? AND issue_id IS NOT NULL AND id <> ? ORDER BY id DESC LIMIT 1").get(row.connector, row.thread, row.id);
    return thread ? { ...thread, where: 'thread' } : null;
  }

  function pending(connector, limit = 20) {
    return sql(`SELECT ${COLUMNS} FROM inbox_records WHERE connector = ? AND state = 'new' AND ${OPEN} ORDER BY id LIMIT ?`).all(connector, limit).map((row) => ({ ...view(row), known: known(row) }));
  }

  const waiting = (connector) => sql(`SELECT COUNT(*) AS n FROM inbox_records WHERE connector = ? AND state = 'new' AND ${OPEN}`).get(connector).n;

  function judge(id, { verdict, issueId = null, reason = '' }) {
    return sql(`UPDATE inbox_records SET state = 'done', verdict = ?, issue_id = ?, reason = ?, judged_at = ? WHERE id = ? AND state = 'new' AND ${OPEN}`)
      .run(verdict, issueId, String(reason).slice(0, 500), now(), id).changes === 1;
  }

  function fail(id) {
    const row = sql(`SELECT tries FROM inbox_records WHERE id = ? AND state = 'new' AND ${OPEN}`).get(id);
    if (!row) return false;
    const tries = row.tries + 1;
    if (tries >= TRIES) {
      sql("UPDATE inbox_records SET state = 'let_go', tries = ?, judged_at = ? WHERE id = ?").run(tries, now(), id);
      return true;
    }
    sql('UPDATE inbox_records SET tries = ? WHERE id = ?').run(tries, id);
    return false;
  }

  const issueFor = (connector, sourceId) => sql("SELECT issue_id AS id FROM inbox_records WHERE connector = ? AND source_id = ? AND verdict = 'issue' AND issue_id IS NOT NULL ORDER BY id LIMIT 1").get(connector, sourceId)?.id ?? null;

  function list({ connector, state, thread, issue, since, limit = 50, cursor } = {}) {
    const where = ['deleted_at IS NULL'];
    const params = [];
    if (connector) { where.push('connector = ?'); params.push(String(connector)); }
    if (state) { where.push('state = ?'); params.push(String(state)); }
    if (thread) { where.push('thread = ?'); params.push(String(thread)); }
    if (Number.isSafeInteger(issue)) { where.push('issue_id = ?'); params.push(issue); }
    if (Number.isFinite(since)) { where.push('collected_at >= ?'); params.push(since); }
    const before = Number.isSafeInteger(cursor) ? cursor : null;
    if (before !== null) { where.push('id < ?'); params.push(before); }
    const size = Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 50));
    const rows = sql(`SELECT ${LIGHT} FROM inbox_records WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...params, size + 1);
    return { items: rows.slice(0, size).map(view), nextCursor: rows.length > size ? rows[size - 1].id : null };
  }

  function search(query, { connector, limit = 20 } = {}) {
    const match = matchQuery(query);
    if (!match) return [];
    const size = Math.max(1, Math.min(100, Number.isSafeInteger(limit) ? limit : 20));
    const rows = connector
      ? sql(`SELECT ${LIGHT.split(', ').map((c) => `r.${c}`).join(', ')} FROM inbox_fts f JOIN inbox_records r ON r.id = f.rowid WHERE inbox_fts MATCH ? AND r.connector = ? AND r.deleted_at IS NULL ORDER BY rank LIMIT ?`).all(match, String(connector), size)
      : sql(`SELECT ${LIGHT.split(', ').map((c) => `r.${c}`).join(', ')} FROM inbox_fts f JOIN inbox_records r ON r.id = f.rowid WHERE inbox_fts MATCH ? AND r.deleted_at IS NULL ORDER BY rank LIMIT ?`).all(match, size);
    return rows.map(view);
  }

  function get(id, { around = 4, summary = false } = {}) {
    const number = typeof id === 'string' ? Number(id.replace(/^r/i, '')) : id;
    if (!Number.isSafeInteger(number)) return null;
    const row = sql(`SELECT ${summary ? LIGHT : COLUMNS} FROM inbox_records WHERE id = ?`).get(number);
    if (!row) return null;
    const thread = !summary && around > 0 && row.thread
      ? sql(`SELECT ${LIGHT} FROM inbox_records WHERE connector = ? AND thread = ? AND id <> ? ORDER BY ABS(id - ?) LIMIT ?`).all(row.connector, row.thread, row.id, row.id, Math.max(0, Math.min(20, around))).map(view).sort((a, b) => a.id - b.id)
      : [];
    return { record: view(row), thread };
  }

  const forIssue = (issueId) => sql(`SELECT ${COLUMNS} FROM inbox_records WHERE issue_id = ? ORDER BY id`).all(issueId).map(view);

  function prune() {
    const at = now();
    return transaction(() => {
      const settled = "(state <> 'new' OR ignored_at IS NOT NULL OR done_at IS NOT NULL OR deleted_at IS NOT NULL) AND issue_id IS NULL"; // judged, or dealt with by the owner
      const settledAt = 'COALESCE(judged_at, ignored_at, done_at, deleted_at)';
      const old = sql(`SELECT id FROM inbox_records WHERE cleared = 0 AND ${settled} AND ${settledAt} < ?`).all(at - KEEP_TEXT_MS);
      for (const { id } of old) sql('DELETE FROM inbox_fts WHERE rowid = ?').run(id);
      for (const { id } of old) sql("UPDATE inbox_records SET text = '', context = NULL, more = '', cleared = 1 WHERE id = ?").run(id);
      const gone = sql(`SELECT id FROM inbox_records WHERE ${settled} AND ${settledAt} < ?`).all(at - KEEP_ROW_MS);
      for (const { id } of gone) sql('DELETE FROM inbox_fts WHERE rowid = ?').run(id);
      for (const { id } of gone) sql('DELETE FROM inbox_records WHERE id = ?').run(id);
      return { cleared: old.length, deleted: gone.length };
    });
  }

  /** A collector was removed (owner, 2026-11-10): what it brought and nobody dealt with has no collector and no owner's mark, so it goes. The marked rows are the owner's record. */
  function dropUntouched(connector) {
    return transaction(() => {
      const gone = sql(`SELECT id FROM inbox_records WHERE connector = ? AND ${TABS.todo}`).all(connector);
      for (const { id } of gone) sql('DELETE FROM inbox_fts WHERE rowid = ?').run(id);
      for (const { id } of gone) sql('DELETE FROM inbox_records WHERE id = ?').run(id);
      return gone.length;
    });
  }

  /** The widget's list. `connector` is a list of ids, `since` the earliest time shown; `cursor` is the nextCursor of the page before. */
  function browse({ tab = 'todo', connector, since, limit = 50, cursor } = {}) {
    const base = Object.hasOwn(TABS, tab) ? TABS[tab] : TABS.todo;
    const where = [base];
    const params = [];
    const ids = Array.isArray(connector) ? connector.filter((id) => typeof id === 'string' && id) : [];
    if (ids.length) { where.push(`connector IN (${ids.map(() => '?').join(', ')})`); params.push(...ids); }
    if (Number.isFinite(since)) { where.push(`${SHOWN_AT} >= ?`); params.push(since); }
    const after = /^(-?\d+):(\d+)$/.exec(String(cursor ?? ''));
    if (after) { where.push(`(${SHOWN_AT} < ? OR (${SHOWN_AT} = ? AND id < ?))`); params.push(Number(after[1]), Number(after[1]), Number(after[2])); }
    const size = Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 50));
    const rows = sql(`SELECT ${LIGHT}, ${SHOWN_AT} AS shown_at FROM inbox_records WHERE ${where.join(' AND ')} ORDER BY shown_at DESC, id DESC LIMIT ?`).all(...params, size + 1);
    const facets = sql(`SELECT connector AS key, COUNT(*) AS count FROM inbox_records WHERE ${base} GROUP BY connector ORDER BY count DESC, connector`).all();
    return { items: rows.slice(0, size).map(view), nextCursor: rows.length > size ? `${rows[size - 1].shown_at}:${rows[size - 1].id}` : null, facets: { connector: facets } };
  }

  /** The owner puts a row aside; only one that has no issue. True when it changed. */
  const ignore = (id) => sql('UPDATE inbox_records SET ignored_at = ? WHERE id = ? AND issue_id IS NULL AND ignored_at IS NULL AND done_at IS NULL AND deleted_at IS NULL').run(now(), id).changes === 1;
  /** The owner dealt with it themselves and needs no issue for it: it is handled (an ignored row is, from now on, handled and no longer ignored). */
  const done = (id) => sql('UPDATE inbox_records SET done_at = ?, ignored_at = NULL WHERE id = ? AND issue_id IS NULL AND done_at IS NULL AND deleted_at IS NULL').run(now(), id).changes === 1;
  /** The row was wrong. It leaves every list but stays in the table, so that the same message is not collected into a new row. */
  const remove = (id) => sql('UPDATE inbox_records SET deleted_at = ? WHERE id = ? AND issue_id IS NULL AND deleted_at IS NULL').run(now(), id).changes === 1;
  /**
   * Takes the owner's mark off. A deleted row is back where it was (its other marks were kept); an ignored or handled row, with no issue, is waiting again.
   */
  const restore = (id) => transaction(() => {
    if (sql('UPDATE inbox_records SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes === 1) return true;
    return sql('UPDATE inbox_records SET ignored_at = NULL, done_at = NULL WHERE id = ? AND issue_id IS NULL AND (ignored_at IS NOT NULL OR done_at IS NOT NULL)').run(id).changes === 1;
  });

  /** The owner made an issue of the row (verdict 'issue') or shared it to one (verdict 'note'): it is handled, and it is theirs. */
  const link = (id, { issueId, verdict }) => sql("UPDATE inbox_records SET state = 'done', verdict = ?, issue_id = ?, reason = '', judged_at = COALESCE(judged_at, ?), by_owner = 1, ignored_at = NULL WHERE id = ?")
    .run(verdict, issueId, now(), id).changes === 1;

  const startRun = (connector, at = now()) => Number(sql('INSERT INTO collect_runs (connector, started_at) VALUES (?, ?)').run(connector, at).lastInsertRowid);
  const meOf = (text) => {
    try {
      const value = JSON.parse(text ?? 'null');
      return value && typeof value === 'object' && (value.name || value.id) ? { name: String(value.name ?? ''), id: String(value.id ?? '') } : null;
    } catch { return null; }
  };
  const finishRun = (runId, { ok, added = 0, seen = 0, rejected = 0, created = 0, error = null, notesChanged = false, me = null }) => {
    sql('UPDATE collect_runs SET finished_at = ?, ok = ?, added = ?, seen = ?, rejected = ?, created = ?, error = ?, notes_changed = ?, me = ? WHERE id = ?')
      .run(now(), ok ? 1 : 0, added, seen, rejected, created, error ? String(error).slice(0, 500) : null, notesChanged ? 1 : 0, me ? JSON.stringify(me) : null, runId);
  };
  const runView = (row) => row ? ({ id: row.id, connector: row.connector, startedAt: row.started_at, finishedAt: row.finished_at, ok: row.ok === null ? null : Boolean(row.ok), added: row.added, seen: row.seen, rejected: row.rejected, created: row.created, error: row.error, notesChanged: Boolean(row.notes_changed), me: meOf(row.me) }) : null;
  const lastRun = (connector) => runView(sql('SELECT * FROM collect_runs WHERE connector = ? ORDER BY id DESC LIMIT 1').get(connector));
  const lastFinished = (connector) => runView(sql('SELECT * FROM collect_runs WHERE connector = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(connector));
  /** The last collection of the connector that finished well: where `since` comes from. */
  const lastGood = (connector) => runView(sql('SELECT * FROM collect_runs WHERE connector = ? AND ok = 1 ORDER BY id DESC LIMIT 1').get(connector));
  /** Who the owner is on this source, from the latest collection that named them. */
  const lastMe = (connector) => meOf(sql("SELECT me FROM collect_runs WHERE connector = ? AND me IS NOT NULL ORDER BY id DESC LIMIT 1").get(connector)?.me);
  const lastStarted = (connector) => sql('SELECT MAX(started_at) AS at FROM collect_runs WHERE connector = ?').get(connector)?.at ?? null;

  return { ingest, addContext, repairTitles, pending, waiting, judge, fail, issueFor, list, search, get, forIssue, prune, dropUntouched, browse, ignore, done, remove, restore, link, startRun, finishRun, lastRun, lastFinished, lastGood, lastStarted, lastMe };
}
