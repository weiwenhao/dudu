// 嘟嘟's memory (docs/assistant.md 3.5, 3.7): the Markdown files of the project folder, the index of the conversation, the skills.
//
//   const memory = createMemory({ dir, indexDir, llm = null, now = Date.now });
//
//   dir       the project folder (the caller has validated it: project.mjs). Files are read from and written to it, nothing else.
//   indexDir  the folder of turns.db (<DSH_HOME>/dudu/assistant/index). Throws SchemaTooNew (code 'SCHEMA_TOO_NEW') if turns.db is
//             from a newer app. Without turns.db the history is gone (the DSH conversation log can be fed to capture again:
//             a turn with the same `key` is never indexed twice).
//   llm       async (messages: [{ role: 'system' | 'user', content }]) -> string. The only way a model is used: one call to
//             rewrite a question (recall, lane 2) and one per tidy. Without it both are simply not done. A failing llm never makes
//             a call throw. The library never imports DSH and never logs.
//
// Every operation answers { outcome: 'success' | 'no_op' | 'needs_clarification' | 'error', message?, next?, ... }; wrong input
// never throws, only database failures do. The message and next texts are written for the model that calls the tools. Times are
// ms UTC; dates are local ('YYYY-MM-DD').
//
//   capture({ role | src, text, at?, session?, key? })       sync
//       Indexes one turn: src is 'owner' or 'dudu' (role is a synonym), the text in full, at (default now), the DSH session it
//       belongs to, key = the caller's own id of the message (makes capture idempotent). Tool results and content from sessions or
//       connectors are NOT conversation: any other src is a no_op. -> { id, ref: 'turn:<id>', date, truncated? } or no_op.
//   recall(query, { limit = 10, maxChars = 1200 })           async
//       Lane 1, no model: BM25 over the words of the question; the best `limit` turns, oldest first, each { id, ref, at, date,
//       src, rank, text, truncated? }. Lane 2, only if an llm was given AND lane 1 found nothing AND the question is about the past
//       (上次, 之前, 昨天, last time, ...): one rewrite call, then the same search. -> { lane: 1 | 2, hits, rewritten? }.
//   remember({ text, supersedes?, file?, src? })              sync
//       Writes at once. file 'USER' (preferences) or 'MEMORY' (facts and decisions, the default). supersedes = the id of an
//       active entry (m3, u2): it must exist, the new entry goes into its file and it is marked superseded in place. src =
//       'turn:<id>' (or a list): where it came from, it must be the owner's own words, so at least one owner turn or 'owner'
//       (default: the latest owner turn). Refused with needs_clarification: text that looks like a password, key, token or card
//       number (secrets.mjs lists the patterns; the value is never echoed), text over 800 characters or containing <!-- or -->,
//       an unknown supersedes, a source that is not the owner's conversation (sessions, connectors), a file over its budget.
//       -> { record: { id, file, since, status, src, text }, superseded? }; the same text twice is a no_op.
//   context()                                                 sync
//       What every turn sees from memory: AGENTS.md, SOUL.md, USER.md (4000 characters), MEMORY.md (8000), the skill names with a
//       line each. -> { text, files: [{ name, text, chars, truncated, missing, error? }], skills: [{ name, description }] }. USER and
//       MEMORY show active entries only; over budget the oldest go first. AGENTS.md and SOUL.md are whole, up to 20000 characters.
//       A file that is missing or cannot be read is reported in its slot (missing / error) and does not stop the others.
//       The issue summary, the recalled turns and TRIAGE.md/ASSIGN.md (rules()) are not part of it.
//   forget({ source, preview = true })                        sync
//       source = 'turn:<id>' | 'session:<key>' | 'record:<id>' (or a list). preview (the default: only an explicit false deletes)
//       lists what would go: the raw turns, the entries that cite them, lines of the day's flow, review items, skills, staged notes
//       and the search index rows. preview: false deletes all of it, then rebuilds the index and compacts the file. A record
//       source also takes the turns it cites. -> a preview { preview: true, turns, entries, logLines, skills, reviews, staged,
//       indexRows, counts, next } (each list shows at most 50 items with short excerpts, secrets blanked; `counts` are the true
//       numbers), a deletion { preview: false, deleted: { turns, indexRows, entries, logLines, skills, reviews, staged } }.
//       DSH's own conversation log (and its compaction summary) is outside this library: the caller has to deal with it.
//   records({ file?, status?, q? })                           sync     -> { records: [{ id, file, since, status, src, text }], total, budget }
//   update(id, { text?, status? })                            sync     the owner's edit from the settings page -> { record }
//   tidy({ apply = false, maxTurns? })                        async    see tidy.mjs -> { applied, review, summary, ops, staged, questions, skipped }
//   undoReview(id), reviews({ limit })                        sync     put a tidy back (entries edited since are left alone and listed in `skipped`)
//   rules()                                                   sync     -> { rules: { 'TRIAGE.md': text | null, 'ASSIGN.md': text | null } } (read only)
//   skills.list() / skills.read(name) / skills.remove(name)   sync     only the tidy creates skills
//   close()
import { join } from 'node:path';
import { checkEntryText, CURATED, curatedOf, dayOf, EntryTextError, FileError, findEntry, createFiles, nextId, parseCurated, renderContext, renderEntry, serializeCurated, stripComments } from './files.mjs';
import { redact } from './secrets.mjs';
import { createSkills } from './skills.mjs';
import { createTidy, flowLine, turnRefs, WORD } from './tidy.mjs';
import { CONVERSATION, createTurns, MAX_TURN_CHARS, queryTerms, SchemaTooNew } from './turns.mjs';

