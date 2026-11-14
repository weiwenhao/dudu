// The issues store (issues.db): the one unit of work in 嘟嘟, see docs/assistant.md 3.2.
//
//   const issues = createIssues({ file, now = Date.now, sessionState = () => null, sessionSince, sessionBases, sessionHandledAt, sessionTurnActive, deepSleepMs = 30 min, deepSleepOn = () => true, actor = 'owner' });
//   sessionBases(key)   optional: every `state@since` the session reads as from the places it is read from; a boss's word on an agent holds while ANY of them is the one it was given on
//
// createIssues throws SchemaTooNew (code 'SCHEMA_TOO_NEW') when the file was written by a newer app; the file is left
// untouched. Everything else returns { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', issue?, message?,
// next? }: wrong input never throws, only database failures do. Times are ms UTC. Ids are 12, '12', '#12' or a project reference.
//
//   list(view)              view = { tab: 'active'|'backlog'|'all', filter, group, subGroup, order, reverse, completedLast,
//                                    limit (1..200, default 50), cursor, groupFilter }
//                           -> { items (with progressSummary), total, nextCursor, counts: { status, priority }, groups? }
//                           filter = { status, priority, project, agent, agentState, sessionState (the session's own state, for the
//                                      reminders), source (lists; null is "none"),
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
//   search(q, { limit, tab }), counts(), events({ issueId, limit, cursor }), export(), close()
//   inbox                   the records the connectors collected (../inbox/store.mjs): they live in this file and are linked to the issues they became
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
import { Buffer } from 'node:buffer';
import { matchQuery, segment } from '../segment.mjs';
import { FINISHED_SQL, migrate, OPEN_SQL, SCHEMA_VERSION, SchemaTooNew } from './schema.mjs';
import { createReferences } from './references.mjs';
import { SESSION_STATES } from '../sessions/states.mjs';
import { DEEP_SLEEP_MS, inDeepSleep } from '../sessions/deep-sleep.mjs';
import { AGENT_STATES, ISSUE_AGENT_STATES, agedMark, agentMarkForSession, agentStateForSession, stateOfMark } from '../sessions/work-state.mjs';
import { createWorkflow } from './workflow.mjs';
import { createLabels } from './labels.mjs';
import { createLinks } from './links.mjs';
import { createInbox } from '../inbox/store.mjs';
import { progressSentence } from './summary.mjs';

export { AGENT_STATES, ISSUE_AGENT_STATES, SchemaTooNew };
export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
export const PRIORITIES = ['none', 'urgent', 'high', 'medium', 'low'];
export const LOG_KINDS = ['source', 'priority', 'due', 'assign', 'status', 'progress', 'decision', 'blocked', 'session', 'result', 'note'];
const SOURCES = ['owner', 'dudu', 'connector', 'session'];
const EFFORTS = ['s', 'm', 'l'];
const OWNER = 'owner';
const NO_DUE = Number.MAX_SAFE_INTEGER;

