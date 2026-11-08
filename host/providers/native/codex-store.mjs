import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { oneLine } from './text.mjs';

// Codex answers questions about its threads through `codex app-server`, the same program OAR drives to run them.
// OAR has no call for listing or reading them, so this asks the app-server directly: a short-lived process with the
// initialize handshake and one request per page. `thread/read` is how history is read; `thread/resume` would
// activate the thread, and listing never needs it.

const PAGE = 100;
const MAX_PAGES = 30;

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
export async function withAppServer({ command, env, cwd, timeoutMs = 20_000, spawnProcess = spawn }, run) {
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
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const call = message?.id === undefined ? undefined : pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message ?? `codex app-server refused ${call.method}.`));
    else call.resolve(message.result ?? {});
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

/** One thread with its turns. A long thread takes a while to read. */
export async function readCodexThread(options, id) {
  return withAppServer({ timeoutMs: 180_000, ...options }, async (request) => (await request('thread/read', { threadId: id, includeTurns: true })).thread);
}

/**
 * Several threads, each handed to `onThread` as it is read. A thread that fails is skipped, and one that does not answer
 * in time (a very long thread) ends that app-server, which may still be busy with it, so the rest are read by a new one.
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
            if (/did not answer/.test(error.message)) { restart = true; return; }
            continue;
          }
          await onThread(id, thread);
        }
      });
    } catch { return; }
    if (!restart) return;
  }
}
