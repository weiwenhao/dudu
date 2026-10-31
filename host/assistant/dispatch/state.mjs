// intake.json: what intake remembers between runs (<DSH_HOME>/dudu/assistant/intake.json), written by the program only.
//
//   v          1
//   lastRunAt  when the last run that read anything ended
//   outputs    "<connector>/<operation>" -> { hash, at }: the output that was last dealt with in full. An output with the same hash costs no model call
//   tries      "<connector>/<operation>" -> { hash, n }: how often the model answered this output with something unusable; after 3 the output is let go
//   refs       "<connector>:<ref>" -> issue id: every message that became an issue, so that it never becomes one twice (the issue may be gone, or done)
//   reads      "<connector>" -> { at, ok, items, created, error? }: the last read of each connector, for the Inputs widget
//   today      { date: 'YYYY-MM-DD' (local), connectors: { "<connector>": { read, created } } }: the day's counters, started again each day
//
// A file that is missing or cannot be used (not JSON, wrong shape, from a newer app) is moved aside (intake.json.bad-<ms>) when there is
// one, and the refs are read again from the issues that came from connectors, so that losing the file does not make every message in
// every output become an issue a second time. The file is written through a temporary file and a rename.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const VERSION = 1;
const MAX_REFS = 20_000;
const MAX_OUTPUTS = 1_000;
const REBUILD_PAGES = 50; // of 200 issues: the most recent 10 000 that came from a connector

const pad = (n) => String(n).padStart(2, '0');
/** The local calendar date of a time in ms, 'YYYY-MM-DD'. */
export const dayOf = (ms) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const own = (object, test) => Object.fromEntries(Object.entries(object).filter(([, value]) => test(value)));
const blank = () => ({ v: VERSION, lastRunAt: null, outputs: {}, tries: {}, refs: {}, reads: {}, today: { date: '', connectors: {} } });

function normalize(parsed) {
  const found = blank();
  found.lastRunAt = Number.isSafeInteger(parsed.lastRunAt) ? parsed.lastRunAt : null;
  found.outputs = own(isObject(parsed.outputs) ? parsed.outputs : {}, (entry) => isObject(entry) && typeof entry.hash === 'string');
  found.tries = own(isObject(parsed.tries) ? parsed.tries : {}, (entry) => isObject(entry) && typeof entry.hash === 'string' && Number.isSafeInteger(entry.n));
  found.refs = own(isObject(parsed.refs) ? parsed.refs : {}, (id) => Number.isSafeInteger(id) && id > 0);
  found.reads = own(isObject(parsed.reads) ? parsed.reads : {}, (entry) => isObject(entry) && Number.isSafeInteger(entry.at) && typeof entry.ok === 'boolean');
  for (const entry of Object.values(found.reads)) {
    entry.items = count(entry.items);
    entry.created = count(entry.created);
    if (typeof entry.error !== 'string') delete entry.error;
  }
  if (isObject(parsed.today) && typeof parsed.today.date === 'string' && isObject(parsed.today.connectors)) {
    found.today = {
      date: parsed.today.date,
      connectors: Object.fromEntries(Object.entries(parsed.today.connectors).filter(([, entry]) => isObject(entry)).map(([id, entry]) => [id, { read: count(entry.read), created: count(entry.created) }])),
    };
  }
  return found;
}

export function createIntakeState({ file, now, issues }) {
  let data = null;

  // The refs of the issues that came from connectors, newest first: what the file would have said.
  function refsFromIssues() {
    const refs = {};
    let cursor;
    for (let page = 0; page < REBUILD_PAGES; page++) {
      const result = issues.list({ tab: 'all', filter: { source: ['connector'] }, order: 'created', limit: 200, ...(cursor ? { cursor } : {}) });
      if (result.outcome !== 'success') break;
      for (const issue of result.items) if (issue.sourceRef && !Object.hasOwn(refs, issue.sourceRef)) refs[issue.sourceRef] = issue.id;
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return refs;
  }

  function setAside() {
    for (let n = 0; n < 100; n++) {
      try {
        renameSync(file, `${file}.bad-${now()}${n ? `-${n}` : ''}`);
        return;
      } catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') return; // it could not be moved: the next save replaces it
      }
    }
  }

  function load() {
    if (data) return data;
    let text = null;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') setAside();
    }
    let parsed = null;
    if (text !== null) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (!isObject(parsed) || parsed.v !== VERSION) {
        parsed = null;
        setAside();
      }
    }
    if (parsed) return (data = normalize(parsed));
    data = blank();
    try {
      data.refs = refsFromIssues();
    } catch { /* the store is not readable either: the first run will say so */ }
    return data;
  }

  function save() {
    const kept = load();
    for (const name of ['refs', 'outputs']) {
      const limit = name === 'refs' ? MAX_REFS : MAX_OUTPUTS;
      const keys = Object.keys(kept[name]);
      for (const key of keys.slice(0, Math.max(0, keys.length - limit))) delete kept[name][key]; // the oldest first: insertion order
    }
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(kept)}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  /** The counters of today, for writing: a new day starts them again. */
  function today(at) {
    const kept = load();
    const date = dayOf(at);
    if (kept.today.date !== date) kept.today = { date, connectors: {} };
    return kept.today;
  }

  /** The counters of today, for reading: the same, without starting a new day. */
  function peekToday(at) {
    const kept = load();
    return kept.today.date === dayOf(at) ? kept.today : { date: dayOf(at), connectors: {} };
  }

  return { load, save, today, peekToday };
}
