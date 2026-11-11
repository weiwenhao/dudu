import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

// A Claude account's allowance, read the way magpie reads it (owner, 2026-11-11: "按照 magpie 的方法来。这个命令可以直接获取到额度"): Claude Code's own `claude -p /usage`,
// which Claude Code answers itself (it asks Anthropic, no model is called) and prints as lines:
//   Current session: 21% used · resets Nov 11 at 3:39pm (Asia/Shanghai)
//   Current week (all models): 23% used · resets Nov 17 at 1:59am (Asia/Shanghai)
//   Current week (Fable): 0% used · resets Nov 17 at 2am (Asia/Shanghai)
// The plan (Max, Pro) is not printed there: `claude auth status --json` says it. Nothing here asks Anthropic itself, and the sign-in file is never read.

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const WINDOW_LINE = /^Current (session|week(?: \(([^)]+)\))?):\s*([0-9.]+)% used(?:\s*·\s*resets (.+))?$/;
// the closing lines of /usage count the account's own work ("Last 7d · 403 requests · 388 sessions"): counts, not HTTP statuses
const COUNTS = /(?: · )?Last [0-9]+[a-z]+ · [0-9][0-9,]* requests? · [0-9][0-9,]* sessions?/g;
const SIGNED_OUT = /not (?:logged|signed) in|signed out|sign-in (?:has )?expired|unauthori[sz]ed|forbidden|authentication (?:failed|required)|invalid (?:access )?token|\b40[13]\b/i;
// what makes Claude Code answer as if it were paid by use: with one of these in its environment it cannot report how much of a plan is used
const PAID_BY_USE = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];
const HOUR = 3_600_000;
const SPANS = { session: 5 * HOUR, week: 7 * 24 * HOUR };
const SLACK = 2 * HOUR; // this computer's clock may be behind Anthropic's
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const validZone = (zone) => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; } };

