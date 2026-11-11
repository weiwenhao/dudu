// The collector widget's side of the inbox, for the desktop interface: POST /api/dudu/inbox/<action> with one JSON object, answered with JSON.
// The page is the owner. Nothing here calls a model: the owner reads what was collected, puts a row aside, shares it to an issue, or makes an
// issue of it (the page opens its own New issue dialog for that, and tells this module which issue came of it).
//
//   list     { tab: 'todo' | 'done' | 'ignored', filter: { connector: [id], date: ['day' | 'week' | 'month'] }, limit, cursor }
//            -> { items: [card], nextCursor, names: { id: name }, facets: { connector: [{ key, name, count }] } }
//   get      { id }               -> { record, draft: { title, brief, sourceRef } }   the whole record, and what a new issue made of it starts with (and is marked with)
//   ignore   { id | ids } / done { id | ids } / delete { id | ids } / restore { id | ids }     one record, or up to 200 at once -> { outcome, changed, record? }
//            The owner's marks, on a record that has no issue: put aside, dealt with by themselves (listed under Handled, no issue needed), wrong (in no
//            list; the row is kept, so the same message is not collected again). `restore` takes a mark off: a deleted record is back where it was, an
//            ignored or handled one is waiting again.
//   share    { id | ids, issue, to? }  to 'issue' (the default): adds the record to an open issue's activity as a note of the owner's.
//            to 'session': appends it to the session of that issue as a message to its agent, with where it came from, when and what was around it
//            (the issue needs an agent and a session: the same checks and the same note in its activity as the owner's own message to the agent);
//            several records go in one message. The records are then the issue's: they move to Handled.
//   link     { id, issue }        the record became that issue (made by the page); the line saying where it came from is in the issue's brief
//   complete { id }               the owner wants more of this record's context (the Collector's button): the session of the collector that brought it reads the conversation around it, in the
//            background (ten seconds to a few minutes), and what it read goes into that record. -> { outcome: 'success', started: true } at once; `get` then says `completing` while it runs and
//            `completeError` (the plugin's own words, kept ten minutes) when it failed.
//
// A card is the row of the list, without the text: { id, ref, connector, connectorName, connectorIcon, title, from, at, url, state, verdict, ignored, done, byOwner, issue }
// (`connector` is the id of the collector that brought the row, and `connectorName` its name: the fields kept their names when the two were told apart;
// `connectorIcon` is the icon key of the service the collector is about (the catalog's, or one a name says: Lark, Stripe, QQ, WeChat...), or null:
// the pages draw the first letter of the name then)
// where `at` is the time the row shows (its own, else when it was collected), `done` says the owner marked it handled themselves, and `issue` is
// { id, ref, title, status, statusType } or null.
import { brandOf } from '../connectors/brands.mjs';
import { loadCatalog } from '../connectors/catalog.mjs';
import { WORDS as W } from '../dispatch/words.mjs';

const NO_STORE = { 'cache-control': 'no-store' };
const HOUR = 3_600_000;
const SPAN = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };
const TABS = ['todo', 'done', 'ignored'];
const FINISHED = new Set(['done', 'canceled']);
const clip = (value, size) => String(value ?? '').slice(0, size);
// The catalog's keys that are a plain symbol and not a service's logo (the pages draw the first letter instead).
const GENERIC = new Set(['browser', 'pencil', 'plug', 'terminal']);

export const INBOX_ACTIONS = Object.freeze(['list', 'get', 'ignore', 'done', 'delete', 'restore', 'share', 'link', 'complete']);
const KEEP_ERROR_MS = 10 * 60_000;

const needs = (message, code) => ({ outcome: 'needs_clarification', ...(code ? { code } : {}), message });
const MAX_IDS = 200;
const MESSAGE_CHARS = 19_000; // what a message to a session may hold is 20,000

