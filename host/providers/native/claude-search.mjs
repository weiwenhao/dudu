import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { blocksOf, isHumanPrompt, promptText } from './claude-store.mjs';

// A conversation this size stops growing the in-memory index further, dropping the oldest text first: a transcript
// left to run for days reaches gigabytes, and indexing it whole crashed the host's Worker on an out-of-memory error.
const SEARCH_TEXT_BUDGET = 6 * 1024 * 1024;

/** Index conversation text only: no tool payloads, reasoning, image bytes or reconstruction of a harness turn. */
export async function readClaudeSearch(file, { includeMessages = false } = {}) {
  const records = [];
  const positions = new Map();
  let budget = 0;
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.startsWith('{"type":"') && !/^\{"type":"(?:user|assistant)"/.test(line)) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (!record || !['user', 'assistant'].includes(record.type) || record.isSidechain || record.isMeta || record.isCompactSummary) continue;
      const human = isHumanPrompt(record);
      if (human && positions.has(record.parentUuid)) {
        const from = records.indexOf(positions.get(record.parentUuid)) + 1;
        if (from > 0) for (const removed of records.splice(from)) {
          positions.delete(removed.id);
          budget -= removed.text.length;
        }
      }
      const text = record.type === 'assistant'
        ? blocksOf(record.message?.content).filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
        : human ? promptText(record.message.content) : '';
      const at = Date.parse(record.timestamp);
      const entry = {
        id: record.uuid, role: record.type, text,
        ...(includeMessages ? { messageId: record.message?.id ?? record.uuid, at: Number.isFinite(at) ? at : undefined } : {}),
      };
      if (record.uuid) positions.set(record.uuid, entry);
      records.push(entry);
      budget += text.length;
      while (budget > SEARCH_TEXT_BUDGET && records.length > 1) {
        const [evicted] = records.splice(0, 1);
        positions.delete(evicted.id);
        budget -= evicted.text.length;
      }
    }
  } finally { lines.close(); input.destroy(); }
  const messages = [];
  if (includeMessages) for (const record of records) {
    const previous = messages.at(-1);
    if (record.role === 'assistant' && previous?.role === 'assistant' && previous.id === record.messageId) {
      if (record.text) previous.text = previous.text ? `${previous.text}\n${record.text}` : record.text;
    } else messages.push({ id: record.messageId, role: record.role, at: record.at, text: record.text });
  }
  return {
    user: records.filter((record) => record.role === 'user' && record.text).map((record) => record.text).join('\n'),
    assistant: records.filter((record) => record.role === 'assistant' && record.text).map((record) => record.text).join('\n'),
    ...(includeMessages ? { messages: messages.filter((message) => message.text.trim()).map(({ id: _id, ...message }) => message) } : {}),
  };
}
