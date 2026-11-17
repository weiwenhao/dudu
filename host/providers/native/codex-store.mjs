import { spawn } from 'node:child_process';
import { oneLine } from './text.mjs';

// Codex answers questions about its threads through `codex app-server`, the same program OAR drives to run them.
// OAR has no call for listing or reading them, so this asks the app-server directly: a short-lived process with the
// initialize handshake and one request per page. `thread/read` is how history is read; `thread/resume` would
// activate the thread, and listing never needs it.

const PAGE = 100;
const MAX_PAGES = 30;
// What one answer of the app-server may weigh, as bytes of one line of JSON. The host reads it into a string and parses it, which costs several times as much
// again in DSH's heap (a thread of a gigabyte answers with a hundred megabytes, and reading it whole took 540 MB of the heap): an answer over this is dropped,
// and the app-server stopped, instead of being let into the memory of DSH's host. (DSH's host died of its heap four times in ten days.)
export const MAX_ANSWER_BYTES = 64 * 1024 * 1024;
// A long thread is read from its end: this many of its newest turns, in pages of this many (`thread/read` with every turn is deprecated by Codex itself for long threads).
export const TAIL_TURNS = 40;
const TAIL_PAGE = 10;

/** The lines of a stream of bytes, each as a string once it is whole; a line over `limit` bytes ends the stream's use (`onTooLarge`) before it is held in full. */
function lineReader(stream, { limit, onLine, onTooLarge }) {
  let chunks = [];
  let size = 0;
  let stopped = false;
  stream.on('data', (chunk) => {
    if (stopped) return;
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start);
      const piece = end === -1 ? chunk.subarray(start) : chunk.subarray(start, end);
      size += piece.length;
      if (size > limit) { stopped = true; chunks = []; size = 0; onTooLarge(); return; }
      chunks.push(piece);
      if (end === -1) return;
      const line = chunks.length === 1 ? chunks[0].toString('utf8') : Buffer.concat(chunks, size).toString('utf8');
      chunks = [];
      size = 0;
      onLine(line);
      start = end + 1;
    }
  });
}

/** `base` with an OAR-style overlay applied: a `null` value removes the name. */
function withOverlay(base, overlay = {}) {
  const env = { ...base };
  for (const [name, value] of Object.entries(overlay)) {
    if (value === null || value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

/** Run `run(request)` against a fresh app-server and stop it afterwards. */
export async function withAppServer({ command, env, cwd, timeoutMs = 20_000, maxAnswerBytes = MAX_ANSWER_BYTES, spawnProcess = spawn }, run) {
  const child = spawnProcess(command, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], cwd, env: withOverlay(process.env, env) });
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  const pending = new Map();
  let nextId = 1;
  let exitCode;
  const failAll = (error) => { for (const call of pending.values()) call.reject(error); pending.clear(); };
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => { exitCode = code ?? -1; failAll(new Error(`codex app-server stopped (${exitCode}). ${stderr.trim()}`.trim())); resolve(); });
  });
  child.once('error', (error) => { exitCode = -1; failAll(error); });
  lineReader(child.stdout, {
    limit: maxAnswerBytes,
    onLine: (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const call = message?.id === undefined ? undefined : pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message ?? `codex app-server refused ${call.method}.`));
      else call.resolve(message.result ?? {});
    },
    onTooLarge: () => {
      failAll(Object.assign(new Error(`codex app-server's answer is over ${Math.round(maxAnswerBytes / 1048576)} MB.`), { code: 'ANSWER_TOO_LARGE' }));
      child.kill('SIGTERM');
    },
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`codex app-server did not answer ${method}.`)); }, timeoutMs);
    pending.set(id, { method, resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
  });
  try {
    await request('initialize', { clientInfo: { name: 'dudu', title: 'Dudu', version: '0.4.0' }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    return await run(request);
  } finally {
    child.stdin.end();
    child.kill('SIGTERM');
    let grace;
    await Promise.race([exited, new Promise((resolve) => { grace = setTimeout(resolve, 2000); })]);
    clearTimeout(grace);
    if (exitCode === undefined) child.kill('SIGKILL');
  }
}

/** A Codex thread as the list shows it. */
export function threadSummary(thread) {
  const preview = typeof thread.preview === 'string' ? thread.preview : '';
  const name = typeof thread.name === 'string' ? thread.name : '';
  return {
    provider: 'codex', id: thread.id, cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
    branch: thread.gitInfo?.branch ?? null, model: thread.model ?? null, entrypoint: typeof thread.source === 'string' ? thread.source : null,
    title: oneLine(name || preview) || 'Untitled', preview: oneLine(preview, 300),
    createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt * 1000 : null,
    updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt * 1000 : 0,
    file: typeof thread.path === 'string' ? thread.path : null,
  };
}

/** The threads `codex resume` would offer, newest first. An empty `modelProviders` is how "no filter" is spelled. */
export async function listCodexThreads(options) {
  return withAppServer(options, async (request) => {
    const threads = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const reply = await request('thread/list', { limit: PAGE, cursor, sortKey: 'updated_at', sortDirection: 'desc', modelProviders: [], useStateDbOnly: true });
      for (const thread of reply.data ?? []) {
        if (thread.ephemeral || thread.parentThreadId) continue;
        threads.push(threadSummary(thread));
      }
      cursor = reply.nextCursor ?? null;
      if (!cursor) break;
    }
    return threads;
  });
}