const pad = (n) => String(n).padStart(2, '0');
/** A time as the message says it: the owner's local date and minute. */
const stamp = (ms) => {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const cut = (text, max) => { const chars = [...String(text ?? '')]; return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join('')}…` : chars.join(''); };

/**
 * What an agent is told of records the owner shares into its session: for each one, where it came from, who sent it and when, its link, its words
 * and the messages around it; several are separated by a line. The text is cut to fit a message, each record getting its share.
 * `records` are whole records (inbox.get), `name` says which collector brought one.
 */
export function sessionMessage(records, name) {
  const share = Math.max(400, Math.floor(MESSAGE_CHARS / Math.max(1, records.length)) - 400);
  return records.map((record) => {
    const head = [`收集到的信息：${cut(record.title, 300)}`];
    if (record.from) head.push(`发送人：${cut(record.from, 100)}`);
    const at = stamp(record.at ?? record.collectedAt);
    if (at) head.push(`时间：${at}`);
    head.push(`来源：${[name(record), record.url].filter(Boolean).join(' · ')}`);
    const parts = [head.join('\n')];
    if (record.text) parts.push(cut(record.text, Math.floor(share * 0.7)));
    const around = (record.context ?? []).filter((entry) => entry?.text);
    if (around.length) {
      const each = Math.max(80, Math.floor((share * 0.3) / around.length));
      parts.push(`上下文：\n${around.map((entry) => `- ${entry.from || '-'}${stamp(entry.at) ? `（${stamp(entry.at)}）` : ''}：${cut(entry.text, each).replace(/\s*\n\s*/g, ' ')}`).join('\n')}`);
    }
    return parts.join('\n\n');
  }).join('\n\n---\n\n');
}

export function createInboxApi({ issues, collectors = () => null, forward = null, fill = null, now = Date.now }) {
  const { inbox } = issues;
  // The completions in flight or failed lately, by record number: { running, error }. In memory only: a restart forgets them, and the record shows what it has.
  const jobs = new Map();

  const catalog = loadCatalog();

  /**
   * The collectors by id: the name the owner gave each, and the icon key of the service it is about: the catalog's own when its connector was made from one, otherwise
   * the service its name, its connector's name or the connector's id says it is (Lark, Stripe, QQ, WeChat and so on: connectors/brands.mjs). Null when it is none:
   * the pages then draw the first letter of the name.
   */
  function directory() {
    try {
      const resolved = collectors()?.resolve();
      if (resolved?.outcome !== 'success') return new Map();
      return new Map(resolved.collectors.map((entry) => {
        const listed = catalog.byId(entry.via?.via ?? '')?.icon;
        return [entry.id, { name: entry.name, icon: (listed && !GENERIC.has(listed) ? listed : null) ?? brandOf(entry.name, entry.via?.name, entry.via?.id, entry.connector) }];
      }));
    } catch { return new Map(); }
  }
  /** The names alone, by id; a collector that is gone is shown by its id. */
  const names = (known = directory()) => new Map([...known].map(([id, entry]) => [id, entry.name]));

  const issueOf = (summary) => summary ? { id: summary.id, ref: summary.ref, title: summary.title, status: summary.status, statusType: summary.statusType } : null;

  function card(row, known, summaries) {
    const entry = known.get(row.connector);
    return {
      id: row.id, ref: row.ref, connector: row.connector, connectorName: entry?.name ?? row.connector, connectorIcon: entry?.icon ?? null, title: row.title, from: row.from,
      at: row.at ?? row.collectedAt, url: row.url, state: row.state, verdict: row.verdict, ignored: row.ignoredAt !== null, done: row.doneAt !== null, byOwner: row.byOwner,
      issue: row.issueId === null ? null : issueOf(summaries.get(row.issueId)),
    };
  }
  const summariesOf = (rows) => new Map(issues.summaries(rows.map((row) => row.issueId).filter((id) => id !== null)).map((summary) => [summary.id, summary]));
  const numberOf = (id) => Number(String(id ?? '').replace(/^r/i, ''));

  function one(id, options) {
    const got = inbox.get(numberOf(id), options);
    return got?.record ?? null;
  }

  function list({ tab = 'todo', filter = {}, limit, cursor } = {}) {
    if (!TABS.includes(tab)) return needs('Choose todo, done or ignored.', 'invalid_tab');
    const span = SPAN[filter?.date?.[0]];
    // Counted back from the hour, so that the request, and with it the list, does not change at every look.
    const since = span ? Math.floor(now() / HOUR) * HOUR - span : undefined;
    const page = inbox.browse({ tab, connector: filter?.connector, since, limit, cursor });
    const known = directory();
    const called = names(known);
    const summaries = summariesOf(page.items);
    return {
      outcome: 'success', items: page.items.map((row) => card(row, known, summaries)), nextCursor: page.nextCursor,
      names: Object.fromEntries(called), // every collector's name by id, for the chips of a filter that keeps them by id
      facets: { connector: page.facets.connector.map(({ key, count }) => ({ key, name: called.get(key) ?? key, count })) },
    };
  }

  function get({ id }) {
    const record = one(id);
    if (!record) return needs('There is no record with that number.', 'unknown_record');
    const known = directory();
    const name = known.get(record.connector)?.name ?? record.connector;
    const summaries = summariesOf([record]);
    const where = record.url ? `\n\n${W.sourceLine(clip(name, 100), record.url)}` : '';
    return {
      outcome: 'success',
      record: {
        ...card(record, known, summaries), text: record.text, context: record.context, more: record.more, reason: record.reason, cleared: record.cleared, truncated: record.truncated,
        completing: jobs.get(record.id)?.running === true, completeError: jobs.get(record.id)?.error ?? null,
      },
      // What an issue made of the record starts with (the page puts it in its New issue dialog): the same line of origin 嘟嘟 writes.
      draft: { title: clip(record.title, 300), brief: `${clip(record.text, 4000).trimEnd()}${where}`.trim(), sourceRef: `${record.connector}:${record.sourceId}` },
    };
  }

  /** The numbers a body names: `ids`, else `id`; at most 200, each once. */
  function idsOf(body) {
    const raw = Array.isArray(body?.ids) ? body.ids : body?.id === undefined ? [] : [body.id];
    return [...new Set(raw.slice(0, MAX_IDS).map(numberOf))].filter((id) => Number.isInteger(id) && id > 0);
  }

  function mark(change) {
    return (body) => {
      const ids = idsOf(body);
      const records = ids.map((id) => one(id, { summary: true }));
      if (!ids.length || records.some((record) => !record)) return needs('There is no record with that number.', 'unknown_record');
      const changed = records.filter((record) => change(record)).length;
      if (!changed) return { outcome: 'no_op', message: 'Nothing changed.' };
      const after = one(ids[0], { summary: true });
      return { outcome: 'success', changed, record: card(after, directory(), summariesOf([after])) };
    };
  }

  function open(issue) {
    const got = issues.get(issue, { logLimit: 1 });
    if (got.outcome !== 'success') return { problem: needs('There is no such issue.', 'unknown_issue') };
    if (FINISHED.has(got.issue.statusType ?? got.issue.status)) return { problem: needs('This issue is finished.', 'not_open') };
    return { issue: got.issue };
  }

  function share(body) {
    const to = body?.to ?? 'issue';
    if (!['issue', 'session'].includes(to)) return needs('Share to an issue or to a session.', 'invalid_target');
    const ids = idsOf(body);
    const records = ids.map((id) => one(id));
    if (!ids.length || records.some((record) => !record)) return needs('There is no record with that number.', 'unknown_record');
    const found = open(body.issue);
    if (found.problem) return found.problem;
    return to === 'session' ? shareSession(records, found.issue) : shareIssue(records, found.issue);
  }

  function shareIssue(records, issue) {
    const known = directory();
    const called = names(known);
    const fresh = records.filter((record) => record.issueId !== issue.id);
    if (!fresh.length) return { outcome: 'no_op', message: 'It is in this issue already.' };
    for (const record of fresh) {
      const name = clip(called.get(record.connector) ?? record.connector, 100);
      const where = record.url ? `\n\n${W.sourceLine(name, record.url)}` : '';
      const text = `${name}: ${clip(record.title, 300)}${record.text ? `\n\n${clip(record.text, 3000).trimEnd()}` : ''}${where}`;
      const logged = issues.log(issue.id, {
        kind: 'note', text, actor: 'owner',
        data: { source: 'connector', ref: `${record.connector}:${record.sourceId}`, record: record.id, ...(record.url ? { url: record.url } : {}) },
      });
      if (logged.outcome !== 'success') return logged;
      inbox.link(record.id, { issueId: issue.id, verdict: 'note' });
    }
    const after = one(fresh[0].id);
    return { outcome: 'success', changed: fresh.length, record: card(after, known, summariesOf([after])), issue: issueOf({ ...issue, ref: issue.ref }) };
  }

  // The owner's words to the agent of that issue, said through the same door as their own message to it: the issue must have an agent, a project and a
  // session, and the message is noted in its activity. Only a message that was delivered makes the records the issue's.
  async function shareSession(records, issue) {
    if (!issue.agent || !issue.session) return needs('This issue has no session to share to.', 'no_session');
    if (!forward) return { outcome: 'error', code: 'delivery_failed', message: 'Sharing to a session is unavailable.' };
    const known = directory();
    const called = names(known);
    const text = sessionMessage(records, (record) => called.get(record.connector) ?? record.connector);
    let sent;
    try { sent = await forward(issue.id, text); } catch { sent = null; }
    if (!sent || !['success', 'no_op'].includes(sent.outcome)) return { outcome: 'error', code: sent?.code ?? 'delivery_failed', message: 'The message could not be sent to the session.' };
    for (const record of records) if (record.issueId !== issue.id) inbox.link(record.id, { issueId: issue.id, verdict: 'note' });
    const after = one(records[0].id);
    return { outcome: 'success', changed: records.length, record: card(after, known, summariesOf([after])), issue: issueOf({ ...issue, ref: issue.ref }) };
  }

  function link({ id, issue }) {
    const record = one(id);
    if (!record) return needs('There is no record with that number.', 'unknown_record');
    const got = issues.get(issue, { logLimit: 1 });
    if (got.outcome !== 'success') return needs('There is no such issue.', 'unknown_issue');
    inbox.link(record.id, { issueId: got.issue.id, verdict: 'issue' });
    const after = one(record.id);
    return { outcome: 'success', record: card(after, directory(), summariesOf([after])) };
  }

  /** The owner asks for more of the record's context: the work is started and left to run (a session reading a thread takes a while); the answer says it started. */
  function complete(body) {
    const number = numberOf(body.id);
    if (!Number.isInteger(number) || number <= 0) return needs('Name a record.', 'invalid_request');
    if (!one(number, { summary: true })) return needs('There is no record with that number.', 'unknown_record');
    if (typeof fill !== 'function') return { outcome: 'error', code: 'unavailable', message: 'Completing the context is unavailable.' };
    if (jobs.get(number)?.running) return { outcome: 'success', started: true };
    const job = { running: true, error: null };
    jobs.set(number, job);
    Promise.resolve().then(() => fill(number)).then((result) => {
      if (result?.outcome !== 'success') job.error = clip(result?.message ?? 'The context could not be completed.', 300);
    }, (error) => { job.error = clip(error instanceof Error ? error.message : error, 300) || 'The context could not be completed.'; }).finally(() => {
      job.running = false;
      if (!job.error) { jobs.delete(number); return; }
      const forget = setTimeout(() => { if (jobs.get(number) === job) jobs.delete(number); }, KEEP_ERROR_MS);
      forget.unref?.();
    });
    return { outcome: 'success', started: true };
  }

  const CALLS = {
    list, get, share, link, complete,
    ignore: mark((record) => inbox.ignore(record.id)),
    done: mark((record) => inbox.done(record.id)),
    delete: mark((record) => inbox.remove(record.id)),
    restore: mark((record) => inbox.restore(record.id)),
  };

  return {
    execute(action, body = {}) {
      if (!Object.hasOwn(CALLS, action)) return { outcome: 'error', code: 'unknown_action' };
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return needs('The request must be a JSON object.', 'invalid_request');
      return CALLS[action](body);
    },
    async handle(action, request) {
      if (!Object.hasOwn(CALLS, action)) return new Response('Not found', { status: 404 });
      try {
        const body = await request.json().catch(() => { throw new SyntaxError('The request body is not JSON.'); });
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
        return Response.json(await CALLS[action](body), { headers: NO_STORE });
      } catch (error) {
        const bad = error instanceof SyntaxError;
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: bad ? 400 : 500, headers: NO_STORE });
      }
    },
  };
}
