import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function desktopPackageIdentity(folder) {
  const files = ['package.json', 'index.mjs', 'client.js', 'cordis.patch.yml'];
  async function visit(relative) {
    for (const entry of await readdir(join(folder, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error('The desktop package contains an unexpected symbolic link.');
    }
  }
  await visit('dist');
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    hash.update(file).update('\0').update(await readFile(join(folder, file))).update('\0');
  }
  const metadata = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  if (metadata.name !== 'dsbot' || typeof metadata.version !== 'string') {
    throw new Error('Expected a dsbot desktop package.');
  }
  return { version: metadata.version, fingerprint: hash.digest('hex') };
}

export async function writeDesktopRuntime(folder, identity, port) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const temporary = join(folder, `.runtime-${randomUUID()}.json`);
  const runtime = { schemaVersion: 1, ...identity, pid: process.pid, port, startedAt: Date.now() };
  try {
    await writeFile(temporary, JSON.stringify(runtime) + '\n', { mode: 0o600 });
    await rename(temporary, join(folder, 'runtime.json'));
  } finally {
    await rm(temporary, { force: true });
  }
  return runtime;
}

export function matchesDesktopRuntime(runtime, expected, after = 0) {
  return runtime?.schemaVersion === 1 && runtime.version === expected.version
    && runtime.fingerprint === expected.fingerprint && Number.isSafeInteger(runtime.pid) && runtime.pid > 0
    && Number.isSafeInteger(runtime.port) && runtime.port > 0 && runtime.port <= 65535
    && Number.isFinite(runtime.startedAt) && runtime.startedAt >= after;
}

export async function waitForDesktopRuntime({
  folder, expected, after = 0, timeoutMs, intervalMs = 250, probe,
  alive = (pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  },
}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    let runtime;
    try { runtime = JSON.parse(await readFile(join(folder, 'runtime.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (matchesDesktopRuntime(runtime, expected, after) && alive(runtime.pid) && await probe(runtime.port)) {
      return runtime;
    }
    if (Date.now() >= deadline) return undefined;
    await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
}
