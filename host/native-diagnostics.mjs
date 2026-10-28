import { appendFile, chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_BYTES = 256 * 1024;
const MAX_PENDING = 128;
const CODE = /^(?:gateway\/|session\/|subagent\/|agent-preset\/|remote-access\/|SESSION_|E[A-Z])[A-Za-z0-9_./-]{0,96}$/;
const STAGES = new Set(['invoke', 'open', 'next']);

function errorCodes(error) {
  const codes = [];
  for (let depth = 0; error && depth < 4; depth++, error = error.cause) {
    if (typeof error.code === 'string' && CODE.test(error.code)) codes.push(error.code);
  }
  return codes;
}

// Persist categories only: upstream errors may embed credentials or conversation content in messages.
export function createNativeDiagnostics(folder) {
  const directory = join(folder, 'diagnostics');
  const file = join(directory, 'upstream.jsonl');
  let tail = Promise.resolve();
  let pending = 0;
  return {
    failure({ endpoint, stage, error }) {
      if (pending >= MAX_PENDING || typeof endpoint !== 'string'
        || !/^[A-Za-z][A-Za-z0-9]{0,40}\/[A-Za-z][A-Za-z0-9]{0,40}$/.test(endpoint)
        || !STAGES.has(stage)) return;
      const line = JSON.stringify({
        timestamp: Date.now(), event: 'gateway.failure', endpoint, stage,
        codes: errorCodes(error),
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
    flush() { return tail; },
  };
}
