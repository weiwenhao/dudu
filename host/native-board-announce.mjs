// What a phone that is away is told about, besides the board having changed (owner, 2026-11-22: 「弹通知也行」, as long as opening the App shows the messages at once): a reply, or a question, that
// comes to a conversation nobody has read. The phone is sent one push that shows the conversation's name and what was said, as a messaging app does, and that also wakes the App for a few
// seconds to write the board (`BoardWake.swift`). Apple delivers an alert at once and in order; it is the silent wake alone that Apple may hold back (native-board-wake.mjs).
//
// This module only says WHAT is announced and WHEN. Which phones are sent it, and the asking of Apple, are native-board-wake.mjs and native-notifications.mjs. The words are the conversation's name
// and the last paragraph of what it said: the plugin writes no wording of its own.

const MAX_TITLE = 80;
const MAX_BODY = 140;
const FRESH_MS = 60_000; // an answer the plugin first sees this long after it was published is old news, not a message
const oneLine = (text, max) => [...String(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');

/**
 * `conversationOf(sessionId)` says which conversation of the board a session is, `{ id: 'issue:12' | 'assistant', title }`, or nothing for a session the board does not show (a collector's,
 * a task's). `announce({ conversationId, title, body })` is told what to announce.
 */
export function createBoardAnnounce({ conversationOf, announce, now = Date.now }) {
  return {
    /** An answer, a question or an error was published in `sessionId`. `unread`: nobody has read it, on any screen. `baseline`: the first thing the plugin has seen of this session. */
    content({ id: sessionId, attention, unread, baseline = false }) {
      if (unread !== true || !['message', 'question'].includes(attention?.kind)) return;
      if (baseline && !(now() - (attention.at ?? 0) <= FRESH_MS)) return;
      let conversation;
      try { conversation = conversationOf(sessionId); } catch { return; }
      if (!conversation?.id) return;
      announce({
        conversationId: String(conversation.id),
        title: oneLine(conversation.title, MAX_TITLE) || ' ',
        // A question has no text of its own here (the last answer would be an old one): the conversation's name is the notice, and the conversation says the rest.
        body: attention.kind === 'message' ? oneLine(attention.preview, MAX_BODY) : '',
      });
    },
  };
}
