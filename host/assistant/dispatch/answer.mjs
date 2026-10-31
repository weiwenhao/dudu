// The answers of the model, read strictly (docs/assistant.md 3.2 and 3.3). A model's answer is text from something that has read
// material written by other people: it is checked in code, field by field, and only what passes is ever acted on. Unknown fields are
// dropped, a value of the wrong type or outside its range makes the item (for the triage) or the answer (for the assignment) unusable,
// and nothing here ever throws for what a model can write.
//
//   parseTriage(reply, { openIds, now }) -> { ok: false, message } | { ok: true, items, rejected }
//     items     [{ index, action: 'new', ref, title, brief, kind, impact, effort, priority, dueAt (ms), dueReason, project, reason }
//              | { index, action: 'update', ref, issueId, brief, title, reason } | { index, action: 'ignore', ref, reason }]
//     rejected  [{ index, ref, message }]: items that were not usable; the others are still good
//   parseAssign(reply) -> { ok: false, message } | { ok: true, agent, session, access, reason }
//
// The answer as a whole is unusable when it is not a JSON object, has no "items" list, or has more than 20 items. Text is cleaned (control
// characters and bidirectional overrides removed, a line made of one line) before its length is checked; secrets are not this file's
// business: whoever writes the text somewhere passes it through the redactor.
export const LIMITS = Object.freeze({ items: 20, reply: 200_000, ref: 300, title: 300, brief: 4000, kind: 100, project: 200, reason: 500, session: 300, agent: 40 });
export const ACTIONS = Object.freeze(['new', 'update', 'ignore']);
export const EFFORTS = Object.freeze(['s', 'm', 'l']);
export const PRIORITIES = Object.freeze(['none', 'urgent', 'high', 'medium', 'low']);
const ACCESS = ['read-only', 'workspace-write', 'danger-full-access'];
const DAY = 86_400_000;

class Problem extends Error {}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const absent = (value) => value === undefined || value === null || value === '';
// Control characters (not tab, line feed, carriage return) and the controls that make text read in another order than it is written.
const range = ([from, to]) => String.fromCharCode(from) + (to > from ? `-${String.fromCharCode(to)}` : '');
const CONTROL = new RegExp(`[${[[0, 8], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x85, 0x85], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069]].map(range).join('')}]`, 'g');

function text(name, value, { min = 0, max, multiline = false }) {
  if (typeof value !== 'string') throw new Problem(`${name} must be text.`);
  if (value.length > max + 1000) throw new Problem(`${name} is longer than ${max} characters.`); // before any work on a megabyte
  const clean = value.replace(CONTROL, '');
  const out = multiline ? clean.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : clean.replace(/\s+/g, ' ').trim();
  if (out.length < min) throw new Problem(`${name} must not be empty.`);
  if (out.length > max) throw new Problem(`${name} is longer than ${max} characters.`);
  return out;
}

const oneOf = (name, values, value) => {
  const found = typeof value === 'string' ? value.trim().toLowerCase() : null;
  if (!values.includes(found)) throw new Problem(`${name} must be one of: ${values.join(', ')}.`);
  return found;
};

const whole = (name, min, max, value) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Problem(`${name} must be a whole number from ${min} to ${max}.`);
  return value;
};

// "12", 12 and "DUDU-12" all name issue 12.
function issueNumber(value) {
  const match = typeof value === 'number' && Number.isSafeInteger(value) ? [null, String(value)] : /^\s*(?:dudu-)?(\d{1,15})\s*$/i.exec(typeof value === 'string' ? value : '');
  const id = match ? Number(match[1]) : 0;
  if (!(id > 0)) throw new Problem('issueId must be the number of an open issue.');
  return id;
}

// A date the message states: "2026-11-05" is the end of that day in the owner's time, "2026-11-05T17:00" is that minute. It must be a day
// that exists, not more than a year ago and not more than five years ahead.
function dueDate(value, now) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!match) throw new Problem('dueAt must be a date such as 2026-11-05, or 2026-11-05T17:00.');
  const [year, month, day] = match.slice(1, 4).map(Number);
  const timed = match[4] !== undefined;
  const [hour, minute] = timed ? [Number(match[4]), Number(match[5])] : [23, 59];
  const date = new Date(year, month - 1, day, hour, minute, timed ? 0 : 59, timed ? 0 : 999);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Problem('dueAt is not a day and time that exist.');
  }
  const ms = date.getTime();
  if (ms < now - 366 * DAY || ms > now + 5 * 366 * DAY) throw new Problem('dueAt is more than a year ago or more than five years ahead.');
  return ms;
}

