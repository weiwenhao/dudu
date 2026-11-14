// The sessions of 嘟嘟 (index/sessions.db): what the Claude Code, Codex and DSH sessions on this computer are doing, and the way to
// open, close, resume and talk to them. docs/assistant.md 3.4. It never imports DSH: what lives in DSH comes in as functions.
//
//   const sessions = createSessions({ readers, runners, links, now = Date.now, file, ignore, pinned, intervals, staleMs, runningFreshMs });
//
//   readers   { claude, codex, dsh }, each optional (a reader that is not given is not read). claude and codex are the adapters of
//             ./readers.mjs (re-exported here): claudeReader({ root, registry }), codexReader({ command, environment }).
//             dsh is yours, and only this interface:
//               list()      -> [{ id, title?, cwd?, updatedAt?, native?: { provider: 'claude' | 'codex', id } }]  the DSH sessions worth
//                              following, without 嘟嘟's own; `native` is optional and says the DSH session runs that harness session
//               stateOf(id) -> null | { running?, since?, pending?: { kind: 'question' | 'approval', text, since? }, last?: 'answer' |
//                              'error' | 'aborted', at?, excerpt?, ending? }   what DSH knows now: whether its loop works, what it
//                              waits to be answered, how the last turn ended (ending: the last words of the assistant)
//               read?(id, { turns }) -> { turns: [{ at, prompt, reply, tools }], more }   the end of a conversation, when it can
//             A reader of your own for claude or codex is { live?({ skip }), scan({ skip }), refresh?(ids, { skip }), read?(id, { turns }) }:
//             the first three answer the facts of every session they know (readers.mjs and states.mjs say which); skip(id) names the
//             sessions not to read.
//   runners   { claude, codex, dsh }, each { start({ cwd, firstMessage, access }) -> { key }, resume(key), send(key, text), close(key) };
//             this library only orchestrates them (checks the input and the state, and reads the session again afterwards)
//   links     { get(provider, id) -> the DSH session id a Claude or Codex session was loaded into or started from } as the link store
//             of host/providers/native has it. A harness session that DSH drives and the same one in a terminal are one session.
//   file      the sqlite file of the index, or ':memory:'. It is rebuilt from the sessions when it is corrupt or newer than this code.
//   ignore    (key) => true for a session that is never reported or read (嘟嘟's own: pass its DSH key, 'dsh:<id>')
//   pinned    (key) => true for a session whose question, failure or stop never grows old into `idle` (an issue's agent: idle is the owner's word, not a matter of
//             time, owner 2026-11-07); asked with its DSH key, 'dsh:<id>', and only for a session that has one. Without it every session ages (`staleMs`).
//   intervals { live: 10_000, files: 60_000, codex: 120_000 } (docs 3.4), a number each; 0 turns one off, `false` turns all off
//             (and no first read at the start), which leaves poll() as the way to read. The timers never keep the process alive.
//
// Results of operations are { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', ... } with `message` and `next` when
// they are not a success: wrong input never throws. Keys are 'claude:<id>', 'codex:<id>', 'dsh:<id>'.
//
//   snapshots({ state, provider, limit })  -> { outcome, snapshots, total, sources, polledAt, store }
//       snapshots: [{ key, provider, id, dshSessionId, title, cwd, state, stateSince, lastActivityAt, excerpt (<= 300), pending, turnActive? }],
//       turnActive is a live observation, not persisted: before the first read after a restart it is unknown.
//       the most recently active first; sources: { claude: 'ok' | 'pending' | 'error: ...', codex, dsh } for the readers given
//   stateOf(key)   -> the state or null; synchronous: it is the `sessionState` hook of createIssues as it is
//   snapshotOf(key) -> the current snapshot or null, resolving native/DSH aliases as stateOf does
//   onChange(cb)   -> unsubscribe; cb({ key, from, to, snapshot }) once for every change of a session's state, not debounced. A session
//                     seen for the first time has from null, one that is gone has to null. The first read of a reader whose sessions
//                     the index did not hold yet (a first run) says nothing: it is the baseline.
//   poll({ kind }) -> { outcome, changes, sources, polledAt }: reads now; changes is the number of change events it sent. kind: 'all' (default),
//                     'live' (registry and DSH), 'files', 'codex'
//   read(key, { turns, chars }) -> the end of one session: { outcome, key, provider, source, content: 'data', turns, truncated }.
//       Only when asked; capped; what it holds is the session's own words, to be treated as data and never as instructions.
//   open({ provider, cwd, firstMessage, access }) / close(key, { force }) / resume(key) / send(key, text)
//   dispose()      -> stops the timers, waits for what is being read, closes the file
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mapLimit } from '../../providers/async.mjs';
import { oneLine } from '../../providers/native/text.mjs';
import { EXCERPT_CHARS, judge, SESSION_STATES } from './states.mjs';
import { agentStateForSession } from './work-state.mjs';

