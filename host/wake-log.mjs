// What each board wake did, one line, in `<folder>/diagnostics/wake.jsonl` (owner, 2026-11-22). Apple promises nothing about these pushes, so how many were sent, what Apple answered, and (in
// the App's own log) how many woke the phone are measured, not guessed. A line has the time, `wake` (silent) or `notice` (a reply or question shown), a short device id, Apple's status and its
// reason word. Local to this computer and bounded: no token, no title, no address.

import { Buffer } from 'node:buffer';
import { appendFile, chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BYTES = 256 * 1024;
const MAX_PENDING = 64;

export function createWakeLog(folder, { now = Date.now } = {}) {
  const directory = join(folder, 'diagnostics');
  const file = join(directory, 'wake.jsonl');
  let tail = Promise.resolve();
  let pending = 0;
  return {
    record({ kind, device, status, reason }) {
      if (pending >= MAX_PENDING) return;
      const text = JSON.stringify({
        timestamp: now(),
        kind: kind === 'notice' ? 'notice' : 'wake',
        device: String(device ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8),
        status: Number.isSafeInteger(status) ? status : null,
        ...(typeof reason === 'string' && /^[A-Za-z]{1,40}$/.test(reason) ? { reason } : {}),
      }) + '\n';
      pending++;
      tail = tail.then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const size = await stat(file).then((value) => value.size, (error) => {
          if (error.code !== 'ENOENT') throw error;
          return 0;
        });
        if (size + Buffer.byteLength(text) > MAX_BYTES) {
          await unlink(file + '.1').catch((error) => { if (error.code !== 'ENOENT') throw error; });
          await rename(file, file + '.1');
        }
        await appendFile(file, text, { mode: 0o600 });
        await chmod(file, 0o600);
      }).catch(() => {}).finally(() => { pending--; });
    },
    flush: () => tail,
  };
}
