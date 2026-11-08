// What a search found, marked where it was found: in the list's titles and snippets and in the conversation on the right.
import { textMatch } from '../../../conversation-search.mjs';

/** The words of a search, the way the lists match them: lower case, split on spaces. */
export const queryTerms = (query) => String(query ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);

/** Keep a content hit near the start of the one-line excerpt, where the list has room to show it. */
export function searchSnippet(text, terms) {
  const value = String(text ?? '');
  const hit = textMatch(value, terms.join(' '));
  if (!hit) return value;
  const start = Math.max(0, hit.at - 12);
  return `${start ? '…' : ''}${value.slice(start)}`;
}

const escaped = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` cut into pieces, each saying whether it is one of the words; a match ignores case and the text keeps what was written. */
export function splitByTerms(text, terms) {
  const value = String(text ?? '');
  if (!terms.length || !value) return [{ text: value, hit: false }];
  // The longest word first, so a short one inside a longer one does not cut it in two.
  const pattern = new RegExp(`(${terms.map(escaped).join('\\s+')}|${[...terms].sort((a, b) => b.length - a.length).map(escaped).join('|')})`, 'giu');
  return value.split(pattern).map((piece, index) => ({ text: piece, hit: index % 2 === 1 })).filter((piece) => piece.text);
}

/**
 * The sessions of a list that say all of the words in their title, folder, project or id: what the list answers by itself, at once, to what is typed, before the
 * server's answer (which also looks inside the conversations) is there. No words: the list as it is.
 */
export function matchSessions(sessions, query) {
  const list = sessions ?? [];
  const terms = queryTerms(query);
  if (!terms.length) return list;
  return list.filter((session) => {
    const text = `${session.title ?? ''} ${session.cwd ?? ''} ${session.id ?? ''} ${session.project?.name ?? ''} ${session.project?.path ?? ''}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
