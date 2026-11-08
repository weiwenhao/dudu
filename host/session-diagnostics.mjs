import { appendFile, chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BYTES = 256 * 1024;
const MAX_PENDING = 128;
const EVENTS = new Set(['session.index.failure', 'session.preview.read']);
const PROVIDERS = new Set(['claude', 'codex', 'dsh']);

function reasonOf(error) {
  const text = String(error?.message ?? error ?? '');
  if (error?.code === 'ENOENT' || /no such file|not found|missing.*(?:file|transcript|rollout)/i.test(text)) return 'missing_transcript';
  if (/timeout|timed out|did not answer/i.test(text) || error?.name === 'TimeoutError') return 'timeout';
  if (error?.name === 'AbortError' || /abort|cancel/i.test(text)) return 'cancelled';
  if (error?.code === 'UNSUPPORTED') return 'unsupported';
  if (error?.code === 'invalid_session') return 'invalid_session';
  return 'read_failed';
}

/** Bounded local diagnostics. IDs and timings only; never prompts, search terms, paths or raw upstream errors. */
export function createSessionDiagnostics(folder) {
  const directory = join(folder, 'diagnostics');
  const file = join(directory, 'sessions.jsonl');
  let tail = Promise.resolve();
  let pending = 0;
  return {
    record({ event, provider, id, source, outcome, elapsedMs, count, error }) {
      if (pending >= MAX_PENDING || !EVENTS.has(event) || !PROVIDERS.has(provider)
        || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return;
      const line = JSON.stringify({
        timestamp: Date.now(), event, provider, id,
        ...(['sqlite', 'source'].includes(source) ? { source } : {}),
        ...(['success', 'failure'].includes(outcome) ? { outcome } : {}),
        ...(Number.isFinite(elapsedMs) ? { elapsedMs: Math.max(0, Math.round(elapsedMs)) } : {}),
        ...(Number.isSafeInteger(count) && count >= 0 ? { count } : {}),
        ...(error ? { reason: reasonOf(error) } : {}),
      }) + '\n';
      pending++;
      tail = tail.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await chmod(directory, 0o700);
        const size = await stat(file).then((value) => value.size, (error) => {
          if (error.code !== 'ENOENT') throw error;
          return 0;
        });
        if (size + Buffer.byteLength(line) > MAX_BYTES) {
          await unlink(file + '.1').catch((error) => { if (error.code !== 'ENOENT') throw error; });
          await rename(file, file + '.1');
        }
        await appendFile(file, line, { mode: 0o600 });
        await chmod(file, 0o600);
      }).catch(() => {}).finally(() => { pending--; });
    },
    flush: () => tail,
  };
}
