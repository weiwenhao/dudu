// What a search found, marked where it was found: in the list's titles and snippets and in the conversation on the right.

/** The words of a search, the way the lists match them: lower case, split on spaces. */
export const queryTerms = (query) => String(query ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);

const escaped = (term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` cut into pieces, each saying whether it is one of the words; a match ignores case and the text keeps what was written. */
export function splitByTerms(text, terms) {
  const value = String(text ?? '');
  if (!terms.length || !value) return [{ text: value, hit: false }];
  // The longest word first, so a short one inside a longer one does not cut it in two.
  const pattern = new RegExp(`(${[...terms].sort((a, b) => b.length - a.length).map(escaped).join('|')})`, 'giu');
  return value.split(pattern).map((piece, index) => ({ text: piece, hit: index % 2 === 1 })).filter((piece) => piece.text);
}
