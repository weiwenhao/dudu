// The only file that imports croner, so that scripts/package-desktop.mjs bundles it ('assistant/schedule/cron.mjs'): the installed
// plugin has no node_modules of its own. Five fields only, in the computer's own time zone.
import { Cron } from 'croner';

/** A problem with a five-field expression as a short sentence, or null when it is fine. */
export function cronProblem(expression) {
  const fields = String(expression ?? '').trim().split(/\s+/);
  if (fields.length !== 5) return 'A cron expression has five fields: minute hour day-of-month month day-of-week.';
  if (/[@?LW#]|[A-Za-z]/.test(fields.join(' '))) return 'Use numbers, *, ranges, lists and steps in a cron expression.';
  try {
    new Cron(fields.join(' ')).nextRun();
  } catch (error) {
    return String(error?.message ?? error).replace(/^CronPattern:\s*/, '');
  }
  return null;
}

/** The first time after `after` (ms) that the expression names, in ms; null when there is none. */
export function nextCron(expression, after) {
  const next = new Cron(String(expression).trim().split(/\s+/).join(' ')).nextRun(new Date(after));
  return next ? next.getTime() : null;
}
