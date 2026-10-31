// What was said in the conversations, kept in memory so a search can look inside them. All the conversation text of a
// computer is small (some tens of megabytes), it is read again from the harnesses' own files whenever they change, and
// nothing of it is written anywhere.

const SNIPPET = 140;

/** The text of a conversation: what the person typed and what the harness answered, each joined into one string. */
export function textOf(history) {
  const user = [];
  const assistant = [];
  for (const turn of history.turns) {
    user.push(turn.prompt);
    for (const step of turn.steps) for (const block of step.blocks) if (block.type === 'text') assistant.push(block.text);
  }
  return { user: user.join('\n'), assistant: assistant.join('\n') };
}

export function createContentIndex() {
  const docs = new Map();
  return {
    get size() { return docs.size; },
    stamp: (key) => docs.get(key)?.stamp,
    has: (key) => docs.has(key),
    keys: () => [...docs.keys()],
    set(key, stamp, { user, assistant }) {
      docs.set(key, { stamp, user, assistant, userLower: user.toLowerCase(), assistantLower: assistant.toLowerCase() });
    },
    delete: (key) => docs.delete(key),
    /** Where `term` (lower case) first occurs in the conversation of each session that holds it. */
    find(term) {
      const found = new Map();
      for (const [key, doc] of docs) {
        const inUser = doc.userLower.indexOf(term);
        if (inUser >= 0) { found.set(key, { role: 'user', at: inUser }); continue; }
        const inAssistant = doc.assistantLower.indexOf(term);
        if (inAssistant >= 0) found.set(key, { role: 'assistant', at: inAssistant });
      }
      return found;
    },
    /** A few words around a match. */
    snippet(key, { role, at }, length) {
      const doc = docs.get(key);
      const text = role === 'user' ? doc?.user : doc?.assistant;
      if (!text) return '';
      const start = Math.max(0, at - Math.floor(SNIPPET / 3));
      const piece = text.slice(start, start + SNIPPET + length).replace(/\s+/g, ' ').trim();
      return `${start > 0 ? '…' : ''}${piece}${start + SNIPPET + length < text.length ? '…' : ''}`;
    },
  };
}
