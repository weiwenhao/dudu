// Word splitting for full-text search, shared by memory and issues. SQLite's FTS5 tokenizers do not split Chinese,
// so the application splits with Intl.Segmenter and writes space-joined words; queries go through the same function.
const words = new Intl.Segmenter('zh', { granularity: 'word' });

/** Lowercased, space-joined word tokens. Latin words and numbers stay whole, Chinese is split into words, punctuation is dropped. */
export function segment(text) {
  const out = [];
  for (const part of words.segment(String(text ?? '').normalize('NFKC'))) {
    if (part.isWordLike) out.push(part.segment.toLowerCase());
  }
  return out.join(' ');
}

/**
 * A safe FTS5 query for user input: every token is a quoted string (so operators, column filters and NEAR are plain
 * text), tokens are ANDed, and the last one is a prefix match so results appear while typing. '' means no usable token.
 */
export function matchQuery(text) {
  const tokens = segment(text).split(' ').filter(Boolean);
  return tokens.map((token, i) => `"${token.replaceAll('"', '""')}"${i === tokens.length - 1 ? '*' : ''}`).join(' ');
}
