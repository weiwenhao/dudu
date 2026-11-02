// The conversation index (index/turns.db): one document per turn, found by words. docs/assistant.md 3.5, "召回两道", lane 1.
//
//   const turns = createTurns({ file, now = Date.now });
//
// A turn is one message of the conversation between the owner and 嘟嘟: src 'owner' or 'dudu', the text in full (no tool results,
// nothing that came from a session or a connector: those are material, not conversation). Text goes through segment.mjs, so
// Chinese is split into words; BM25 ranks; no model is involved. The same file also keeps the tidy's bookkeeping (the notes still
// waiting for the gate and how far it has read), because forgetting a turn has to reach them in the same breath.
//
// The words are only ever searched, never read back, so the FTS table is contentless; the original text lives in `turns`, which is
// what forget deletes and the index is rebuilt from. createTurns throws SchemaTooNew when the file is from a newer app.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { segment } from '../segment.mjs';

export const CONVERSATION = ['owner', 'dudu'];
export const MAX_TURN_CHARS = 100_000;
const STAGED_KEEP = 200;

const MIGRATIONS = [
  `
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    at INTEGER NOT NULL,
    src TEXT NOT NULL,
    session TEXT,
    text TEXT NOT NULL
  );
  CREATE INDEX turns_at ON turns(at, id);
  CREATE INDEX turns_session ON turns(session) WHERE session IS NOT NULL;
  CREATE VIRTUAL TABLE turns_fts USING fts5(text, content = '', contentless_delete = 1, tokenize = 'unicode61 remove_diacritics 2');

  -- Notes the tidy has seen but not yet let into the memory (it needs the same thing on two different days, or the owner's word).
  CREATE TABLE staged (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('entry','skill')),
    file TEXT,
    relation TEXT,
    target TEXT,
    name TEXT,
    description TEXT,
    text TEXT NOT NULL,
    explicit INTEGER NOT NULL DEFAULT 0,
    src TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  `,
  `
  CREATE TABLE forgotten_turns (key TEXT PRIMARY KEY) WITHOUT ROWID;
  `,
];
const SCHEMA_VERSION = MIGRATIONS.length;

export class SchemaTooNew extends Error {
  constructor(found) {
    super(`turns.db is schema version ${found}, newer than this app understands (${SCHEMA_VERSION}). Update the app.`);
    this.code = 'SCHEMA_TOO_NEW';
  }
}

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

