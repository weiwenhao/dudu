// The pure part of the search page of the conversation list (owner, 2026-11-27; `.local/designs/phone-search-2026-11-27/`, the phone's design on every screen): what the page remembers (the words
// that were searched for, when each conversation was last opened), the 常用 list, the words to mark in a result, the groups of an answer, and the search filters.
// No React in here: `tests/desktop-search.test.ts` runs it as it is.
import { facetCounts } from '../../../assistant/home/search-filters.mjs';
export { agentOfEntry, filterSessions, filterTasks, isUnfiltered, projectOfEntry } from '../../../assistant/home/search-filters.mjs';

export const HISTORY_KEY = 'dudu.search.history.v1';
export const OPENED_KEY = 'dudu.conversations.opened.v1';
export const HISTORY_MAX = 12;
export const FREQUENT_MAX = 6;
export const OPENED_MAX = 500;
/** How many rows of one place the answer to the words alone shows; the rest is behind 更多. */
export const GROUP_ROWS = 3;
export const PLACES = ['sessions', 'inbox', 'tasks'];

const local = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The words that were searched for, the newest first. */
export function readHistory(store = local()) {
  try {
    const stored = JSON.parse(store?.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((word) => typeof word === 'string' && word.trim()).slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}

/** The history with `word` first and nowhere else; the history as it was when the word is empty. */
export function withWord(history, word) {
  const text = String(word ?? '').trim();
  return text ? [text, ...history.filter((entry) => entry !== text)].slice(0, HISTORY_MAX) : history;
}

export function saveHistory(history, store = local()) {
  try { store?.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* private window or blocked storage: it just is not remembered */ }
}

/** When each conversation was last opened in this panel, by its id (`issue:12`, `assistant`): { id: ms }. This computer's own; the phones keep theirs. */
export function readOpened(store = local()) {
  try {
    const stored = JSON.parse(store?.getItem(OPENED_KEY) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, at]) => Number.isFinite(at)));
  } catch { return {}; }
}

/** The conversation was opened now. The oldest times go when there are many (a conversation that is deleted leaves its time behind). */
export function noteOpened(id, now = Date.now(), store = local()) {
  if (typeof id !== 'string' || !id) return;
  try {
    const kept = Object.entries({ ...readOpened(store), [id]: now }).sort((a, b) => b[1] - a[1]).slice(0, OPENED_MAX);
    store?.setItem(OPENED_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* private window or blocked storage: it just is not remembered */ }
}

/** The 常用 list: every conversation (the 全部 list, not only the active ones), the one opened last first; those never opened follow in the order of the list. */
export function frequent(entries, opened, max = FREQUENT_MAX) {
  return entries.map((entry, index) => ({ entry, index, at: opened[entry.id] ?? 0 }))
    .sort((a, b) => b.at - a.at || a.index - b.index).slice(0, max).map(({ entry }) => entry);
}

/** The words of a query a result marks: its parts between spaces, the longest first (so that a word inside another is not cut out of it). */
export const searchWords = (query) => [...new Set(String(query ?? '').split(/\s+/u).filter(Boolean))].sort((a, b) => b.length - a.length);

const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** A text cut into the parts the words mark and the parts between them: [{ text, hit }]. */
export function markParts(text, words) {
  const value = String(text ?? '');
  const found = words.filter(Boolean);
  if (!value || !found.length) return [{ text: value, hit: false }];
  // split() with a group gives the text between the matches at the even places and the matches at the odd ones.
  return value.split(new RegExp(`(${found.map(escaped).join('|')})`, 'giu')).map((part, index) => ({ text: part, hit: index % 2 === 1 })).filter((part) => part.text !== '');
}

/** What the answer to the words alone shows: each place that has a row, with its total and its first rows. */
export function groupsOf(answer, rows = GROUP_ROWS) {
  return PLACES.map((place) => ({ place, total: answer?.[place]?.total ?? 0, items: (answer?.[place]?.items ?? []).slice(0, rows) })).filter((group) => group.items.length > 0);
}

/** 'error' when every place that was asked failed (or none answered), 'empty' when none has a row, else 'rows'. */
export function answerState(answer, places = PLACES) {
  const asked = places.map((place) => answer?.[place]).filter(Boolean);
  if (!asked.length || asked.every((group) => group.failed)) return 'error';
  return asked.some((group) => group.items?.length > 0) ? 'rows' : 'empty';
}

/** The values a picker offers, from the rows it filters: each once, the commonest first. */
export function distinct(rows, pick) {
  return facetCounts(rows, pick).map(({ key }) => key);
}

/** What the inbox filter says to the plugin: one state, and the collectors by id. */
export function inboxArguments(filter) {
  return { ...(filter.state?.[0] ? { state: filter.state[0] } : {}), ...(filter.connector?.length ? { connector: filter.connector } : {}) };
}

/** The tab of the Collector a record is in: handled (an issue, or the owner's own mark) or waiting. `RecordDialog` takes it. */
export const recordTab = (card) => (card.issue || card.done ? 'done' : 'todo');