/** The calendar a moment has in a zone (the machine's own when none). */
function partsIn(epoch, zone) {
  const formatter = new Intl.DateTimeFormat('en-US', { ...(zone ? { timeZone: zone } : {}), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const value = Object.fromEntries(formatter.formatToParts(epoch).map((part) => [part.type, Number(part.value)]));
  return { year: value.year, month: value.month - 1, day: value.day, hour: value.hour, minute: value.minute, second: value.second };
}

/** The moment a wall clock reads in a zone. */
function instantOf(year, month, day, hour, minute, zone) {
  if (!zone) return new Date(year, month, day, hour, minute).getTime();
  const wall = Date.UTC(year, month, day, hour, minute);
  let guess = wall;
  for (let pass = 0; pass < 3; pass++) {
    const read = partsIn(guess, zone);
    guess += wall - Date.UTC(read.year, read.month, read.day, read.hour, read.minute);
  }
  return guess;
}

const clockOf = (hour, minute, meridiem) => [(Number(hour) % 12) + (/^p/i.test(meridiem) ? 12 : 0), Number(minute ?? 0)];

/**
 * When a window starts over, from the words of /usage: "Oct 1 at 3:30pm (Asia/Shanghai)", "Oct 9, 2:59pm (UTC)", "Oct 1, 2026 at 3pm" or "3pm (Asia/Shanghai)", in the zone named, else this computer's.
 * A date without a year is in the year where it is less than a day past and no further ahead than the window is long; a time alone is the next one from now.
 */
export function resetTime(value, now, span) {
  let text = String(value ?? '').trim();
  if (!text) return undefined;
  let zone;
  const named = /\(([^)]+)\)\s*$/.exec(text);
  if (named) {
    if (validZone(named[1].trim())) zone = named[1].trim();
    text = text.slice(0, named.index).trim();
  }
  const latest = now + span + SLACK;
  const dated = /^([A-Za-z]{3})[a-z]* (\d{1,2})(?:, (\d{4}))?(?:,| at) (\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i.exec(text);
  if (dated) {
    const month = MONTHS.indexOf(dated[1].toLowerCase());
    if (month < 0) return undefined;
    const [hour, minute] = clockOf(dated[4], dated[5], dated[6]);
    if (dated[3]) return instantOf(Number(dated[3]), month, Number(dated[2]), hour, minute, zone);
    const year = partsIn(now, zone).year;
    let past;
    for (const candidate of [year - 1, year, year + 1]) {
      const at = instantOf(candidate, month, Number(dated[2]), hour, minute, zone);
      if (at >= now - 24 * HOUR && at <= latest) return at;
      if (at < now) past = at;
    }
    return past;
  }
  const clock = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i.exec(text);
  if (clock) {
    const [hour, minute] = clockOf(clock[1], clock[2], clock[3]);
    const today = partsIn(now, zone);
    let past;
    for (let offset = -2; offset <= 2; offset++) {
      const at = instantOf(today.year, today.month, today.day + offset, hour, minute, zone);
      if (at >= now && at <= latest) return at;
      if (at < now) past = at;
    }
    return past;
  }
  return undefined;
}

const titleCase = (value) => (typeof value === 'string' && value ? value[0].toUpperCase() + value.slice(1) : '');

/** The windows /usage printed, as the Quota views have them (`used` 0 to 1); a window nobody used is left out unless it is one of the two every plan has. */
export function parseClaudeUsage(output, { now = Date.now() } = {}) {
  const text = String(output ?? '').replace(ANSI, '').trim();
  const windows = [];
  for (const raw of text.split('\n')) {
    const match = WINDOW_LINE.exec(raw.trim());
    if (!match) continue;
    const used = Number.parseFloat(match[3]);
    if (!Number.isFinite(used)) continue;
    const week = match[1] !== 'session';
    // "Sonnet only" is the week of Sonnet
    const scope = week ? (match[2] ?? '').trim().replace(/ only$/i, '') : '';
    const model = scope && !/^all models$/i.test(scope) ? scope : '';
    const key = !week ? 'five_hour' : model ? `seven_day_${model.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : 'seven_day';
    if (windows.some((window) => window.key === key)) continue;
    const resetsAt = resetTime(match[4], now, week ? SPANS.week : SPANS.session);
    windows.push({ key, label: !week ? '5 小时' : model ? `${model} 每周` : '每周', used: Math.min(1, Math.max(0, used / 100)), ...(resetsAt === undefined ? {} : { resetsAt }), core: !model });
  }
  if (windows.length) {
    const shown = windows.filter((window) => window.core || window.used >= 0.01);
    shown.sort((a, b) => (b.core - a.core) || (a.label === '5 小时' ? -1 : b.label === '5 小时' ? 1 : 0));
    return { kind: 'windows', windows: shown.slice(0, 4) };
  }
  // no figure at all: a sign-in that is gone says so; anything else is a reading that did not work this time
  return SIGNED_OUT.test(text.replace(COUNTS, '')) ? { kind: 'login' } : { kind: 'unavailable' };
}

/** The environment a child gets: this process's, with an overlay applied (null removes a name) and what makes Claude Code answer as paid by use removed. */
export function childEnvironment(overlay = {}, remove = PAID_BY_USE, base = process.env) {
  const env = { ...base };
  for (const [name, value] of Object.entries(overlay ?? {})) { if (value === null) delete env[name]; else env[name] = value; }
  for (const name of remove) delete env[name];
  return env;
}

/** Runs a program to its end: what it printed and how it ended; rejects when it cannot start. Killed at the timeout or when the signal aborts. */
export function runCommand(command, args, { env, timeoutMs = 30_000, signal, cwd = homedir() } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let done = false;
    const finish = (settle, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); settle(value); };
    const onAbort = () => { child.kill(); finish(reject, signal.reason ?? new Error('aborted')); };
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error(`${command} did not answer in time`)); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => { if (stdout.length < 1_000_000) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 1_000_000) stderr += chunk; });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => finish(resolve, { code, stdout, stderr }));
  });
}

/**
 * What a Claude account has left: `{ state: 'ok', plan, windows }`, `{ state: 'login' }` when it is signed out, and an error when it could not be read this time.
 * `command` is the `claude` found on this computer, `environment` the harness's overlay (`createOarProvider`).
 */
export async function readClaudeQuota({ command, environment, signal, run = runCommand, now = Date.now } = {}) {
  const env = childEnvironment(environment?.());
  const [status, usage] = await Promise.all([
    run(command, ['auth', 'status', '--json'], { env, timeoutMs: 8_000, signal }).catch(() => undefined),
    run(command, ['-p', '/usage'], { env, timeoutMs: 30_000, signal }),
  ]);
  let identity;
  try { identity = JSON.parse(status?.stdout ?? ''); } catch { /* the plan is a label: it can be left out */ }
  if (identity?.loggedIn === false) return { state: 'login' };
  const parsed = parseClaudeUsage(`${usage.stdout}\n${usage.stderr}`, { now: now() });
  if (parsed.kind === 'login') return { state: 'login' };
  if (parsed.kind !== 'windows') throw new Error("Claude Code's /usage showed no usage figures.");
  const plan = titleCase(typeof identity?.subscriptionType === 'string' ? identity.subscriptionType.trim() : '');
  return { state: 'ok', ...(plan ? { plan } : {}), windows: parsed.windows };
}