function migrate(db) {
  if (version(db) > SCHEMA_VERSION) throw new SchemaTooNew(version(db));
  if (version(db) === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const found = version(db);
    if (found > SCHEMA_VERSION) throw new SchemaTooNew(found);
    for (let v = found; v < SCHEMA_VERSION; v++) db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

// Words that say what kind of question it is, not what it is about. BM25 already gives common words almost no weight, but in a
// small history "什么" is not common, so the plainest function words are left out of the query (never out of the index). Chinese
// is split into short words, so only words that are never part of a longer word's meaning are listed ("会" is not: 周会).
const STOP = new Set([
  ...'的 了 吗 呢 吧 啊 呀 嘛 么 是 在 有 和 与 或 就 都 也 还 我 你 他 她 它 这 那 哪 谁 几'.split(' '),
  ...'我们 你们 他们 这个 那个 这些 那些 什么 怎么 怎样 如何 哪个 哪些 哪里 多少 为什么 是否 可以 一下 一个 之前 以前 上次 刚才 还记得 记得 说过 提到 提过 曾经 当时 是不是 有没有'.split(' '),
  ...'a an the is are was were be been do does did what which who when where why how i you we they it my our your of in on at to for and or but not that this with about remember recall earlier before last time said told ago'.split(' '),
]);

/** The distinct words a question is searched by (at most 32): its words without the stop words, or all of them if only those are left. */
export function queryTerms(text) {
  const words = [...new Set(segment(text).split(' ').filter(Boolean))];
  const content = words.filter((word) => !STOP.has(word));
  return (content.length ? content : words).slice(0, 32);
}
const orQuery = (terms) => terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');

const toTurn = (row) => ({ id: row.id, at: row.at, src: row.src, session: row.session, text: row.text });

export function createTurns({ file, now = Date.now }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const statements = new Map();
  function stmt(sql) {
    let statement = statements.get(sql);
    if (!statement) {
      if (statements.size >= 128) statements.clear();
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  }
  function write(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
  const idsJson = (ids) => JSON.stringify([...ids].map(Number));
  const toStaged = (row) => ({
    id: row.id, kind: row.kind, file: row.file, relation: row.relation, target: row.target, name: row.name, description: row.description,
    text: row.text, explicit: row.explicit === 1, src: JSON.parse(row.src), createdAt: row.created_at, updatedAt: row.updated_at,
  });

  const staged = () => stmt('SELECT * FROM staged ORDER BY id').all().map(toStaged);

  return {
    /** Indexes one turn. { id, existing }: a turn with a key that was indexed before is not indexed again. */
    add({ src, text, at = now(), session = null, key = null }) {
      if (key && stmt('SELECT key FROM forgotten_turns WHERE key = ?').get(key)) return { forgotten: true };
      const known = key ? stmt('SELECT id FROM turns WHERE key = ?').get(key) : null;
      if (known) return { id: known.id, existing: true };
      return write(() => {
        const { lastInsertRowid } = stmt('INSERT INTO turns (key, at, src, session, text) VALUES (?, ?, ?, ?, ?)').run(key, at, src, session, text);
        const id = Number(lastInsertRowid);
        stmt('INSERT INTO turns_fts (rowid, text) VALUES (?, ?)').run(id, segment(text));
        return { id, existing: false };
      });
    },
    get(id) {
      const row = stmt('SELECT * FROM turns WHERE id = ?').get(id);
      return row ? toTurn(row) : null;
    },
    /** Map of id -> turn for the ids that exist. */
    byIds(ids) {
      const found = new Map();
      for (const row of stmt('SELECT * FROM turns WHERE id IN (SELECT value FROM json_each(?))').all(idsJson(ids))) found.set(row.id, toTurn(row));
      return found;
    },
    bySession(session) {
      return stmt('SELECT * FROM turns WHERE session = ? ORDER BY id').all(session).map(toTurn);
    },
    lastOwner() {
      const row = stmt("SELECT * FROM turns WHERE src = 'owner' ORDER BY id DESC LIMIT 1").get();
      return row ? toTurn(row) : null;
    },
    /** Conversation turns after an id, oldest first. */
    after(cursor, limit) {
      return stmt(`SELECT * FROM turns WHERE id > ? AND src IN ('owner','dudu') ORDER BY id LIMIT ?`).all(cursor, limit).map(toTurn);
    },
    /**
     * The best `limit` turns for a question by BM25 over its words (OR: a turn needs one, and the more of the rarer words it has the
     * higher it ranks), returned oldest first, each with `rank` (1 = best match).
     */
    search(text, limit = 10) {
      const terms = queryTerms(text);
      if (!terms.length) return [];
      const rows = stmt(
        'SELECT t.*, bm25(turns_fts) AS score FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid WHERE turns_fts MATCH ? ORDER BY score, t.id DESC LIMIT ?',
      ).all(orQuery(terms), limit);
      return rows.map((row, i) => ({ ...toTurn(row), rank: i + 1 })).sort((a, b) => a.at - b.at || a.id - b.id);
    },
    /** How many of these turns have a row in the search index. */
    indexed(ids) {
      return stmt('SELECT COUNT(*) AS n FROM turns_fts WHERE rowid IN (SELECT value FROM json_each(?))').get(idsJson(ids)).n;
    },
    count: () => stmt('SELECT COUNT(*) AS n FROM turns').get().n,
    /** Deletes turns and their index rows. Returns how many turns were deleted. */
    remove(ids) {
      return write(() => {
        // Replay after a restart must not resurrect a message the owner forgot.
        stmt('INSERT OR IGNORE INTO forgotten_turns (key) SELECT key FROM turns WHERE key IS NOT NULL AND id IN (SELECT value FROM json_each(?))').run(idsJson(ids));
        stmt('DELETE FROM turns_fts WHERE rowid IN (SELECT value FROM json_each(?))').run(idsJson(ids));
        return stmt('DELETE FROM turns WHERE id IN (SELECT value FROM json_each(?))').run(idsJson(ids)).changes;
      });
    },
    /** Builds the search index again from the stored turns and compacts the file, so nothing deleted stays in free pages. */
    rebuild() {
      write(() => {
        db.exec("INSERT INTO turns_fts (turns_fts) VALUES ('delete-all')");
        const insert = stmt('INSERT INTO turns_fts (rowid, text) VALUES (?, ?)');
        for (const row of stmt('SELECT id, text FROM turns').all()) insert.run(row.id, segment(row.text));
        db.exec("INSERT INTO turns_fts (turns_fts) VALUES ('optimize')");
      });
      db.exec('VACUUM');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    },

    // --- what the tidy keeps between runs
    cursor() {
      const row = stmt("SELECT value FROM meta WHERE key = 'tidy_cursor'").get();
      return row ? Number(row.value) : 0;
    },
    setCursor(id) {
      stmt("INSERT INTO meta (key, value) VALUES ('tidy_cursor', ?) ON CONFLICT DO UPDATE SET value = excluded.value").run(String(id));
    },
    staged,
    /** Inserts a staged note, or updates it when it has an id. Returns the id. */
    stagedPut(row) {
      const at = now();
      const values = [row.kind, row.file ?? null, row.relation ?? null, row.target ?? null, row.name ?? null, row.description ?? null, row.text, row.explicit ? 1 : 0, JSON.stringify(row.src)];
      if (row.id) {
        stmt('UPDATE staged SET kind = ?, file = ?, relation = ?, target = ?, name = ?, description = ?, text = ?, explicit = ?, src = ?, updated_at = ? WHERE id = ?').run(...values, at, row.id);
        return row.id;
      }
      return write(() => {
        const { lastInsertRowid } = stmt('INSERT INTO staged (kind, file, relation, target, name, description, text, explicit, src, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...values, at, at);
        stmt('DELETE FROM staged WHERE id IN (SELECT id FROM staged ORDER BY updated_at DESC, id DESC LIMIT -1 OFFSET ?)').run(STAGED_KEEP);
        return Number(lastInsertRowid);
      });
    },
    stagedDelete(ids) {
      return stmt('DELETE FROM staged WHERE id IN (SELECT value FROM json_each(?))').run(idsJson(ids)).changes;
    },
    /** Deletes notes not touched since `before` (ms). */
    stagedExpire(before) {
      return stmt('DELETE FROM staged WHERE updated_at < ?').run(before).changes;
    },
    /** Ids of staged notes that cite any of these turns. */
    stagedCiting(turnIds) {
      const wanted = new Set(turnIds);
      return staged().filter((row) => row.src.some((id) => wanted.has(id))).map((row) => row.id);
    },
    close() {
      if (db.isOpen) db.close();
    },
  };
}