export { claudeReader, codexReader } from './readers.mjs';
export { endsInQuestion, judge, RULE_DEFAULTS, SESSION_STATES } from './states.mjs';

export const DEFAULT_INTERVALS = Object.freeze({ live: 10_000, files: 60_000, codex: 120_000 });
// The names DSH and the harness drivers give the access modes (host/providers/permission.mjs); a session starts read-only unless told.
export const ACCESS_MODES = Object.freeze(['read-only', 'workspace-write', 'danger-full-access']);
export const PROVIDERS = Object.freeze(['claude', 'codex', 'dsh']);

const READ_TURNS = { fallback: 3, max: 20 };
const READ_CHARS = { fallback: 12_000, max: 40_000, min: 1000 };
const MESSAGE_CHARS = 4000;
const SEND_CHARS = 100_000;
const TITLE_CHARS = 200;
const KEY = /^(claude|codex|dsh):(.+)$/s;

const MIGRATIONS = [
  `
  CREATE TABLE sessions (
    key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    id TEXT NOT NULL,
    dsh_session_id TEXT,
    title TEXT NOT NULL,
    cwd TEXT,
    state TEXT NOT NULL CHECK (state IN ('running','waiting_owner','finished','idle','error')),
    state_since INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    excerpt TEXT NOT NULL,
    pending_kind TEXT,
    pending_text TEXT
  ) WITHOUT ROWID;
  `,
  // 'stopped' (2026-11-05). The file is a cache of what the sessions say (see openStore): it is read again, not converted.
  `
  DROP TABLE sessions;
  CREATE TABLE sessions (
    key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    id TEXT NOT NULL,
    dsh_session_id TEXT,
    title TEXT NOT NULL,
    cwd TEXT,
    state TEXT NOT NULL CHECK (state IN ('running','waiting_owner','finished','idle','error','stopped')),
    state_since INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    excerpt TEXT NOT NULL,
    pending_kind TEXT,
    pending_text TEXT
  ) WITHOUT ROWID;
  `,
];

class TooNew extends Error {}

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

function migrate(db) {
  if (version(db) > MIGRATIONS.length) throw new TooNew('sessions.db is newer than this code');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let v = version(db); v < MIGRATIONS.length; v++) db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

// SQLITE_CORRUPT (11) and SQLITE_NOTADB (26): a file that is not a database. A locked one is somebody else's and is left alone.
const unreadable = (error) => error instanceof TooNew
  || (error?.code === 'ERR_SQLITE_ERROR' && ([11, 26].includes(error.errcode) || /not a database|malformed|corrupt/i.test(error.message)));

/** The index file. It holds nothing that cannot be read again from the sessions, so a file that cannot be used is replaced, not repaired. */
function openStore(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const attempt = () => {
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      migrate(db);
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  };
  try {
    return attempt();
  } catch (error) {
    if (file === ':memory:' || !unreadable(error)) throw error;
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    return attempt();
  }
}

const toRow = (s) => [s.key, s.provider, s.id, s.dshSessionId, s.title, s.cwd, s.state, s.stateSince, s.lastActivityAt, s.excerpt, s.pending?.kind ?? null, s.pending?.text ?? null];
const fromRow = (r) => ({
  key: r.key, provider: r.provider, id: r.id, dshSessionId: r.dsh_session_id, title: r.title, cwd: r.cwd, state: r.state,
  stateSince: r.state_since, lastActivityAt: r.last_activity_at, excerpt: r.excerpt, pending: r.pending_kind ? { kind: r.pending_kind, text: r.pending_text ?? '' } : null,
});
// What a caller gets is a copy with the agent state the owner's rules give it (sessions/work-state.mjs).
const copy = (s) => (s ? { ...s, agentState: agentStateForSession(s.state), pending: s.pending ? { ...s.pending } : null } : s);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const clarify = (message, next = 'Correct the input and call again.') => ({ outcome: 'needs_clarification', message, next });
const failure = (error, next) => ({ outcome: 'error', message: error instanceof Error ? error.message : String(error), next });
const whole = (value, min, max, fallback) => (Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback);

