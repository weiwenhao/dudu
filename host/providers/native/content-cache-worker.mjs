import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { conversationEvidence } from '../../conversation-search.mjs';
import { CONVERSATION_PAGE_SIZE, conversationPage } from './preview.mjs';

export const contentCacheWorker = new URL(import.meta.url);

if (!isMainThread) {
mkdirSync(dirname(workerData.file), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(workerData.file);
chmodSync(workerData.file, 0o600);
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS documents (
    key TEXT UNIQUE NOT NULL, stamp TEXT NOT NULL,
    user_text TEXT NOT NULL, assistant_text TEXT NOT NULL,
    user_lower TEXT NOT NULL, assistant_lower TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS words USING fts5(
    user_lower, assistant_lower, content=documents, content_rowid=rowid, tokenize='trigram'
  );
  CREATE TRIGGER IF NOT EXISTS documents_insert AFTER INSERT ON documents BEGIN
    INSERT INTO words(rowid,user_lower,assistant_lower) VALUES(new.rowid,new.user_lower,new.assistant_lower);
  END;
  CREATE TRIGGER IF NOT EXISTS documents_delete AFTER DELETE ON documents BEGIN
    INSERT INTO words(words,rowid,user_lower,assistant_lower) VALUES('delete',old.rowid,old.user_lower,old.assistant_lower);
  END;
  CREATE TRIGGER IF NOT EXISTS documents_update AFTER UPDATE ON documents BEGIN
    INSERT INTO words(words,rowid,user_lower,assistant_lower) VALUES('delete',old.rowid,old.user_lower,old.assistant_lower);
    INSERT INTO words(rowid,user_lower,assistant_lower) VALUES(new.rowid,new.user_lower,new.assistant_lower);
  END;
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS conversations (
    key TEXT PRIMARY KEY, stamp TEXT NOT NULL, count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversation_messages (
    key TEXT NOT NULL, position INTEGER NOT NULL, role TEXT NOT NULL, at REAL, text TEXT NOT NULL,
    PRIMARY KEY(key, position)
  ) WITHOUT ROWID;
`);
const statements = {
  stamps: db.prepare('SELECT d.key,d.stamp,c.stamp AS message_stamp FROM documents d LEFT JOIN conversations c ON c.key=d.key'),
  set: db.prepare(`INSERT INTO documents(key,stamp,user_text,assistant_text,user_lower,assistant_lower) VALUES(?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET stamp=excluded.stamp,user_text=excluded.user_text,assistant_text=excluded.assistant_text,user_lower=excluded.user_lower,assistant_lower=excluded.assistant_lower`),
  delete: db.prepare('DELETE FROM documents WHERE key=?'),
  document: db.prepare('SELECT user_text AS user,assistant_text AS assistant FROM documents WHERE key=?'),
  search: db.prepare('SELECT key,user_text,assistant_text,user_lower,assistant_lower FROM documents WHERE rowid IN (SELECT rowid FROM words WHERE words MATCH ?)'),
  short: db.prepare('SELECT key,user_text,assistant_text,user_lower,assistant_lower FROM documents WHERE instr(user_lower,?)>0 OR instr(assistant_lower,?)>0'),
  snapshot: db.prepare("SELECT value FROM metadata WHERE key='snapshot'"),
  saveSnapshot: db.prepare("INSERT INTO metadata(key,value) VALUES('snapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"),
  metadata: db.prepare('SELECT value FROM metadata WHERE key=?'),
  saveMetadata: db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
  conversation: db.prepare('SELECT stamp,count FROM conversations WHERE key=?'),
  saveConversation: db.prepare('INSERT INTO conversations(key,stamp,count) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET stamp=excluded.stamp,count=excluded.count'),
  deleteConversation: db.prepare('DELETE FROM conversations WHERE key=?'),
  deleteMessages: db.prepare('DELETE FROM conversation_messages WHERE key=?'),
  saveMessage: db.prepare('INSERT INTO conversation_messages(key,position,role,at,text) VALUES(?,?,?,?,?)'),
  page: db.prepare('SELECT role,at,text FROM conversation_messages WHERE key=? AND position>=? AND position<? ORDER BY position'),
};
function set({ key, stamp, user, assistant, messages }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    statements.set.run(key, stamp, user, assistant, user.toLowerCase(), assistant.toLowerCase());
    if (Array.isArray(messages)) {
      statements.deleteMessages.run(key);
      for (const [position, message] of messages.entries()) {
        statements.saveMessage.run(key, position, message.role, Number.isFinite(message.at) ? message.at : null, message.text);
      }
      statements.saveConversation.run(key, stamp, messages.length);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function page({ key, before, query }) {
  const conversation = statements.conversation.get(key);
  if (!conversation) return null; // Old search-only databases are filled by the same background scan.
  const end = Math.min(before ?? conversation.count, conversation.count);
  const start = Math.max(0, end - CONVERSATION_PAGE_SIZE);
  const messages = statements.page.all(key, start, end).map(({ role, at, text }) => ({
    role, ...(at === null ? {} : { at }), text,
  }));
  return { ...conversationPage(messages, undefined, query), nextCursor: start || null };
}
function remove(key) {
  db.exec('BEGIN IMMEDIATE');
  try {
    statements.delete.run(key);
    statements.deleteMessages.run(key);
    statements.deleteConversation.run(key);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function find(term) {
  if (!term) return [];
  const rows = [...term].length >= 3 ? statements.search.all(`"${term.replaceAll('"', '""')}"`) : statements.short.all(term, term);
  const result = [];
  for (const row of rows) {
    const owner = row.user_lower.indexOf(term);
    const role = owner >= 0 ? 'user' : 'assistant';
    const at = owner >= 0 ? owner : row.assistant_lower.indexOf(term);
    if (at < 0) continue;
    const text = role === 'user' ? row.user_text : row.assistant_text;
    const start = Math.max(0, at - 46);
    const end = start + 140 + term.length;
    result.push([row.key, { role, at, text: `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}` }]);
  }
  return result;
}
parentPort.on('message', ({ id, action, body }) => {
  try {
    let value;
    if (action === 'stamps') value = statements.stamps.all().map(({ key, stamp, message_stamp }) => [key, stamp, message_stamp]);
    else if (action === 'set') set(body);
    else if (action === 'delete') remove(body.key);
    else if (action === 'page') value = page(body);
    else if (action === 'find') value = find(body.term);
    else if (action === 'evidence') value = body.keys.flatMap((key) => {
      const doc = statements.document.get(key);
      const hit = doc && conversationEvidence(doc, body.query);
      return hit ? [[key, hit]] : [];
    });
    else if (action === 'snapshot') value = JSON.parse(statements.snapshot.get()?.value ?? 'null');
    else if (action === 'saveSnapshot') statements.saveSnapshot.run(JSON.stringify(body));
    else if (action === 'metadata') value = JSON.parse(statements.metadata.get(body.key)?.value ?? 'null');
    else if (action === 'saveMetadata') statements.saveMetadata.run(body.key, JSON.stringify(body.value));
    else if (action === 'flush') db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    else if (action === 'close') { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); }
    else throw new Error('Unknown conversation cache operation.');
    parentPort.postMessage({ id, value });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
}
