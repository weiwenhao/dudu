/** A bounded page of conversation text; an exclusive cursor walks backwards without changing the transcript. */
export function conversationPage(messages, before) {
  const end = Math.min(before ?? messages.length, messages.length);
  const start = Math.max(0, end - 20);
  return { outcome: 'success', untrusted: true, messages: messages.slice(start, end), nextCursor: start || null };
}