/** One thread with all its turns. A long thread takes a while to read and a lot of memory: `readCodexThreadTail` is for those. */
export async function readCodexThread(options, id) {
  return withAppServer({ timeoutMs: 180_000, ...options }, async (request) => (await request('thread/read', { threadId: id, includeTurns: true })).thread);
}

/**
 * The newest `turns` turns of a thread, oldest first, and `partial` when the thread has older ones that were not read. Memory follows what is read, not
 * how long the thread is: the newest ten turns of a thread of a gigabyte are a few megabytes, the whole of it a hundred.
 */
export async function readCodexThreadTail(options, id, { turns = TAIL_TURNS, page = TAIL_PAGE } = {}) {
  return withAppServer({ timeoutMs: 60_000, ...options }, async (request) => {
    const { thread } = await request('thread/read', { threadId: id, includeTurns: false });
    const newest = [];
    let cursor = null;
    do {
      const reply = await request('thread/turns/list', {
        threadId: id, limit: Math.min(page, turns - newest.length), sortDirection: 'desc', itemsView: 'full', ...(cursor ? { cursor } : {}),
      });
      newest.push(...(Array.isArray(reply.data) ? reply.data : []));
      cursor = reply.nextCursor ?? null;
    } while (cursor && newest.length < turns);
    return { ...thread, turns: newest.reverse(), partial: Boolean(cursor) };
  });
}

/**
 * Several threads, each handed to `onThread` as it is read. A thread that fails is skipped, and one that does not answer
 * in time (a very long thread), or answers with more than the host may hold, ends that app-server, which may still be busy with it, so the rest are read by a new one.
 */
export async function readCodexThreads(options, ids, onThread, { timeoutMs = 25_000, onFailure } = {}) {
  const remaining = [...ids];
  while (remaining.length) {
    let restart = false;
    try {
      await withAppServer({ ...options, timeoutMs }, async (request) => {
        while (remaining.length) {
          const id = remaining.shift();
          let thread;
          try { thread = (await request('thread/read', { threadId: id, includeTurns: true })).thread; }
          catch (error) {
            onFailure?.(id, error); // the caller says which conversation could not be read, and why
            if (/did not answer/.test(error.message) || error.code === 'ANSWER_TOO_LARGE') { restart = true; return; }
            continue;
          }
          await onThread(id, thread);
        }
      });
    } catch { return; }
    if (!restart) return;
  }
}
