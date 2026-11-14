// What a collection session hands back, checked in code before anything is stored (docs/assistant.md 3.1, "记录").
//
//   normalizeRecords(raw, { now }) -> { records, rejected: [{ index, id, message }], dropped, duplicates, truncated }
//     raw      the "records" list of the session's answer: [{ id, version, url, kind, title, from, at, thread, text, context: [{ from, at, text, mine }], more, to_me, handled }]
//     records  [{ sourceId, version, kind, title, author, url, thread, at (ms | null), text, context: [{ from, at, text, mine }], more, truncated, toMe, handled }]
//     `to_me` says the item is meant for the owner (it names them, is sent to them, gives them something to do); false: it is for someone else, or a
//     notification, a digest, talk between other people; absent: the session could not tell. `handled`: the owner already answered it, or it says it is done.
//     Both come out as true, false or null. `mine` marks a message of the context that the owner wrote.
//   identityOf(raw) -> { name, id } | null     who the owner is on the source (the account the session read as), as the session says it
//
// An item the inbox has already can be given again to change it: `update: true` with the id (and the thread, if the first record had one) and only what changes. It comes out as
// { update: true, sourceId, thread, changes: { title?, text?, author?, url?, at?, more?, context? }, truncated }, with nothing in it that was not given; the inbox changes the row that
// holds that item and makes none (store.mjs `ingest`). It is never one message of a conversation, and a title it does not give is not made up.
//
// A conversation is one record, however many messages it has (owner, 2026-11-06: sixteen messages of one private chat were sixteen rows): the
// messages of a chat or a comment thread that one collection brings are put together under the thread's id, oldest first, one message to a
// line that starts with its time; `conversation: true` tells the inbox to add the messages that come later to the row that is still waiting.
//
// A record's title is the session's. One it left out is the first words of what the record says (`titleFromText`): a row is never blank.
//
// The session is a model that has read other people's messages, so nothing it wrote is taken as it is: text is cleaned of control and
// bidirectional characters, secrets are blanked, lengths are cut (and a cut is counted, not silent), a link must be http or https. One bad record
// is rejected with its reason and the others stay good. At most 100 records are taken; the rest is counted in `dropped`.
import { createHash } from 'node:crypto';
import { findSecret, redact } from '../memory/secrets.mjs';

export const RECORD_LIMITS = Object.freeze({ records: 100, id: 300, version: 100, title: 300, from: 200, url: 2000, thread: 300, text: 8000, context: 8, contextText: 1000, more: 500 });
export const KINDS = Object.freeze(['mail', 'message', 'issue', 'comment', 'page', 'task', 'other']);
/** The kinds whose items are messages of a conversation: a mail has its own subject, a message or a comment is only a line of the talk. */
export const CONVERSATION_KINDS = Object.freeze(['message', 'comment']);
const inConversation = (record) => !record.update && Boolean(record.thread) && CONVERSATION_KINDS.includes(record.kind);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** true, false, or null for "not said": only a real boolean (or the words) counts. */
const flag = (value) => (value === true || value === 'true' ? true : value === false || value === 'false' ? false : null);
// Control characters (not tab, line feed, carriage return) and the controls that make text read in another order than it is written.
const CONTROL = new RegExp(`[${[[0, 8], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x85, 0x85], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]].map(([from, to]) => String.fromCharCode(from) + (to > from ? `-${String.fromCharCode(to)}` : '')).join('')}]`, 'g');
const digest = (text) => createHash('sha256').update(text).digest('hex');

/** Text without control characters and without secrets; `multiline` keeps the line breaks. Returns { text, cut }. */
export function cleanText(value, max, { multiline = false } = {}) {
  if (typeof value !== 'string') return { text: '', cut: false };
  const head = value.length > max * 4 ? value.slice(0, max * 4) : value;
  const plain = head.replace(CONTROL, '');
  const shaped = multiline ? plain.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : plain.replace(/\s+/g, ' ').trim();
  const blanked = redact(shaped);
  const chars = [...blanked];
  return chars.length > max ? { text: chars.slice(0, max).join(''), cut: true } : { text: blanked, cut: head.length < value.length };
}

function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : null;
}

