// Readers of the sessions the harnesses already have on this computer, for createSessions (docs/assistant.md 3.4). They are
// adapters over host/providers/native/ (listing, registry paths, the app-server), which stays as it is. They only read, and of a
// transcript only its ends: head and tail of a file that can be hundreds of megabytes.
//
//   const claude = claudeReader({ root, registry })     // ~/.claude/projects and ~/.claude/sessions by default
//   const codex = codexReader({ command, environment }) // both may be functions, asked again at every read
//
// A reader is { provider, live?(), scan(), refresh?(ids), read(id, { turns, chars }) }. live (cheap, often) and scan (the
// whole listing, by file time) both answer the facts of every session the reader knows, in the shapes states.mjs describes:
// { id, title, cwd, branch, updatedAt, lastActivityAt, excerpt, ...what the rules read }. refresh re-reads the named sessions
// now. read answers { turns: [{ at, prompt, reply, tools }], more } for the end of one session.
import { Buffer } from 'node:buffer';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { mapLimit } from '../../providers/async.mjs';
import { blocksOf, claudeProjectsRoot, isHumanPrompt, listClaudeSessions, promptText } from '../../providers/native/claude-store.mjs';
import { listCodexThreads, withAppServer } from '../../providers/native/codex-store.mjs';
import { claudeSessionRegistry } from '../../providers/native/running.mjs';
import { oneLine } from '../../providers/native/text.mjs';
import { ENDING_CHARS, EXCERPT_CHARS } from './states.mjs';

// How far from the end of a transcript to look, widened only while no conversation record is in what was read (the requests
// Claude sent are in the file too, a few of them hundreds of kilobytes). Most of the real ones were in the first read.
const TAIL_WINDOWS = [128 * 1024, 512 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024];
const READ_WINDOWS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
const LIVE_STATUSES = new Set(['busy', 'shell', 'idle', 'waiting']);
const INTERRUPTED = /^\s*\[Request interrupted by user/;
// A slash command the person ran (/model, /effort, /exit) is written as a user record; it is not something said to the model.
const COMMAND = /^\s*<command-name>/;
// A message that stopped for one of these is not the end of a turn: the model is waiting for a tool, or is to be asked to go on.
const GOES_ON = new Set(['tool_use', 'pause_turn']);

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
const ms = (value) => { const at = Date.parse(value); return Number.isNaN(at) ? null : at; };
const textOf = (blocks) => blocks.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n').trim();
const value = (source) => (typeof source === 'function' ? source() : source);
const keepAll = () => false;

// --- Claude Code ----------------------------------------------------------------------------------------------------

/**
 * The live Claude Code processes by session. This is running.mjs's listRunningClaude with what it leaves out: the registry has four
 * statuses (busy, shell, idle, waiting) and the name of what a waiting session waits for; listRunningClaude keeps only busy or not.
 * A file that cannot be parsed right now (a write in progress) is read as it was the last time rather than as a session that left.
 */
async function readRegistry({ directory, alive, lastGood }) {
  let names;
  try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const sessions = new Map();
  const seen = new Set();
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    seen.add(name);
    let entry;
    try { entry = JSON.parse(await readFile(join(directory, name), 'utf8')); } catch { entry = lastGood.get(name); }
    if (!Number.isInteger(entry?.pid) || typeof entry.sessionId !== 'string' || !alive(entry.pid)) { lastGood.delete(name); continue; }
    lastGood.set(name, entry);
    const item = {
      pid: entry.pid, status: LIVE_STATUSES.has(entry.status) ? entry.status : 'idle',
      since: [entry.statusUpdatedAt, entry.updatedAt, entry.startedAt].find(Number.isFinite) ?? null,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      waitingFor: typeof entry.waitingFor === 'string' ? entry.waitingFor : '', needs: typeof entry.needs === 'string' ? entry.needs : '',
    };
    const known = sessions.get(entry.sessionId);
    if (!known || item.updatedAt >= known.updatedAt) sessions.set(entry.sessionId, item);
  }
  for (const name of lastGood.keys()) if (!seen.has(name)) lastGood.delete(name);
  return sessions;
}

