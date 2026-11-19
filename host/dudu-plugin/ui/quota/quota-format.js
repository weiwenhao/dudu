import { T } from '../strings.js';
import { intlLocale } from '../lib/locale.mjs';

const Q = T.widgets.quota;
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const weekday = { format: (ms) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(ms) };
const startOfDay = (ms) => { const date = new Date(ms); date.setHours(0, 0, 0, 0); return date.getTime(); };

/** When a window starts over: the time of day when that is today, else the weekday too ("Mon 13:00"). */
export function resetText(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  return startOfDay(ms) === startOfDay(now) ? clock.format(ms) : `${weekday.format(ms)} ${clock.format(ms)}`;
}

/** The plugin names windows in Chinese ("5 小时", "每周", "Opus 每周", "3 天"): this is how they read in the interface. */
export function windowName(label) {
  if (label === '5 小时') return Q.fiveHour;
  if (label === '每周') return Q.weekly;
  const weekly = /^(.*?)\s*每周$/.exec(label);
  if (weekly) return `${weekly[1]} ${Q.weekly.toLowerCase()}`.trim();
  const days = /^(\d+)\s*天$/.exec(label);
  if (days) return Q.days(days[1]);
  return label;
}

/** The bar's colour by how much is used: blue below 70 %, amber to 90 %, red from there (the number is always beside it). */
export const toneOf = (percent) => (percent >= 90 ? 'bg-destructive' : percent >= 70 ? 'bg-warning' : 'bg-ring');

/** Keep each currency's total, omitting zero wallets; negative and sub-cent balances still matter. */
export const amountText = (provider) => (provider.balance ?? []).map((amount) => amount.text)
  .filter((text) => text && !/^-?[$¥]?0\.00$/.test(text)).join(' + ');
