import { T } from '../strings.js';
import { intlLocale } from '../lib/locale.mjs';

const DAY = 86400000;
const withoutYear = { format: (ms) => new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric' }).format(ms) };
const withYear = { format: (ms) => new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(ms) };
const startOfDay = (ms) => { const date = new Date(ms); date.setHours(0, 0, 0, 0); return date.getTime(); };

/**
 * How a due date reads on a row: "Today" or "Oct 30" (the year only when it is not this year), and its tone: overdue,
 * today, within the week, later. Days are counted on the local calendar, so a DST change does not shift them.
 */
export function dueInfo(dueAt, now = Date.now()) {
  if (dueAt == null) return null;
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY);
  const kind = days < 0 ? 'late' : days === 0 ? 'today' : days <= 7 ? 'soon' : 'later';
  const sameYear = new Date(dueAt).getFullYear() === new Date(now).getFullYear();
  const text = days === 0 ? T.today : (sameYear ? withoutYear : withYear).format(dueAt);
  const hint = days === 0 ? text : `${text} · ${days < 0 ? T.overdue(-days) : T.dueIn(days)}`;
  return { kind, days, text, hint };
}

export const DUE_TONE = {
  late: 'text-danger-foreground',
  today: 'text-warning-foreground',
  soon: 'text-warning-foreground',
  later: 'text-muted-foreground',
};

/** "Oct 30", with the year when it is not this year: the Created and Updated properties of a row. */
export function shortDate(ms, now = Date.now()) {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? withoutYear : withYear).format(ms);
}
