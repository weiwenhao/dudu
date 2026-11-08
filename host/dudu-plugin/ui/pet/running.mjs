// What the running line of the conversation window needs, counted as DSH's own conversation counts it.

/**
 * "1h 2m 5s" or "1小时2分5秒": hours when there are any, minutes from the first minute on, seconds always. DSH's formatRunDuration, with its
 * units (`units`: the words for hour, minute and second, spacing included) given by the caller.
 */
export function formatRunDuration(ms, units) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return `${hours > 0 ? `${hours}${units.hour}` : ''}${total >= 60 ? `${minutes}${units.minute}` : ''}${seconds}${units.second}`;
}

/**
 * When the work now going on began: the time of the owner's last message that has no reply after it. A turn that began by itself (a
 * connector's intake, a compaction) has no such message: then there is none, and the line counts from when it was first seen.
 */
export function turnStart(messages) {
  const lastReply = messages.findLast((message) => message.role === 'dudu')?.at ?? 0;
  return messages.findLast((message) => message.role === 'owner' && message.at > lastReply)?.at;
}