const PRIORITY_RANK = "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";
const STATUS_RANK = "CASE status WHEN 'in_progress' THEN 0 WHEN 'in_review' THEN 0 WHEN 'todo' THEN 1 WHEN 'backlog' THEN 2 WHEN 'done' THEN 3 ELSE 4 END";
const WORKFLOW_POSITION = 'COALESCE((SELECT position FROM issue_statuses WHERE id = COALESCE(issues.workflow_status,issues.status)),0)';
const DUE_RANK = `COALESCE(due_at, ${NO_DUE})`;
// Every order runs one direction over all its keys, which lets a cursor be a single row-value comparison.
const ORDERS = {
  priority: { keys: [PRIORITY_RANK, DUE_RANK, 'id'], dir: 'ASC' },
  status: { keys: [STATUS_RANK, WORKFLOW_POSITION, PRIORITY_RANK, DUE_RANK, 'id'], dir: 'ASC' },
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

// The state of the agent's work: the session's (a fact), or the boss's word over it (see agentStateOf).
const AGENT_STATE_SQL = 'dudu_agent_state(agent, session, agent_state, agent_state_basis)';
// What the boss may declare by hand. Working is never declared: only a session that is running is working.
const MANUAL_AGENT_STATES = ['idle', 'blocked'];
const GROUPS = {
  status: { sql: 'status', order: ['in_progress', 'in_review', 'todo', 'backlog', 'done', 'canceled'] },
  priority: { sql: 'priority', order: ['urgent', 'high', 'medium', 'low', 'none'] },
  agentState: { sql: AGENT_STATE_SQL, order: ['blocked', 'working', 'idle', 'unassigned'] },
  agent: { sql: 'agent' },
  project: { sql: 'project_name' },
};
// The filter menu's fields that list() does not count; the orders are the fixed ones for enumerations, by name otherwise.
const FACETS = { project: GROUPS.project, agent: GROUPS.agent, agentState: GROUPS.agentState, source: { sql: 'source', order: SOURCES } };
const collator = new Intl.Collator('zh', { numeric: true });

const COLUMNS = {
  title: 'title', brief: 'brief', status: 'status', ask: 'ask', priority: 'priority', impact: 'impact', effort: 'effort',
  kind: 'kind', dueAt: 'due_at', snoozeUntil: 'snooze_until', agent: 'agent', session: 'session', outcome: 'outcome',
  source: 'source', sourceRef: 'source_ref', resolvedAt: 'resolved_at', agentState: 'agent_state', agentStateBasis: 'agent_state_basis',
  labels: 'label_ids', parent: 'parent_id',
};
const BLANK = {
  title: '', brief: '', status: 'todo', ask: '', priority: 'none', impact: null, effort: null, kind: '', project: null, dueAt: null,
  snoozeUntil: null, agent: null, session: null, outcome: null, source: OWNER, sourceRef: '', resolvedAt: null, agentState: null, agentStateBasis: null,
  labels: [], parent: null,
};

// --- input checking: a parser returns the clean value or throws Invalid, which the public methods turn into a result.
class Invalid extends Error {
  constructor(message, next = 'Correct the value and call again.') {
    super(message);
    this.next = next;
  }
}
class WorkflowInvalid extends Invalid {
  constructor(code) { super(code); this.code = code; }
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
const parseAttachmentIds = list(text(100, true));
// The ids of an issue's labels, once each and in order, so that the same labels are always the same list.
const labelIds = (value) => {
  if (!Array.isArray(value) || value.length > 50) throw new Invalid('must be a list of up to 50 label ids');
  for (const id of value) if (!Number.isSafeInteger(id) || id < 1) throw new Invalid('must be label ids (see issues/labels)');
  return [...new Set(value)].sort((a, b) => a - b);
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
  title: text(300, true), brief: text(20000), status: text(100, true), ask: text(2000), priority: oneOf(PRIORITIES),
  impact: nullable(integer(1, 3)), effort: nullable(oneOf(EFFORTS)), kind: text(100), project, dueAt: nullable(timestamp),
  snoozeUntil: nullable(timestamp), agent: nullable(text(100)), session: nullable(text(300)), outcome: nullable(text(4000)),
  source: oneOf(SOURCES), sourceRef: text(2000), agentState: nullable(oneOf(MANUAL_AGENT_STATES)),
  labels: labelIds, parent: nullable(integer(1, Number.MAX_SAFE_INTEGER)),
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
  status: list(text(100, true)), priority: list(oneOf(PRIORITIES)), agentState: list(oneOf(ISSUE_AGENT_STATES)), source: list(oneOf(SOURCES)),
  // The session's own state (a fact), for what the agent state no longer tells apart: a stuck session from a finished one (the reminders).
  sessionState: list(oneOf(SESSION_STATES)),
  hasQuestion: flag,
  project: list(nullable(text(200))), agent: list(nullable(text(100))), label: list(integer(1, Number.MAX_SAFE_INTEGER)),
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
  anyOf('status', 'COALESCE(workflow_status,status)');
  anyOf('priority', 'priority');
  anyOf('project', 'project_name');
  anyOf('agent', 'agent');
  anyOf('agentState', AGENT_STATE_SQL);
  anyOf('sessionState', 'dudu_session_state(session)');
  anyOf('source', 'source');
  if (filter.label?.length && skip !== 'label') {
    sql.push('EXISTS (SELECT 1 FROM json_each(issues.label_ids) WHERE value IN (SELECT value FROM json_each(?)))');
    params.push(JSON.stringify(filter.label));
  }
  if (filter.hasQuestion != null) sql.push(filter.hasQuestion ? "ask <> ''" : "ask = ''");
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

function sortKeys(group, keys) {
  if (group.order) return [...keys].sort((a, b) => group.order.indexOf(a) - group.order.indexOf(b));
  return [...keys].sort((a, b) => (a === null) - (b === null) || (a !== null && collator.compare(a, b)));
}

// --- rows
const fieldsOf = (row) => ({
  title: row.title, brief: row.brief, status: row.workflow_status ?? row.status, ask: row.ask, priority: row.priority, impact: row.impact, effort: row.effort,
  kind: row.kind, project: row.project_name === null ? null : { name: row.project_name, path: row.project_path },
  dueAt: row.due_at, snoozeUntil: row.snooze_until, agent: row.agent, session: row.session, outcome: row.outcome,
  source: row.source, sourceRef: row.source_ref, resolvedAt: row.resolved_at, agentState: row.agent_state, agentStateBasis: row.agent_state_basis,
  labels: row.label_ids ? JSON.parse(row.label_ids) : [], parent: row.parent_id ?? null,
});
const isFinished = (status) => status === 'done' || status === 'canceled';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const json = (value) => (value == null ? null : JSON.stringify(value));
const parseJson = (value) => (value == null ? null : JSON.parse(value));
const lastParagraph = (value) => (value ?? '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/).at(-1).trim();

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
function logEntries(before, after, next, reason, finished = isFinished) {
  const entries = [];
  if ('status' in after) entries.push({ kind: 'status', text: (finished(after.status) && next.outcome) || reason, data: { from: before.status, to: after.status } });
  if ('priority' in after) entries.push({ kind: 'priority', text: reason, data: { from: before.priority, to: after.priority, impact: next.impact, effort: next.effort } });
  if ('dueAt' in after) entries.push({ kind: 'due', text: reason, data: { from: before.dueAt, to: after.dueAt } });
  if ('agent' in after || 'session' in after) entries.push({ kind: 'assign', text: reason, data: { agent: next.agent, session: next.session } });
  if (after.ask) entries.push({ kind: 'blocked', text: after.ask, data: null });
  return entries;
}

export function createIssues({ file, now = Date.now, sessionState = () => null, sessionSince = () => null, sessionBases = null, sessionHandledAt = () => null, sessionTurnActive = () => null, deepSleepMs = DEEP_SLEEP_MS, deepSleepOn = () => true, actor: defaultActor = OWNER }) {
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
  const workflow = createWorkflow(db, (code) => new WorkflowInvalid(code));
  const labels = createLabels({ db, now, write: (work) => write(work), bad: (message, next) => new Invalid(message, next) });
  const links = createLinks({ db, now, bad: (message, next) => new Invalid(message, next) });
  const inbox = createInbox(db, { now });
  // Records kept without a title (the session left it out) get the first words of what they say; best effort, tried again at the next start.
  try { inbox.repairTitles(); } catch { /* a blank title is only a looks problem: the service goes on */ }
  const isFinished = (status) => ['done', 'canceled'].includes(workflow.type(status));
  const groups = { ...GROUPS, status: { ...GROUPS.status, sql: 'COALESCE(workflow_status,status)' } };
  const parseIssueFields = (input, actor = OWNER) => {
    const fields = parseFields(input);
    if (fields.status) {
      if (actor !== OWNER && STATUSES.includes(fields.status)) fields.status = workflow.forType(fields.status);
      workflow.require(fields.status);
    }
    return fields;
  };
  const viewOf = (input) => {
    const view = parseView(input);
    for (const id of view.filter.status ?? []) {
      // Saved filters may still refer to a removed status; their empty result remains removable in the UI.
      if (!workflow.get(id)) throw new WorkflowInvalid('unknown_status');
    }
    return view;
  };
  const withWorkflowGroup = (where, view, keys) => merge(where, {
    sql: and(...keys.map((_, index) => `${groups[[view.group, view.subGroup][index]].sql} IS ?`)), params: keys,
  });
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

  function sinceOf(session) {
    try {
      return (session && sessionSince(session)) ?? null;
    } catch {
      return null;
    }
  }

  // When anybody last did anything with the session (it changed, was spoken to or was opened): an idle agent, or one whose run finished and waits for a look
  // (a red dot never), that nobody has handled for half an hour is in deep sleep (sessions/deep-sleep.mjs), unless the owner has turned deep sleep off
  // (`deepSleepOn`, asked each time: the setting can change any moment).
  function handledAtOf(session) {
    try {
      return (session && sessionHandledAt(session)) ?? null;
    } catch {
      return null;
    }
  }
  function turnActiveOf(session) {
    try {
      return (session && sessionTurnActive(session)) ?? null;
    } catch {
      return null;
    }
  }
  const deepSleepOf = (row) => Boolean(deepSleepOn() && row.agent && row.session && inDeepSleep({
    key: row.session, state: stateOf(row.session), agentMark: agentMarkOf(row.session, row.agent_state, row.agent_state_basis),
    handledAt: handledAtOf(row.session), turnActive: turnActiveOf(row.session), now: now(), afterMs: deepSleepMs,
  }));

  // What the session was doing when the boss spoke: its state and since when. The boss's word holds while that is still true.
  const basisOf = (session) => `${stateOf(session) ?? ''}@${sinceOf(session) ?? ''}`;
  // A session can be read from more than one place (what DSH says of it, and what its harness wrote), and the places do not agree on since when a state has lasted (by a few
  // hundred milliseconds, or by hours): the word holds when ANY of them says it is still the state the boss saw, so that which of them is asked at the moment never moves it
  // (it used to: an issue put to Idle by hand jumped to Needs you and back with every change of the one asked).
  const basesOf = (session) => {
    try {
      const bases = sessionBases?.(session);
      if (Array.isArray(bases) && bases.length) return bases;
    } catch { /* the one that is asked, then */ }
    return [basisOf(session)];
  };
  // The boss's word (`override`) holds until the session's state changes, and never over live work. The mark is the state as an avatar's corner
  // shows it: a finished run ("done") is the state "blocked", told from a question or a failure; the boss's word is never a finished run.
  const agentMarkOf = (session, override, basis) => {
    // A session that waits for the boss and that nobody has handled for 72 hours is Idle by itself (owner, 2026-11-07: "超过 24 小时没有处理的会话也自动进入到空闲中"; 2026-11-14: 72 hours);
    // before that, no time makes an agent idle: that is a session that really is idle, or the boss's word. A stopped or interrupted turn needs the owner.
    const fact = agedMark(agentMarkForSession(stateOf(session)), handledAtOf(session), now());
    if (!override || fact === 'working') return fact;
    return basesOf(session).includes(basis) ? override : fact;
  };
  // No agent: "unassigned" (owner, 2026-11-05), the state an issue starts in; with one, what its work is doing.
  const agentStateOf = (agent, session, override, basis) => (agent ? stateOfMark(agentMarkOf(session, override, basis)) : 'unassigned');
  db.function('dudu_agent_state', agentStateOf);
  db.function('dudu_session_state', (session) => stateOf(session));

  // An issue's parent, and how many sub-issues it has and how many of them are done (only when it has any).
  const parentOf = (id) => {
    if (!id) return null;
    const parent = stmt('SELECT id, project_key, project_number, title, status, workflow_status FROM issues WHERE id = ?').get(id);
    return parent ? { id: parent.id, ref: parent.project_key ? `${parent.project_key}-${parent.project_number}` : null, title: parent.title, status: parent.workflow_status ?? parent.status, statusType: parent.status, ...subIssuesOf(parent.id) } : null;
  };
  const subIssuesOf = (id) => {
    const { total, done } = stmt("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'done'), 0) AS done FROM issues WHERE parent_id = ?").get(id);
    return total ? { subIssues: { total, done } } : {};
  };
  // A parent must be another issue, and never one of its own sub-issues (a loop).
  const checkParent = (id, parent) => {
    if (parent == null) return;
    if (parent === id) throw new Invalid('parent cannot be the issue itself.');
    if (!stmt('SELECT 1 FROM issues WHERE id = ?').get(parent)) throw new Invalid(`parent: there is no issue ${parent}.`);
    let walk = parent;
    for (let step = 0; walk != null && step < 200; step++) {
      if (walk === id) throw new Invalid('parent cannot be one of the issue\'s own sub-issues.');
      walk = stmt('SELECT parent_id FROM issues WHERE id = ?').get(walk)?.parent_id ?? null;
    }
  };

  const toIssue = (row) => {
    const { agentStateBasis, ...fields } = fieldsOf(row); // the basis stays inside the store
    return {
      id: row.id, ref: row.project_key ? `${row.project_key}-${row.project_number}` : null, ...fields,
      agentState: agentStateOf(row.agent, row.session, row.agent_state, row.agent_state_basis),
      ...(row.agent && agentMarkOf(row.session, row.agent_state, row.agent_state_basis) === 'done' ? { agentFinished: true } : {}), // (absent: not finished)
      ...(deepSleepOf(row) ? { deepSleep: true } : {}), // (absent: awake)
      statusType: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at,
      labels: labels.resolve(fields.labels), parent: parentOf(row.parent_id),
      ...subIssuesOf(row.id),
    };
  };

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
      if (error instanceof Invalid) return { outcome: 'needs_clarification', ...(error.code ? { code: error.code } : {}), message: error.message, next: error.next };
      if (error instanceof Missing) return { outcome: 'error', message: error.message, next: 'Find the issue with issues_list or issues_search.' };
      throw error;
    }
  };
  const success = (extra) => ({ outcome: 'success', ...extra });
  const noOp = (message, extra) => ({ outcome: 'no_op', message, ...extra });

  const changeListeners = new Set();
  let committedChanges = [];
  function write(work) {
    db.exec('BEGIN IMMEDIATE');
    committedChanges = [];
    let result;
    let changes;
    try {
      result = work();
      db.exec('COMMIT');
      changes = committedChanges;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      committedChanges = [];
    }
    // Observers see only committed events. A failed observer cannot undo an accepted edit.
    for (const change of changes) for (const listener of changeListeners) {
      try { listener(change); } catch (error) { console.warn(`[dudu] An issue change was not observed: ${error.message}`); }
    }
    return result;
  }

  function context(meta) {
    const { actor, reason, groupId } = meta ?? {};
    return {
      actor: check('actor', text(100, true), actor ?? defaultActor), reason: check('reason', text(2000), reason ?? ''),
      groupId: check('groupId', nullable(text(100)), groupId), at: now(),
    };
  }

  // --- writing: every change is one transaction that also leaves an event and, for some kinds, a log entry (the `undoes` and `undone_by` columns are what the undo of before 2026-11-12 wrote: nothing writes them now)
  function addEvent(ctx, action, issueId, before, after) {
    const { lastInsertRowid } = stmt('INSERT INTO issue_events (at, actor, action, issue_id, before, after, reason, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ctx.at, ctx.actor, action, issueId, json(before), json(after), ctx.reason, ctx.groupId);
    committedChanges.push({ id: Number(lastInsertRowid), issueId, action, before, after, actor: ctx.actor, at: ctx.at });
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
      if (key === 'status') {
        sets.push('status = ?', 'workflow_status = ?');
        params.push(workflow.type(value), value);
      } else if (key === 'labels') {
        sets.push('label_ids = ?');
        params.push(value.length ? JSON.stringify(value) : null);
      } else if (key === 'project') {
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
    for (const id of fields.labels ?? []) if (!labels.exists(id)) throw new Invalid(`labels: there is no label ${id}.`, 'Use the ids from issues/labels, or create the label first.');
    if (fields.agent && (!next.project?.path || !isAbsolute(next.project.path))) {
      throw new Invalid('Choose a project folder before assigning an agent.', 'Select or create a project, then choose an agent.');
    }
    // The boss's word about the agent's state belongs to this agent and this session, as it was when the word was given.
    if ('agentState' in fields && fields.agentState && !next.agent) throw new Invalid('An issue without an agent has no agent state to set.');
    if ('agentState' in fields && fields.agentState && agentStateForSession(stateOf(next.session)) === 'working') throw new Invalid('The agent is working; its state cannot be set by hand.', 'Wait until the session stops, or stop it.');
    if ('agentState' in fields) next.agentStateBasis = fields.agentState ? basisOf(next.session) : null;
    else if (current !== BLANK && current.agentState && (next.agent !== current.agent || next.session !== current.session)) {
      next.agentState = null;
      next.agentStateBasis = null;
    }
    if (next.status !== current.status) {
      const sameType = workflow.type(next.status) === workflow.type(current.status);
      if (isFinished(current.status) && !sameType && !('outcome' in fields)) next.outcome = null;
      next.resolvedAt = isFinished(next.status) ? (sameType ? current.resolvedAt : ctx.at) : null;
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
    if ('parent' in fields) checkParent(id, fields.parent);
    const next = settle(current, fields, ctx);
    const { before, after } = diff(current, next);
    if (!Object.keys(after).length) return noOp('Nothing changed.', { issue: toIssue(row) });
    updateRow(id, after, ctx.at);
    if ('title' in after || 'brief' in after || 'outcome' in after) reindex(id, next);
    if ('session' in after) trackSessions(id, next, ctx.at);
    const eventId = addEvent(ctx, action, id, before, after);
    for (const entry of logEntries(before, after, next, ctx.reason, isFinished)) addLog(id, ctx, entry);
    return success({ issue: toIssue(loadRow(id)), eventId });
  }

  const change = (rawId, patch, action, meta) => {
    const id = parseId(rawId);
    const ctx = context(meta);
    const fields = parseIssueFields(patch ?? {}, ctx.actor); // a missing patch changes nothing
    return write(() => applyChange(id, fields, action, ctx));
  };

  function add(input, meta) {
    const ctx = context(meta);
    const fields = parseIssueFields(input ?? {}, ctx.actor);
    if (!fields.title) throw new Invalid('title is required', 'Call again with a title.');
    return write(() => {
      const next = settle(BLANK, { status: workflow.defaultId(), ...fields }, ctx);
      checkParent(null, next.parent);
      const { lastInsertRowid } = stmt(`INSERT INTO issues (title, brief, status, ask, priority, impact, effort, kind, project_name, project_path, due_at, snooze_until,
        agent, session, created_at, updated_at, resolved_at, outcome, source, source_ref, workflow_status, label_ids, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(next.title, next.brief, workflow.type(next.status), next.ask, next.priority, next.impact, next.effort, next.kind, next.project?.name ?? null, next.project?.path ?? null,
          next.dueAt, next.snoozeUntil, next.agent, next.session, ctx.at, ctx.at, next.resolvedAt, next.outcome, next.source, next.sourceRef, next.status,
          next.labels.length ? JSON.stringify(next.labels) : null, next.parent);
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
    return change(rawId, { status: workflow.forType('done'), outcome }, 'complete', meta);
  }

  function cancel(rawId, input) {
    const { reason, ...meta } = input ?? {};
    return change(rawId, { status: workflow.forType('canceled'), outcome: reason }, 'cancel', { ...meta, reason });
  }

  function log(rawId, input) {
    const { kind, text: body, data, attachmentIds = [], requestId, ...meta } = input ?? {};
    const id = parseId(rawId);
    check('kind', oneOf(LOG_KINDS), kind);
    const keys = check('attachmentIds', parseAttachmentIds, attachmentIds);
    if (new Set(keys).size !== keys.length || keys.length && kind !== 'note') throw new Invalid('invalid attachments');
    if (requestId !== undefined) check('requestId', text(100, true), requestId);
    const entry = { kind, text: check('text', text(20000, keys.length === 0), body), data: data ?? null };
    const ctx = context(meta);
    return write(() => {
      loadRow(id);
      if (requestId) {
        const previous = stmt("SELECT * FROM issue_log WHERE issue_id=? AND actor=? AND json_extract(data, '$.requestId')=?").get(id, ctx.actor, requestId);
        if (previous) {
          const saved = parseJson(previous.data);
          if (previous.text !== entry.text || JSON.stringify(saved?.attachments?.map((item) => item.id) ?? []) !== JSON.stringify(keys)) throw new Invalid('requestId has different content');
          return { ...success({ issue: toIssue(loadRow(id)), entry: { id: previous.id, at: previous.at, actor: previous.actor, kind: previous.kind, text: previous.text, data: saved } }), outcome: 'no_op' };
        }
      }
      const attachments = keys.map((key) => {
        const row = stmt('SELECT * FROM issue_attachments WHERE issue_id=? AND id=? AND log_id IS NULL').get(id, key);
        if (!row) throw new Invalid('attachment is unavailable for this issue');
        return { id: row.id, type: row.type, attachment: parseJson(row.ref) };
      });
      if (attachments.length || requestId) entry.data = { ...entry.data, ...(attachments.length ? { attachments } : {}), ...(requestId ? { requestId } : {}) };
      const logId = addLog(id, ctx, entry);
      for (const key of keys) stmt('UPDATE issue_attachments SET log_id=? WHERE issue_id=? AND id=?').run(logId, id, key);
      stmt('UPDATE issues SET updated_at = ? WHERE id = ?').run(ctx.at, id);
      const eventId = addEvent(ctx, 'log', id, null, { logId });
      return success({ issue: toIssue(loadRow(id)), entry: { id: logId, at: ctx.at, actor: ctx.actor, ...entry }, eventId });
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
      stmt('UPDATE issues SET parent_id = NULL WHERE parent_id = ?').run(id); // its sub-issues are issues of their own again
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
        return stmt(`SELECT COALESCE(workflow_status,status) AS s, priority AS p, COUNT(*) AS n FROM ${source(others, scope)} WHERE ${scoped.sql} GROUP BY s, priority`).all(...scoped.params);
      });
    } else {
      cells = counterCells().filter((cell) => TAB_STATUSES[view.tab].includes(workflow.type(cell.s)));
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

  const counterCells = () => stmt('SELECT status AS s, priority AS p, n FROM issue_workflow_counts WHERE n > 0').all();

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
      // Read only stored progress through the issue's log index; listing never reads conversations or generates text.
      const sql = `SELECT *, ${order.keys.map((key, i) => `${key} AS k${i}`).join(', ')},
        (SELECT text FROM issue_log WHERE issue_id = issues.id AND kind = 'progress' ORDER BY id DESC LIMIT 1) AS latest_progress
        FROM ${source(view.filter, scope)} ${clause ? `WHERE ${clause}` : ''}
        ORDER BY ${order.keys.map((key) => `${key} ${order.dir}`).join(', ')} LIMIT ?`;
      for (const row of stmt(sql).all(...params, limit + 1 - rows.length)) rows.push({ row, s, order });
    }
    const last = rows[limit - 1];
    return {
      items: rows.slice(0, limit).map(({ row }) => ({ ...toIssue(row), progressSummary: progressSentence(lastParagraph(row.latest_progress)) })),
      nextCursor: rows.length > limit ? encodeCursor(last.s, last.order.keys.map((_, i) => last.row[`k${i}`])) : null,
    };
  }

  function groupPages(view, where) {
    const categoryOrder = ['started', 'unstarted', 'backlog', 'completed', 'canceled'];
    const statusOrder = workflow.rows().sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.position - b.position).map((status) => status.id);
    const names = [groups[view.group], view.subGroup && groups[view.subGroup]].filter(Boolean).map((group) => group === groups.status ? { ...group, order: statusOrder } : group);
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
      if (!view.subGroup) return node(key, subs.get(null), pageOf(view, withWorkflowGroup(where, view, [key])));
      const groups = sortKeys(names[1], [...subs.keys()]).map((sub) => node(sub, subs.get(sub), pageOf(view, withWorkflowGroup(where, view, [key, sub]))));
      return node(key, [...subs.values()].reduce((a, b) => a + b, 0), { groups });
    });
  }

  function list(input) {
    const view = viewOf(input);
    const where = filterSql(view.filter);
    const { counts, total } = summarize(view);
    const statuses = workflow.rows();
    if (view.group && !view.groupFilter) return success({ items: [], total, nextCursor: null, counts, statuses, groups: groupPages(view, where) });
    const scoped = view.groupFilter ? withWorkflowGroup(where, view, view.groupFilter) : where;
    return success({ ...pageOf(view, scoped), total: view.groupFilter ? countRows(view, scoped) : total, counts, statuses });
  }

  // The options of the filter menu for the fields list() does not count, over the view's tab and filter. A field leaves out
  // its own filter, so its options show what choosing them would give; an option with no issues is listed only while selected.
  function facets(input) {
    const view = viewOf(input);
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
    // Labels are many to an issue: counted over the labels of the issues the other filters leave, every label listed, those no issue has with 0.
    const labelCounts = new Map();
    const labelWhere = filterSql(view.filter, 'label');
    for (const scope of TABS[view.tab]) {
      const scoped = whereOf(scope, view.filter, labelWhere);
      for (const { k, n } of stmt(`SELECT j.value AS k, COUNT(*) AS n FROM (SELECT label_ids FROM ${source(view.filter, scope)} WHERE ${scoped.sql}) AS t, json_each(t.label_ids) AS j GROUP BY k`).all(...scoped.params)) {
        labelCounts.set(k, (labelCounts.get(k) ?? 0) + n);
      }
    }
    result.label = labels.list().map((label) => ({ key: label.id, label: label.name, color: label.color, count: labelCounts.get(label.id) ?? 0 }));
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
      issue: { ...toIssue(row), sessions, links: links.list(id), children: stmt('SELECT * FROM issues WHERE parent_id = ? ORDER BY id').all(id).map(toIssue) },
      log: rows.slice(0, limit).map(entry),
      activeQuestion: question ? entry(question) : null,
      nextLogCursor: rows.length > limit ? rows[limit - 1].id : null,
    });
  }

  /** What a list of records says of the issues they belong to, for many at once: { id, ref, title, status, statusType } (an issue that is gone is left out). */
  function summaries(ids) {
    const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => Number.isSafeInteger(id)))].slice(0, 200);
    if (!wanted.length) return [];
    return db.prepare(`SELECT id, project_key, project_number, title, status, workflow_status FROM issues WHERE id IN (${wanted.map(() => '?').join(', ')})`).all(...wanted).map((row) => ({
      id: row.id, ref: row.project_key ? `${row.project_key}-${row.project_number}` : null, title: row.title, status: row.workflow_status ?? row.status, statusType: row.status,
    }));
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

  // The pet's @ picker reads stored routing metadata only; opening it never observes a conversation.
  function recipients({ q = '', limit = 50 } = {}) {
    const query = check('q', text(300), q).toLowerCase().trim();
    const max = check('limit', integer(1, 200), limit);
    const terms = query.split(/\s+/).filter(Boolean);
    const label = "lower(coalesce(project_key || '-' || project_number, '') || ' #' || id || ' ' || title || ' ' || agent || CASE WHEN agent='codex' THEN ' chatgpt' ELSE '' END || ' ' || coalesce(project_name, ''))";
    const where = ['agent IS NOT NULL', "session IS NOT NULL AND session <> ''", ...terms.map(() => `instr(${label}, ?) > 0`)].join(' AND ');
    const rows = stmt(`SELECT * FROM issues WHERE ${where}
      ORDER BY CASE WHEN status IN ('todo', 'in_progress', 'in_review') THEN 0 ELSE 1 END, updated_at DESC, id DESC LIMIT ?`).all(...terms, max);
    return success({ items: rows.map((row) => {
      const issue = toIssue(row);
      return { id: issue.id, ref: issue.ref, title: issue.title, agent: issue.agent, project: issue.project, session: issue.session };
    }) });
  }

  function counts() {
    const byStatus = Object.fromEntries(workflow.rows().filter((status) => !status.archived).map((status) => [status.id, 0]));
    const byPriority = Object.fromEntries(PRIORITIES.map((priority) => [priority, 0]));
    for (const { s, p, n } of counterCells()) {
      byStatus[s] = (byStatus[s] ?? 0) + n;
      if (!isFinished(s)) byPriority[p] += n;
    }
    const active = Object.entries(byStatus).reduce((sum, [id, n]) => sum + (['todo', 'in_progress', 'in_review'].includes(workflow.type(id)) ? n : 0), 0);
    return { byStatus, byPriority, active, total: Object.values(byStatus).reduce((a, b) => a + b, 0) };
  }

  function office() {
    const active = TABS.active[0];
    const board = [0, 0, 0, 0];
    const counts = { total: 0, ...Object.fromEntries(AGENT_STATES.map((state) => [state, 0])) };
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
      statuses: workflow.rows(),
      labels: labels.list(),
      attachments: rows('SELECT * FROM issue_attachments WHERE log_id IS NOT NULL ORDER BY created_at, id', (row) => ({ ...row, ref: parseJson(row.ref) })),
      links: rows('SELECT * FROM issue_links ORDER BY issue_id, id', (row) => row),
      // What the connectors brought that became or fed an issue; the rest is cleared on its own.
      records: rows('SELECT id, connector, source_id, version, kind, title, author, url, thread, at, text, context, more, collected_at, state, verdict, issue_id, reason, judged_at FROM inbox_records WHERE issue_id IS NOT NULL ORDER BY id', (row) => ({ ...row, context: parseJson(row.context) })),
    };
  }

  return {
    statusType: (issue) => issue.statusType ?? workflow.type(issue.status),
    recipients: guarded(recipients),
    labels: guarded(() => success({ labels: labels.list() })),
    /** Adds a link to an issue: `fields` is { url, title?, kind? } (kind: link, pull_request or document). Not undoable: a link is taken off again. */
    linkAdd: guarded((rawId, fields, meta) => {
      const id = parseId(rawId);
      const ctx = context(meta);
      return write(() => {
        loadRow(id);
        const link = links.add(id, fields ?? {});
        stmt('UPDATE issues SET updated_at = ? WHERE id = ?').run(ctx.at, id);
        const eventId = addEvent(ctx, 'link-add', id, null, { link });
        return success({ link, links: links.list(id), issue: toIssue(loadRow(id)), eventId });
      });
    }),
    linkRemove: guarded((rawId, rawLink, meta) => {
      const id = parseId(rawId);
      const linkId = check('linkId', integer(1, Number.MAX_SAFE_INTEGER), rawLink);
      const ctx = context(meta);
      return write(() => {
        loadRow(id);
        const link = links.remove(id, linkId);
        stmt('UPDATE issues SET updated_at = ? WHERE id = ?').run(ctx.at, id);
        const eventId = addEvent(ctx, 'link-remove', id, null, { link });
        return success({ link, links: links.list(id), issue: toIssue(loadRow(id)), eventId });
      });
    }),
    labelAdd: guarded((fields) => { const label = labels.add(fields ?? {}); return success({ label, labels: labels.list() }); }),
    labelUpdate: guarded((id, patch) => { const label = labels.update(check('id', integer(1, Number.MAX_SAFE_INTEGER), id), patch ?? {}); return success({ label, labels: labels.list() }); }),
    labelRemove: guarded((id) => { const done = labels.remove(check('id', integer(1, Number.MAX_SAFE_INTEGER), id)); return success({ ...done, labels: labels.list() }); }),
    statuses: () => success({ statuses: workflow.rows(), counts: counts().byStatus }),
    statusAdd: guarded((fields) => write(() => success({ status: workflow.add(fields), statuses: workflow.rows() }))),
    statusUpdate: guarded((id, patch) => write(() => success({ status: workflow.update(id, patch), statuses: workflow.rows() }))),
    statusOrder: guarded((category, ids) => write(() => { workflow.reorder(category, ids); return success({ statuses: workflow.rows() }); })),
    statusRemove: guarded((id, replacement) => write(() => {
      workflow.require(id);
      const used = stmt('SELECT id FROM issues WHERE workflow_status=?').all(id);
      if (used.length && !replacement) throw new WorkflowInvalid('status_in_use');
      const target = workflow.archive(id, replacement);
      for (const row of used) applyChange(row.id, { status: target.id }, 'update', context({}));
      return success({ statuses: workflow.rows(), moved: used.length });
    })),
    office: guarded(office),
    findBySession: guarded((session) => {
      const row = stmt("SELECT * FROM issues WHERE session = ? ORDER BY status IN ('done','canceled'), updated_at DESC, id DESC LIMIT 1").get(check('session', text(300, true), session));
      return success({ issue: row ? toIssue(row) : null });
    }),
    sessionOwners: (key) => stmt('SELECT DISTINCT issue_id AS id FROM issue_sessions WHERE session_key = ? UNION SELECT id FROM issues WHERE session = ?').all(key, key).map((row) => row.id),
    onChange(listener) { changeListeners.add(listener); return () => changeListeners.delete(listener); },
    titleRevision: (id) => stmt("SELECT id, at FROM issue_events WHERE issue_id = ? AND (action = 'add' OR json_type(after, '$.title') IS NOT NULL) ORDER BY id DESC LIMIT 1").get(parseId(id)),
    sessionStart: (id, key) => parseJson(stmt("SELECT data FROM issue_log WHERE issue_id = ? AND kind = 'session' AND actor = 'dudu' AND json_extract(data, '$.key') = ? AND json_extract(data, '$.provider') IS NOT NULL ORDER BY id LIMIT 1").get(parseId(id), key)?.data),
    relayNote(id, entryId) {
      const row = stmt("SELECT * FROM issue_log WHERE issue_id = ? AND id = ? AND kind = 'note'").get(parseId(id), entryId);
      return row ? { id: row.id, at: row.at, actor: row.actor, kind: row.kind, text: row.text, data: parseJson(row.data) } : null;
    },
    stageAttachment: guarded((rawId, type, attachment) => {
      const id = parseId(rawId);
      loadRow(id);
      if (!['image', 'file'].includes(type) || !attachment?.attachmentId || !Number.isSafeInteger(attachment.bytes)) throw new Invalid('invalid attachment');
      const key = randomUUID();
      stmt('INSERT INTO issue_attachments(id,issue_id,type,ref,created_at) VALUES(?,?,?,?,?)').run(key, id, type, JSON.stringify(attachment), now());
      return success({ item: { id: key, type, attachment } });
    }),
    attachment: guarded((rawId, key) => {
      const id = parseId(rawId);
      loadRow(id);
      const row = stmt('SELECT * FROM issue_attachments WHERE issue_id=? AND id=?').get(id, check('attachment', text(100, true), key));
      if (!row) throw new Missing('The attachment is unavailable.');
      return success({ item: { id: row.id, type: row.type, attachment: parseJson(row.ref) } });
    }),
    list: guarded(list),
    facets: guarded(facets),
    get: guarded(get),
    summaries,
    add: guarded(add),
    update: guarded((id, patch, meta) => change(id, patch, 'update', meta)),
    log: guarded(log),
    assign: guarded(assign),
    snooze: guarded(snooze),
    complete: guarded(complete),
    cancel: guarded(cancel),
    search: guarded(search),
    counts,
    forget: guarded(forget),
    events: guarded(events),
    export: exportAll,
    inbox,
    close() {
      changeListeners.clear();
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
