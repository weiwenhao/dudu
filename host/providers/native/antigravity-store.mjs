import { stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import path, { join } from 'node:path';
import { turnsOf } from './claude-history.mjs';
import { environmentValue } from './environment.mjs';
import { settled } from './history.mjs';
import { allOf, fieldsOf, messageOf, numberOf, stringOf } from './protobuf.mjs';
import { clip, oneLine } from './text.mjs';
import { canonicalInput, kindOf, mirrorName } from '../drivers/universal-tools.mjs';

// The conversations Antigravity (`agy`) keeps for itself, read so that a DSH session that runs on it can be brought up to date with what its own store says (see sync.mjs). Its
// ACP server cannot be asked for them through OAR, so the store is read here: `<gemini directory>/antigravity-cli/conversations/<id>.db`, one SQLite database per conversation
// (`GEMINI_HOME` moves the gemini directory, as OAR's Antigravity runtime has it). A database has a table of steps, and a step is a protobuf message that the vendor publishes no
// definition of: what is read from it was found by looking at real conversations, and each field that is used is named below. A step that does not look as it should is skipped, so a
// version of agy that writes something else reads as a shorter conversation (and the synchronization then adds nothing), never as a crash.
//
//   step_type 14   what the person typed:             payload field 19, whose field 2 is the text
//   step_type 15   what the model answered, one step per request: payload field 20: 3 its reasoning, 1 its words, 7 (repeated) its calls, each { 1 id, 2 name, 3 arguments as JSON }
//   step_type 132  the result of one tool call:        payload field 5 -> 4 is the call ({ 1 id, 2 name, 3 arguments }), field 140 -> 2 -> 1 the result's text
//   anything else  (messages between agents, bookkeeping) is not part of what the person sees
// Every step has its creation time in payload field 5 -> 1 ({ 1 seconds, 2 nanoseconds }), and a `status` column (3 done); a step that failed has `error_details`.

const TEXT_LIMIT = 256 * 1024;
const USER = 14;
const ANSWER = 15;
const RESULT = 132;
const DONE = 3;

const idPattern = /^[A-Za-z0-9-]{8,64}$/;

/** The folder of the conversation databases: `antigravity-cli/conversations` in the gemini folder, which is `GEMINI_HOME` or else `.gemini` in the home folder (`HOME`, `USERPROFILE` on Windows). */
export function antigravityConversationsRoot(env = process.env, { platform = process.platform, home = homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const gemini = environmentValue(env, 'GEMINI_HOME', platform) ?? paths.join(environmentValue(env, platform === 'win32' ? 'USERPROFILE' : 'HOME', platform) ?? home, '.gemini');
  return paths.join(gemini, 'antigravity-cli', 'conversations');
}

/** What the plugin knows of a conversation without reading it: where it is and how big it is (a database that was written to lately is partly in its `-wal` file, which counts). */
async function summaryOf(id, { env } = {}) {
  if (!idPattern.test(id)) return undefined;
  const file = join(antigravityConversationsRoot(env), `${id}.db`);
  let info;
  try { info = await stat(file); } catch { return undefined; }
  if (!info.isFile()) return undefined;
  let size = info.size;
  let mtimeMs = info.mtimeMs;
  try {
    const log = await stat(`${file}-wal`);
    size += log.size;
    mtimeMs = Math.max(mtimeMs, log.mtimeMs);
  } catch { /* checkpointed: all of it is in the database */ }
  return { provider: 'antigravity', id, title: '', cwd: undefined, file, size, mtimeMs, updatedAt: Math.trunc(mtimeMs) };
}

/** When a step was made, in milliseconds. */
function timeOf(payload) {
  const created = messageOf(messageOf(payload, 5), 1);
  const seconds = numberOf(created, 1);
  return Number.isFinite(seconds) ? seconds * 1000 + Math.trunc((numberOf(created, 2) ?? 0) / 1e6) : undefined;
}

// What agy calls a tool, by what the tool does, for the names that neither OAR's table nor the universal driver's patterns know (its ACP frames say `search` for these).
const KIND_OF_TOOL = Object.freeze({ search_web: 'search' });

/** A tool call as DSH records a call of this harness: named for what it does, with the canonical input the cards read. */
function callBlock(call) {
  let raw;
  try { raw = JSON.parse(call.arguments); } catch { raw = undefined; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  const kind = kindOf(undefined, call.name, KIND_OF_TOOL[call.name]);
  const input = canonicalInput({ kind, tool: call.name, raw });
  return { type: 'tool_use', id: call.id, name: mirrorName('antigravity', kind), input: JSON.stringify(input).length <= TEXT_LIMIT ? input : { ...input, input: { _truncated: true } } };
}

/** The text of a tool's result, without the two lines that say when it ran. */
const outputOf = (text) => clip(text.replace(/^(?:(?:Created|Completed) At: [^\n]*\n)+/, ''), TEXT_LIMIT);

/**
 * Read an Antigravity conversation (history.mjs). A turn begins with what the person typed; what they typed while the model worked (after the answers to its calls, before its
 * next request) belongs to the step that follows.
 */
export function readAntigravityHistory({ file, id }) {
  const database = new DatabaseSync(file, { readOnly: true, timeout: 2000 });
  const kept = [];
  let waiting = new Set(); // the calls of the last answer that have no result yet
  let working = false;     // the last answer asked for tools: the model is in the middle of a reply
  let createdAt = null;
  try {
    const steps = database.prepare('select idx, step_type, status, error_details is not null as failed, step_payload from steps where step_type in (14, 15, 132) order by idx');
    for (const row of steps.iterate()) {
      const payload = fieldsOf(row.step_payload);
      const at = timeOf(payload) ?? createdAt ?? Date.now();
      if (createdAt === null) createdAt = at;
      // (Field 5 -> 12 names the request the step belongs to, shared by all the steps of one turn, so it cannot name a step.)
      const uuid = `step-${row.idx}`;
      if (row.step_type === USER) {
        const prompt = stringOf(messageOf(payload, 19), 2).trim();
        if (!prompt) continue;
        if (working && waiting.size === 0) kept.push({ type: 'input', uuid, at, prompt });
        else { kept.push({ type: 'user', uuid, at, prompt, blocks: [] }); working = false; }
      } else if (row.step_type === ANSWER) {
        const answer = messageOf(payload, 20);
        const reasoning = stringOf(answer, 3);
        const words = stringOf(answer, 1) || stringOf(answer, 8);
        const calls = allOf(answer, 7).map((field) => fieldsOf(field.value)).map((call) => ({ id: stringOf(call, 1), name: stringOf(call, 2), arguments: stringOf(call, 3) })).filter((call) => call.id && call.name);
        const blocks = [
          ...(reasoning.trim() ? [{ type: 'reasoning', text: clip(reasoning, TEXT_LIMIT) }] : []),
          ...(words ? [{ type: 'text', text: clip(words, TEXT_LIMIT) }] : []),
          ...calls.map(callBlock),
        ];
        waiting = new Set(calls.map((call) => call.id));
        working = calls.length > 0;
        // A request that is not finished (the model is still answering) has not stopped: the turn is open.
        kept.push({ type: 'assistant', uuid, at, messageId: uuid, stopReason: row.status !== DONE ? null : calls.length ? 'tool_use' : 'end_turn', blocks });
      } else {
        const call = messageOf(messageOf(payload, 5), 4);
        const callId = stringOf(call, 1);
        if (!callId) continue;
        waiting.delete(callId);
        const output = stringOf(messageOf(messageOf(payload, 140), 2), 1);
        kept.push({ type: 'user', uuid, at, blocks: [{ type: 'tool_result', id: callId, output: outputOf(output), isError: row.failed === 1 }] });
      }
    }
  } finally { database.close(); }
  const turns = settled(turnsOf(kept));
  return { provider: 'antigravity', id, cwd: null, branch: null, createdAt, model: null, title: oneLine(turns[0]?.prompt ?? ''), turns };
}

/** Antigravity, for the synchronization of a DSH session that runs on it (native/index.mjs): where a conversation is, and what it holds. */
export const antigravityStore = {
  id: 'antigravity',
  summary: (id, options) => summaryOf(id, options),
  history: async (summary) => readAntigravityHistory({ file: summary.file, id: summary.id }),
};
