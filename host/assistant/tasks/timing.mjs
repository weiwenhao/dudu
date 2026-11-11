// Dudu's user-defined schedules. The collector scheduler deliberately has a different contract.
import { cronProblem, nextCron, onceAt } from '../schedule/cron.mjs';

const KINDS = new Set(['once', 'interval', 'daily', 'workdays', 'weekly', 'monthly', 'cron']);
const bad = () => { throw Object.assign(new Error('invalid_schedule'), { code: 'invalid_schedule' }); };

export function validateSchedule(input) {
  if (!input || !KINDS.has(input.kind) || typeof input.timezone !== 'string') bad();
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(); } catch { bad(); }
  const { kind, timezone } = input;
  if (kind === 'interval') {
    if (!Number.isSafeInteger(input.minutes) || input.minutes < 1 || input.minutes > 525600) bad();
    return { kind, timezone, minutes: input.minutes };
  }
  if (kind === 'cron') {
    if (typeof input.expression !== 'string' || input.expression.length > 200 || cronProblem(input.expression)) bad();
    return { kind, timezone, expression: input.expression.trim().replace(/\s+/g, ' ') };
  }
  if (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) bad();
  const result = { kind, timezone, time: input.time };
  if (kind === 'once') {
    if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) bad();
    const date = new Date(`${input.date}T12:00:00Z`);
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== input.date) bad();
    result.date = input.date;
    try { if (!Number.isFinite(onceAt(`${result.date}T${result.time}:00`, timezone))) bad(); } catch { bad(); }
  }
  if (kind === 'weekly') {
    if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.length > 7 || input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) bad();
    result.weekdays = [...new Set(input.weekdays)].sort();
  }
  if (kind === 'monthly') {
    if (!Number.isInteger(input.day) || input.day < 1 || input.day > 31) bad();
    result.day = input.day;
  }
  return result;
}

/** Strictly after `after`. Interval schedules keep their original anchor after sleep/restart. */
export function nextOccurrence(schedule, after, anchor = after) {
  if (schedule.kind === 'once') {
    const at = onceAt(`${schedule.date}T${schedule.time}:00`, schedule.timezone);
    return at > after ? at : null;
  }
  if (schedule.kind === 'interval') {
    const step = schedule.minutes * 60_000;
    return anchor + Math.max(1, Math.floor((after - anchor) / step) + 1) * step;
  }
  let expression = schedule.expression;
  if (schedule.kind !== 'cron') {
    const [hour, minute] = schedule.time.split(':').map(Number);
    expression = `${minute} ${hour} ${schedule.kind === 'monthly' ? schedule.day : '*'} * ${schedule.kind === 'workdays' ? '1-5' : schedule.kind === 'weekly' ? schedule.weekdays.join(',') : '*'}`;
  }
  return nextCron(expression, after, schedule.timezone);
}