export { SchemaTooNew };
export const BUDGETS = { USER: CURATED.USER.budget, MEMORY: CURATED.MEMORY.budget };
const RULE_FILE_CHARS = 20_000;
const PREVIEW_ITEMS = 50; // a forget preview lists this many of each kind (with the true counts), so a whole session stays readable
const HIT_CHARS = 1200;
// A question about the past: lane 2 is only tried for these.
const ASKS_ABOUT_PAST = /上次|之前|以前|昨天|前天|上周|上星期|上个月|前几天|那天|刚才|刚刚|还记得|记不记得|说过|聊过|讲过|提到过|提过|当时|去年|earlier|last time|last week|last month|yesterday|before|previously|remember when|did i (?:say|tell|mention)|what did (?:we|i)|we (?:talked|discussed|decided)/i;
const REWRITE = 'Rewrite a question about something said earlier into search words that the original messages are likely to contain. Reply with ONE line of space-separated words in the language of the question, with likely synonyms. No explanation.';

class Invalid extends Error {
  constructor(message, next = 'Correct the value and call again.') {
    super(message);
    this.next = next;
  }
}
class Missing extends Error {}

const normText = (text) => String(text).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const excerpt = (text, max = 60) => {
  const flat = redact(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const success = (extra) => ({ outcome: 'success', ...extra });
const noOp = (message, extra) => ({ outcome: 'no_op', message, ...extra });

function failure(error) {
  if (error instanceof Invalid) return { outcome: 'needs_clarification', message: error.message, next: error.next };
  if (error instanceof EntryTextError) return { outcome: 'needs_clarification', message: error.message, next: 'Change the text and call again.' };
  if (error instanceof Missing) return { outcome: 'error', message: error.message, next: 'List the records to find the id.' };
  if (error instanceof FileError) return { outcome: 'error', code: error.code, message: error.message, next: 'Check the project folder in the settings, then try again.' };
  throw error;
}
// Input mistakes and file trouble become results; only database failures throw.
const guarded = (method) => (...args) => {
  try {
    return method(...args);
  } catch (error) {
    return failure(error);
  }
};
const guardedAsync = (method) => async (...args) => {
  try {
    return await method(...args);
  } catch (error) {
    return failure(error);
  }
};

const toRecord = (entry, file) => ({ id: entry.id, file, since: entry.since, status: entry.status, src: entry.src, text: entry.text });
const fileName = (value, fallback = null) => {
  if (value == null || value === '') return fallback;
  const name = String(value).toUpperCase().replace(/\.MD$/, '');
  if (!Object.hasOwn(CURATED, name)) throw new Invalid('file must be USER or MEMORY');
  return name;
};

export function createMemory({ dir, indexDir, llm = null, now = Date.now }) {
  if (typeof dir !== 'string' || !dir || typeof indexDir !== 'string' || !indexDir) throw new TypeError('createMemory needs dir (the project folder) and indexDir (the folder of turns.db).');
  const files = createFiles({ dir });
  const turns = createTurns({ file: join(indexDir, 'turns.db'), now });
  const skills = createSkills({ files, now });
  const tidy = createTidy({ turns, files, skills, llm, now });

  const flow = (at, label, subject, body, src) => {
    try {
      files.appendDaily(dayOf(at), flowLine(at, label, subject, body, src));
    } catch {} // the entry is written; the flow is a convenience
  };

  // --- the conversation
  function capture(turn) {
    const input = turn !== null && typeof turn === 'object' ? turn : {};
    if (typeof input.text !== 'string') throw new Invalid('text must be the message as text');
    const src = input.src ?? input.role;
    if (!CONVERSATION.includes(src)) return noOp("Only the owner's and 嘟嘟's own messages are indexed: not tool results, and not content that came from sessions or connectors.");
    const full = input.text.replace(/\r\n?/g, '\n').trim();
    if (!full) return noOp('Nothing to index: the message is empty.');
    const at = input.at ?? now();
    if (!Number.isSafeInteger(at) || at < 0) throw new Invalid('at must be a time in milliseconds');
    for (const [name, max] of [['session', 300], ['key', 200]]) {
      if (input[name] != null && (typeof input[name] !== 'string' || input[name].length > max)) throw new Invalid(`${name} must be text of at most ${max} characters`);
    }
    const text = full.slice(0, MAX_TURN_CHARS);
    const { id, existing, forgotten } = turns.add({ src, text, at, session: input.session ?? null, key: input.key ?? null });
    if (forgotten) return noOp('This message was forgotten.');
    if (existing) return noOp('This message was indexed before.', { id, ref: `turn:${id}` });
    return success({ id, ref: `turn:${id}`, date: dayOf(at), ...(text.length < full.length ? { truncated: true } : {}) });
  }

  const toHit = (turn, maxChars) => ({
    id: turn.id, ref: `turn:${turn.id}`, at: turn.at, date: dayOf(turn.at), src: turn.src, rank: turn.rank,
    text: turn.text.slice(0, maxChars), ...(turn.text.length > maxChars ? { truncated: true } : {}),
  });

  async function recall(query, options) {
    const { limit = 10, maxChars = HIT_CHARS } = options ?? {};
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Invalid('limit must be a whole number from 1 to 50');
    if (!Number.isInteger(maxChars) || maxChars < 50 || maxChars > 20_000) throw new Invalid('maxChars must be a whole number from 50 to 20000');
    const text = typeof query === 'string' ? query : '';
    if (!queryTerms(text).length) throw new Invalid('The question needs at least one word.');
    let hits = turns.search(text, limit);
    if (hits.length || typeof llm !== 'function' || !ASKS_ABOUT_PAST.test(text)) return success({ lane: 1, hits: hits.map((turn) => toHit(turn, maxChars)) });
    try {
      const reply = await llm([{ role: 'system', content: REWRITE }, { role: 'user', content: text }]);
      const rewritten = String(reply ?? '').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 300) ?? '';
      if (!queryTerms(rewritten).length) return success({ lane: 1, hits: [] });
      hits = turns.search(rewritten, limit);
      return success({ lane: 2, rewritten, hits: hits.map((turn) => toHit(turn, maxChars)) });
    } catch {
      return success({ lane: 1, hits: [], message: 'The question could not be rewritten.' }); // a model failure is not the caller's problem
    }
  }

  // --- what every turn sees
  // A file that is missing or cannot be read is reported in its slot; it never takes the other files down with it.
  function contextOf(name, show) {
    const none = { name, text: '', chars: 0, truncated: false, missing: false };
    try {
      const found = files.read(name);
      return found ? { ...none, ...show(found.text) } : { ...none, missing: true };
    } catch (error) {
      if (error instanceof FileError) return { ...none, error: error.message };
      throw error;
    }
  }

  function context() {
    const parts = [];
    const out = [];
    for (const name of ['AGENTS.md', 'SOUL.md']) {
      out.push(contextOf(name, (raw) => {
        const whole = stripComments(raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).trim();
        const text = whole.slice(0, RULE_FILE_CHARS);
        return { text, chars: text.length, truncated: whole.length > text.length };
      }));
    }
    for (const key of ['USER', 'MEMORY']) {
      out.push(contextOf(CURATED[key].file, (raw) => {
        const shown = renderContext(parseCurated(raw), CURATED[key].budget);
        return { text: shown.text, chars: shown.chars, truncated: shown.truncated };
      }));
    }
    for (const file of out) if (file.text) parts.push(`--- ${file.name} ---\n${file.text}`);
    const list = skills.list().map(({ name, description }) => ({ name, description }));
    if (list.length) parts.push(`--- skills ---\n${list.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n')}`);
    return success({ text: parts.join('\n\n'), files: out, skills: list });
  }

  // --- writing entries
  function sourcesOf(raw) {
    const list = raw == null || raw === '' ? [] : Array.isArray(raw) ? raw : [raw];
    if (!list.length) {
      const last = turns.lastOwner();
      return last ? [`turn:${last.id}`] : ['owner'];
    }
    const out = [];
    for (const item of list) {
      const ref = typeof item === 'string' ? item.trim() : '';
      const match = /^turn:(\d{1,15})$/.exec(ref);
      const turn = match ? turns.get(Number(match[1])) : null;
      if (ref === 'owner') out.push('owner');
      else if (turn && CONVERSATION.includes(turn.src)) out.push(`turn:${turn.id}`);
      else if (turn) throw new Invalid(`Turn ${turn.id} is not part of the conversation with the owner.`, "Cite the owner's turn and call again.");
      else if (match) throw new Invalid(`There is no turn ${match[1]} in the history.`, 'Use the ref of a turn that was captured.');
      else {
        throw new Invalid(
          `"${excerpt(String(item), 40)}" is not a source the memory accepts. Only the owner's own words count: pass turn:<id> of what the owner said. Content from sessions and connectors is material, not memory: put it in an issue.`,
          'Cite the owner\'s turn and call again.',
        );
      }
    }
    const unique = [...new Set(out)];
    const ownerSaid = unique.some((ref) => ref === 'owner' || turns.get(Number(ref.slice(5)))?.src === 'owner');
    if (!ownerSaid) throw new Invalid("Only what the owner said can be remembered, and none of these sources is the owner's turn.", "Cite the owner's turn and call again.");
    return unique;
  }

  const tooFull = (cfg, used) => new Invalid(`${cfg.file} is full (${used} of ${cfg.budget} characters). Forget or shorten an entry first.`, 'Forget or shorten an entry, then call again.');

  function remember(input) {
    const body = input !== null && typeof input === 'object' ? input : {};
    const text = checkEntryText(body.text);
    let name = fileName(body.file);
    const replaces = body.supersedes == null || body.supersedes === '' ? null : String(body.supersedes).trim();
    if (replaces) {
      const owner = curatedOf(replaces);
      if (!owner) throw new Invalid(`"${excerpt(replaces, 40)}" is not an entry id; ids look like m3 or u2.`, 'Take the id from the entries in context, or leave supersedes out.');
      if (name && name !== owner) throw new Invalid(`${replaces} is in ${CURATED[owner].file}; the new entry has to go there too.`);
      name = owner;
    }
    name ??= 'MEMORY';
    const src = sourcesOf(body.src);
    const cfg = CURATED[name];
    const at = now();
    let done = null;
    files.modify(cfg.file, (current) => {
      const parsed = parseCurated(current);
      const sizeBefore = renderContext(parsed).chars;
      const old = replaces ? findEntry(parsed, replaces) : null;
      if (replaces && !old) throw new Invalid(`There is no entry ${replaces}.`, 'Take the id from the entries in context, or leave supersedes out.');
      if (old && old.status !== 'active') throw new Invalid(`${replaces} was already replaced.`, 'Replace the entry that replaced it, or leave supersedes out.');
      const same = parsed.entries.find((entry) => entry.status === 'active' && normText(entry.text) === normText(text));
      if (same) {
        done = { duplicate: same };
        return null;
      }
      const entry = { id: nextId(parsed, cfg.prefix), since: dayOf(at), status: 'active', src, text };
      if (old) old.status = 'superseded';
      parsed.entries.push(entry);
      const size = renderContext(parsed).chars;
      if (size > cfg.budget && size > sizeBefore) throw tooFull(cfg, sizeBefore);
      done = { entry };
      return { text: serializeCurated(parsed) };
    });
    if (done.duplicate) return noOp(`Already remembered as ${done.duplicate.id}.`, { record: toRecord(done.duplicate, name) });
    flow(at, WORD.remembered, replaces ? `[${replaces}] → [${done.entry.id}] ${name}` : `[${done.entry.id}] ${name}`, text, src);
    return success({ record: toRecord(done.entry, name), ...(replaces ? { superseded: replaces } : {}) });
  }

  function records(options) {
    const { file, status, q } = options ?? {};
    const names = file == null ? ['USER', 'MEMORY'] : [fileName(file)];
    if (status != null && !['active', 'superseded'].includes(status)) throw new Invalid('status must be active or superseded');
    const parts = typeof q === 'string' ? q.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const found = [];
    for (const name of names) {
      for (const entry of files.readCurated(name).entries) {
        if (status && entry.status !== status) continue;
        if (parts.length && !parts.every((part) => entry.text.toLowerCase().includes(part) || entry.id === part)) continue;
        found.push(toRecord(entry, name));
      }
    }
    const budget = Object.fromEntries(['USER', 'MEMORY'].map((name) => [name, { used: renderContext(files.readCurated(name)).chars, limit: CURATED[name].budget }]));
    return success({ records: found, total: found.length, budget });
  }

  function update(id, patch) {
    const entryId = String(id ?? '').trim();
    const name = curatedOf(entryId);
    if (!name) throw new Invalid(`"${excerpt(entryId, 40)}" is not an entry id; ids look like m3 or u2.`);
    const changes = patch !== null && typeof patch === 'object' ? patch : {};
    for (const key of Object.keys(changes)) if (!['text', 'status'].includes(key)) throw new Invalid(`Unknown field "${excerpt(key, 30)}". Allowed: text, status.`);
    if (changes.text === undefined && changes.status === undefined) throw new Invalid('Give the new text or status.');
    const text = changes.text === undefined ? undefined : checkEntryText(changes.text);
    if (changes.status !== undefined && !['active', 'superseded'].includes(changes.status)) throw new Invalid('status must be active or superseded');
    const cfg = CURATED[name];
    const at = now();
    let record = null;
    const { changed } = files.modify(cfg.file, (current) => {
      const parsed = parseCurated(current);
      const entry = findEntry(parsed, entryId);
      if (!entry) throw new Missing(`There is no entry ${entryId}.`);
      const sizeBefore = renderContext(parsed).chars;
      const before = renderEntry(entry);
      if (text !== undefined) entry.text = text;
      if (changes.status !== undefined) entry.status = changes.status;
      if (renderEntry(entry) === before) {
        record = toRecord(entry, name);
        return null;
      }
      const size = renderContext(parsed).chars;
      if (size > cfg.budget && size > sizeBefore) throw tooFull(cfg, sizeBefore);
      record = toRecord(entry, name);
      return { text: serializeCurated(parsed) };
    });
    if (!changed) return noOp(`${entryId} already says that.`, { record });
    if (text !== undefined) flow(at, WORD.edited, `[${entryId}]`, text, ['owner']);
    return success({ record });
  }

  // --- forgetting
  function parseSources(source) {
    const list = Array.isArray(source) ? source : [source];
    if (!list.length || list.length > 100) throw new Invalid('source is one or more of turn:<id>, session:<key>, record:<id>');
    return list.map((item) => {
      const match = /^(turn|session|record):(.+)$/s.exec(String(item ?? '').trim());
      if (!match || !match[2].trim()) throw new Invalid(`"${excerpt(String(item), 40)}" is not a source. Use turn:<id>, session:<key> or record:<id>.`, 'Take the ref from recall, or the id from the records.');
      return { kind: match[1], value: match[2].trim() };
    });
  }

  // What the sources stand for: turn ids (their own, a session's, a record's cited turns) and record ids.
  function resolve(sources) {
    const turnIds = new Set();
    const recordIds = new Set();
    const missing = [];
    for (const { kind, value } of sources) {
      if (kind === 'turn') {
        if (/^\d{1,15}$/.test(value) && turns.get(Number(value))) turnIds.add(Number(value));
        else missing.push(`turn:${value}`);
      } else if (kind === 'session') {
        const found = turns.bySession(value);
        if (found.length) for (const turn of found) turnIds.add(turn.id);
        else missing.push(`session:${value}`);
      } else {
        const name = curatedOf(value);
        const entry = name ? findEntry(files.readCurated(name), value) : null;
        if (!entry) {
          missing.push(`record:${value}`);
          continue;
        }
        recordIds.add(entry.id);
        for (const ref of entry.src) {
          const turn = /^turn:(\d+)$/.exec(ref);
          if (turn && turns.get(Number(turn[1]))) turnIds.add(Number(turn[1]));
        }
      }
    }
    return { turnIds, recordIds, missing };
  }

  function forget(input) {
    const body = input !== null && typeof input === 'object' ? input : {};
    const { turnIds, recordIds, missing } = resolve(parseSources(body.source));
    if (!turnIds.size && !recordIds.size) return noOp(`Nothing matches ${missing.map((m) => excerpt(m, 40)).join(', ')}.`);
    const refSet = new Set(turnRefs([...turnIds]));
    const entries = [];
    for (const name of ['USER', 'MEMORY']) {
      for (const entry of files.readCurated(name).entries) if (recordIds.has(entry.id) || entry.src.some((ref) => refSet.has(ref))) entries.push({ ...entry, file: name });
    }
    const entryIds = new Set(entries.map((entry) => entry.id));
    const dailyHit = (line) => {
      for (const found of line.matchAll(/turn:(\d+)/g)) if (turnIds.has(Number(found[1]))) return true;
      for (const found of line.matchAll(/\[([um]\d+)\]/g)) if (entryIds.has(found[1])) return true;
      return false;
    };
    const logLines = files.findDailyLines(dailyHit);
    const skillNames = skills.citing(turnIds);
    const stagedIds = turns.stagedCiting(turnIds);
    const reviewHits = tidy.reviewsCiting({ turnIds: [...turnIds], entryIds: [...entryIds], skillNames });
    const found = turns.byIds(turnIds);
    const indexRows = turns.indexed(turnIds);

    if (body.preview !== false) {
      return success({
        preview: true,
        turns: [...found.values()].sort((a, b) => a.id - b.id).slice(0, PREVIEW_ITEMS).map((turn) => ({ id: turn.id, ref: `turn:${turn.id}`, at: turn.at, date: dayOf(turn.at), src: turn.src, excerpt: excerpt(turn.text) })),
        entries: entries.slice(0, PREVIEW_ITEMS).map((entry) => ({ id: entry.id, file: entry.file, status: entry.status, excerpt: excerpt(entry.text) })),
        logLines: logLines.slice(0, PREVIEW_ITEMS).map(({ day, line }) => ({ day, excerpt: excerpt(line, 80) })),
        skills: skillNames.slice(0, PREVIEW_ITEMS).map((name) => ({ name, description: skills.read(name)?.description ?? '' })),
        reviews: reviewHits.slice(0, PREVIEW_ITEMS), staged: stagedIds.length, indexRows,
        counts: { turns: found.size, entries: entries.length, logLines: logLines.length, skills: skillNames.length, reviews: reviewHits.length },
        ...(missing.length ? { notFound: missing.map((m) => excerpt(m, 40)) } : {}),
        next: 'Show the owner what would be deleted. Call forget again with preview: false only after they confirm.',
      });
    }
    // Files first: if one of them fails, the turns are still here and the same forget can be run again.
    const removedLines = files.removeDailyLines(dailyHit);
    for (const name of ['USER', 'MEMORY']) {
      if (!entries.some((entry) => entry.file === name)) continue;
      files.modify(CURATED[name].file, (current) => {
        const parsed = parseCurated(current);
        const kept = parsed.entries.filter((entry) => !entryIds.has(entry.id));
        return kept.length === parsed.entries.length ? null : { text: serializeCurated({ ...parsed, entries: kept }) };
      });
    }
    tidy.scrubReviews({ turnIds: [...turnIds], entryIds: [...entryIds], skillNames });
    for (const name of skillNames) skills.remove(name);
    turns.stagedDelete(stagedIds);
    const deletedTurns = turns.remove([...turnIds]);
    turns.rebuild();
    return success({
      preview: false,
      deleted: { turns: deletedTurns, indexRows, entries: entries.length, logLines: removedLines, skills: skillNames.length, reviews: reviewHits.length, staged: stagedIds.length },
    });
  }

  // --- the skills the outside world can see: list, read, remove (only the tidy creates them)
  const publicSkills = {
    list: guarded(() => success({ skills: skills.list() })),
    read: guarded((name) => {
      const skill = skills.read(name);
      if (!skill) throw new Missing(`There is no skill ${excerpt(String(name), 60)}.`);
      return success({ skill });
    }),
    remove: guarded((name) => (skills.remove(name) ? success({ removed: name }) : noOp(`There is no skill ${excerpt(String(name), 60)}.`))),
  };

  return {
    capture: guarded(capture),
    recall: guardedAsync(recall),
    remember: guarded(remember),
    context: guarded(context),
    forget: guarded(forget),
    records: guarded(records),
    update: guarded(update),
    tidy: guardedAsync((options) => tidy.run(options ?? {})),
    undoReview: guarded((id) => tidy.undo(id)),
    reviews: guarded((options) => success({ reviews: tidy.reviews(options ?? {}) })),
    rules: guarded(() => success({ rules: { 'TRIAGE.md': files.read('TRIAGE.md')?.text ?? null, 'ASSIGN.md': files.read('ASSIGN.md')?.text ?? null } })),
    skills: publicSkills,
    pending: () => turns.after(turns.cursor(), 1).length > 0,
    close() {
      turns.close();
    },
  };
}

