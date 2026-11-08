// How often a collector runs, as the settings page says it (docs/assistant.md 3.1, "定时"): the text the owner wrote (30m, 2h, 1d or
// five-field cron) in words where there are words for it, and the common ones the field offers.
import { intlLocale } from '../lib/locale.mjs';
import { T } from '../strings.js';

/** The values the list under the field offers, in the order it shows them. The words are in strings.js (`preset`). */
export const PRESET_VALUES = ['5m', '15m', '30m', '1h', '6h', '0 9 * * *', '0 9 * * 1-5', '0 9-18 * * 1-5'];

/** What a frequency reads as; a collector that says nothing runs every 30 minutes. Cron that is not one of the common ones stays as it was written. */
export function describeFrequency(text) {
  const C = T.settings.collectors;
  const value = String(text ?? '').trim();
  if (!value) return C.everyMinutes(30);
  if (Object.hasOwn(C.preset, value)) return C.preset[value];
  const every = /^(\d{1,4})\s*([mhd])$/i.exec(value);
  if (!every) return value;
  const n = Number(every[1]);
  return { m: C.everyMinutes, h: C.everyHours, d: C.everyDays }[every[2].toLowerCase()](n);
}

/** The time of the last collection: a clock time today, a date and a clock time before. */
export function whenOf(at, now = Date.now()) {
  const date = new Date(at);
  const today = date.toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(intlLocale(), today
    ? { hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** The line under a collector's text about its last collection, or '' when it has not been collected. */
export function lastLine(read, now) {
  if (!read || !Number.isFinite(read.at)) return '';
  const C = T.settings.collectors;
  return read.ok ? C.last.done(whenOf(read.at, now), read.items ?? 0) : C.last.failed(whenOf(read.at, now));
}
