// A recently previewed page needs neither a second transcript read nor a spinner on the way back.
const stores = new WeakMap();
const LIMIT = 12;
const keyOf = ({ provider, id, updatedAt, previewVersion, query = '' }) => JSON.stringify([provider, id, updatedAt, previewVersion, query]);
const conversationOf = ({ provider, id, query = '' }) => JSON.stringify([provider, id, query]);

export function previewCache(readSession) {
  if (!stores.has(readSession)) stores.set(readSession, new Map());
  const pages = stores.get(readSession);
  return {
    get(session) {
      const key = keyOf(session);
      const item = pages.get(key);
      if (!item) return null;
      pages.delete(key);
      pages.set(key, item);
      return item.value;
    },
    latest(session) {
      const conversation = conversationOf(session);
      return [...pages.values()].findLast((item) => item.conversation === conversation)?.value ?? null;
    },
    set(session, value) {
      const key = keyOf(session);
      const conversation = conversationOf(session);
      for (const [oldKey, item] of pages) if (item.conversation === conversation) pages.delete(oldKey);
      pages.delete(key);
      pages.set(key, { conversation, value });
      while (pages.size > LIMIT) pages.delete(pages.keys().next().value);
    },
  };
}
