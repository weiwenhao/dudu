// Schema of issues.db. PRAGMA user_version is the number of applied migrations; migrations only move forward.
// SQLite only uses a partial index when the query's WHERE contains the index's WHERE term literally, so queries import these.
import { shortenProjectKeys } from './references.mjs';
import { migrateWorkflow } from './workflow.mjs';
import { migrateLabels } from './labels.mjs';
import { migrateLinks } from './links.mjs';
import { migrateInbox, migrateInboxMarks, migrateInboxOwner, migrateInboxSignals } from '../inbox/store.mjs';

export const OPEN_SQL = "status NOT IN ('done','canceled')";
export const FINISHED_SQL = "status IN ('done','canceled')";

// The boss's word about an agent's state, and what the session was doing when it was given (its state and since when): the word holds
// until that changes. Written so that running it twice (a copy of a database whose version number was put back) changes nothing.
function addAgentState(db) {
  const have = new Set(db.prepare('PRAGMA table_info(issues)').all().map((column) => column.name));
  if (!have.has('agent_state')) db.exec("ALTER TABLE issues ADD COLUMN agent_state TEXT CHECK (agent_state IN ('idle','blocked','done'))");
  if (!have.has('agent_state_basis')) db.exec('ALTER TABLE issues ADD COLUMN agent_state_basis TEXT');
}

// "Done" is not an agent state any more (2026-11-03): a finished run is the boss's turn, as a question or a failure is. What the boss had
// said by hand follows. Running it twice changes nothing.
function mergeDoneIntoBlocked(db) {
  db.exec("UPDATE issues SET agent_state = 'blocked' WHERE agent_state = 'done'");
}

const MIGRATIONS = [
  `
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('backlog','todo','in_progress','in_review','done','canceled')),
    ask TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none','urgent','high','medium','low')),
    impact INTEGER CHECK (impact BETWEEN 1 AND 3),
    effort TEXT CHECK (effort IN ('s','m','l')),
    kind TEXT NOT NULL DEFAULT '',
    project_name TEXT,
    project_path TEXT,
    due_at INTEGER,
    snooze_until INTEGER,
    agent TEXT,
    session TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    outcome TEXT,
    source TEXT NOT NULL DEFAULT 'owner' CHECK (source IN ('owner','dudu','connector','session')),
    source_ref TEXT NOT NULL DEFAULT '',
    CHECK ((status IN ('done','canceled')) = (resolved_at IS NOT NULL))
  );
  -- The open set is small however many finished issues pile up; list, due and overdue only touch these.
  CREATE INDEX issues_open_status_priority ON issues(status, priority) WHERE ${OPEN_SQL};
  CREATE INDEX issues_open_due ON issues(due_at) WHERE ${OPEN_SQL};
  CREATE INDEX issues_open_project_status ON issues(project_name, status) WHERE ${OPEN_SQL};
  -- Finished issues in completion order (read backwards for newest first, so new ones append at the right edge).
  CREATE INDEX issues_finished ON issues(resolved_at, id) WHERE ${FINISHED_SQL};

  -- Issue counts by status and priority, kept by triggers: the counts a list or the dashboard shows do not scan the
  -- finished issues, however many pile up.
  CREATE TABLE issue_counts (
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (status, priority)
  ) WITHOUT ROWID;
  CREATE TRIGGER issues_counted_insert AFTER INSERT ON issues BEGIN
    INSERT INTO issue_counts VALUES (new.status, new.priority, 1) ON CONFLICT DO UPDATE SET n = n + 1;
  END;
  CREATE TRIGGER issues_counted_update AFTER UPDATE OF status, priority ON issues BEGIN
    UPDATE issue_counts SET n = n - 1 WHERE status = old.status AND priority = old.priority;
    INSERT INTO issue_counts VALUES (new.status, new.priority, 1) ON CONFLICT DO UPDATE SET n = n + 1;
  END;
  CREATE TRIGGER issues_counted_delete AFTER DELETE ON issues BEGIN
    UPDATE issue_counts SET n = n - 1 WHERE status = old.status AND priority = old.priority;
  END;

  CREATE TABLE issue_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    data TEXT
  );
  CREATE INDEX issue_log_issue ON issue_log(issue_id, id);

  CREATE TABLE issue_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    agent TEXT NOT NULL DEFAULT '',
    session_key TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    close_reason TEXT CHECK (close_reason IN ('auto','switch','done'))
  );
  CREATE INDEX issue_sessions_issue ON issue_sessions(issue_id, id);

  -- No foreign key: events outlive an issue that is forgotten.
  CREATE TABLE issue_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    issue_id INTEGER,
    before TEXT,
    after TEXT,
    reason TEXT NOT NULL DEFAULT '',
    group_id TEXT,
    undoes INTEGER,
    undone_by INTEGER
  );
  CREATE INDEX issue_events_issue ON issue_events(issue_id, id);
  CREATE INDEX issue_events_group ON issue_events(group_id) WHERE group_id IS NOT NULL;

  -- Text is segmented by the application (see segment.mjs); rowid is the issue id. Contentless: the words are only ever
  -- searched, never read back, so the segmented copy is not stored a second time.
  CREATE VIRTUAL TABLE issues_fts USING fts5(title, brief, outcome, content = '', contentless_delete = 1, tokenize = 'unicode61 remove_diacritics 2');
  `,
  `CREATE INDEX issues_session ON issues(session) WHERE session IS NOT NULL;`,
  `
  ALTER TABLE issues ADD COLUMN project_key TEXT;
  ALTER TABLE issues ADD COLUMN project_number INTEGER;
  CREATE UNIQUE INDEX issues_reference ON issues(project_key, project_number) WHERE project_key IS NOT NULL;
  CREATE TABLE issue_projects (
    identity TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE COLLATE NOCASE,
    next_number INTEGER NOT NULL DEFAULT 1
  );
  -- Reservations survive moving, undoing and forgetting an issue; project numbers are never reused.
  CREATE TABLE issue_project_numbers (
    identity TEXT NOT NULL REFERENCES issue_projects(identity),
    issue_id INTEGER NOT NULL,
    number INTEGER NOT NULL,
    PRIMARY KEY (identity, issue_id),
    UNIQUE (identity, number)
  );
  `,
  shortenProjectKeys,
  migrateWorkflow,
  addAgentState,
  mergeDoneIntoBlocked,
  migrateInbox,
  migrateInboxOwner,
  migrateInboxSignals,
  `
  CREATE TABLE IF NOT EXISTS issue_attachments (
    id TEXT PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    log_id INTEGER REFERENCES issue_log(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('image', 'file')),
    ref TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS issue_attachments_issue ON issue_attachments(issue_id, id);
  `,
  migrateLabels,
  migrateLinks,
  migrateInboxMarks,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Thrown when the file was written by a newer version of the app; nothing is changed. */
export class SchemaTooNew extends Error {
  constructor(found) {
    super(`issues.db is schema version ${found}, newer than this app understands (${SCHEMA_VERSION}). Update the app.`);
    this.code = 'SCHEMA_TOO_NEW';
  }
}

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

export function migrate(db) {
  if (version(db) > SCHEMA_VERSION) throw new SchemaTooNew(version(db));
  if (version(db) === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Another process may have migrated while this one waited for the lock.
    const found = version(db);
    if (found > SCHEMA_VERSION) throw new SchemaTooNew(found);
    for (let v = found; v < SCHEMA_VERSION; v++) {
      const migration = MIGRATIONS[v];
      if (typeof migration === 'function') migration(db);
      else db.exec(migration);
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
