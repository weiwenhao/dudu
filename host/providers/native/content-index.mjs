// In-memory conversation matching, also used by callers that do not supply a cache file.
// Production catalogs use cached-content-index.mjs: durable SQLite and search on a worker.
import { conversationEvidence } from '../../conversation-search.mjs';
import { conversationPage } from './preview.mjs';
import { IMAGE_MARKER } from './images.mjs';

const SNIPPET = 140;

/** The text of a conversation: what the person typed and what the harness answered, each joined into one string. */
export function textOf(history) {
  const user = [];
  const assistant = [];
  for (const turn of history.turns) {
    user.push(turn.prompt);
    for (const step of turn.steps) {
      if (step.input?.prompt) user.push(step.input.prompt);
      for (const block of step.blocks) if (block.type === 'text') assistant.push(block.text);
    }
  }
  return { user: user.join('\n'), assistant: assistant.join('\n') };
}

/** Search all original Codex message text, including mid-turn input and text beyond the import/preview display limit. */
export function codexSearchText(thread, { includeMessages = false } = {}) {
  const user = [];
  const assistant = [];
  const messages = [];
  for (const turn of Array.isArray(thread?.turns) ? thread.turns : []) {
    const at = Number.isFinite(turn.startedAt) ? turn.startedAt * 1000 : undefined;
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (item?.type === 'userMessage') {
        const text = (Array.isArray(item.content) ? item.content : []).filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n');
        user.push(text);
        if (includeMessages) {
          const parts = [];
          for (const part of Array.isArray(item.content) ? item.content : []) {
            if (part?.type === 'text' && typeof part.text === 'string' && part.text) parts.push(part.text);
            else if (['image', 'localImage'].includes(part?.type) && parts.at(-1) !== IMAGE_MARKER) parts.push(IMAGE_MARKER);
          }
          const visible = parts.join('\n').trim();
          if (visible) messages.push({ role: 'user', ...(at === undefined ? {} : { at }), text: visible });
        }
      } else if (item?.type === 'agentMessage' && typeof item.text === 'string') {
        assistant.push(item.text);
        if (includeMessages && item.text.trim()) messages.push({ role: 'assistant', ...(at === undefined ? {} : { at }), text: item.text });
      }
    }
  }
  return { user: user.join('\n'), assistant: assistant.join('\n'), ...(includeMessages ? { messages } : {}) };
}

export function createContentIndex() {
  const docs = new Map();
  return {
    get size() { return docs.size; },
    stamp: (key) => docs.get(key)?.stamp,
    messageStamp: (key) => docs.get(key)?.messageStamp,
    has: (key) => docs.has(key),
    keys: () => [...docs.keys()],
    set(key, stamp, { user, assistant, messages }) {
      const previous = docs.get(key);
      docs.set(key, {
        stamp, user, assistant, userLower: user.toLowerCase(), assistantLower: assistant.toLowerCase(),
        messages: messages ?? previous?.messages, messageStamp: messages ? stamp : previous?.messageStamp,
      });
    },
    page(key, { before, query } = {}) {
      const doc = docs.get(key);
      return doc?.messages ? conversationPage(doc.messages, before, query) : null;
    },
    delete: (key) => docs.delete(key),
    evidence(keys, query) {
      return new Map(keys.flatMap((key) => {
        const doc = docs.get(key);
        const hit = doc && conversationEvidence(doc, query);
        return hit ? [[key, hit]] : [];
      }));
    },
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
