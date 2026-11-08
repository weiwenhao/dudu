const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const searchTerms = (query) => String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/** Prefer the whole query, then the most informative word, rather than "hi" inside "redshift". */
export function textMatch(text, query) {
  const value = String(text ?? '');
  const terms = searchTerms(query);
  if (!terms.length) return null;
  const phrase = new RegExp(terms.map(escape).join('\\s+'), 'iu').exec(value);
  if (phrase) return { at: phrase.index, length: phrase[0].length, exact: true, terms: terms.length };
  const lower = value.toLowerCase();
  const present = terms.filter((term) => lower.includes(term)).sort((a, b) => b.length - a.length);
  return present.length ? { at: lower.indexOf(present[0]), length: present[0].length, exact: false, terms: present.length } : null;
}

export const matchRank = (match) => match ? [Number(match.exact), match.terms, match.length] : [0, 0, 0];
export function betterMatch(candidate, current) {
  const next = matchRank(candidate);
  const previous = matchRank(current);
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

export function messageMatch(messages, query) {
  let best = null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const hit = textMatch(messages[index].text, query);
    if (hit && (!best || betterMatch(hit, best))) best = { ...hit, index };
  }
  return best;
}

export function searchExcerpt(text, hit, size = 140) {
  const start = Math.max(0, hit.at - Math.floor(size / 3));
  const end = start + size + hit.length;
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export function conversationEvidence({ user, assistant }, query) {
  let best = null;
  for (const [role, text] of [['user', user], ['assistant', assistant]]) {
    const hit = textMatch(text, query);
    if (hit && (!best || betterMatch(hit, best))) best = { ...hit, role, text: searchExcerpt(text, hit) };
  }
  return best;
}

/** Keep bounded preview text around a hit, including hits beyond the ordinary 4000-character prefix. */
export function previewMessages(messages, query = '') {
  const match = messageMatch(messages, query);
  return {
    messages: messages.map((message) => {
      const hit = query ? textMatch(message.text, query) : null;
      const start = hit ? Math.max(0, hit.at - 1000) : 0;
      return { ...message, text: message.text.slice(start, start + 4000) };
    }),
    ...(match ? { matchIndex: match.index } : {}),
  };
}
