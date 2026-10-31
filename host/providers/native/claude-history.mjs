import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { blocksOf, isHumanPrompt, promptText } from './claude-store.mjs';
import { settled } from './history.mjs';
import { clip, oneLine } from './text.mjs';

// The conversation inside a Claude Code transcript. A transcript is a log of records, and most of its bytes are not
// conversation (the requests Claude sent, attachments, snapshots), so lines are filtered before they are parsed and
// only what a conversation needs is kept: what the person typed, what Claude said and did, and what the tools answered.

const TEXT_LIMIT = 256 * 1024;

function parse(line) {
  try { return JSON.parse(line); } catch { return undefined; }
}

const resultText = (content) => clip(blocksOf(content).map((block) => {
  if (block?.type === 'text' && typeof block.text === 'string') return block.text;
  if (block?.type === 'image') return '[image]';
  return '';
}).filter(Boolean).join('\n'), TEXT_LIMIT);

function boundedInput(input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return JSON.stringify(value).length <= TEXT_LIMIT ? value : { _truncated: clip(JSON.stringify(value), 2000) };
}

/** The parts of a message that a conversation shows; `results: false` leaves the output of tool calls out. */
function compactBlocks(content, { results = true } = {}) {
  const blocks = [];
  for (const block of blocksOf(content)) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text) blocks.push({ type: 'text', text: clip(block.text, TEXT_LIMIT) });
    else if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) blocks.push({ type: 'reasoning', text: clip(block.thinking, TEXT_LIMIT) });
    else if (block?.type === 'tool_use' && typeof block.id === 'string') blocks.push({ type: 'tool_use', id: block.id, name: String(block.name ?? 'unknown'), input: boundedInput(block.input) });
    else if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') blocks.push({ type: 'tool_result', id: block.tool_use_id, output: results ? resultText(block.content) : '', isError: block.is_error === true });
  }
  return blocks;
}

/**
 * Turns of a transcript: each begins with something the person typed and holds the steps Claude took in answer, one per
 * assistant message (a message is written as one record per block, sharing the message id), with the results of
 * its tool calls. `records` are the kept user and assistant records in order.
 */
export function turnsOf(records) {
  const turns = [];
  let turn;
  let step;
  for (const record of records) {
    if (record.type === 'user') {
      const results = record.blocks.filter((block) => block.type === 'tool_result');
      if (results.length) {
        if (turn) for (const result of results) turn.results.set(result.id, { output: result.output, isError: result.isError });
        continue;
      }
      if (record.prompt === undefined) continue;
      turn = { at: record.at, prompt: record.prompt, steps: [], results: new Map() };
      turns.push(turn);
      step = undefined;
    } else if (turn) {
      if (!step || step.messageId !== record.messageId) {
        step = { messageId: record.messageId, at: record.at, model: record.model, blocks: [], calls: [] };
        turn.steps.push(step);
      }
      for (const block of record.blocks) {
        if (block.type === 'tool_use') {
          step.calls.push(block);
          step.blocks.push({ type: 'tool-call', id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
        } else if (block.type === 'text' || block.type === 'reasoning') step.blocks.push(block);
      }
    }
  }
  return turns;
}

/** Read a Claude Code transcript as a conversation. */
export async function readClaudeHistory({ file, id, results = true }) {
  const kept = [];
  const positions = new Map();
  let customTitle = ''; let aiTitle = ''; let cwd = null; let branch = null; let createdAt = null; let model = null;
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    const start = line.slice(0, 40);
    if (start.startsWith('{"type":"')) {
      if (start.startsWith('{"type":"ai-title"')) aiTitle = parse(line)?.aiTitle ?? aiTitle;
      else if (start.startsWith('{"type":"custom-title"')) customTitle = parse(line)?.customTitle ?? customTitle;
      else if (!start.startsWith('{"type":"user"') && !start.startsWith('{"type":"assistant"')) continue;
    } else if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue;
    const record = parse(line);
    if (!record || (record.type !== 'user' && record.type !== 'assistant') || record.isSidechain) continue;
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd;
    if (!branch && typeof record.gitBranch === 'string' && record.gitBranch !== 'HEAD') branch = record.gitBranch;
    const at = Date.parse(record.timestamp);
    if (createdAt === null && !Number.isNaN(at)) createdAt = at;
    if (record.isMeta || record.isCompactSummary) continue;
    const human = isHumanPrompt(record);
    // A prompt written after a rewind continues from an earlier message: what came after that message is another branch.
    if (human && typeof record.parentUuid === 'string' && positions.has(record.parentUuid)) {
      const keep = positions.get(record.parentUuid) + 1;
      if (keep < kept.length) {
        for (const dropped of kept.splice(keep)) positions.delete(dropped.uuid);
      }
    }
    const entry = {
      uuid: record.uuid, type: record.type, at: Number.isNaN(at) ? createdAt ?? Date.now() : at,
      messageId: record.message?.id ?? record.uuid, model: record.message?.model,
      blocks: compactBlocks(record.message?.content, { results }),
      ...(human ? { prompt: promptText(record.message.content) } : {}),
    };
    if (record.type === 'assistant' && typeof entry.model === 'string' && entry.model !== '<synthetic>') model = entry.model;
    positions.set(entry.uuid, kept.length);
    kept.push(entry);
  }
  const turns = settled(turnsOf(kept));
  const first = turns[0]?.prompt ?? '';
  return { provider: 'claude', id, cwd, branch, createdAt, model, title: oneLine(customTitle || aiTitle || first), turns };
}
