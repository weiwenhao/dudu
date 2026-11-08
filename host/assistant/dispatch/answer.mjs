// The answer of the model, read strictly (docs/assistant.md 3.3). A model's answer is text from something that has read material written by other
// people: it is checked in code, field by field, and only what passes is ever acted on. Unknown fields are dropped, a value of the wrong type or
// outside its range makes the answer unusable, and nothing here ever throws for what a model can write.
//
//   parseAssign(reply) -> { ok: false, message } | { ok: true, agent, session, access, reason }
//
// The answer as a whole is unusable when it is not a JSON object. Text is cleaned (control characters and bidirectional overrides removed, a line
// made of one line) before its length is checked; secrets are not this file's business: whoever writes the text somewhere passes it through the redactor.
export const LIMITS = Object.freeze({ reply: 200_000, reason: 500, session: 300, agent: 40 });
const ACCESS = ['read-only', 'workspace-write', 'danger-full-access'];

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

const given = (value, parse) => (absent(value) ? undefined : parse(value));

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