/** The records of a transcript between `start` and `end`, the ones that matter here, oldest first. The first line of a cut is not whole. */
async function readRecords(file, start, end) {
  const handle = await open(file, 'r');
  let text;
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    text = buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
  const lines = text.split('\n');
  if (start > 0) lines.shift();
  const records = [];
  for (const line of lines) {
    // Most of a transcript's bytes are requests and attachments: the cheap look at a line's start says which to parse. The type of
    // an assistant record comes late in it, so it is looked for in the line.
    const typed = line.startsWith('{"type":"');
    const wanted = typed
      ? line.startsWith('{"type":"user"') || line.startsWith('{"type":"assistant"') || line.startsWith('{"type":"system"')
      : line.includes('"type":"assistant"') || line.includes('"type":"user"') || line.includes('"type":"system"');
    if (!wanted) continue;
    try { records.push(JSON.parse(line)); } catch { /* the line being written */ }
  }
  return records;
}

const questionsOf = (input) => oneLine((Array.isArray(input?.questions) ? input.questions : []).map((item) => item?.question).filter((item) => typeof item === 'string').join(' / '), EXCERPT_CHARS);

/** A tool call, in the words of what it does: the tool and the first thing it was given. */
function toolSummary(use) {
  const input = use.input && typeof use.input === 'object' ? use.input : {};
  const given = [input.command, input.file_path, input.path, input.pattern, input.url, ...Object.values(input)].find((item) => typeof item === 'string' && item);
  return oneLine(given ? `${use.name}: ${given}` : String(use.name ?? ''), 160);
}

/** What the last conversation record of a transcript is (reminders and command output that Claude Code writes as the user are not). */
function lastConversation(records) {
  let turnEnded = false;
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    // The end of a turn is written after its last record, so one seen before a conversation record is one that follows it.
    if (record.type === 'system') { if (record.subtype === 'turn_duration') turnEnded = true; continue; }
    if (record.isSidechain || (record.type !== 'user' && record.type !== 'assistant')) continue;
    const at = ms(record.timestamp);
    const blocks = blocksOf(record.message?.content);
    if (record.type === 'user') {
      if (blocks.some((block) => block?.type === 'tool_result')) return { kind: 'tool_result', at, turnEnded };
      if (INTERRUPTED.test(textOf(blocks))) return { kind: 'interrupted', at, turnEnded };
      if (record.isCompactSummary) return { kind: 'compacted', at, turnEnded };
      if (isHumanPrompt(record) && !COMMAND.test(textOf(blocks))) return { kind: 'prompt', at, turnEnded };
      continue;
    }
    const uses = blocks.filter((block) => block?.type === 'tool_use');
    if (record.isApiErrorMessage) return { kind: 'error', at, turnEnded };
    // Nothing is after this record, so a question it asked has no answer.
    const ask = uses.find((use) => use.name === 'AskUserQuestion');
    if (ask) return { kind: 'ask', at, turnEnded, question: questionsOf(ask.input) };
    if (uses.length) return { kind: 'tool_call', at, turnEnded, tool: toolSummary(uses.at(-1)) };
    // A message whose stop reason was never written was cut off, unless the turn went on to be marked over.
    const stop = record.message?.stop_reason;
    if (textOf(blocks)) return { kind: GOES_ON.has(stop) || (stop == null && !turnEnded) ? 'partial' : 'answer', at, turnEnded };
    return { kind: 'partial', at, turnEnded };
  }
  return { kind: 'none', at: null, turnEnded };
}

/** The words of the assistant's last message that has any, which may be before later tool calls: its start is the excerpt, its end tells whether it asked. */
function lastWords(records) {
  let id;
  const parts = [];
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.isSidechain) continue;
    if (record.type === 'assistant') {
      const words = textOf(blocksOf(record.message?.content));
      const messageId = record.message?.id ?? record.uuid;
      if (id === undefined) { if (!words) continue; id = messageId; }
      else if (messageId !== id) break;
      if (words) parts.unshift(words);
    } else if (record.type === 'user' && id !== undefined) break;
  }
  const words = parts.join('\n\n');
  return { excerpt: oneLine(words, EXCERPT_CHARS), ending: words.slice(-ENDING_CHARS) };
}

