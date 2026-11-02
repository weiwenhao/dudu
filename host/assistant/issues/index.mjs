// The issues store (issues.db): the one unit of work in 嘟嘟, see docs/assistant.md 3.2.
//
//   const issues = createIssues({ file, now = Date.now, sessionState = () => null, actor = 'owner' });
//
// createIssues throws SchemaTooNew (code 'SCHEMA_TOO_NEW') when the file was written by a newer app; the file is left
// untouched. Everything else returns { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', issue?, message?,
// next? }: wrong input never throws, only database failures do. Times are ms UTC. Ids are 12, '12', '#12' or a project reference.
//
//   list(view)              view = { tab: 'active'|'backlog'|'all', filter, group, subGroup, order, reverse, completedLast,
//                                    limit (1..200, default 50), cursor, groupFilter }
//                           -> { items, total, nextCursor, counts: { status, priority }, groups? }
//                           filter = { status, priority, project, agent, agentState, source (lists; null is "none"),
//                                      dueFrom, dueTo, createdFrom, createdTo, updatedFrom, updatedTo, completedFrom, q }
//                           completedFrom hides finished issues resolved before it (open issues are never hidden);
//                           Number.MAX_SAFE_INTEGER hides all finished issues
//   facets(view)            -> { facets: { project, agent, agentState, source: [{ key, label, count }] } }: the filter menu's
//                           options over the view's tab and filter, each field leaving out its own filter; null is "none";
//                           an option with count 0 is listed only while the filter selects it
//   get(id, { logLimit, logCursor })   -> { issue (with sessions), log, activeQuestion, nextLogCursor }
//   add(fields, meta) / update(id, patch, meta) / assign(id, { agent, session, ...meta }) / snooze(id, until, meta)
//   complete(id, { outcome, ...meta }) / cancel(id, { reason, ...meta }) / log(id, { kind, text, data, ...meta })
//                           meta = { actor, reason, groupId }; every successful change returns { issue, eventId }
//   undo(target)            target: nothing (the latest change), an event id, { eventId } or { groupId } (plus actor, reason);
//                           -> { issue, issues, skipped: [{ eventId, issueId, reason }], kept: [{ eventId, issueId, fields }] }
//   search(q, { limit, tab }), counts(), events({ issueId, limit, cursor }), export(), close()
//
// Paging: a cursor is the last row's sort key (opaque base64url) plus the segment it came from. With tab 'all' and
// completedLast there are two segments (open issues in the view's order, then finished ones by resolvedAt desc); every
// other view has one. Keyset paging stays stable while rows change and never counts or skips rows by position.
//
// Grouping: with `group` the response has groups: [{ key, label, count, items, nextCursor }] (non-empty groups only, `items`
// and `nextCursor` replaced by `groups` of the same shape when `subGroup` is set) and top-level items are []. A group's
// next page is list({ ...view, groupFilter: { key, subKey }, cursor }), which returns a flat page of just that group.
// A null key is the "none" group (no project, no agent). The agent state is a SQL function over the current session
// state, so filtering and grouping by it is exact for paging and counts, at one JS call per scanned row.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { matchQuery, segment } from '../segment.mjs';
import { FINISHED_SQL, migrate, OPEN_SQL, SCHEMA_VERSION, SchemaTooNew } from './schema.mjs';
import { createReferences } from './references.mjs';

export { SchemaTooNew };
export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export const PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'];
export const AGENT_STATES = ['working', 'needs_you', 'stuck', 'idle'];
export const LOG_KINDS = ['source', 'priority', 'due', 'assign', 'status', 'progress', 'decision', 'blocked', 'session', 'result', 'note'];
const SOURCES = ['owner', 'dudu', 'connector', 'session'];
const EFFORTS = ['s', 'm', 'l'];
const OWNER = 'owner';
const NO_DUE = Number.MAX_SAFE_INTEGER;

const PRIORITY_RANK = "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";
const STATUS_RANK = "CASE status WHEN 'in_progress' THEN 0 WHEN 'in_review' THEN 1 WHEN 'todo' THEN 2 WHEN 'backlog' THEN 3 WHEN 'done' THEN 4 ELSE 5 END";
const DUE_RANK = `COALESCE(due_at, ${NO_DUE})`;
// Every order runs one direction over all its keys, which lets a cursor be a single row-value comparison.
const ORDERS = {
  priority: { keys: [PRIORITY_RANK, DUE_RANK, 'id'], dir: 'ASC' },
  status: { keys: [STATUS_RANK, PRIORITY_RANK, DUE_RANK, 'id'], dir: 'ASC' },
  due: { keys: [DUE_RANK, PRIORITY_RANK, 'id'], dir: 'ASC' },
  updated: { keys: ['updated_at', 'id'], dir: 'DESC' },
  created: { keys: ['created_at', 'id'], dir: 'DESC' },
};
const FINISHED_ORDER = { keys: ['resolved_at', 'id'], dir: 'DESC' };

// Each tab is a list of scopes, each carrying the literal term of the partial index that serves it.
const TABS = {
  active: [`${OPEN_SQL} AND status IN ('todo','in_progress','in_review')`],
  backlog: [`${OPEN_SQL} AND status = 'backlog'`],
  all: [OPEN_SQL, FINISHED_SQL],
};
const TAB_STATUSES = { active: ['todo', 'in_progress', 'in_review'], backlog: ['backlog'], all: STATUSES };

const AGENT_STATE_SQL = 'dudu_agent_state(status, ask, snooze_until, session)';
const GROUPS = {
  status: { sql: 'status', order: ['in_progress', 'in_review', 'todo', 'backlog', 'done', 'canceled'] },
  priority: { sql: 'priority', order: ['urgent', 'high', 'medium', 'low', 'none'] },
  agentState: { sql: AGENT_STATE_SQL, order: ['needs_you', 'stuck', 'working', 'idle'] },
  agent: { sql: 'agent' },
  project: { sql: 'project_name' },
};
// The filter menu's fields that list() does not count; the orders are the fixed ones for enumerations, by name otherwise.
const FACETS = { project: GROUPS.project, agent: GROUPS.agent, agentState: GROUPS.agentState, source: { sql: 'source', order: SOURCES } };
const collator = new Intl.Collator('zh', { numeric: true });

