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

/** How much of an agent's subscription is used: the highest of its windows, as a whole percent (null when nothing is known). */
export function percentUsed(provider) {
  if (provider.state !== 'ok' || !provider.windows.length) return null;
  return Math.round(Math.max(...provider.windows.map((window) => window.used)) * 100);
}

/** The bar's colour by how much is used: blue below 70 %, amber to 90 %, red from there (the number is always beside it). */
export const toneOf = (percent) => (percent >= 90 ? 'bg-destructive' : percent >= 70 ? 'bg-warning' : 'bg-ring');

/** The windows a compact line shows side by side: the two every plan has, the 5-hour one first. */
export const coreWindows = (provider) => provider.windows.filter((window) => window.core);

/** A wallet's amounts as DSH writes them, one per currency ("¥12.34 + $3.00"); empty when there is none. */
export const amountText = (provider) => (provider.balance ?? []).map((amount) => amount.text).join(' + ');

// How tall a block is (measured in the interface): the name line, then a bar for each window; a wallet or a "—" is the name line alone.
const BLOCK = { base: 32, line: 22, empty: 22 };
const FRAME = 48; // the widget's title line and the room under the last block

/** Whether a block for every agent fits in a widget `height` pixels tall; if not, the lines (28px each) are the better use of it. */
export function fitsBlocks(providers, height) {
  const needed = providers.reduce((sum, provider) => sum + BLOCK.base + (provider.kind === 'balance' ? 0 : provider.windows.length ? provider.windows.length * BLOCK.line : BLOCK.empty), FRAME);
  return providers.length > 0 && height >= needed;
}
