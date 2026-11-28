// The search of the phone's and the Desktop's search page, and Dudu's `search/query` (owner, 2026-11-27: Lark's search, one design on every screen; .local/designs/phone-search-2026-11-27/).
// One request looks in the three places the owner keeps things, each answered in the rows of its own page:
//
//   query({ q, scope?, state?, connector?, filters?, limit? })
//     -> { outcome: 'success', q, sessions?: { total, items: [entry], indexing?, partial? }, inbox?: { total, items: [card], names: { collectorId: name } }, tasks?: { total, items: [task] } }
//
//   sessions  the conversations of the board's 全部 list (嘟嘟 included) whose title, issue number or project holds the words of `q`, newest first, then the ones whose text does (DSH's
//             content index, the one the drawer's search uses); an entry is the list's own (`home.list`) and has `snippet`, a line of the text, when the text matched. `indexing` says that
//             index is still being built, `partial` that it could not be asked in time (the title matches are all there is).
//   inbox     the collected records (inbox/api.mjs `search`): the cards of the Collector, with `snippet` for a record whose text matched and whose title shows nothing of it.
//   tasks     the scheduled tasks whose name holds the words (the ones the tasks page lists: not those a conversation made for itself): `tasks/list`'s own rows.
//
// `scope` asks for one place only; with it, `q` may be empty and the answer is the place's newest rows (a range picked on the page and narrowed by its filters, with nothing typed yet).
// `state` ('todo' | 'done') and `connector` (ids) narrow the inbox. In a sessions or tasks scope, `filters` narrows the matches before `limit` and asks for `facets` with the available
// agent and project choices. `total` counts the matches after filtering. A place that could not be asked has `failed: true` and no rows: the others are still answered.
import { agentOfEntry, facetCounts, filterSessions, filterTasks, projectOfEntry, validSearchFilters } from './search-filters.mjs';

export const SEARCH_SCOPES = Object.freeze(['sessions', 'inbox', 'tasks']);
export const MAX_QUERY = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// The content index may be busy building itself: the answer does not wait for it longer than this (a request of the Desktop's must not hang: DSH installs its updates only between them).
const CONTENT_WAIT_MS = 2500;

const lower = (value) => String(value ?? '').toLocaleLowerCase();

// DSH writes its own reminders into a turn (`<system-reminder>…</system-reminder>`). They are not what the owner or the agent said: a line of text is cut of them, and a hit that was only in one is no hit.
const REMINDER = /<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/gi;
const REMINDER_TAG = /<\/?system-reminder>/gi;
export function cleanLine(text, terms) {
  const raw = String(text ?? '');
  if (!/system-reminder/i.test(raw)) return raw;
  const cleaned = raw.replace(REMINDER, ' ').replace(REMINDER_TAG, ' ').replace(/\s+/g, ' ').trim();
  const lowered = cleaned.toLowerCase();
  return terms.some((term) => lowered.includes(term)) ? cleaned : '';
}
const timeout = (ms) => new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('timeout')), ms); timer.unref?.(); });

function sessionPage(matches, limit, filters, includeAssistant) {
  if (!filters) return { total: matches.length, items: matches.slice(0, limit) };
  const now = Date.now();
  const items = filterSessions(matches, filters, now, includeAssistant);
  const choices = includeAssistant ? matches : matches.filter((entry) => entry.issue);
  const agents = includeAssistant ? choices : filterSessions(choices, { ...filters, agent: [] }, now, false);
  const projects = includeAssistant ? choices : filterSessions(choices, { ...filters, project: [] }, now, false);
  return { total: items.length, items: items.slice(0, limit), facets: {
    agent: facetCounts(choices, agentOfEntry, agents), project: facetCounts(choices, projectOfEntry, projects),
  } };
}

/**
 * `conversations(row, options)` is the chat home's list (`home.list('all', row, undefined, options)`), `sessions(query)` the content search (`{ items: [{ sessionId, snippet }], indexing }`),
 * `inbox(options)` the inbox api's `search`, `tasks(action, body)` the tasks service, `row` how a conversation's issue is shown unless a caller says otherwise (the phone's compact row,
 * native-board.mjs `boardRow`).
 */