const COLUMNS = {
  title: 'title', brief: 'brief', status: 'status', ask: 'ask', priority: 'priority', impact: 'impact', effort: 'effort',
  kind: 'kind', dueAt: 'due_at', snoozeUntil: 'snooze_until', agent: 'agent', session: 'session', outcome: 'outcome',
  source: 'source', sourceRef: 'source_ref', resolvedAt: 'resolved_at',
};
const BLANK = {
  title: '', brief: '', status: 'todo', ask: '', priority: 'none', impact: null, effort: null, kind: '', project: null, dueAt: null,
  snoozeUntil: null, agent: null, session: null, outcome: null, source: OWNER, sourceRef: '', resolvedAt: null,
};

// --- input checking: a parser returns the clean value or throws Invalid, which the public methods turn into a result.
class Invalid extends Error {
  constructor(message, next = 'Correct the value and call again.') {
    super(message);
    this.next = next;
  }
}
class Missing extends Error {}

const nullable = (parse) => (value) => (value == null || value === '' ? null : parse(value));
const oneOf = (values) => (value) => {
  if (!values.includes(value)) throw new Invalid(`must be one of: ${values.join(', ')}`);
  return value;
};
const integer = (min, max) => (value) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Invalid(`must be a whole number from ${min} to ${max}`);
  return value;
};
const timestamp = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Invalid('must be a time in milliseconds');
  return value;
};
const flag = (value) => {
  if (typeof value !== 'boolean') throw new Invalid('must be true or false');
  return value;
};
const text = (max, required = false) => (value) => {
  if (typeof value !== 'string') throw new Invalid('must be text');
  const trimmed = value.trim();
  if (required && !trimmed) throw new Invalid('must not be empty');
  if (trimmed.length > max) throw new Invalid(`must be at most ${max} characters`);
  return trimmed;
};
const list = (parse) => (value) => {
  if (!Array.isArray(value) || value.length > 100) throw new Invalid('must be a list of up to 100 values');
  return value.map(parse);
};
const project = nullable((value) => {
  if (typeof value !== 'object' || Array.isArray(value)) throw new Invalid('must be { name, path } or null');
  return { name: check('name', text(200, true), value.name), path: check('path', nullable(text(1000)), value.path) };
});

function check(name, parse, value) {
  try {
    return parse(value);
  } catch (error) {
    throw error instanceof Invalid ? new Invalid(`${name} ${error.message}`, error.next) : error;
  }
}

function reject(object, allowed, what) {
  if (typeof object !== 'object' || object === null || Array.isArray(object)) throw new Invalid(`${what} must be an object`);
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw new Invalid(`Unknown ${what} "${key}". Allowed: ${allowed.join(', ')}.`);
}

const FIELDS = {
  title: text(300, true), brief: text(20000), status: oneOf(STATUSES), ask: text(2000), priority: oneOf(PRIORITIES),
  impact: nullable(integer(1, 3)), effort: nullable(oneOf(EFFORTS)), kind: text(100), project, dueAt: nullable(timestamp),
  snoozeUntil: nullable(timestamp), agent: nullable(text(100)), session: nullable(text(300)), outcome: nullable(text(4000)),
  source: oneOf(SOURCES), sourceRef: text(2000),
};

function parseFields(input) {
  reject(input, Object.keys(FIELDS), 'field');
  const fields = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) fields[key] = check(key, FIELDS[key], value);
  return fields;
}

function numericId(value) {
  const match = /^#?([1-9]\d{0,14})$/.exec(String(value ?? '').trim());
  if (!match) throw new Invalid(`"${String(value).slice(0, 40)}" is not an issue id; use its internal id or project reference.`);
  return Number(match[1]);
}

const FILTER_PARSERS = {
  status: list(oneOf(STATUSES)), priority: list(oneOf(PRIORITIES)), agentState: list(oneOf(AGENT_STATES)), source: list(oneOf(SOURCES)),
  project: list(nullable(text(200))), agent: list(nullable(text(100))),
  dueFrom: timestamp, dueTo: timestamp, createdFrom: timestamp, createdTo: timestamp, updatedFrom: timestamp, updatedTo: timestamp,
  completedFrom: timestamp,
  q: (value) => {
    if (referenceId(value)) return String(value).trim().toUpperCase();
    const query = matchQuery(typeof value === 'string' ? value : '');
    if (!query) throw new Invalid('needs at least one word');
    return query;
  },
};
const RANGES = [
  ['dueFrom', 'due_at', '>='], ['dueTo', 'due_at', '<='], ['createdFrom', 'created_at', '>='], ['createdTo', 'created_at', '<='],
  ['updatedFrom', 'updated_at', '>='], ['updatedTo', 'updated_at', '<='],
];
const VIEW_KEYS = ['tab', 'filter', 'group', 'subGroup', 'order', 'reverse', 'completedLast', 'limit', 'cursor', 'groupFilter'];

const encodeCursor = (s, k) => Buffer.from(JSON.stringify({ s, k })).toString('base64url');
function decodeCursor(value) {
  let cursor;
  try {
    cursor = JSON.parse(Buffer.from(String(value), 'base64url').toString());
  } catch {
    throw new Invalid('cursor is not valid');
  }
  if (!Number.isInteger(cursor?.s) || !Array.isArray(cursor.k) || !cursor.k.every(Number.isFinite)) throw new Invalid('cursor is not valid');
  return cursor;
}

function parseView(input) {
  const view = input ?? {};
  reject(view, VIEW_KEYS, 'view option');
  const tab = check('tab', oneOf(Object.keys(TABS)), view.tab ?? 'active');
  const group = check('group', nullable(oneOf(Object.keys(GROUPS))), view.group);
  const subGroup = check('subGroup', nullable(oneOf(Object.keys(GROUPS))), view.subGroup);
  if (subGroup && (!group || subGroup === group)) throw new Invalid('subGroup needs a group and must differ from it');
  const filter = view.filter ?? {};
  reject(filter, Object.keys(FILTER_PARSERS), 'filter');
  return {
    tab, group, subGroup,
    filter: Object.fromEntries(Object.entries(FILTER_PARSERS).filter(([key]) => filter[key] != null).map(([key, parse]) => [key, check(`filter.${key}`, parse, filter[key])])),
    order: check('order', oneOf(Object.keys(ORDERS)), view.order ?? 'priority'),
    reverse: check('reverse', flag, view.reverse ?? false),
    completedLast: check('completedLast', flag, view.completedLast ?? tab === 'all'),
    limit: check('limit', integer(1, 200), view.limit ?? 50),
    cursor: view.cursor == null ? null : decodeCursor(view.cursor),
    groupFilter: parseGroupFilter(view.groupFilter, group, subGroup),
  };
}

