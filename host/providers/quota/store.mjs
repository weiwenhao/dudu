import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// What the last readings said, kept so that a window opened later has numbers at once and a reading is not asked for more often than the floor allows (service.mjs). A cache: deleting the
// file loses nothing but the numbers, so it has a file of its own (like the tasks) and no migration; a file of another version is dropped and made again.
const VERSION = 1;

/**
 * One row for each source: `tried_at` is when it was last ASKED (a reading that failed counts, so a failure is not retried at once), `read_at` and `data` are the last reading that WORKED,
 * `state` is how the last attempt ended: ok, error (the reading before it stands), login (the sign-in is gone: nothing is shown), none (nothing to read here), pending (under way).
 */
export function createQuotaStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
  if (db.prepare('PRAGMA user_version').get().user_version !== VERSION) db.exec('DROP TABLE IF EXISTS readings');
  db.exec(`CREATE TABLE IF NOT EXISTS readings (source TEXT PRIMARY KEY, tried_at INTEGER NOT NULL, read_at INTEGER, state TEXT NOT NULL, data TEXT) STRICT; PRAGMA user_version=${VERSION};`);
  const statements = {
    get: db.prepare('SELECT source, tried_at, read_at, state, data FROM readings WHERE source = ?'),
    begin: db.prepare("INSERT INTO readings (source, tried_at, state) VALUES (?, ?, 'pending') ON CONFLICT(source) DO UPDATE SET tried_at = excluded.tried_at"),
    succeed: db.prepare("UPDATE readings SET read_at = ?, state = 'ok', data = ? WHERE source = ?"),
    clear: db.prepare('UPDATE readings SET state = ?, data = NULL, read_at = NULL WHERE source = ?'),
    fail: db.prepare("UPDATE readings SET state = 'error' WHERE source = ?"),
  };
  return {
    get(source) {
      const row = statements.get.get(source);
      if (!row) return undefined;
      let data = null;
      try { data = row.data ? JSON.parse(row.data) : null; } catch { /* a row that cannot be read is no reading */ }
      return { source: row.source, triedAt: row.tried_at, readAt: row.read_at ?? null, state: row.state, data };
    },
    begin: (source, at) => { statements.begin.run(source, at); },
    succeed: (source, at, reading) => { statements.succeed.run(at, JSON.stringify(reading), source); },
    clear: (source, state) => { statements.clear.run(state, source); },
    fail: (source) => { statements.fail.run(source); },
    close: () => { try { db.close(); } catch { /* already closed */ } },
  };
}