export function createSearch({ conversations, sessions, inbox, tasks, row: shownAs = (issue) => issue }) {
  async function findSessions(query, limit, row, ownMessages, filters, includeAssistant) {
    const listed = await conversations(row, { ownMessages });
    const entries = listed?.conversations;
    if (!Array.isArray(entries)) throw new Error('The conversation list is not available.');
    if (!query) return sessionPage(entries, limit, filters, includeAssistant);
    const needle = lower(query);
    const titled = entries.filter((entry) => lower([entry.title, entry.issue?.ref, projectOfEntry(entry)].join('\n')).includes(needle));
    let hits = [];
    let indexing;
    let partial = false;
    try {
      const found = await Promise.race([sessions(query), timeout(CONTENT_WAIT_MS)]);
      hits = Array.isArray(found?.items) ? found.items : [];
      if (typeof found?.indexing === 'boolean') indexing = found.indexing;
    } catch { partial = true; }
    const lines = new Map();
    const terms = needle.split(/\s+/).filter(Boolean);
    for (const hit of hits) {
      if (typeof hit?.sessionId !== 'string' || typeof hit.snippet !== 'string' || lines.has(hit.sessionId)) continue;
      const line = [...cleanLine(hit.snippet, terms)].slice(0, 240).join('');
      if (line) lines.set(hit.sessionId, line);
    }
    const titles = new Set(titled.map((entry) => entry.id));
    const bySession = new Map(entries.filter((entry) => entry.sessionId).map((entry) => [entry.sessionId, entry]));
    // A hit on a session that is not a conversation of the list (no issue, or a folded one) has no row to show: it is left out.
    const inText = [...lines.keys()].map((sessionId) => bySession.get(sessionId)).filter((entry) => entry && !titles.has(entry.id));
    const merged = [...titled, ...inText].map((entry) => (lines.has(entry.sessionId) ? { ...entry, snippet: lines.get(entry.sessionId) } : entry));
    return { ...sessionPage(merged, limit, filters, includeAssistant), ...(indexing === undefined ? {} : { indexing }), ...(partial ? { partial: true } : {}) };
  }

  async function findTasks(query, limit, filters) {
    const answer = await tasks('list', {});
    if (answer?.outcome !== 'success' || !Array.isArray(answer.tasks)) throw new Error('The tasks are not available.');
    const needle = lower(query);
    // The tasks page does not list what a conversation made for itself with its cron tools (origin 'session'), so neither does the search.
    const matched = answer.tasks.filter((task) => task?.origin !== 'session' && (!needle || lower(task.title).includes(needle)));
    if (!filters) return { total: matched.length, items: matched.slice(0, limit) };
    const items = filterTasks(matched, filters);
    return { total: items.length, items: items.slice(0, limit), facets: { agent: facetCounts(matched, (task) => task.agent ?? null) } };
  }

  async function findInbox(query, limit, { state, connector }) {
    const answer = await inbox({ q: query, state, connector, limit });
    if (answer?.outcome !== 'success') throw new Error('The inbox is not available.');
    return { total: answer.total, items: answer.items, names: answer.names ?? {} };
  }

  return {
    /** `row` is what the conversations are shown as (the default one, or the Desktop's whole issue); `ownMessages` is the board's own switch (home/chat-home.mjs). */
    async query(body = {}, { row = shownAs, ownMessages = true, includeAssistant = true } = {}) {
      const query = typeof body.q === 'string' ? body.q.trim() : '';
      if (query.length > MAX_QUERY) return { outcome: 'needs_clarification', code: 'invalid_request', message: `The query may have at most ${MAX_QUERY} characters.` };
      if (body.scope !== undefined && !SEARCH_SCOPES.includes(body.scope)) return { outcome: 'needs_clarification', code: 'invalid_request', message: 'Choose sessions, inbox or tasks.' };
      if (!query && body.scope === undefined) return { outcome: 'needs_clarification', code: 'empty_query', message: 'Give the words to look for, or choose where to look.' };
      if (!validSearchFilters(body.scope, body.filters)) return { outcome: 'needs_clarification', code: 'invalid_request', message: 'Use the filters for the selected search scope.' };
      const limit = Number.isSafeInteger(body.limit) ? Math.max(1, Math.min(MAX_LIMIT, body.limit)) : DEFAULT_LIMIT;
      const places = {
        sessions: () => findSessions(query, limit, row, ownMessages, body.filters, includeAssistant),
        inbox: () => findInbox(query, limit, body),
        tasks: () => findTasks(query, limit, body.filters),
      };
      const asked = body.scope === undefined ? SEARCH_SCOPES : [body.scope];
      const answers = await Promise.all(asked.map(async (place) => [place, await places[place]().catch(() => ({ failed: true, total: 0, items: [] }))]));
      return { outcome: 'success', q: query, ...Object.fromEntries(answers) };
    },
  };
}

/** The Desktop's route: POST /api/dudu/search/query with the body of `query`, answered with whole issues in the conversations, as `home/list` answers the list column. */
export function createSearchApi(search) {
  return async (request) => {
    const headers = { 'cache-control': 'no-store' };
    try {
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
      const answer = await search.query(body, { row: (issue) => issue, ownMessages: true });
      return Response.json(answer, { status: answer.outcome === 'success' ? 200 : 400, headers });
    } catch (error) {
      return Response.json({ outcome: 'error', code: error instanceof SyntaxError ? 'invalid_request' : 'unavailable' }, { status: error instanceof SyntaxError ? 400 : 500, headers });
    }
  };
}