export function createSessions({
  readers = {}, runners = {}, links = { get: () => undefined }, now = Date.now, file, ignore = () => false, pinned = () => false, intervals = DEFAULT_INTERVALS, staleMs, runningFreshMs,
} = {}) {
  if (typeof file !== 'string' || !file) throw new TypeError('createSessions needs the file of its index.');
  const db = openStore(file);
  const select = db.prepare('SELECT * FROM sessions');
  const upsert = db.prepare('INSERT OR REPLACE INTO sessions (key, provider, id, dsh_session_id, title, cwd, state, state_since, last_activity_at, excerpt, pending_kind, pending_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM sessions WHERE key = ?');
  const rules = {};
  if (staleMs !== undefined) rules.staleMs = staleMs;
  if (runningFreshMs !== undefined) rules.runningFreshMs = runningFreshMs;

  let current = new Map(select.all().map((row) => [row.key, fromRow(row)]));
  // A DSH session id that is one session with a harness session -> that session's key. What the index held at the last run says so already: without it, from the start until the first
  // read is done (the transcripts' ends, seconds, longer when the computer is busy) a DSH key found no snapshot, and everything that asks about a session by its DSH key (an issue's agent
  // state, its question) saw something else than it had before the restart, and again when the read ended.
  let aliases = new Map([...current.values()].filter((snapshot) => snapshot.provider !== 'dsh' && snapshot.dshSessionId).map((snapshot) => [snapshot.dshSessionId, snapshot.key]));
  const tables = { claude: null, codex: null };   // the facts of the last good read of each reader; null until there was one
  let dshTable = null;                     // { entries, facts: Map<DSH session id, DSH facts>, hints: Map<native key, DSH session id> }
  const signatures = new Map();            // DSH session id -> what DSH last said of it, to read a linked harness session again when it changes
  const failures = new Map();              // job -> message
  const succeeded = new Set();             // the readers that have been read
  const baselined = new Set([...current.values()].map((s) => s.provider));
  const listeners = new Set();
  let polledAt = null;
  let storeFailure = null;
  let disposed = false;

  const dshIdOf = (provider, id, hints = dshTable?.hints) => links.get(provider, id) ?? hints?.get(`${provider}:${id}`) ?? null;
  /** A session that is not read at all: 嘟嘟's own, whichever side of it the caller knows. */
  const skipFor = (provider) => (id) => {
    if (ignore(`${provider}:${id}`)) return true;
    const dshId = provider === 'dsh' ? null : dshIdOf(provider, id);
    return Boolean(dshId) && Boolean(ignore(`dsh:${dshId}`));
  };

  // --- reading -------------------------------------------------------------------------------------------------------

  // Each source reads its reader and keeps the facts; it answers whether there was a reader to read.
  const fromReader = (provider, method) => async () => {
    const read = readers[provider]?.[method];
    if (typeof read !== 'function') return false;
    tables[provider] = await read.call(readers[provider], { skip: skipFor(provider) });
    return true;
  };
  const SOURCES = {
    'claude:live': { provider: 'claude', run: fromReader('claude', 'live') },
    'claude:scan': { provider: 'claude', run: fromReader('claude', 'scan') },
    'codex:scan': { provider: 'codex', run: fromReader('codex', 'scan') },
    'dsh:live': { provider: 'dsh', run: () => readDsh() },
  };
  const JOBS = {
    live: ['claude:live', 'dsh:live'],
    files: ['claude:scan'],
    codex: ['codex:scan'],
    all: ['claude:scan', 'codex:scan', 'dsh:live'],
  };

  async function readDsh() {
    const dsh = readers.dsh;
    if (typeof dsh?.list !== 'function' || typeof dsh.stateOf !== 'function') return false;
    const entries = ((await dsh.list()) ?? []).filter((entry) => typeof entry?.id === 'string' && entry.id && !ignore(`dsh:${entry.id}`));
    const hints = new Map(entries.filter((entry) => entry.native?.provider && entry.native.id).map((entry) => [`${entry.native.provider}:${entry.native.id}`, entry.id]));
    const wanted = new Set(entries.map((entry) => entry.id));
    // The DSH side of a harness session is asked about even when the list leaves it out.
    for (const provider of ['claude', 'codex']) {
      for (const facts of tables[provider] ?? []) {
        const dshId = dshIdOf(provider, facts.id, hints);
        if (dshId && !skipFor(provider)(facts.id)) wanted.add(dshId);
      }
    }
    const facts = new Map();
    let problem;
    await mapLimit([...wanted], 8, async (id) => {
      try { facts.set(id, (await dsh.stateOf(id)) ?? null); } catch (error) {
        problem ??= error;
        if (dshTable?.facts.has(id)) facts.set(id, dshTable.facts.get(id));   // what it said before stands
      }
    });
    dshTable = { entries, facts, hints };
    if (problem) throw problem;
    return true;
  }

  async function runSource(job) {
    try {
      if (await SOURCES[job].run()) succeeded.add(SOURCES[job].provider);
      failures.delete(job);
    } catch (error) {
      failures.set(job, error instanceof Error ? error.message : String(error));
    }
  }

  /** A harness session whose DSH side just changed is read again at once: its own reader would only look again at its next turn. */
  async function readLinkedAgain() {
    if (!dshTable) return;
    const again = { claude: [], codex: [] };
    for (const provider of ['claude', 'codex']) {
      for (const facts of tables[provider] ?? []) {
        const dshId = dshIdOf(provider, facts.id);
        if (!dshId || !dshTable.facts.has(dshId)) continue;
        const signature = JSON.stringify(dshTable.facts.get(dshId));
        if (signatures.has(dshId) && signatures.get(dshId) !== signature && !skipFor(provider)(facts.id)) again[provider].push(facts.id);
        signatures.set(dshId, signature);
      }
    }
    await Promise.all(Object.entries(again).filter(([provider, ids]) => ids.length && readers[provider]?.refresh).map(async ([provider, ids]) => {
      const job = `${provider}:refresh`;
      try {
        tables[provider] = await readers[provider].refresh(ids, { skip: skipFor(provider) });
        failures.delete(job);
      } catch (error) { failures.set(job, error instanceof Error ? error.message : String(error)); }
    }));
  }

  // --- judging -------------------------------------------------------------------------------------------------------

  function snapshotOf(key, provider, facts, dsh, dshId, at, before) {
    // An issue's agent keeps a question, a failure or a stop however old: it is idle only by the owner's word (`pinned`).
    const dshKey = provider === 'dsh' ? `dsh:${facts.id}` : dshId ? `dsh:${dshId}` : null;
    const verdict = judge(provider, { ...facts, dsh }, { now: at, ...rules, ...(dshKey && pinned(dshKey) ? { staleMs: Infinity } : {}) });
    const activity = [facts.lastActivityAt, dsh?.at].filter(Number.isFinite);
    return {
      key, provider, id: facts.id, dshSessionId: provider === 'dsh' ? facts.id : dshId, title: oneLine(facts.title ?? '', TITLE_CHARS), cwd: facts.cwd ?? null,
      state: verdict.state,
      // A state that has not changed keeps the time it began even when a reader has nothing better than its own clock to say.
      stateSince: verdict.stateSince ?? (before?.state === verdict.state ? before.stateSince : facts.updatedAt ?? at),
      lastActivityAt: activity.length ? Math.max(...activity) : facts.updatedAt ?? 0,
      excerpt: oneLine(facts.excerpt || dsh?.excerpt || '', EXCERPT_CHARS), pending: verdict.pending,
      // A transcript question is resumable history, not evidence of a process waiting on a dialog. Preserve that distinction
      // separately from `state`; live work is never inferred from the cached SQLite row after a restart.
      turnActive: Boolean(dsh?.running || dsh?.pending || verdict.state === 'running' || (provider === 'claude' && facts.process?.status === 'waiting')),
    };
  }

  /** Judge every session from the facts the readers last gave, keep the index and say what changed. Returns the number of change events. */
  function rebuild() {
    const at = now();
    const next = new Map();
    const merged = new Set();       // DSH sessions that are one session with a harness session
    const twins = new Map();
    const read = new Set();
    const hints = dshTable?.hints;
    for (const provider of ['claude', 'codex']) {
      if (!tables[provider]) continue;
      read.add(provider);
      for (const facts of tables[provider]) {
        const key = `${provider}:${facts.id}`;
        const dshId = dshIdOf(provider, facts.id, hints);
        if (dshId) merged.add(dshId);
        if (ignore(key) || (dshId && ignore(`dsh:${dshId}`))) continue;
        if (dshId) twins.set(dshId, key);
        next.set(key, snapshotOf(key, provider, facts, dshId ? dshTable?.facts.get(dshId) ?? null : null, dshId, at, current.get(key)));
      }
    }
    if (dshTable) {
      read.add('dsh');
      for (const entry of dshTable.entries) {
        if (merged.has(entry.id)) continue;
        const key = `dsh:${entry.id}`;
        const facts = { id: entry.id, title: entry.title, cwd: entry.cwd, updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : undefined };
        next.set(key, snapshotOf(key, 'dsh', facts, dshTable.facts.get(entry.id) ?? null, null, at, current.get(key)));
      }
    }
    // A reader that has not been read yet leaves what the index held of it as it was; one that is not given any more (the harness was
    // turned off) takes its sessions with it.
    for (const [key, snapshot] of current) if (!read.has(snapshot.provider) && readers[snapshot.provider]) next.set(key, snapshot);

    const events = [];
    const writes = [];
    const deletes = [];
    for (const [key, snapshot] of next) {
      const before = current.get(key);
      if (!before || !same(before, snapshot)) writes.push(snapshot);
      if (before ? before.state !== snapshot.state : baselined.has(snapshot.provider)) events.push({ key, from: before?.state ?? null, to: snapshot.state, snapshot });
    }
    for (const [key, snapshot] of current) {
      if (next.has(key)) continue;
      deletes.push(key);
      // One that became part of a harness session, or that is not to be reported any more, did not go away.
      if (read.has(snapshot.provider) && !(snapshot.provider === 'dsh' && merged.has(snapshot.id)) && !ignore(key)) events.push({ key, from: snapshot.state, to: null, snapshot });
    }
    for (const provider of read) baselined.add(provider);

    if (writes.length || deletes.length) {
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const snapshot of writes) upsert.run(...toRow(snapshot));
          for (const key of deletes) remove.run(key);
          db.exec('COMMIT');
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw error;
        }
        storeFailure = null;
      } catch (error) {
        // The index is only a copy: what is read stays right in memory when it cannot be written.
        storeFailure = error instanceof Error ? error.message : String(error);
      }
    }
    current = next;
    aliases = twins;
    for (const event of events) {
      for (const listener of [...listeners]) {
        try { listener({ ...event, snapshot: copy(event.snapshot) }); } catch { /* a listener's mistake is its own */ }
      }
    }
    return events.length;
  }

  const sourcesView = () => {
    const view = {};
    for (const provider of PROVIDERS) {
      if (!readers[provider]) continue;
      const problem = [...failures].find(([job]) => job.startsWith(`${provider}:`));
      view[provider] = problem ? `error: ${problem[1]}` : succeeded.has(provider) ? 'ok' : 'pending';
    }
    return view;
  };
  const report = () => ({ outcome: 'success', sources: sourcesView(), polledAt });

  // --- the queue: one read at a time, so a slow read can never overwrite what a newer one found -----------------------

  let chain = Promise.resolve();
  const waiting = new Map();   // kind -> the read that has not started yet, which a second request for the same kind joins

  async function run(kind, keys) {
    if (disposed) return report();
    if (keys) {
      const ids = { claude: [], codex: [] };
      for (const key of keys) { const [, provider, id] = KEY.exec(key) ?? []; if (ids[provider]) ids[provider].push(id); }
      await Promise.all(Object.entries(ids).filter(([provider, list]) => list.length && readers[provider]?.refresh).map(async ([provider, list]) => {
        const job = `${provider}:refresh`;
        try { tables[provider] = await readers[provider].refresh(list, { skip: skipFor(provider) }); failures.delete(job); } catch (error) { failures.set(job, error instanceof Error ? error.message : String(error)); }
      }));
      await runSource('dsh:live');
    } else {
      // DSH last: which DSH sessions belong to harness sessions is known from what the harness readers just gave.
      await Promise.all(JOBS[kind].filter((job) => job !== 'dsh:live').map(runSource));
      if (JOBS[kind].includes('dsh:live')) await runSource('dsh:live');
      if (kind === 'live' || kind === 'all') await readLinkedAgain();
    }
    const changes = rebuild();
    polledAt = now();
    return { ...report(), changes };
  }

  function enqueue(kind, keys) {
    if (disposed) return Promise.resolve({ outcome: 'no_op', message: 'The index was closed.', sources: sourcesView(), polledAt });
    if (!keys && waiting.has(kind)) return waiting.get(kind);
    const promise = chain.then(() => { if (!keys) waiting.delete(kind); return run(kind, keys); }).catch((error) => failure(error));
    if (!keys) waiting.set(kind, promise);
    chain = promise.then(() => undefined);
    return promise;
  }

  function poll({ kind = 'all' } = {}) {
    if (!Object.hasOwn(JOBS, kind)) return Promise.resolve(clarify(`kind must be one of: ${Object.keys(JOBS).join(', ')}`));
    return enqueue(kind);
  }

  // --- the timers ----------------------------------------------------------------------------------------------------

  const timers = [];
  if (intervals !== false) {
    const every = { ...DEFAULT_INTERVALS, ...intervals };
    const wanted = { live: Boolean(readers.claude?.live || readers.dsh), files: Boolean(readers.claude?.scan), codex: Boolean(readers.codex?.scan) };
    for (const kind of Object.keys(DEFAULT_INTERVALS)) {
      if (wanted[kind] && every[kind] > 0) timers.push(setInterval(() => { void enqueue(kind); }, every[kind]).unref());
    }
    void enqueue('all');
  }

  // --- what is asked of it -------------------------------------------------------------------------------------------

  function snapshots({ state, provider, limit = 1000 } = {}) {
    const states = state == null ? null : [state].flat();
    if (states && states.some((item) => !SESSION_STATES.includes(item))) return clarify(`state must be one of: ${SESSION_STATES.join(', ')}`);
    if (provider != null && !PROVIDERS.includes(provider)) return clarify(`provider must be one of: ${PROVIDERS.join(', ')}`);
    const found = [...current.values()].filter((s) => (!states || states.includes(s.state)) && (!provider || s.provider === provider))
      .sort((a, b) => (b.lastActivityAt - a.lastActivityAt) || (a.key < b.key ? -1 : 1));
    return {
      outcome: 'success', snapshots: found.slice(0, whole(limit, 1, 5000, 1000)).map(copy), total: found.length, sources: sourcesView(), polledAt,
      store: storeFailure ? `error: ${storeFailure}` : 'ok',
    };
  }

  /** The session a key names: a DSH session that is one with a harness session is that session. */
  const resolve = (key) => {
    if (typeof key !== 'string') return key;
    if (current.has(key)) return key;
    return key.startsWith('dsh:') ? aliases.get(key.slice(4)) ?? key : key;
  };
  const stateOf = (key) => current.get(resolve(key))?.state ?? null;

  function onChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('onChange needs a function.');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function read(key, { turns, chars } = {}) {
    const target = resolve(key);
    const snapshot = current.get(target);
    if (!snapshot) return clarify(`There is no session ${String(key).slice(0, 80)}.`, 'List the sessions with sessions_list.');
    const reader = readers[snapshot.provider];
    if (typeof reader?.read !== 'function') return clarify(`Sessions of ${snapshot.provider} cannot be read here.`);
    const count = whole(turns, 1, READ_TURNS.max, READ_TURNS.fallback);
    const budget = whole(chars, READ_CHARS.min, READ_CHARS.max, READ_CHARS.fallback);
    let found;
    try { found = await reader.read(snapshot.id, { turns: count }); } catch (error) { return failure(error, 'Try again later, or list the sessions again.'); }
    // Newest turns first into the budget; what does not fit is cut or left out, and the answer says so.
    let used = 0;
    let truncated = Boolean(found?.more);
    const kept = [];
    const fit = (text, limit) => {
      const whole_ = String(text ?? '');
      if (whole_.length <= limit) return whole_;
      truncated = true;
      return `${whole_.slice(0, Math.max(0, limit))}…`;
    };
    for (const turn of [...(found?.turns ?? [])].reverse()) {
      const room = budget - used;
      if (room <= 0) { truncated = true; break; }
      const prompt = fit(turn.prompt, Math.min(MESSAGE_CHARS, room));
      const reply = fit(turn.reply, Math.min(MESSAGE_CHARS, room - prompt.length));
      used += prompt.length + reply.length;
      kept.unshift({ at: Number.isFinite(turn.at) ? turn.at : null, prompt, reply, tools: Array.isArray(turn.tools) ? turn.tools.slice(0, 20) : [] });
    }
    return { outcome: 'success', key: target, provider: snapshot.provider, source: target, content: 'data', turns: kept, truncated };
  }

  // --- opening, closing, resuming, talking: the runners do it, this checks and looks again -----------------------------

  async function afterwards(key) {
    await enqueue('live', [resolve(key)]).catch(() => {});
    return copy(current.get(resolve(key))) ?? null;
  }

  async function act(key, what, input, call) {
    const match = typeof key === 'string' ? KEY.exec(key) : null;
    if (!match) return clarify('key must look like claude:<id>, codex:<id> or dsh:<id>.', 'Use a key from sessions_list.');
    const runner = runners[match[1]];
    if (typeof runner?.[what] !== 'function') return clarify(`There is no way to ${what} a ${match[1]} session here.`);
    const before = current.get(resolve(key));
    const early = input(before);
    if (early) return early;
    let result;
    try { result = await call(runner); } catch (error) { return failure(error, 'Check the session, then try again.'); }
    const snapshot = await afterwards(key);
    if (result && typeof result === 'object' && ['no_op', 'needs_clarification', 'error'].includes(result.outcome)) return { ...result, key, snapshot };
    return { outcome: 'success', key, provider: match[1], snapshot };
  }

  async function open({ provider, cwd, firstMessage, access } = {}) {
    if (!PROVIDERS.includes(provider)) return clarify(`provider must be one of: ${PROVIDERS.join(', ')}`);
    const runner = runners[provider];
    if (typeof runner?.start !== 'function') return clarify(`There is no way to start a ${provider} session here.`);
    if (typeof cwd !== 'string' || !cwd.trim()) return clarify('cwd must be the folder the session works in.');
    if (typeof firstMessage !== 'string' || !firstMessage.trim()) return clarify('firstMessage must be the text the session starts with.');
    if (firstMessage.length > SEND_CHARS) return clarify(`firstMessage must be at most ${SEND_CHARS} characters.`);
    const mode = access ?? 'read-only';
    if (!ACCESS_MODES.includes(mode)) return clarify(`access must be one of: ${ACCESS_MODES.join(', ')}`);
    let started;
    try { started = await runner.start({ cwd, firstMessage, access: mode }); } catch (error) { return failure(error, 'Check that the harness is installed and enabled, then try again.'); }
    const key = started?.key;
    if (typeof key !== 'string' || !key.startsWith(`${provider}:`) || key.length === provider.length + 1) return failure('The runner did not say which session it started.');
    return { outcome: 'success', key, provider, snapshot: await afterwards(key) };
  }

  const close = (key, { force = false } = {}) => act(key, 'close', (before) => (before?.state === 'running' && !force
    ? clarify('The session is running; closing it now would interrupt it.', 'Wait until it stops, or call again with force: true.') : null), (runner) => runner.close(key));

  const resume = (key) => act(key, 'resume', (before) => (before?.state === 'running'
    ? { outcome: 'no_op', message: 'The session is running already.', key, snapshot: copy(before) } : null), (runner) => runner.resume(key));

  const send = (key, text) => act(key, 'send', () => {
    if (typeof text !== 'string' || !text.trim()) return clarify('text must be what to say to the session.');
    if (text.length > SEND_CHARS) return clarify(`text must be at most ${SEND_CHARS} characters.`);
    return null;
  }, (runner) => runner.send(key, text));

  async function dispose() {
    if (disposed) return;
    disposed = true;
    for (const timer of timers) clearInterval(timer);
    listeners.clear();
    await chain.catch(() => {});
    db.close();
  }

  return { snapshots, snapshotOf: (key) => copy(current.get(resolve(key))) ?? null, onChange, read, open, close, resume, send, stateOf, poll, dispose };
}