/** The facts about the end of a transcript, from its last records. */
function tailFacts(records) {
  const { kind, at, turnEnded, question = '', tool = '' } = lastConversation(records);
  const incoming = records.findLast((record) => !record.isSidechain && record.type === 'assistant'
    && (record.isApiErrorMessage || blocksOf(record.message?.content).some((block) =>
      (block.type === 'text' && block.text) || block.type === 'image' || (block.type === 'tool_use' && block.name === 'AskUserQuestion'))));
  return { last: kind, at, turnEnded, question, tool, incomingAt: incoming ? ms(incoming.timestamp) : null, ...lastWords(records) };
}

const NO_TAIL = Object.freeze({ last: 'none', at: null, turnEnded: false, question: '', tool: '', excerpt: '', ending: '' });

/** The tail facts of a transcript, reading from its end and only as far back as a conversation record needs. */
async function readTail(file, size) {
  let facts = NO_TAIL;
  for (const window of TAIL_WINDOWS) {
    const start = Math.max(0, size - window);
    facts = tailFacts(await readRecords(file, start, size));
    if (facts.last !== 'none' || start === 0) return facts;
  }
  return facts;
}

/**
 * The turns of a stretch of transcript: what the person typed, what the assistant said in answer, and the tools it used. A stretch that
 * is cut out of a longer one may begin with the end of a turn whose prompt is not in it: that comes first, with no prompt.
 */
function turnsOf(records) {
  const turns = [];
  let turn;
  for (const record of records) {
    if (record.isSidechain) continue;
    if (record.type === 'user' && isHumanPrompt(record)) {
      turn = { at: ms(record.timestamp), prompt: promptText(record.message.content), replies: [], tools: new Set() };
      turns.push(turn);
    } else if (record.type === 'assistant') {
      if (!turn) { turn = { at: ms(record.timestamp), prompt: '', cut: true, replies: [], tools: new Set() }; turns.push(turn); }
      const blocks = blocksOf(record.message?.content);
      const words = textOf(blocks);
      if (words) turn.replies.push(words);
      for (const block of blocks) if (block?.type === 'tool_use' && block.name) turn.tools.add(block.name);
    }
  }
  return turns.map((item) => ({ at: item.at, prompt: item.prompt, reply: item.replies.join('\n\n'), tools: [...item.tools], cut: item.cut === true }));
}

