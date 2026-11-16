import { T } from '../strings.js';
import { intlLocale } from '../lib/locale.mjs';

const formatters = new Map();

/** The phone's completed-message time: today, yesterday, then month/day in the current locale. */
export function conversationTime(at, now = Date.now()) {
  if (!(at > 0)) return '';
  const date = new Date(at), today = new Date(now);
  const locale = intlLocale();
  if (date.toDateString() === today.toDateString()) {
    const key = `${locale}:time`;
    if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }));
    return formatters.get(key).format(date);
  }
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return T.activity.yesterday;
  const key = `${locale}:date`;
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }));
  return formatters.get(key).format(date);
}
