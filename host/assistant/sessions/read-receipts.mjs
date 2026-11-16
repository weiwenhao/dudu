import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hasUnread } from './session-state.mjs';

const digestPattern = /^\d{1,9}:[a-f0-9]{1,8}:[a-f0-9]{1,8}$/;
export function validReadPosition(position) {
  return Boolean(position && Number.isSafeInteger(position.seq) && position.seq >= -1
    && (!position.stream || (Number.isSafeInteger(position.stream.turn) && position.stream.turn >= 0
      && Number.isSafeInteger(position.stream.step) && position.stream.step >= 0
      && digestPattern.test(position.stream.digest))));
}

/** Owner data: never deleted or reconstructed like the searchable session cache. */
export function createReadReceipts({ file, now = Date.now }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) { db.close(); throw new Error('session-reads.db is newer than this code'); }
  db.exec(`CREATE TABLE IF NOT EXISTS receipts (
    session TEXT PRIMARY KEY, seq INTEGER NOT NULL, stream TEXT, read_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS manual_unread (session TEXT PRIMARY KEY, seq INTEGER NOT NULL) WITHOUT ROWID;
  PRAGMA user_version = 1;`);
  const select = db.prepare('SELECT seq, stream, read_at FROM receipts WHERE session = ?');
  const save = db.prepare(`INSERT INTO receipts VALUES (?, ?, ?, ?)
    ON CONFLICT(session) DO UPDATE SET seq=excluded.seq, stream=excluded.stream, read_at=excluded.read_at`);
  const get = (key) => {
    const row = select.get(key);
    return row ? { seq: row.seq, stream: row.stream ? JSON.parse(row.stream) : null, readAt: row.read_at } : null;
  };
  const manual = db.prepare('SELECT seq FROM manual_unread WHERE session = ?');
  const clearManual = db.prepare('DELETE FROM manual_unread WHERE session = ? AND seq <= ?');
  return {
    get,
    unread: (key, attention) => Boolean(manual.get(key)) || hasUnread(attention, get(key)),
    markUnread(key, position) {
      if (typeof key !== 'string' || !key || key.length > 600 || !validReadPosition(position)) throw new TypeError('Invalid read position');
      db.prepare('INSERT INTO manual_unread VALUES (?, ?) ON CONFLICT(session) DO UPDATE SET seq=excluded.seq').run(key, position.seq);
    },
    acknowledge(key, position) {
      if (typeof key !== 'string' || !key || key.length > 600 || !validReadPosition(position)) throw new TypeError('Invalid read position');
      const manualChanged = clearManual.run(key, position.seq).changes > 0;
      const previous = get(key);
      const seq = Math.max(position.seq, previous?.seq ?? -1);
      let stream = previous?.stream ?? null;
      const incoming = position.stream;
      // A stale screen/device cannot move either boundary backwards.
      if (incoming && (!stream || incoming.turn > stream.turn || (incoming.turn === stream.turn && incoming.step > stream.step)
        || (incoming.turn === stream.turn && incoming.step === stream.step
          && Number(incoming.digest.split(':')[0]) >= Number(stream.digest.split(':')[0])))) stream = incoming;
      const changed = seq !== previous?.seq || JSON.stringify(stream) !== JSON.stringify(previous?.stream ?? null);
      if (changed) save.run(key, seq, stream ? JSON.stringify(stream) : null, now());
      return { changed: changed || manualChanged, ...get(key) };
    },
    close: () => db.close(),
  };
}