const TITLE_FROM_TEXT = 60;
const LINK = /https?:\/\/[^\s<>"'`）)】」]+/giu;

/**
 * A title for a record the session gave none: the first words of what it says. The session leaves the field out now and then (the prompt only showed it in the answer's example, and
 * in one session it left it out of all eleven messages it gave: records 135, 136 and 149 were shown as blank rows, owner, 2026-11-11). Links are left out of the words, and a text that
 * is only a link gives the link's host. '' when there is nothing to say. The text has been through `cleanText`, so no secret is in it.
 */
export function titleFromText(text, max = TITLE_FROM_TEXT) {
  const said = typeof text === 'string' ? text : '';
  const links = said.match(LINK) ?? [];
  let title = said.replace(LINK, ' ').replace(/\s+/g, ' ').trim();
  if (!title && links.length) {
    try {
      title = new URL(links[0]).host;
    } catch {
      title = '';
    }
  }
  const chars = [...title];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : title;
}

const linkOf = (value) => {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > RECORD_LIMITS.url || /[\u0000-\u001f\u007f\s]/.test(text) || findSecret(text)) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : '';
  } catch {
    return '';
  }
};

/** The messages around an item, cleaned: at most RECORD_LIMITS.context of them, each with who, when and what; `cut` says one was left out or shortened. */
function contextOf(value) {
  const context = [];
  let cut = false;
  for (const item of Array.isArray(value) ? value : []) {
    if (!isObject(item) || context.length >= RECORD_LIMITS.context) {
      if (isObject(item)) cut = true;
      continue;
    }
    const said = cleanText(item.text, RECORD_LIMITS.contextText, { multiline: true });
    if (!said.text) continue;
    cut ||= said.cut;
    context.push({ from: cleanText(item.from, RECORD_LIMITS.from).text, at: timeOf(item.at), text: said.text, mine: flag(item.mine ?? item.from_me) === true });
  }
  return { context, cut };
}

function one(raw, state) {
  if (!isObject(raw)) return { problem: 'A record must be an object.' };
  // The id is the service's own: it is how a record is told from another and from itself later. A secret inside it (a link with a token)
  // becomes a stand-in that is the same every time.
  const idText = typeof raw.id === 'number' && Number.isSafeInteger(raw.id) ? String(raw.id) : raw.id;
  if (typeof idText !== 'string' || !idText.trim()) return { problem: 'A record needs the id the service gives it.' };
  const rawId = idText.replace(CONTROL, '').trim();
  if (!rawId || rawId.length > RECORD_LIMITS.id) return { problem: `The id must be 1 to ${RECORD_LIMITS.id} characters.` };
  const sourceId = findSecret(rawId) ? `ref-${digest(rawId).slice(0, 16)}` : rawId;

  // The item is given again to change what the inbox kept of it: only the fields that are given, cleaned as a new record's are, and at least one of them.
  if (flag(raw.update) === true) {
    const title = cleanText(raw.title, RECORD_LIMITS.title);
    const text = cleanText(raw.text, RECORD_LIMITS.text, { multiline: true });
    const author = cleanText(raw.from, RECORD_LIMITS.from);
    const thread = cleanText(raw.thread, RECORD_LIMITS.thread);
    const more = cleanText(raw.more, RECORD_LIMITS.more);
    const around = contextOf(raw.context);
    const at = timeOf(raw.at);
    const url = linkOf(raw.url);
    const changes = {
      ...(title.text ? { title: title.text } : {}), ...(text.text ? { text: text.text } : {}), ...(author.text ? { author: author.text } : {}), ...(url ? { url } : {}),
      ...(at !== null ? { at } : {}), ...(more.text ? { more: more.text } : {}), ...(around.context.length ? { context: around.context } : {}),
    };
    if (!Object.keys(changes).length) return { id: sourceId, problem: 'An update needs something to change: a title, a text, a sender, a time, a link, a context or more.' };
    return { record: { update: true, sourceId, thread: thread.text, changes, truncated: title.cut || text.cut || author.cut || more.cut || around.cut } };
  }

  const title = cleanText(raw.title, RECORD_LIMITS.title);
  const text = cleanText(raw.text, RECORD_LIMITS.text, { multiline: true });
  if (!title.text && !text.text) return { id: sourceId, problem: 'A record needs a title or a text.' };
  const author = cleanText(raw.from, RECORD_LIMITS.from);
  const thread = cleanText(raw.thread, RECORD_LIMITS.thread);
  const more = cleanText(raw.more, RECORD_LIMITS.more);
  let cut = title.cut || text.cut || author.cut || thread.cut || more.cut;

  const { context, cut: contextCut } = contextOf(raw.context);
  cut ||= contextCut;

  const given = cleanText(raw.version, RECORD_LIMITS.version).text;
  // With no version the text is the version: an edit is a new version, the same text again is not.
  const version = given || `v-${digest(`${title.text}\n${text.text}`).slice(0, 16)}`;
  const kind = typeof raw.kind === 'string' && KINDS.includes(raw.kind.trim().toLowerCase()) ? raw.kind.trim().toLowerCase() : 'other';
  return {
    record: {
      sourceId, version, kind, title: title.text, author: author.text, url: linkOf(raw.url), thread: thread.text,
      at: timeOf(raw.at), text: text.text, context, more: more.text, truncated: cut,
      toMe: flag(raw.to_me ?? raw.toMe), handled: flag(raw.handled),
    },
  };
}

