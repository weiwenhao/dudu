// What the owner's two rule files say, read by code at the two places where a model must not have the last word
// (docs/assistant.md 3.2 and 3.3): the priority of an issue, and how much an agent may do.
//
// Both files are free text for the owner; code only trusts what it can read conservatively, and what it cannot read it leaves at the
// safe end: no Urgent, and a read-only session.
import { stripComments } from '../memory/files.mjs';

// --- priority: impact (1 low, 2 middle, 3 high) x effort (s, m, l)
// The table 嘟嘟 used to carry in TRIAGE.md ("重要又简单的优先级高，不重要又费事的优先级低"). The file now says that in words and the model
// reads it; this table is what is used when the model gives no priority, so that the same impact and effort always give the same one.
export const PRIORITY_TABLE = Object.freeze({
  3: Object.freeze({ s: 'high', m: 'high', l: 'medium' }),
  2: Object.freeze({ s: 'medium', m: 'medium', l: 'low' }),
  1: Object.freeze({ s: 'low', m: 'low', l: 'low' }),
});

/** The priority the table gives, or null when the impact or the effort is not known. */
export const tablePriority = (impact, effort) => PRIORITY_TABLE[impact]?.[effort] ?? null;

// Urgent is not the model's to give: a message that says "urgent" is not the owner saying so. TRIAGE.md has to say when something is
// urgent. The sentence the first template had about it ("Urgent: only when you say so") does not count as a rule.
const MENTIONS_URGENT = /urgent|紧急|很急|加急/i;
const OLD_TEMPLATE_URGENT = /^[-*]?\s*urgent[:：]\s*现在只在你明确说很急时才用。(?:什么时候算很急，你可以写在这里。)?$/i;

/** Whether TRIAGE.md has a line of its own about Urgent (outside comments, and not the old template's sentence). Best effort; false when unsure. */
export function urgentAllowed(triage) {
  for (const raw of stripComments(String(triage ?? '')).split('\n')) {
    const line = raw.trim();
    if (line && MENTIONS_URGENT.test(line) && !OLD_TEMPLATE_URGENT.test(line)) return true;
  }
  return false;
}

// --- access: how much a session may do (the names DSH and host/assistant/sessions/ give the modes)
export const ACCESS_MODES = Object.freeze(['read-only', 'workspace-write', 'danger-full-access']);
const RANK = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 };
const WORDS = [
  ['danger-full-access', /完全访问|完全权限|全部权限|danger[- ]?full[- ]?access|full[- ]access/gi],
  ['workspace-write', /可以改(?:动)?工作区|改工作区|工作区(?:内|里)?(?:可?写|修改|写入)|可以改文件|workspace[- ]?write/gi],
  ['read-only', /只读|read[- ]?only/gi],
];
const ARROW = /→|->|=>/;
const NEGATED = /不|别|勿|禁|无|没|\bno\b|\bnot\b|\bnever\b|n't|\bwithout\b/i;
const CLAUSE = /[，,；;。.、]/;

/** The lowest mode a rule's right-hand side names without a "not" in front of it, or null when it names none. */
function namedBy(right) {
  let lowest = null;
  for (const clause of right.split(CLAUSE)) {
    for (const [mode, pattern] of WORDS) {
      for (const match of clause.matchAll(pattern)) {
        if (NEGATED.test(clause.slice(0, match.index))) continue;
        if (lowest === null || RANK[mode] < RANK[lowest]) lowest = mode;
      }
    }
  }
  return lowest;
}

/** A direct permission statement in the current user's own words, not an agent's request or an ambiguous "yes". */
export function explicitAccess(text) {
  const statement = String(text ?? '').trim();
  if (/[?？]|```/.test(statement) || !/允许|同意|授权|可以改|设(?:置)?(?:为|成)|改成|切(?:换)?(?:为|到)|\b(?:allow|grant|set|switch)\b/i.test(statement)) return null;
  return namedBy(statement);
}

const plain = (text) => String(text ?? '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');

/** Whether two kinds of issue are the same sort of thing: one contains the other (at least two characters). "Redshift" is "Redshift 账号". */
export function sameKind(a, b) {
  const [x, y] = [plain(a), plain(b)];
  return x.length >= 2 && y.length >= 2 && (x === y || x.includes(y) || y.includes(x));
}

// A rule covers a kind that is the rule's words or says more than them ("合同" covers "合同回复"), never one that says less: a rule for
// "合同回复" does not reach every kind of reply.
const covers = (term, kind) => {
  const [rule, what] = [plain(term), plain(kind)];
  return rule.length >= 2 && what.includes(rule);
};

// A rule is one line: "what → which agent, which folder, which access". Lines in comments (the examples) are not rules.
function ruleLines(assign) {
  const rules = [];
  for (const raw of stripComments(String(assign ?? '')).split('\n')) {
    const line = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, '');
    const arrow = ARROW.exec(line);
    if (arrow) rules.push({ left: line.slice(0, arrow.index), right: line.slice(arrow.index + arrow[0].length) });
  }
  return rules;
}

/**
 * The most an agent may do for this kind of issue, as ASSIGN.md says it: the lowest mode named by the rules that name this kind, and
 * read-only when none does. A mode with a "not" in front of it is not named. The model never gets to read this differently.
 */
export function allowedAccess(assign, issue, { fallback = 'read-only' } = {}) {
  const kind = issue?.kind;
  let allowed = null;
  for (const { left, right } of ruleLines(assign)) {
    if (!left.split(/[、，,;；/|]|\s+和\s+|\s+and\s+|\s+or\s+/i).some((term) => covers(term, kind))) continue;
    const mode = namedBy(right);
    if (mode !== null && (allowed === null || RANK[mode] < RANK[allowed])) allowed = mode;
  }
  return allowed ?? fallback;
}

/** Literal folder/model choices from matching owner rules. Never take a working directory from model output. */
export function sessionOptions(assign, issue, { home = '', defaultAccess = 'read-only' } = {}) {
  const folders = new Set();
  const models = new Set();
  for (const { left, right } of ruleLines(assign)) {
    if (!left.split(/[、，,;；/|]|\s+和\s+|\s+and\s+|\s+or\s+/i).some((term) => covers(term, issue?.kind))) continue;
    for (const match of right.matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'|((?<![\w:/])(?:~\/|\/|[A-Za-z]:[\\/])[^\s，,；;`"']+)/g)) {
      const value = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!/^(?:~\/|\/|[A-Za-z]:[\\/])/.test(value) || /[$\n\r]/.test(value)) continue;
      if (value.startsWith('~/')) { if (home) folders.add(`${home.replace(/[\\/]$/, '')}/${value.slice(2)}`); }
      else folders.add(value);
    }
    for (const match of right.matchAll(/(?:\bmodel\b|模型)\s*[:：=]?\s*[`"']?([A-Za-z0-9][A-Za-z0-9_.:/-]*)/gi)) models.add(match[1]);
  }
  if (folders.size > 1 || models.size > 1) return { problem: 'ASSIGN.md gives conflicting folders or models for this issue.' };
  return {
    access: allowedAccess(assign, issue, { fallback: defaultAccess }),
    ...(folders.size ? { cwd: [...folders][0] } : {}),
    ...(models.size ? { model: [...models][0] } : {}),
  };
}

/** What is given: what the model asked for, but never more than is allowed; with no request, what is allowed. */
export function grantAccess(requested, allowed) {
  return Object.hasOwn(RANK, requested) && RANK[requested] < RANK[allowed] ? requested : allowed;
}