// A group is named by its key (null for the "none" group); both keys must be given explicitly.
function parseGroupFilter(value, group, subGroup) {
  if (value == null) return null;
  if (!group) throw new Invalid('groupFilter needs a group');
  const wanted = subGroup ? ['key', 'subKey'] : ['key'];
  reject(value, wanted, 'groupFilter option');
  return wanted.map((name) => {
    if (!(name in value)) throw new Invalid(`groupFilter.${name} is required (null for the none group)`);
    return check(`groupFilter.${name}`, nullable(text(200)), value[name]);
  });
}

// --- SQL pieces
const and = (...parts) => parts.filter(Boolean).join(' AND ');
const merge = (a, b) => ({ sql: and(a.sql, b.sql), params: [...a.params, ...b.params] });

// The WHERE of one scope of a view. `completedFrom` only cuts finished issues: through the finished index's own column
// in the finished scope, and as "open or resolved late enough" when the view has no scope (open issues have no resolved_at).
function whereOf(scope, filter, where) {
  const cut = filter.completedFrom;
  let own = { sql: scope, params: [] };
  if (cut != null && !scope?.startsWith(OPEN_SQL)) {
    own = scope ? { sql: `${scope} AND resolved_at >= ?`, params: [cut] } : { sql: '(resolved_at IS NULL OR resolved_at >= ?)', params: [cut] };
  }
  return merge(own, where);
}

