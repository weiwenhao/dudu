import { previewMessages } from '../../conversation-search.mjs';

export const CONVERSATION_PAGE_SIZE = 20;

/** A bounded page of conversation text; an exclusive cursor walks backwards without changing the transcript. */
export function conversationPage(messages, before, query) {
  const end = Math.min(before ?? messages.length, messages.length);
  const start = Math.max(0, end - CONVERSATION_PAGE_SIZE);
  return { outcome: 'success', untrusted: true, ...previewMessages(messages.slice(start, end), query), nextCursor: start || null };
}
