// How a line of the group chat shows in the thread of 嘟嘟's conversation (owner, 2026-11-10; host/assistant/home/group.mjs, docs/assistant.md 4.1): it is its command's two events, as a card is (card-events.mjs).
// The run says which line and where it stands (its sequence number, which is also where it sorts among the messages); the done says it was made. What the line says is kept by the plugin under the
// command's id and comes by `assistant/cards`, with the cards.
export const SAY_COMMAND = 'dudu-say';
// Kept apart from the cards' runs in the same memory: a card's done must never find a line's run.
const key = (commandId) => `say:${commandId}`;
/** An answer that has not come for this long is not waited for any more (the plugin was restarted, or the agent was left). */
export const WAIT_LIMIT = 15 * 60_000;

/** The message a line's command event makes (`{ id, at, role: 'group', commandId }`), or null: nothing for any other command, for the run alone, and for a line that failed. */
export function groupEvent(event, memory) {
  const data = event?.data ?? {};
  if (typeof data.commandId !== 'string') return null;
  if (event.type === 'command/run') {
    if (data.name === SAY_COMMAND) memory.set(key(data.commandId), { seq: event.seq, time: event.time });
    return null;
  }
  if (event.type !== 'command/done' || data.kind !== 'success') return null;
  const run = memory.get(key(data.commandId));
  return run ? { id: run.seq, at: run.time, role: 'group', commandId: data.commandId } : null;
}

/**
 * The lines the owner wrote to an issue whose answer is still on its way: an `at` line that no `reply` or `end` names, and that is not older than WAIT_LIMIT or carries live text.
 * `lines` are the plugin's records by command id. Each result is `{ commandId, line }`: dots or live text stand under that line.
 */
export function waitingLines(messages, lines, now = Date.now()) {
  const answered = new Set();
  for (const message of messages) {
    if (message.role !== 'group') continue;
    const line = lines[message.commandId];
    if (line && line.kind !== 'at' && typeof line.to === 'string') answered.add(line.to);
  }
  return messages.flatMap((message) => {
    if (message.role !== 'group') return [];
    const line = lines[message.commandId];
    if (!line || line.kind !== 'at' || answered.has(message.commandId)) return [];
    if (!line.liveReply?.text && Number.isFinite(line.at) && now - line.at > WAIT_LIMIT) return [];
    return [{ commandId: message.commandId, line }];
  });
}

/**
 * The thread in the order the owner reads it: an issue's answer (`reply`, or the silent `end`) stands right under the line it answers, where its dots stood while it was awaited, and not where it happened to
 * arrive, after everything written since (owner, 2026-11-11, with a screenshot of an answer at the end of the thread: "这个消息有回复了直接跳过了所有消息在最新消息展示，我希望这个消息能停留在 loading 框对应的位置").
 * `lines` are the plugin's records by command id (`kind`, and for an answer `to`: the command of the line it answers). An answer moves behind its line, behind the answers already there, and takes the line's
 * time, so that it is filed under the same day. One whose line is not in `messages` (hidden by the owner, or on a page not read yet) stays where it arrived. The other messages keep their order.
 */
export function placeReplies(messages, lines) {
  const askedAt = new Map();
  messages.forEach((message, index) => {
    if (message.role === 'group' && lines[message.commandId]?.kind === 'at') askedAt.set(message.commandId, index);
  });
  const under = new Map();
  for (const message of messages) {
    if (message.role !== 'group') continue;
    const line = lines[message.commandId];
    if (!line || line.kind === 'at' || typeof line.to !== 'string' || !askedAt.has(line.to)) continue;
    under.set(line.to, [...(under.get(line.to) ?? []), message]);
  }
  if (!under.size) return messages;
  const moved = new Set([...under.values()].flat());
  return messages.flatMap((message) => {
    if (moved.has(message)) return [];
    const answers = message.role === 'group' ? under.get(message.commandId) : undefined;
    return answers ? [message, ...answers.map((answer) => ({ ...answer, at: message.at }))] : [message];
  });
}

/** A message as one quiet line for under a title: the marks of markdown (emphasis, code, headings, quotes, bullets, the bars of a table) are left out and the lines are run together. */
export function plainText(markdown) {
  return String(markdown ?? '').split(/\r?\n/u).map((raw) => raw.trim())
    // the fence lines of code and the rule row of a table ("|---|---|") say nothing
    .filter((line) => !line.startsWith('```') && !(line.includes('-') && /^[|\-: ]+$/u.test(line)))
    .map((line) => (line.startsWith('|') || line.includes(' | ') ? line.split('|').map((cell) => cell.trim()).filter(Boolean).join(' ') : line))
    .map((line) => line.replace(/^[#>\s]+/u, '').replace(/^(?:[-*+]|\d{1,3}\.)\s+/u, '').replaceAll('**', '').replaceAll('__', '').replaceAll('`', '').trim())
    .filter(Boolean).join(' ');
}