/** Who the owner is on the source: the name and the service's own id of the account the session read as; null when it did not say. */
export function identityOf(raw) {
  if (!isObject(raw)) return null;
  const name = cleanText(raw.name, 100).text;
  const id = cleanText(raw.id, 200).text;
  return name || id ? { name, id } : null;
}

// ---------------------------------------------------------------- a conversation: its messages in one text

const two = (n) => String(n).padStart(2, '0');
/** `11-06 14:43`: when a message was written, on the owner's clock. */
const stamp = (at) => {
  const date = new Date(at);
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
};
const HEADER = /^\d{2}-\d{2} \d{2}:\d{2} /;
const lineOf = (record) => `${record.at == null ? '' : `${stamp(record.at)} `}${record.author ? `${record.author}：` : ''}${record.text || record.title}`;

/** The messages of a conversation's text: one starts at a line that begins with its time, and the lines under it are still that message. */
export function messagesOf(text) {
  const messages = [];
  for (const line of typeof text === 'string' && text ? text.split('\n') : []) {
    if (HEADER.test(line) || !messages.length) messages.push(line);
    else messages[messages.length - 1] += `\n${line}`;
  }
  return messages;
}

/** What the newest message of a kept text says, without the time and the name that start its line (a text that is not a conversation is one message: the whole of it). */
export function newestSaid(text) {
  const last = messagesOf(text).at(-1) ?? '';
  return last.replace(/^\d{2}-\d{2} \d{2}:\d{2} (?:[^：\n]{1,200}：)?/u, '');
}

/** Messages as one text of at most `max` characters: when there are too many the oldest go first. */
function fit(messages, max) {
  const kept = [...messages];
  let cut = false;
  let text = kept.join('\n');
  while (text.length > max && kept.length > 1) {
    kept.shift();
    cut = true;
    text = kept.join('\n');
  }
  if ([...text].length > max) {
    text = [...text].slice(-max).join('');
    cut = true;
  }
  return { text, cut };
}

/** What a conversation's text becomes when messages come that it may not have yet: the ones it has are not added again. -> { text, added, cut } */
export function addMessages(old, incoming, max = RECORD_LIMITS.text) {
  const had = messagesOf(old);
  const have = new Set(had);
  const fresh = messagesOf(incoming).filter((message) => !have.has(message));
  if (!fresh.length) return { text: old, added: 0, cut: false };
  return { ...fit([...had, ...fresh], max), added: fresh.length };
}

/**
 * A conversation's text with messages added that may come before, among or after the ones it has (what a session read around a record, when the owner asked for more of its context): all of
 * them in the order of their times, each once. The messages of a text that have no times cannot be ordered: the new ones then go in front of the old. -> { text, added, cut }
 */
export function mergeMessages(old, incoming, max = RECORD_LIMITS.text) {
  const had = messagesOf(old);
  const have = new Set(had);
  const fresh = messagesOf(incoming).filter((message) => !have.has(message));
  if (!fresh.length) return { text: old, added: 0, cut: false };
  const all = [...fresh, ...had];
  const timed = all.every((message) => HEADER.test(message));
  const key = (message) => message.slice(0, 11); // `11-06 14:43`
  const ordered = timed
    ? all.map((message, index) => ({ message, index })).sort((a, b) => (key(a.message) < key(b.message) ? -1 : key(a.message) > key(b.message) ? 1 : a.index - b.index)).map(({ message }) => message)
    : all;
  return { ...fit(ordered, max), added: fresh.length };
}