// The filter as a WHERE fragment; `skip` leaves one facet's own filter out so its counts show the other options.
function filterSql(filter, skip = null) {
  const sql = [];
  const params = [];
  const anyOf = (key, column) => {
    const values = filter[key];
    if (!values?.length || key === skip) return;
    const named = values.filter((value) => value !== null);
    const parts = [];
    if (named.length) {
      parts.push(`${column} IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(named));
    }
    if (named.length < values.length) parts.push(`${column} IS NULL`);
    sql.push(parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0]);
  };
  anyOf('status', 'status');
  anyOf('priority', 'priority');
  anyOf('project', 'project_name');
  anyOf('agent', 'agent');
  anyOf('agentState', AGENT_STATE_SQL);
  anyOf('source', 'source');
  for (const [key, column, operator] of RANGES) {
    if (filter[key] == null) continue;
    sql.push(`${column} ${operator} ?`);
    params.push(filter[key]);
  }
  if (filter.q) {
    const ref = referenceId(filter.q);
    sql.push(ref ? ref.sql : 'id IN (SELECT rowid FROM issues_fts WHERE issues_fts MATCH ?)');
    params.push(...(ref ? ref.params : [filter.q]));
  }
  return { sql: sql.join(' AND '), params };
}

// A due-date range reads far fewer rows through the due index than through the status index SQLite would otherwise pick.
const source = (filter, scope) => (filter.dueFrom != null || filter.dueTo != null) && scope?.startsWith(OPEN_SQL) ? 'issues INDEXED BY issues_open_due' : 'issues';

function withGroup(where, view, keys) {
  const names = [view.group, view.subGroup];
  return merge(where, { sql: and(...keys.map((_, i) => `${GROUPS[names[i]].sql} IS ?`)), params: keys });
}

function sortKeys(group, keys) {
  if (group.order) return [...keys].sort((a, b) => group.order.indexOf(a) - group.order.indexOf(b));
  return [...keys].sort((a, b) => (a === null) - (b === null) || (a !== null && collator.compare(a, b)));
}

// --- rows
const fieldsOf = (row) => ({
  title: row.title, brief: row.brief, status: row.status, ask: row.ask, priority: row.priority, impact: row.impact, effort: row.effort,
  kind: row.kind, project: row.project_name === null ? null : { name: row.project_name, path: row.project_path },
  dueAt: row.due_at, snoozeUntil: row.snooze_until, agent: row.agent, session: row.session, outcome: row.outcome,
  source: row.source, sourceRef: row.source_ref, resolvedAt: row.resolved_at,
});
const isFinished = (status) => status === 'done' || status === 'canceled';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const json = (value) => (value == null ? null : JSON.stringify(value));
const parseJson = (value) => (value == null ? null : JSON.parse(value));
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));

function diff(current, next) {
  const before = {};
  const after = {};
  for (const key of Object.keys(next)) {
    if (same(current[key], next[key])) continue;
    before[key] = current[key];
    after[key] = next[key];
  }
  return { before, after };
}

// What each kind of change writes into the issue's log: structured data, no display text.
function logEntries(before, after, next, reason) {
  const entries = [];
  if ('status' in after) entries.push({ kind: 'status', text: (isFinished(after.status) && next.outcome) || reason, data: { from: before.status, to: after.status } });
  if ('priority' in after) entries.push({ kind: 'priority', text: reason, data: { from: before.priority, to: after.priority, impact: next.impact, effort: next.effort } });
  if ('dueAt' in after) entries.push({ kind: 'due', text: reason, data: { from: before.dueAt, to: after.dueAt } });
  if ('agent' in after || 'session' in after) entries.push({ kind: 'assign', text: reason, data: { agent: next.agent, session: next.session } });
  if (after.ask) entries.push({ kind: 'blocked', text: after.ask, data: null });
  return entries;
}

export function createIssues({ file, now = Date.now, sessionState = () => null, actor: defaultActor = OWNER }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    createReferences(db).backfill();
  } catch (error) {
    db.close();
    throw error;
  }

  const statements = new Map();
  const references = createReferences(db);
  const forgetPreviews = new Map();
  function stmt(sql) {
    let statement = statements.get(sql);
    if (!statement) {
      if (statements.size >= 256) statements.clear();
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  }

  // A broken session reader must not break the list: its sessions just read as unknown.
  function stateOf(session) {
    try {
      return (session && sessionState(session)) ?? null;
    } catch {
      return null;
    }
  }

  function agentStateOf(status, ask, snoozeUntil, session) {
    const snoozed = snoozeUntil != null && snoozeUntil > now();
    if (ask && !snoozed && !isFinished(status)) return 'needs_you';
    const state = stateOf(session);
    if (state === 'running') return 'working';
    if (state === 'waiting_owner') return ask && snoozed ? 'idle' : 'needs_you'; // a snoozed question stays quiet
    return state === 'error' ? 'stuck' : 'idle';
  }
  db.function('dudu_agent_state', (status, ask, snoozeUntil, session) => agentStateOf(status, ask, snoozeUntil, session));

  const toIssue = (row) => ({
    id: row.id, ref: row.project_key ? `${row.project_key}-${row.project_number}` : null, ...fieldsOf(row), agentState: agentStateOf(row.status, row.ask, row.snooze_until, row.session),
    createdAt: row.created_at, updatedAt: row.updated_at,
  });

  function loadRow(id) {
    const row = stmt('SELECT * FROM issues WHERE id = ?').get(id);
    if (!row) throw new Missing(`There is no issue ${id}.`);
    return row;
  }

  function parseId(value) {
    const ref = projectReference(value);
    if (!ref) return numericId(value);
    const row = stmt('SELECT id FROM issues WHERE project_key = ? COLLATE NOCASE AND project_number = ?').get(ref.key, ref.number);
    if (!row) throw new Missing(`There is no issue ${String(value).trim()}.`);
    return row.id;
  }

  // The public methods all go through here: input mistakes become results, only database failures throw.
  const guarded = (method) => (...args) => {
    try {
      return method(...args);
    } catch (error) {
      if (error instanceof Invalid) return { outcome: 'needs_clarification', message: error.message, next: error.next };
      if (error instanceof Missing) return { outcome: 'error', message: error.message, next: 'Find the issue with issues_list or issues_search.' };
      throw error;
    }
  };
  const success = (extra) => ({ outcome: 'success', ...extra });
  const noOp = (message, extra) => ({ outcome: 'no_op', message, ...extra });

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

  function context(meta) {
    const { actor, reason, groupId } = meta ?? {};
    return {
      actor: check('actor', text(100, true), actor ?? defaultActor), reason: check('reason', text(2000), reason ?? ''),
      groupId: check('groupId', nullable(text(100)), groupId), at: now(),
    };
  }

  // --- writing: every change is one transaction that also leaves an event (for undo) and, for some kinds, a log entry
  function addEvent(ctx, action, issueId, before, after, undoes = null) {
    const { lastInsertRowid } = stmt('INSERT INTO issue_events (at, actor, action, issue_id, before, after, reason, group_id, undoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.at, ctx.actor, action, issueId, json(before), json(after), ctx.reason, ctx.groupId, undoes);
    return Number(lastInsertRowid);
  }

  function addLog(issueId, ctx, { kind, text: body = '', data = null }) {
    const { lastInsertRowid } = stmt('INSERT INTO issue_log (issue_id, at, actor, kind, text, data) VALUES (?, ?, ?, ?, ?, ?)').run(issueId, ctx.at, ctx.actor, kind, body, json(data));
    return Number(lastInsertRowid);
  }

  const reindex = (id, { title, brief, outcome }) =>
    stmt('UPDATE issues_fts SET title = ?, brief = ?, outcome = ? WHERE rowid = ?').run(segment(title), segment(brief), segment(outcome), id);

  // A new session closes the ones still open on the issue; the issue remembers every session it used.
  function trackSessions(id, { agent, session }, at) {
    const open = stmt('SELECT id, session_key FROM issue_sessions WHERE issue_id = ? AND closed_at IS NULL').all(id);
    for (const row of open) {
      if (row.session_key !== session) stmt('UPDATE issue_sessions SET closed_at = ?, close_reason = ? WHERE id = ?').run(at, 'switch', row.id);
    }
    if (session && !open.some((row) => row.session_key === session)) {
      stmt('INSERT INTO issue_sessions (issue_id, agent, session_key, opened_at) VALUES (?, ?, ?, ?)').run(id, agent ?? '', session, at);
    }
  }

  function updateRow(id, after, at) {
    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(after)) {
      if (key === 'project') {
        sets.push('project_name = ?', 'project_path = ?');
        params.push(value?.name ?? null, value?.path ?? null);
      } else {
        sets.push(`${COLUMNS[key]} = ?`);
        params.push(value);
      }
    }
    stmt(`UPDATE issues SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, at, id);
    if ('project' in after) references.assign(id, after.project);
  }

  // Status moves carry their own bookkeeping; this is the one place that knows it.
  function settle(current, fields, ctx) {
    const next = { ...current, ...fields };
    if (current !== BLANK && current.agent && (
      ('agent' in fields && next.agent !== current.agent) ||
      ('project' in fields && (next.project?.path !== current.project?.path || next.project?.name !== current.project?.name))
    )) throw new Invalid('An assigned agent and its project cannot be changed.');
    if (current !== BLANK && 'project' in fields && current.project?.path !== next.project?.path) {
      if (!('session' in fields)) next.session = null;
      if (!('ask' in fields)) next.ask = '';
      if (!next.project?.path) next.agent = null;
    }
    if (fields.agent && (!next.project?.path || !isAbsolute(next.project.path))) {
      throw new Invalid('Choose a project folder before assigning an agent.', 'Select or create a project, then choose an agent.');
    }
    if (next.status !== current.status) {
      if (isFinished(current.status) && !('outcome' in fields)) next.outcome = null; // the old result belongs to the old status
      next.resolvedAt = isFinished(next.status) ? ctx.at : null;
      if (isFinished(next.status)) {
        next.ask = '';
        if (ctx.actor !== OWNER && !next.outcome) {
          throw new Invalid(`Moving an issue to ${next.status} needs an outcome (a canceled issue needs the reason).`, 'Call again with the outcome.');
        }
      }
    }
    if (isFinished(next.status) && next.ask) throw new Invalid('A done or canceled issue cannot have an ask.');
    return next;
  }

  function applyChange(id, fields, action, ctx) {
    const row = loadRow(id);
    const current = fieldsOf(row);
    const next = settle(current, fields, ctx);
    const { before, after } = diff(current, next);
    if (!Object.keys(after).length) return noOp('Nothing changed.', { issue: toIssue(row) });
    updateRow(id, after, ctx.at);
    if ('title' in after || 'brief' in after || 'outcome' in after) reindex(id, next);
    if ('session' in after) trackSessions(id, next, ctx.at);
    const eventId = addEvent(ctx, action, id, before, after);
    for (const entry of logEntries(before, after, next, ctx.reason)) addLog(id, ctx, entry);
    return success({ issue: toIssue(loadRow(id)), eventId });
  }

  const change = (rawId, patch, action, meta) => {
    const id = parseId(rawId);
    const fields = parseFields(patch ?? {});
    const ctx = context(meta);
    return write(() => applyChange(id, fields, action, ctx));
  };

  function add(input, meta) {
    const fields = parseFields(input ?? {});
    if (!fields.title) throw new Invalid('title is required', 'Call again with a title.');
    const ctx = context(meta);
    return write(() => {
      const next = settle(BLANK, fields, ctx);
      const { lastInsertRowid } = stmt(`INSERT INTO issues (title, brief, status, ask, priority, impact, effort, kind, project_name, project_path, due_at, snooze_until,
        agent, session, created_at, updated_at, resolved_at, outcome, source, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(next.title, next.brief, next.status, next.ask, next.priority, next.impact, next.effort, next.kind, next.project?.name ?? null, next.project?.path ?? null,
          next.dueAt, next.snoozeUntil, next.agent, next.session, ctx.at, ctx.at, next.resolvedAt, next.outcome, next.source, next.sourceRef);
      const id = Number(lastInsertRowid);
      references.assign(id, next.project);
      stmt('INSERT INTO issues_fts (rowid, title, brief, outcome) VALUES (?, ?, ?, ?)').run(id, segment(next.title), segment(next.brief), segment(next.outcome));
      if (next.session) trackSessions(id, next, ctx.at);
      const eventId = addEvent(ctx, 'add', id, null, null);
      // An issue the owner typed themselves has no origin to record; created_at and source already say it.
      if (next.source !== OWNER || next.sourceRef || ctx.reason) addLog(id, ctx, { kind: 'source', text: ctx.reason, data: { source: next.source, sourceRef: next.sourceRef } });
      if (next.ask) addLog(id, ctx, { kind: 'blocked', text: next.ask });
      return success({ issue: toIssue(loadRow(id)), eventId });
    });
  }

  function assign(rawId, input) {
    const { agent, session, project, ...meta } = input ?? {};
    if (agent === undefined) throw new Invalid('agent is required (null un-assigns)');
    const current = fieldsOf(loadRow(parseId(rawId)));
    return change(rawId, { agent, session: session ?? (current.agent === agent ? current.session : null), ...(project === undefined ? {} : { project }) }, 'assign', meta);
  }

  function snooze(rawId, until, meta) {
    if (until !== null && !(Number.isSafeInteger(until) && until > now())) throw new Invalid('until must be a time in the future (ms), or null to clear');
    return change(rawId, { snoozeUntil: until }, 'snooze', meta);
  }

  function complete(rawId, input) {
    const { outcome, ...meta } = input ?? {};
    return change(rawId, { status: 'done', outcome }, 'complete', meta);
  }

  function cancel(rawId, input) {
    const { reason, ...meta } = input ?? {};
    return change(rawId, { status: 'canceled', outcome: reason }, 'cancel', { ...meta, reason });
  }

  function log(rawId, input) {
    const { kind, text: body, data, ...meta } = input ?? {};
    const id = parseId(rawId);
    const entry = { kind: check('kind', oneOf(LOG_KINDS), kind), text: check('text', text(20000, true), body), data: data ?? null };
    const ctx = context(meta);
    return write(() => {
      loadRow(id);
      const logId = addLog(id, ctx, entry);
      stmt('UPDATE issues SET updated_at = ? WHERE id = ?').run(ctx.at, id);
      const eventId = addEvent(ctx, 'log', id, null, { logId });
      return success({ issue: toIssue(loadRow(id)), entry: { id: logId, at: ctx.at, actor: ctx.actor, ...entry }, eventId });
    });
  }

  // --- undo: put `before` back for the fields nobody touched since; later edits are never overwritten
  function eventsToUndo(target) {
    const { eventId, groupId } = target !== null && typeof target === 'object' ? target : { eventId: target };
    const inGroup = (group) => stmt('SELECT * FROM issue_events WHERE group_id = ? ORDER BY id DESC').all(group);
    if (groupId) return inGroup(check('groupId', text(100, true), groupId));
    const seed = eventId == null
      ? stmt("SELECT * FROM issue_events WHERE before IS NOT NULL AND undone_by IS NULL AND action != 'undo' ORDER BY id DESC LIMIT 1").get()
      : stmt('SELECT * FROM issue_events WHERE id = ?').get(check('eventId', integer(1, Number.MAX_SAFE_INTEGER), eventId));
    if (!seed && eventId != null) throw new Missing(`There is no event ${eventId}.`);
    if (!seed) return [];
    return seed.group_id ? inGroup(seed.group_id) : [seed];
  }

  function refusalFor(event) {
    if (event.undone_by) return 'it was already undone';
    if (event.action === 'undo') return 'an undo cannot be undone; make the change again';
    if (event.before === null) return event.action === 'add' ? 'an added issue stays; cancel it instead' : 'a log entry stays';
    return null;
  }

  function restore(event, ctx) {
    const row = stmt('SELECT * FROM issues WHERE id = ?').get(event.issue_id);
    if (!row) return { skipped: 'the issue is gone' };
    const current = fieldsOf(row);
    const before = JSON.parse(event.before);
    const after = JSON.parse(event.after);
    const untouched = Object.keys(before).filter((key) => same(current[key], after[key]) && !(current.agent && ['agent', 'project', 'session'].includes(key)));
    if (!untouched.length) return { skipped: current.agent && Object.keys(before).some((key) => ['agent', 'project', 'session'].includes(key)) ? 'the assignment is locked' : 'it was changed again since' };
    const restored = pick(before, untouched);
    const next = { ...current, ...restored };
    updateRow(row.id, restored, ctx.at);
    if (['title', 'brief', 'outcome'].some((key) => key in restored)) reindex(row.id, next);
    if ('session' in restored) trackSessions(row.id, next, ctx.at);
    const undoId = addEvent(ctx, 'undo', row.id, pick(current, untouched), restored, event.id);
    stmt('UPDATE issue_events SET undone_by = ? WHERE id = ?').run(undoId, event.id);
    for (const entry of logEntries(current, restored, next, ctx.reason)) addLog(row.id, ctx, entry);
    return { issue: toIssue(loadRow(row.id)), kept: Object.keys(before).filter((key) => !untouched.includes(key)) };
  }

  function undo(target) {
    const ctx = context(target !== null && typeof target === 'object' ? target : {});
    return write(() => {
      const events = eventsToUndo(target);
      if (!events.length) return noOp('There is nothing to undo.');
      const issues = [];
      const skipped = [];
      const kept = [];
      for (const event of events) {
        const refusal = refusalFor(event);
        if (refusal && events.length === 1) throw new Invalid(`Event ${event.id} cannot be undone: ${refusal}.`, 'Make the change you want as a new change.');
        const outcome = refusal ? { skipped: refusal } : restore(event, ctx);
        if (!outcome.issue) skipped.push({ eventId: event.id, issueId: event.issue_id, reason: outcome.skipped });
        else issues.push(outcome.issue);
        if (outcome.kept?.length) kept.push({ eventId: event.id, issueId: event.issue_id, fields: outcome.kept });
      }
      if (!issues.length) return noOp('Nothing could be undone.', { skipped });
      return success({ issue: issues.at(-1), issues, skipped, kept });
    });
  }

  // Forget only this issue's local records. The external source and DSH's session log belong to their own stores.
  function forget(rawId, { token, checkOnly = false, allowActive = false } = {}) {
    const id = parseId(rawId);
    const got = get(id, { logLimit: 1 });
    const version = () => stmt('SELECT MAX(id) AS id FROM issue_events WHERE issue_id = ?').get(id).id;
    if (!token) {
      const preview = { token: randomUUID(), at: now(), version: version() };
      for (const [key, value] of forgetPreviews) if (now() - value.at > 10 * 60_000) forgetPreviews.delete(key);
      if (forgetPreviews.size >= 100) forgetPreviews.delete(forgetPreviews.keys().next().value);
      forgetPreviews.set(id, preview);
      return success({
        preview: true, token: preview.token, issue: got.issue,
        counts: {
          log: stmt('SELECT COUNT(*) AS n FROM issue_log WHERE issue_id = ?').get(id).n,
          sessions: got.issue.sessions.length,
          events: stmt('SELECT COUNT(*) AS n FROM issue_events WHERE issue_id = ?').get(id).n,
        },
      });
    }
    const preview = forgetPreviews.get(id);
    if (!preview || preview.token !== token || now() - preview.at > 10 * 60_000 || preview.version !== version()) throw new Invalid('Preview this issue again before forgetting it.');
    if (!allowActive && got.issue.sessions.some((session) => ['running', 'waiting_owner'].includes(session.state))) throw new Invalid('Stop the working session before forgetting this issue.');
    if (checkOnly) return success({ issue: got.issue });
    return write(() => {
      stmt('DELETE FROM issues_fts WHERE rowid = ?').run(id);
      stmt('DELETE FROM issue_events WHERE issue_id = ?').run(id);
      stmt('DELETE FROM issues WHERE id = ?').run(id);
      addEvent(context({}), 'forget', id, null, null);
      forgetPreviews.delete(id);
      return success({ id, forgotten: true });
    });
  }

  // --- reading
  // Facet counts and the total come from cells of (status, priority) counts: the trigger-kept table when only the
  // status and priority filters are set, otherwise one pass per scope. Those two filters are applied to the cells, and a
  // facet leaves out its own filter so its menu shows what choosing another value would give.
  function summarize(view) {
    const { status, priority, ...others } = view.filter;
    let cells;
    if (Object.keys(others).length) {
      const where = filterSql(others);
      cells = TABS[view.tab].flatMap((scope) => {
        const scoped = whereOf(scope, others, where);
        return stmt(`SELECT status AS s, priority AS p, COUNT(*) AS n FROM ${source(others, scope)} WHERE ${scoped.sql} GROUP BY status, priority`).all(...scoped.params);
      });
    } else {
      cells = counterCells().filter((cell) => TAB_STATUSES[view.tab].includes(cell.s));
    }
    const allows = (values, value) => !values?.length || values.includes(value);
    const tally = (rows, key) => rows.reduce((counts, cell) => ({ ...counts, [cell[key]]: (counts[cell[key]] ?? 0) + cell.n }), {});
    const inStatus = cells.filter((cell) => allows(status, cell.s));
    const inPriority = cells.filter((cell) => allows(priority, cell.p));
    return {
      counts: { status: tally(inPriority, 's'), priority: tally(inStatus, 'p') },
      total: inStatus.filter((cell) => allows(priority, cell.p)).reduce((sum, cell) => sum + cell.n, 0),
    };
  }

  const counterCells = () => stmt('SELECT status AS s, priority AS p, n FROM issue_counts WHERE n > 0').all();

  function countRows(view, where) {
    return TABS[view.tab].reduce((total, scope) => {
      const scoped = whereOf(scope, view.filter, where);
      return total + stmt(`SELECT COUNT(*) AS n FROM ${source(view.filter, scope)} WHERE ${scoped.sql}`).get(...scoped.params).n;
    }, 0);
  }

  function segmentsOf(view) {
    const order = { ...ORDERS[view.order] };
    if (view.reverse) order.dir = order.dir === 'ASC' ? 'DESC' : 'ASC';
    if (view.tab !== 'all') return [{ scope: TABS[view.tab][0], order }];
    return view.completedLast ? [{ scope: OPEN_SQL, order }, { scope: FINISHED_SQL, order: FINISHED_ORDER }] : [{ scope: null, order }];
  }

  // One page of the view: up to `limit` rows after the cursor, fetching one extra to know whether there is more.
  function pageOf(view, where) {
    const segments = segmentsOf(view);
    const { cursor, limit } = view;
    if (cursor && cursor.s >= segments.length) throw new Invalid('cursor does not belong to this view');
    const rows = [];
    for (let s = cursor?.s ?? 0; s < segments.length && rows.length <= limit; s++) {
      const { scope, order } = segments[s];
      const scoped = whereOf(scope, view.filter, where);
      const conditions = [scoped.sql];
      const params = [...scoped.params];
      if (cursor && s === cursor.s) {
        if (cursor.k.length !== order.keys.length) throw new Invalid('cursor does not belong to this view');
        conditions.push(`(${order.keys.join(', ')}) ${order.dir === 'ASC' ? '>' : '<'} (${order.keys.map(() => '?').join(', ')})`);
        params.push(...cursor.k);
      }
      const clause = and(...conditions);
      const sql = `SELECT *, ${order.keys.map((key, i) => `${key} AS k${i}`).join(', ')} FROM ${source(view.filter, scope)} ${clause ? `WHERE ${clause}` : ''}
        ORDER BY ${order.keys.map((key) => `${key} ${order.dir}`).join(', ')} LIMIT ?`;
      for (const row of stmt(sql).all(...params, limit + 1 - rows.length)) rows.push({ row, s, order });
    }
    const last = rows[limit - 1];
    return {
      items: rows.slice(0, limit).map(({ row }) => toIssue(row)),
      nextCursor: rows.length > limit ? encodeCursor(last.s, last.order.keys.map((_, i) => last.row[`k${i}`])) : null,
    };
  }

  function groupPages(view, where) {
    const names = [GROUPS[view.group], view.subGroup && GROUPS[view.subGroup]].filter(Boolean);
    const tree = new Map(); // group key -> Map(sub key -> count)
    for (const scope of TABS[view.tab]) {
      const columns = names.map((group, i) => `${group.sql} AS g${i}`).join(', ');
      const by = names.map((_, i) => `g${i}`).join(', ');
      const scoped = whereOf(scope, view.filter, where);
      for (const row of stmt(`SELECT ${columns}, COUNT(*) AS n FROM ${source(view.filter, scope)} WHERE ${scoped.sql} GROUP BY ${by}`).all(...scoped.params)) {
        const subs = tree.get(row.g0) ?? new Map();
        tree.set(row.g0, subs);
        subs.set(row.g1 ?? null, (subs.get(row.g1 ?? null) ?? 0) + row.n);
      }
    }
    const node = (key, count, rest) => ({ key, label: key ?? '', count, ...rest });
    return sortKeys(names[0], [...tree.keys()]).map((key) => {
      const subs = tree.get(key);
      if (!view.subGroup) return node(key, subs.get(null), pageOf(view, withGroup(where, view, [key])));
      const groups = sortKeys(names[1], [...subs.keys()]).map((sub) => node(sub, subs.get(sub), pageOf(view, withGroup(where, view, [key, sub]))));
      return node(key, [...subs.values()].reduce((a, b) => a + b, 0), { groups });
    });
  }

  function list(input) {
    const view = parseView(input);
    const where = filterSql(view.filter);
    const { counts, total } = summarize(view);
    if (view.group && !view.groupFilter) return success({ items: [], total, nextCursor: null, counts, groups: groupPages(view, where) });
    const scoped = view.groupFilter ? withGroup(where, view, view.groupFilter) : where;
    return success({ ...pageOf(view, scoped), total: view.groupFilter ? countRows(view, scoped) : total, counts });
  }

  // The options of the filter menu for the fields list() does not count, over the view's tab and filter. A field leaves out
  // its own filter, so its options show what choosing them would give; an option with no issues is listed only while selected.
  function facets(input) {
    const view = parseView(input);
    const result = {};
    for (const [key, facet] of Object.entries(FACETS)) {
      const where = filterSql(view.filter, key);
      const counts = new Map();
      for (const scope of TABS[view.tab]) {
        const scoped = whereOf(scope, view.filter, where);
        for (const { k, n } of stmt(`SELECT ${facet.sql} AS k, COUNT(*) AS n FROM ${source(view.filter, scope)} WHERE ${scoped.sql} GROUP BY k`).all(...scoped.params)) {
          counts.set(k, (counts.get(k) ?? 0) + n);
        }
      }
      for (const selected of view.filter[key] ?? []) if (!counts.has(selected)) counts.set(selected, 0);
      result[key] = sortKeys(facet, [...counts.keys()]).map((option) => ({ key: option, label: option ?? '', count: counts.get(option) }));
    }
    return success({ facets: result });
  }

  function get(rawId, options) {
    const { logLimit = 50, logCursor } = options ?? {};
    const id = parseId(rawId);
    const limit = check('logLimit', integer(1, 200), logLimit);
    const before = logCursor == null ? Number.MAX_SAFE_INTEGER : check('logCursor', integer(1, Number.MAX_SAFE_INTEGER), logCursor);
    const row = loadRow(id);
    const sessions = stmt('SELECT * FROM issue_sessions WHERE issue_id = ? ORDER BY id DESC').all(id).map((s) => ({
      key: s.session_key, agent: s.agent, openedAt: s.opened_at, closedAt: s.closed_at, closeReason: s.close_reason,
      open: s.closed_at === null, state: stateOf(s.session_key),
    }));
    const rows = stmt('SELECT * FROM issue_log WHERE issue_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(id, before, limit + 1);
    // Keep the actual question available even when newer discussion has pushed it outside the current log page.
    const question = row.ask ? stmt("SELECT * FROM issue_log WHERE issue_id = ? AND kind = 'blocked' AND text = ? ORDER BY id DESC LIMIT 1").get(id, row.ask) : null;
    const entry = (r) => ({ id: r.id, at: r.at, actor: r.actor, kind: r.kind, text: r.text, data: parseJson(r.data) });
    return success({
      issue: { ...toIssue(row), sessions },
      log: rows.slice(0, limit).map(entry),
      activeQuestion: question ? entry(question) : null,
      nextLogCursor: rows.length > limit ? rows[limit - 1].id : null,
    });
  }

  function search(query, options) {
    const { limit = 20, tab = 'all' } = options ?? {};
    const match = matchQuery(typeof query === 'string' ? query : '');
    if (!match) throw new Invalid('The search needs at least one word.');
    const max = check('limit', integer(1, 200), limit);
    const scope = check('tab', oneOf(Object.keys(TABS)), tab) === 'all' ? null : TABS[tab][0];
    const ref = referenceId(query);
    if (ref) {
      const row = stmt(`SELECT * FROM issues WHERE ${and(ref.sql, scope)}`).get(...ref.params);
      return success({ items: row ? [toIssue(row)] : [], total: row ? 1 : 0 });
    }
    const from = `FROM issues_fts JOIN issues ON issues.id = issues_fts.rowid WHERE ${and('issues_fts MATCH ?', scope)}`;
    const rows = stmt(`SELECT issues.* ${from} ORDER BY bm25(issues_fts, 4.0, 1.0, 1.0), issues.updated_at DESC LIMIT ?`).all(match, max);
    return success({ items: rows.map(toIssue), total: stmt(`SELECT COUNT(*) AS n ${from}`).get(match).n });
  }

  function counts() {
    const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
    const byPriority = Object.fromEntries(PRIORITIES.map((priority) => [priority, 0]));
    for (const { s, p, n } of counterCells()) {
      byStatus[s] += n;
      if (!isFinished(s)) byPriority[p] += n;
    }
    const active = byStatus.todo + byStatus.in_progress + byStatus.in_review;
    return { byStatus, byPriority, active, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
  }

  function office() {
    const active = TABS.active[0];
    const board = [0, 0, 0, 0];
    const counts = { total: 0, working: 0, needs_you: 0, stuck: 0, idle: 0 };
    for (const row of stmt(`SELECT status, agent IS NOT NULL AS assigned, ${AGENT_STATE_SQL} AS state, COUNT(*) AS n FROM issues WHERE ${active} GROUP BY status, assigned, state`).all()) {
      board[row.assigned ? ['todo', 'in_progress', 'in_review'].indexOf(row.status) + 1 : 0] += row.n;
      if (row.assigned) { counts.total += row.n; counts[row.state] += row.n; }
    }
    const rows = stmt(`SELECT * FROM issues WHERE ${active} AND agent IS NOT NULL ORDER BY ${ORDERS.priority.keys.join(', ')} LIMIT 24`).all();
    return success({ items: rows.map(toIssue), counts, board });
  }

  function events(options) {
    const { issueId, limit = 50, cursor } = options ?? {};
    const max = check('limit', integer(1, 500), limit);
    const below = cursor == null ? Number.MAX_SAFE_INTEGER : check('cursor', integer(1, Number.MAX_SAFE_INTEGER), cursor);
    const id = issueId == null ? null : parseId(issueId);
    const rows = stmt('SELECT * FROM issue_events WHERE id < ? AND (? IS NULL OR issue_id = ?) ORDER BY id DESC LIMIT ?').all(below, id, id, max + 1);
    return success({
      events: rows.slice(0, max).map((e) => ({
        id: e.id, at: e.at, actor: e.actor, action: e.action, issueId: e.issue_id, before: parseJson(e.before), after: parseJson(e.after),
        reason: e.reason, groupId: e.group_id, undoes: e.undoes, undoneBy: e.undone_by,
      })),
      nextCursor: rows.length > max ? rows[max - 1].id : null,
    });
  }

  function exportAll() {
    const rows = (sql, parse = (row) => ({ ...row })) => stmt(sql).all().map(parse);
    return {
      version: SCHEMA_VERSION,
      exportedAt: now(),
      issues: rows('SELECT * FROM issues ORDER BY id'),
      log: rows('SELECT * FROM issue_log ORDER BY id', (row) => ({ ...row, data: parseJson(row.data) })),
      sessions: rows('SELECT * FROM issue_sessions ORDER BY id'),
      events: rows('SELECT * FROM issue_events ORDER BY id', (row) => ({ ...row, before: parseJson(row.before), after: parseJson(row.after) })),
      projects: rows('SELECT * FROM issue_projects ORDER BY identity'),
      references: rows('SELECT * FROM issue_project_numbers ORDER BY identity, number'),
    };
  }

  return {
    office: guarded(office),
    findBySession: guarded((session) => {
      const row = stmt("SELECT * FROM issues WHERE session = ? ORDER BY status IN ('done','canceled'), updated_at DESC, id DESC LIMIT 1").get(check('session', text(300, true), session));
      return success({ issue: row ? toIssue(row) : null });
    }),
    sessionOwners: (key) => stmt('SELECT DISTINCT issue_id AS id FROM issue_sessions WHERE session_key = ? UNION SELECT id FROM issues WHERE session = ?').all(key, key).map((row) => row.id),
    list: guarded(list),
    facets: guarded(facets),
    get: guarded(get),
    add: guarded(add),
    update: guarded((id, patch, meta) => change(id, patch, 'update', meta)),
    log: guarded(log),
    assign: guarded(assign),
    snooze: guarded(snooze),
    complete: guarded(complete),
    cancel: guarded(cancel),
    search: guarded(search),
    counts,
    undo: guarded(undo),
    forget: guarded(forget),
    events: guarded(events),
    export: exportAll,
    close() {
      if (db.isOpen) db.close();
    },
  };
}

function referenceId(value) {
  const ref = projectReference(value);
  if (ref) return { sql: 'project_key = ? COLLATE NOCASE AND project_number = ?', params: [ref.key, ref.number] };
  const match = /^#([1-9]\d{0,14})$/.exec(String(value ?? '').trim());
  return match ? { sql: 'id = ?', params: [Number(match[1])] } : null;
}

function projectReference(value) {
  const match = /^#?([a-z]{1,3})-([1-9]\d{0,14})$/i.exec(String(value ?? '').trim());
  return match ? { key: match[1].toUpperCase(), number: Number(match[2]) } : null;
}