/** The JSON object in an answer: as it is, or in a fenced block, or between the first { and the last }. */
export function extractJson(reply) {
  const body = String(reply ?? '').trim();
  const attempts = [body];
  const fence = /```(?:json)?[ \t]*\n?([\s\S]*?)```/i.exec(body);
  if (fence) attempts.push(fence[1].trim());
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(body.slice(start, end + 1));
  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt);
      if (isObject(value)) return value;
    } catch { /* the next form */ }
  }
  return null;
}

const bad = (message) => ({ ok: false, message });

function readReply(reply, what) {
  if (typeof reply !== 'string') return bad('The model did not answer with text.');
  if (reply.length > LIMITS.reply) return bad(`The answer is too long to be ${what}.`);
  const body = extractJson(reply);
  return body ? { body } : bad('The answer is not a JSON object.');
}

// A line of text that may be wrong without mattering: for an item that is ignored.
const looseLine = (value, max) => (typeof value === 'string' ? value.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const given = (value, parse) => (absent(value) ? undefined : parse(value));

function parseItem(raw, { openIds, now }) {
  if (!isObject(raw)) throw new Problem('An item must be an object.');
  const action = oneOf('action', ACTIONS, raw.action);
  if (action === 'ignore') return { action, ref: looseLine(raw.ref, LIMITS.ref), reason: looseLine(raw.reason, LIMITS.reason) };
  const ref = text('ref', raw.ref, { min: 1, max: LIMITS.ref });
  const reason = text('reason', raw.reason, { min: 1, max: LIMITS.reason });
  const brief = given(raw.brief, (value) => text('brief', value, { max: LIMITS.brief, multiline: true })) ?? '';
  if (action === 'update') {
    const issueId = issueNumber(raw.issueId);
    if (!openIds.has(issueId)) throw new Problem(`issueId ${issueId} is not one of the open issues that were shown.`);
    return { action, ref, issueId, brief, title: given(raw.title, (value) => text('title', value, { max: LIMITS.title })) ?? '', reason };
  }
  return {
    action, ref, reason, brief,
    title: text('title', raw.title, { min: 1, max: LIMITS.title }),
    kind: given(raw.kind, (value) => text('kind', value, { max: LIMITS.kind })) ?? '',
    impact: given(raw.impact, (value) => whole('impact', 1, 3, value)) ?? null,
    effort: given(raw.effort, (value) => oneOf('effort', EFFORTS, value)) ?? null,
    priority: given(raw.priority, (value) => oneOf('priority', PRIORITIES, value)) ?? null,
    dueAt: given(raw.dueAt, (value) => dueDate(value, now)) ?? null,
    dueReason: given(raw.dueReason, (value) => text('dueReason', value, { max: LIMITS.reason })) ?? '',
    project: given(raw.project, (value) => text('project', value, { min: 1, max: LIMITS.project })) ?? null,
  };
}

export function parseTriage(reply, { openIds = new Set(), now = Date.now() } = {}) {
  const read = readReply(reply, 'a list of items');
  if (!read.body) return read;
  const { items: list } = read.body;
  if (!Array.isArray(list)) return bad('The answer has no "items" list.');
  if (list.length > LIMITS.items) return bad(`The answer has more than ${LIMITS.items} items.`);
  const items = [];
  const rejected = [];
  list.forEach((raw, index) => {
    try {
      items.push({ index, ...parseItem(raw, { openIds, now }) });
    } catch (error) {
      if (!(error instanceof Problem)) throw error;
      rejected.push({ index, ref: looseLine(raw?.ref, 40), message: error.message });
    }
  });
  return { ok: true, items, rejected };
}

export function parseAssign(reply) {
  const read = readReply(reply, 'a choice of agent');
  if (!read.body) return read;
  const { body } = read;
  try {
    if (!('agent' in body)) throw new Problem('The answer has no "agent" (an id, or null).');
    let agent = null;
    if (!absent(body.agent)) {
      agent = text('agent', body.agent, { max: LIMITS.agent }).toLowerCase();
      if (agent === 'null' || agent === 'none') agent = null;
    }
    return {
      ok: true, agent,
      session: given(body.session, (value) => text('session', value, { max: LIMITS.session })) ?? null,
      access: given(body.access, (value) => oneOf('access', ACCESS, value)) ?? null,
      reason: text('reason', body.reason, { min: 1, max: LIMITS.reason }),
    };
  } catch (error) {
    if (!(error instanceof Problem)) throw error;
    return bad(error.message);
  }
}