/** The messages one collection brought of one conversation, as one record. */
function together(members) {
  const timed = members.every((member) => member.at != null);
  // The session lists the newest first; with the times it does not matter how it listed them.
  const ordered = timed
    ? members.map((member, index) => [member, index]).sort((a, b) => a[0].at - b[0].at || b[1] - a[1]).map(([member]) => member)
    : [...members].reverse();
  const newest = ordered.at(-1);
  const names = [...new Set(ordered.map((member) => member.author).filter(Boolean))];
  // What the session read around the messages (their `context`) belongs to the talk too: a bare mention says nothing without the messages before it (owner, 2026-11-11: "我不知道这个@是让我干什么").
  // A line the talk has already is not added twice, and one with no time takes the time of the first message, so that it still begins like a message and comes before it.
  const own = ordered.map((member) => ({ at: member.at, line: lineOf(member) }));
  const known = new Set(own.map((entry) => entry.line));
  const around = [];
  for (const member of ordered) {
    for (const item of member.context ?? []) {
      if (!item.text) continue;
      const at = item.at ?? ordered[0].at;
      const line = lineOf({ at, author: item.from, text: item.text, title: '' });
      if (known.has(line)) continue;
      known.add(line);
      around.push({ at, line });
    }
  }
  const lines = [...around, ...own];
  if (around.length && lines.every((entry) => entry.at != null)) lines.sort((a, b) => a.at - b.at); // stable: on the same time what was read around comes first
  const { text, cut } = fit(lines.map((entry) => entry.line), RECORD_LIMITS.text);
  const said = (name) => ordered.map((member) => member[name]);
  return {
    sourceId: `thread:${newest.thread}`, version: newest.version, kind: newest.kind,
    title: [...said('title')].reverse().find(Boolean) || titleFromText(newest.text), author: names.join('、').slice(0, RECORD_LIMITS.from),
    url: [...said('url')].reverse().find(Boolean) ?? '', thread: newest.thread, at: newest.at, text, context: [],
    more: [...said('more')].reverse().find(Boolean) ?? '', truncated: cut || ordered.some((member) => member.truncated),
    toMe: ordered.some((member) => member.toMe === true) ? true : ordered.some((member) => member.toMe === false) ? false : null,
    handled: newest.handled, conversation: true,
  };
}

/** Every message of a conversation in the list becomes one record, at the place of the first of them. */
function gather(records) {
  const groups = new Map();
  for (const record of records) if (inConversation(record)) groups.set(record.thread, [...(groups.get(record.thread) ?? []), record]);
  const placed = new Set();
  const out = [];
  for (const record of records) {
    if (!inConversation(record)) {
      out.push(record);
      continue;
    }
    if (placed.has(record.thread)) continue;
    placed.add(record.thread);
    out.push(together(groups.get(record.thread)));
  }
  return out;
}

export function normalizeRecords(raw, { now = Date.now } = {}) {
  void now;
  const out = { records: [], rejected: [], dropped: 0, duplicates: 0, truncated: 0 };
  if (!Array.isArray(raw)) return out;
  const seen = new Set();
  raw.forEach((item, index) => {
    if (out.records.length >= RECORD_LIMITS.records) {
      out.dropped++;
      return;
    }
    const result = one(item, out);
    if (result.problem) {
      out.rejected.push({ index, id: result.id ?? (typeof item?.id === 'string' ? cleanText(item.id, 40).text : ''), message: result.problem });
      return;
    }
    const key = result.record.update ? `update\u0000${result.record.sourceId}` : `${result.record.sourceId}\u0000${result.record.version}`;
    if (seen.has(key)) {
      out.duplicates++;
      return;
    }
    seen.add(key);
    if (result.record.truncated) out.truncated++;
    out.records.push(result.record);
  });
  out.records = gather(out.records);
  // A title the session left out is the first words of what the record says, never a blank row (`titleFromText`).
  for (const record of out.records) if (!record.update && !record.title) record.title = titleFromText(record.text);
  return out;
}
