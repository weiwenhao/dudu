import { Buffer } from 'node:buffer';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { mapLimit } from '../async.mjs';
import { claudeUsage } from '../usage.mjs';
import { claudeProjectsRoot } from './claude-store.mjs';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_ID = /^[a-z0-9_-]{1,128}$/i;
const empty = () => Buffer.alloc(0);

function account(state, line) {
  if (!line.includes('"assistant"')) return;
  let record;
  try { record = JSON.parse(line); } catch { return; }
  const message = record?.message;
  if (record.type !== 'assistant' || typeof message?.id !== 'string' || !message.id
    || message.model === '<synthetic>' || message.stop_reason === null) return;
  const usage = claudeUsage(message.usage);
  if (!usage) return;
  const previous = state.messages.get(message.id);
  for (const key of new Set([...Object.keys(previous ?? {}), ...Object.keys(usage)])) {
    state.total[key] = (state.total[key] ?? 0) - (previous?.[key] ?? 0) + (usage[key] ?? 0);
  }
  state.messages.set(message.id, usage);
}

/** Claude writes one assistant message per content block, repeating its usage. Read each message's latest sample once. */
function consume(state, bytes) {
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(10, start);
    const end = newline < 0 ? bytes.length : newline;
    if (!state.skip) {
      const part = bytes.subarray(start, end);
      state.pending = state.pending.length ? Buffer.concat([state.pending, part]) : Buffer.from(part);
      // Large request blobs and pasted images need neither decoding nor retaining while the line is still growing.
      const type = /^\{"type":"([^"]+)"/.exec(state.pending.subarray(0, 100).toString('utf8'))?.[1];
      if (type && type !== 'assistant') { state.skip = true; state.pending = empty(); }
    }
    if (newline < 0) return;
    if (!state.skip) account(state, state.pending.toString('utf8'));
    state.pending = empty();
    state.skip = false;
    start = newline + 1;
  }
}

/**
 * Usage of observed Claude children from their own native store. No model, protocol command or path supplied by a task is used.
 * Each file is read once, then only its appended bytes; an incomplete JSONL tail waits for the next native boundary.
 */
export function createClaudeChildUsageReader({ root = claudeProjectsRoot() } = {}) {
  const directories = new Map();
  const files = new Map();

  async function directoryOf(sessionId) {
    if (directories.has(sessionId)) return directories.get(sessionId);
    let projects;
    try { projects = await readdir(root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    const candidates = await mapLimit(projects.filter((entry) => entry.isDirectory()), 8, async (entry) => {
      const directory = join(root, entry.name, sessionId, 'subagents');
      try { return (await stat(directory)).isDirectory() ? directory : undefined; }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    });
    const found = candidates.find(Boolean);
    if (found) directories.set(sessionId, found);
    return found;
  }

  return {
    async read({ sessionId, taskId }) {
      if (!SESSION_ID.test(sessionId) || !TASK_ID.test(taskId)) return undefined;
      const directory = await directoryOf(sessionId);
      if (!directory) return undefined;
      const file = join(directory, `agent-${taskId}.jsonl`);
      let handle;
      try { handle = await open(file, 'r'); }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
      try {
        const info = await handle.stat();
        const identity = `${info.dev}:${info.ino}`;
        let state = files.get(file);
        if (!state || state.identity !== identity || info.size < state.position
          || info.size === state.position && info.mtimeMs !== state.mtimeMs) {
          state = { identity, position: 0, pending: empty(), skip: false, messages: new Map(), total: {} };
          files.set(file, state);
        }
        const buffer = Buffer.alloc(64 * 1024);
        while (state.position < info.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - state.position), state.position);
          if (!bytesRead) break;
          consume(state, buffer.subarray(0, bytesRead));
          state.position += bytesRead;
        }
        state.mtimeMs = info.mtimeMs;
        return state.messages.size ? { ...state.total } : undefined;
      } finally { await handle.close(); }
    },
    close() { directories.clear(); files.clear(); },
  };
}
