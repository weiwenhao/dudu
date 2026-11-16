// What dudu says by itself beside the pet: an agent waiting for the owner, a due date that has gone by, a session that stopped with an
// error. Read from the issue list with no model. Each one carries a key that changes when its state does (a new question, a new due
// date, a new session), so a reminder the owner closed stays closed until then. One issue is one reminder: the first kind that fits.
import { createHash } from 'node:crypto';

const DAY = 86_400_000;
const startOfDay = (ms) => { const date = new Date(ms); date.setHours(0, 0, 0, 0); return date.getTime(); };
const words = (text, size) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, size);
const digest = (text) => createHash('sha1').update(String(text ?? '')).digest('hex').slice(0, 8);

export function reminders(issues, now, limit = 20) {
  const find = (filter, order) => issues.list({ tab: 'active', filter, limit, order }).items ?? [];
  const taken = new Set();
  const found = [];
  const add = (issue, kind, text, key, extra = {}) => {
    if (taken.has(issue.id)) return;
    taken.add(issue.id);
    found.push({ key: `${issue.id}:${kind}:${key}`, kind, id: issue.id, ref: issue.ref, title: words(issue.title, 160), text: words(text, 200), agent: issue.agent ?? null, ...extra });
  };
  for (const issue of find({ status: ['in_review'] }, 'priority')) {
    if (issue.sessionState === 'processing' || (issue.snoozeUntil != null && issue.snoozeUntil > now)) continue;
    add(issue, 'needs_you', issue.ask || issue.title, digest(issue.ask || issue.session));
  }
  for (const issue of find({ hasQuestion: true }, 'priority')) {
    if (issue.sessionState === 'processing' || (issue.snoozeUntil != null && issue.snoozeUntil > now)) continue;
    add(issue, 'needs_you', issue.ask, digest(issue.ask));
  }
  // Days are counted on the local calendar, as the list counts them: due yesterday is "1 day overdue" from midnight on.
  const today = startOfDay(now);
  for (const issue of find({ dueTo: today - 1 }, 'due')) {
    if (issue.snoozeUntil != null && issue.snoozeUntil > now) continue;
    add(issue, 'overdue', issue.title, String(issue.dueAt), { daysLate: Math.max(1, Math.round((today - startOfDay(issue.dueAt)) / DAY)) });
  }
  for (const issue of find({ lifecycleState: ['waiting_owner', 'error'] }, 'priority')) {
    if (issue.snoozeUntil != null && issue.snoozeUntil > now) continue;
    add(issue, 'blocked', issue.ask || issue.title, digest(issue.session));
  }
  return found.slice(0, limit);
}