export function claudeReader({ root = claudeProjectsRoot(), registry = claudeSessionRegistry(), alive = isAlive } = {}) {
  const listing = new Map();   // listClaudeSessions' own cache: a file that has not changed is not read again
  const lastGood = new Map();  // registry file -> what it said when it last parsed
  const known = new Map();     // session id -> { summary, size, mtimeMs, tail, stamp }
  let processes = new Map();   // session id -> live process, from the last registry read

  // `skip(id)` names the sessions that are not to be read or reported at all (嘟嘟's own).
  // The last activity is the last record of the conversation, or the moment a live process last changed what it was doing: the time
  // of the file says little, Claude Code appends titles and modes to transcripts nobody is working in.
  const facts = (skip) => [...known.values()].filter(({ summary }) => !skip(summary.id)).map(({ summary, mtimeMs, tail }) => {
    const process = processes.get(summary.id) ?? null;
    return {
      id: summary.id, title: summary.title, cwd: summary.cwd, branch: summary.branch, updatedAt: mtimeMs,
      lastActivityAt: Math.max(tail?.at ?? 0, process?.since ?? 0) || mtimeMs, excerpt: tail?.excerpt ?? '', incomingAt: tail?.incomingAt ?? null, process, tail: tail ?? null,
    };
  });

  /** The tail of a session is read again only when its file changed. */
  async function retail(entry) {
    const stamp = `${entry.size}:${entry.mtimeMs}`;
    if (entry.stamp === stamp) return;
    try { entry.tail = await readTail(entry.summary.file, entry.size); entry.stamp = stamp; } catch { /* kept as it was, read again next time */ }
  }

  async function scan({ skip = keepAll } = {}) {
    const found = await listClaudeSessions({ root, cache: listing });
    const next = new Map();
    for (const summary of found) {
      const before = known.get(summary.id);
      next.set(summary.id, { summary, size: summary.size, mtimeMs: summary.mtimeMs, tail: before?.tail ?? null, stamp: before?.stamp });
    }
    known.clear();
    for (const [id, entry] of next) known.set(id, entry);
    processes = await readRegistry({ directory: registry, alive, lastGood });
    await mapLimit([...known.values()].filter((entry) => !skip(entry.summary.id)), 8, retail);
    return facts(skip);
  }

  /** The files of these sessions looked at again, whatever the last listing said. */
  async function look(ids, skip) {
    await mapLimit([...ids].filter((id) => !skip(id)), 8, async (id) => {
      const entry = known.get(id);
      let info;
      try { info = entry && await stat(entry.summary.file); } catch { return; }
      if (!info) return;
      entry.size = info.size;
      entry.mtimeMs = info.mtimeMs;
      await retail(entry);
    });
  }

  async function live({ skip = keepAll } = {}) {
    const before = processes;
    processes = await readRegistry({ directory: registry, alive, lastGood });
    // A session the last listing did not know has started since: list again, which only looks at file times.
    if (!known.size || [...processes.keys()].some((id) => !known.has(id))) return scan({ skip });
    // A live session's file is the one that changes, and one that just left may have been written to a last time.
    await look(new Set([...processes.keys(), ...before.keys()]), skip);
    return facts(skip);
  }

  async function refresh(ids, { skip = keepAll } = {}) {
    if (ids.some((id) => !known.has(id))) return scan({ skip });
    processes = await readRegistry({ directory: registry, alive, lastGood });
    await look(ids, skip);
    return facts(skip);
  }

  async function read(id, { turns = 3 } = {}) {
    if (!known.has(id)) await scan();
    const entry = known.get(id);
    if (!entry) throw new Error('That session is no longer on this computer.');
    const { file } = entry.summary;
    let size;
    try { ({ size } = await stat(file)); } catch { throw new Error('That session is no longer on this computer.'); }
    for (const window of READ_WINDOWS) {
      const start = Math.max(0, size - window);
      const found = turnsOf(await readRecords(file, start, size));
      // Wider until there are as many whole turns as asked for, or the head of the file, or the widest look.
      if (found.filter((item) => !item.cut).length >= turns || start === 0 || window === READ_WINDOWS.at(-1)) {
        return { turns: found.slice(-turns).map(({ cut, ...item }) => item), more: found.length > turns || start > 0 };
      }
    }
    return { turns: [], more: true };
  }

  return { provider: 'claude', live, scan, refresh, read };
}

// --- Codex ----------------------------------------------------------------------------------------------------------

const seconds = (item) => (Number.isFinite(item) ? item * 1000 : null);
const inputText = (content) => (Array.isArray(content) ? content : []).filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n').trim();
const agentWords = (items) => items.filter((item) => item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim());

/** The last turn of a thread as the rules read it. */
function codexTurn(turn) {
  if (!turn) return null;
  const items = Array.isArray(turn.items) ? turn.items : [];
  const words = agentWords(items);
  // Commentary is the agent thinking aloud on its way; the last thing it said that is not is what it came to.
  const closing = [...words].reverse().find((item) => item.phase !== 'commentary') ?? words.at(-1);
  const asked = [...items].reverse().find((item) => item?.type === 'agentMessage' && Array.isArray(item.questions) && item.questions.length);
  return {
    status: turn.status, startedAt: seconds(turn.startedAt), completedAt: seconds(turn.completedAt),
    error: typeof turn.error?.message === 'string' ? turn.error.message : '',
    question: asked ? oneLine(asked.questions.map((item) => item?.title).filter(Boolean).join(' / '), EXCERPT_CHARS) : '',
    excerpt: closing ? oneLine(closing.text, EXCERPT_CHARS) : '', ending: closing ? closing.text.slice(-ENDING_CHARS) : '',
  };
}

