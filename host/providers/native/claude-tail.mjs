import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { isHumanPrompt, promptText } from './claude-store.mjs';
import { previewMessages } from '../../conversation-search.mjs';

// The end of a Claude Code transcript as a conversation, read without reading the file: a transcript reaches hundreds of
// megabytes and most of it is not conversation, while a preview wants twenty messages. The file is read backwards in chunks until
// enough messages are found; `before` (a byte position) continues from where an earlier page stopped.

const CHUNK = 1024 * 1024;
const SCAN_LIMIT = 48 * CHUNK; // one page never reads further back than this; the next page carries on from there

function parse(line) {
  try { return JSON.parse(line); } catch { return undefined; }
}

/** What one record says, as a conversation message, or undefined for a record that is not conversation. */
function messageOf(line) {
  const start = line.slice(0, 40);
  if (start.startsWith('{"type":"')) {
    if (!start.startsWith('{"type":"user"') && !start.startsWith('{"type":"assistant"')) return undefined;
  } else if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) return undefined;
  const record = parse(line);
  if (!record || record.isSidechain || record.isMeta || record.isCompactSummary) return undefined;
  const at = Date.parse(record.timestamp);
  if (record.type === 'user') {
    return isHumanPrompt(record) ? { role: 'user', id: record.uuid, at: Number.isNaN(at) ? undefined : at, text: promptText(record.message.content) } : undefined;
  }
  if (record.type !== 'assistant') return undefined;
  const content = record.message?.content;
  const text = (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string' && block.text).map((block) => block.text).join('\n');
  // An assistant message is written as one record per content block, all with the message's id.
  return { role: 'assistant', id: record.message?.id ?? record.uuid, at: Number.isNaN(at) ? undefined : at, text };
}

/**
 * The newest `count` messages that end before byte `before` (the end of the file when it is not given): { messages, nextCursor }.
 * `nextCursor` is the position to pass as `before` for the page before this one, or null when the start of the file was reached.
 */
export async function readClaudeTail({ file, before, query, count = 20, chunk: size = CHUNK, signal }) {
  signal?.throwIfAborted();
  const handle = await open(file, 'r');
  try {
    const length = (await handle.stat()).size;
    let position = Math.min(Number.isSafeInteger(before) && before > 0 ? before : length, length);
    let pending = Buffer.alloc(0); // a line that starts before `position` and ends inside what was read: its beginning is still to come
    let scanned = 0;
    const found = []; // newest first; an assistant message that continues in earlier records is merged as they are met
    let visible = 0; // how many of them have words (an assistant step that only called tools has none, and is not a message to show)
    while (position > 0 && visible <= count && scanned < Math.max(SCAN_LIMIT, 4 * size)) {
      signal?.throwIfAborted();
      const start = Math.max(0, position - size);
      const chunk = Buffer.alloc(position - start);
      await handle.read(chunk, 0, chunk.length, start);
      scanned += chunk.length;
      const data = Buffer.concat([chunk, pending]);
      let from = 0;
      if (start > 0) {
        const newline = data.indexOf(0x0a);
        if (newline === -1) { pending = data; position = start; continue; }
        pending = data.subarray(0, newline);
        from = newline + 1;
      } else pending = Buffer.alloc(0);
      const lines = data.subarray(from).toString('utf8').split('\n');
      // Byte offset of each line: the lines are walked from the end, so they are located from the start first.
      const offsets = [];
      let at = start + from;
      for (const line of lines) { offsets.push(at); at += Buffer.byteLength(line) + 1; }
      for (let index = lines.length - 1; index >= 0 && visible <= count; index--) {
        const message = messageOf(lines[index]);
        if (!message) continue;
        const newer = found.at(-1);
        if (message.role === 'assistant' && newer?.role === 'assistant' && newer.id === message.id) {
          if (message.text) {
            if (!newer.text) visible++;
            newer.text = newer.text ? `${message.text}\n${newer.text}` : message.text;
          }
          newer.offset = offsets[index];
        } else {
          found.push({ ...message, offset: offsets[index] });
          if (message.text) visible++;
        }
      }
      position = start;
    }
    const withText = found.filter((message) => message.text);
    const enough = withText.length > count;
    const reachedStart = position === 0;
    // The message found last may continue in records that were not read yet (until another one is met before it): it is left to the next
    // page, which starts at the oldest message shown here.
    const kept = (enough || reachedStart ? withText : withText.slice(0, -1)).slice(0, count);
    const oldest = kept.at(-1);
    const more = enough || !reachedStart;
    return {
      ...previewMessages([...kept].reverse().map(({ role, at: when, text }) => ({ role, ...(when === undefined ? {} : { at: when }), text })), query),
      nextCursor: !more ? null : oldest ? oldest.offset : position || null,
    };
  } finally {
    await handle.close();
  }
}
