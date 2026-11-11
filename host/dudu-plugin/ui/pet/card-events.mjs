// How a card of 嘟嘟's chat shows in the thread: it is its command's two events (host/assistant/home/cards.mjs). The run says which card and where it stands (its sequence number, which is also
// where it sorts among the messages); the done says it was made. The two can arrive in different reads of the thread, so what the run said is kept in `memory` (the same Map the reads keep for
// tool calls) until the done comes.
export const CARD_COMMAND = 'dudu-card';
const key = (commandId) => `command:${commandId}`;

/** The message a command event makes (`{ id, at, role: 'card', commandId, kind }`), or null: nothing for any other command, for the run alone, and for a card that failed. */
export function cardEvent(event, memory) {
  const data = event?.data ?? {};
  if (typeof data.commandId !== 'string') return null;
  if (event.type === 'command/run') {
    if (data.name === CARD_COMMAND) memory.set(key(data.commandId), { seq: event.seq, time: event.time, kind: String(data.args ?? '').trim() });
    return null;
  }
  if (event.type !== 'command/done' || data.kind !== 'success') return null;
  const run = memory.get(key(data.commandId));
  return run ? { id: run.seq, at: run.time, role: 'card', commandId: data.commandId, kind: run.kind } : null;
}

/**
 * The card that a tap of `kind` would only repeat (owner, 2026-11-10: "连点就发一张"): the newest card of that kind with nothing after it in the thread but other cards. A conversation
 * since then (a message, a reply, a tool) makes the next card a new one even when its list is the same, so this is null. The plugin compares the lists (`assistant/card`, `since`).
 */
export function repeatableCard(messages, kind) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'card') return null;
    if (message.kind === kind && typeof message.commandId === 'string') return message.commandId;
  }
  return null;
}