/** The tools a Codex turn used, by the name of the kind of item. */
const toolsOf = (items) => [...new Set(items.map((item) => item?.type).filter((type) => type && !['userMessage', 'agentMessage', 'reasoning', 'plan', 'hookPrompt'].includes(type)))];

export function codexReader({ command, environment, spawnProcess } = {}) {
  const turns = new Map();   // thread id -> { updatedAt, turn }: a thread is read again only when it was written to
  let listed = [];

  const options = () => {
    const found = value(command);
    if (!found) throw new Error('Codex is not available.');
    return { command: found, env: value(environment), ...(spawnProcess ? { spawnProcess } : {}) };
  };
  const facts = (skip) => listed.filter((thread) => !skip(thread.id)).map((thread) => {
    const turn = turns.get(thread.id)?.turn ?? null;
    return { id: thread.id, title: thread.title, cwd: thread.cwd, branch: thread.branch, updatedAt: thread.updatedAt, lastActivityAt: thread.updatedAt, excerpt: turn?.excerpt ?? '', incomingAt: turn?.excerpt || turn?.question || turn?.error ? turn.completedAt ?? turn.startedAt : null, turn };
  });

  /** The last turn of each thread, through the app-server's turn paging (one turn, not the whole thread). */
  async function lastTurns(threads) {
    const queue = [...threads];
    const failures = [];
    while (queue.length) {
      let restart = false;
      await withAppServer({ ...options(), timeoutMs: 20_000 }, async (request) => {
        while (queue.length) {
          const thread = queue.shift();
          try {
            const reply = await request('thread/turns/list', { threadId: thread.id, limit: 1, sortDirection: 'desc', itemsView: 'summary' });
            turns.set(thread.id, { updatedAt: thread.updatedAt, turn: codexTurn(reply.data?.[0]) });
          } catch (error) {
            // A thread that does not answer in time may keep the app-server busy: the rest go to a new one.
            failures.push(error.message);
            if (/did not answer/.test(error.message)) { restart = true; return; }
          }
        }
      });
      if (!restart) break;
    }
    // Every read failing is a Codex that cannot do this, not a bad thread: say so instead of calling every session idle.
    if (threads.length && failures.length === threads.length) throw new Error(failures[0]);
  }

  async function scan({ skip = keepAll } = {}) {
    listed = await listCodexThreads(options());
    const ids = new Set(listed.map((thread) => thread.id));
    for (const id of turns.keys()) if (!ids.has(id)) turns.delete(id);
    await lastTurns(listed.filter((thread) => !skip(thread.id) && turns.get(thread.id)?.updatedAt !== thread.updatedAt));
    return facts(skip);
  }

  async function refresh(ids, { skip = keepAll } = {}) {
    if (ids.some((id) => !listed.some((thread) => thread.id === id))) return scan({ skip });
    const wanted = listed.filter((thread) => ids.includes(thread.id) && !skip(thread.id));
    if (wanted.length) await lastTurns(wanted);
    return facts(skip);
  }

  async function read(id, { turns: count = 3 } = {}) {
    const reply = await withAppServer({ ...options(), timeoutMs: 60_000 }, (request) => request('thread/turns/list', { threadId: id, limit: count, sortDirection: 'desc', itemsView: 'full' }));
    const found = (reply.data ?? []).reverse().map((turn) => {
      const items = Array.isArray(turn.items) ? turn.items : [];
      return {
        at: seconds(turn.startedAt), prompt: inputText(items.find((item) => item?.type === 'userMessage')?.content),
        reply: agentWords(items).map((item) => item.text.trim()).join('\n\n'), tools: toolsOf(items),
      };
    });
    return { turns: found, more: Boolean(reply.nextCursor) };
  }

  return { provider: 'codex', scan, refresh, read };
}
