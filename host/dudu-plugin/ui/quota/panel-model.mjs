import { T } from '../strings.js';
import { intlLocale } from '../lib/locale.mjs';
import { amountText, resetText, windowName } from './quota-format.js';

// What the quota panel behind the header icon says (owner, 2026-11-11: form B, "一家一块，一行一个窗口"), from what the quota service answered. Pure: the page only draws what this returns.
// The words are the quota widget's own; the one new word is the update time. Nothing here names an agent: a block is whatever the service lists, and `agent` only picks its logo.

const Q = T.widgets.quota;
const usedOf = (window) => Math.min(100, Math.max(0, Math.round((Number(window.used) || 0) * 100)));

/** The colour of a number as its window runs low: amber from 70 % used, red from 90 % (the bar changes at the same places, `toneOf`). */
export const levelOf = (used) => (used >= 90 ? 'hot' : used >= 70 ? 'warn' : '');

/**
 * One window as a row: its name, what is left (the number is coloured as it runs low), when it starts over; used up, the phrase says when instead.
 * `figure` is "剩余 79%" ("79% left"); `at`..`end` is where the number stands in it.
 */
export function rowOf(window) {
  const used = usedOf(window);
  const left = 100 - used;
  const when = Number.isFinite(window.resetsAt) ? resetText(window.resetsAt) : '';
  const figure = Q.leftLine('', left).trim();
  const at = figure.lastIndexOf(`${left}%`);
  const out = left === 0;
  return {
    key: window.key ?? window.label, label: windowName(window.label), used, left, level: levelOf(used), out,
    figure, number: at < 0 ? null : [at, at + `${left}%`.length],
    reset: out ? '' : when ? Q.resets(when) : '',
    phrase: out && when ? Q.limitReached(when) : '',
  };
}

/**
 * When the plan's paid time ends, as it follows the plan's name ("Team · 有效期至11月24日"; owner, 2026-11-11, magpie's words): the month and day in the interface's language, and the full time as its tooltip.
 * The plugin says it only while it is still ahead, and only for a plan whose sign-in tells it.
 */
export function termOf(until) {
  if (!Number.isFinite(until)) return null;
  const date = new Date(until);
  return { text: Q.until(new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric' }).format(date)), title: date.toLocaleString(intlLocale()) };
}

/** One agent as a block: its logo key, name and plan (and when the plan ends), then a row for each window, or its balance. */
export function blockOf(provider) {
  const balance = provider.kind === 'balance';
  return {
    key: provider.id, agent: provider.agent ?? provider.id, name: provider.name, plan: provider.plan ?? '', term: termOf(provider.until),
    amount: balance ? amountText(provider) : '', rows: balance ? [] : (provider.windows ?? []).map(rowOf),
  };
}

/**
 * The panel: the blocks that have something to say, when the oldest of their readings was taken, and whether a reading is under way. `null` before the first answer.
 * What cannot be read (a sign-in that is gone, nothing to read) is not in the service's list, so it is not here; there is no "—" row.
 */
export function panelOf(view) {
  if (!view || !Array.isArray(view.providers)) return null;
  const blocks = view.providers.map(blockOf).filter((block) => block.amount || block.rows.length);
  return { blocks, readAt: Number.isFinite(view.readAt) ? view.readAt : null, refreshing: view.refreshing === true };
}

/** "更新于 15:12": today the time, another day the weekday and the time (as the resets are told). */
export const updatedText = (readAt) => (Number.isFinite(readAt) ? Q.updated(resetText(readAt)) : '');
