import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { desktopPackageIdentity, waitForDesktopRuntime } from '../host/desktop-runtime.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Reloading a plugin from one of its own workers removes that worker's adapter mid-turn. */
export function runsInsideDesktop(pid, processes, executable) {
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const visited = new Set();
  while (pid > 0 && !visited.has(pid)) {
    visited.add(pid);
    const entry = byPid.get(pid);
    if (!entry) return false;
    if (entry.command === executable) return true;
    pid = entry.parent;
  }
  return false;
}

/** Profile HMR compares file contents; touching an unchanged patch never reloads a changed package. */
export async function requestDesktopReload(profile, fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Expected a desktop package fingerprint.');
  const patch = join(profile, 'cordis.patch.yml');
  const original = await readFile(patch, 'utf8');
  const mode = (await stat(patch)).mode & 0o777;
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const marker = `# dudu desktop update: ${fingerprint} ${randomBytes(12).toString('hex')}${newline}`;
  const content = original.replace(/^# dudu desktop update: [a-f0-9]{64} [a-f0-9]{24}\r?\n/gm, '');
  const temporary = join(profile, `.dudu-update-${randomBytes(12).toString('hex')}.tmp`);
  let file;
  try {
    file = await open(temporary, 'wx', mode);
    await file.writeFile(marker + content);
    await file.sync();
    await file.close();
    file = null;
    if (await readFile(patch, 'utf8') !== original) throw new Error('The profile changed during the update; run desktop:update again.');
    await rename(temporary, patch);
  } finally {
    await file?.close();
    await rm(temporary, { force: true });
  }
}

/** What the command line says: the app, whether to restart it, and whether to reload even from a task inside it. */
export function parseUpdateArguments(args) {
  const options = { app: '/Applications/DeepSeek Harness.app', restartRequired: false, force: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--restart') options.restartRequired = true;
    else if (args[index] === '--force') options.force = true;
    else if (args[index] === '--app' && args[index + 1] && !args[index + 1].startsWith('--')) options.app = args[++index];
    else throw new Error(`Unknown or incomplete option: ${args[index]}`);
  }
  return options;
}

const processAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

/** Takes the update lock; one left by an update that was killed (a forced reload ends the task that ran it) is taken over. */
export async function acquireUpdateLock(lockPath, alive = processAlive) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await open(lockPath, 'wx', 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = 0;
      try { holder = Number(JSON.parse(await readFile(lockPath, 'utf8')).pid); } catch { /* an unreadable lock has no live holder */ }
      if (attempt > 0 || (Number.isInteger(holder) && holder > 0 && alive(holder))) throw new Error(`Another desktop update holds ${lockPath}.`);
      await rm(lockPath, { force: true });
    }
  }
}

/** A ready plugin in a replacement host is recovery after an interruption, not a hot reload. */
export function assertDesktopContinuity(before, after, runtime) {
  const missing = before.filter((previous) => !after.some((current) =>
    current.pid === previous.pid && current.parent === previous.parent
    && current.command === previous.command && current.startedAt === previous.startedAt));
  if (!before.length || missing.length || (runtime && !before.some((entry) => entry.pid === runtime.pid))) {
    throw Object.assign(new Error('DSH exited or its host process changed during the update. Hot reload failed, even if a reopened DSH is now ready. Check the Desktop crash logs; the updater did not request a restart.'), {
      code: 'DESKTOP_PROCESS_CHANGED', processes: { before, after }, ...(runtime ? { runtime } : {}),
    });
  }
}

export async function activateDesktopUpdate({ running, restartRequired, assertHotRuntime, requestReload, waitForRuntime, restart }) {
  if (running && !restartRequired) {
    await assertHotRuntime();
    await requestReload();
    // A normal profile reconciliation can take longer than 20 s. Use the same
    // bounded readiness window as a launch; this still never restarts Desktop.
    const runtime = await waitForRuntime(90_000, assertHotRuntime);
    await assertHotRuntime(runtime);
    if (runtime) return { mode: 'hot', runtime };
    throw new Error('Plugin hot reload did not become ready. DSH was left open; use --restart only when you want to restart it.');
  }
  await restart();
  const runtime = await waitForRuntime(90_000);
  if (!runtime) throw new Error('The new desktop plugin did not become ready after restarting DSH.');
  return { mode: 'restart', runtime };
}

async function writeReceipt(folder, result) {
  const receipt = await open(join(folder, 'result.json'), 'w', 0o600);
  try { await receipt.writeFile(JSON.stringify(result, null, 2) + '\n'); }
  finally { await receipt.close(); }
}

async function hasDependency(profile, name) {
  const { dependencies } = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
  return dependencies?.[name] !== undefined;
}

async function probe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/dsbot/api/v1/probe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: randomBytes(24).toString('base64url') }),
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    if (!response.ok) return false;
    const value = await response.json();
    return value.protocol === 1 && typeof value.proof === 'string';
  } catch { return false; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('npm run desktop:update -- [--app "/Applications/DeepSeek Harness.app"] [--restart] [--force]');
    console.log('npm run desktop:install -- [--app "/Applications/DeepSeek Harness.app"]');
    console.log('Packages and installs dudu through Desktop and verifies hot reload. --restart explicitly restarts DSH.');
    console.log('--force hot reloads even from a task running inside DSH: the reload removes the adapter of every running Claude and Codex session, this task included.');
    return;
  }
  const { app: requestedApp, restartRequired, force } = parseUpdateArguments(args);
  let app = requestedApp;
  if (process.platform !== 'darwin') throw new Error('Automatic Desktop updates currently support macOS.');
  app = await realpath(resolve(app));
  const carrier = join(app, 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh');
  await stat(carrier);
  const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'));
  const profile = join(dshHome, 'profiles', 'desktop');
  await stat(join(profile, 'package.json'));
  const local = join(root, '.local', 'desktop-updates');
  await mkdir(local, { recursive: true, mode: 0o700 });
  const lockPath = join(local, 'update.lock');
  const lock = await acquireUpdateLock(lockPath);
  let logFolder;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }) + '\n');
    logFolder = await mkdtemp(join(local, 'run-'));
    console.log(`Update logs and profile backup: ${logFolder}`);
    const run = async (command, argv, label, timeout = 180_000) => {
      const log = await open(join(logFolder, `${label}.log`), 'a', 0o600);
      try {
        const result = await exec(command, argv, {
          cwd: root, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, DSH_HOME: dshHome },
        });
        await log.writeFile(result.stdout + result.stderr);
        return result.stdout;
      } catch (error) {
        await log.writeFile((error.stdout || '') + (error.stderr || ''));
        throw new Error(`${label} failed; see ${join(logFolder, `${label}.log`)}.`, { cause: error });
      } finally { await log.close(); }
    };
    const executable = join(app, 'Contents', 'MacOS', 'DeepSeek Harness');
    const processes = async () => {
      const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,lstart=,comm='], { env: { ...process.env, LC_ALL: 'C' } });
      return stdout.split('\n').flatMap((line) => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
        return match ? [{ pid: Number(match[1]), parent: Number(match[2]), startedAt: match[3], command: match[4] }] : [];
      });
    };
    const desktopProcesses = async () => (await processes()).filter((entry) => entry.command === executable);
    const mainPids = async () => {
      const candidates = await desktopProcesses();
      return candidates.filter((entry) => !candidates.some((other) => other.pid === entry.parent));
    };
    const originalProcesses = await desktopProcesses();
    const running = originalProcesses.length > 0;
    const assertHotRuntime = async (runtime) => assertDesktopContinuity(originalProcesses, await desktopProcesses(), runtime);
    console.log('Packaging dudu...');
    await run(process.execPath, ['scripts/package-desktop.mjs'], 'package');
    const expected = await desktopPackageIdentity(join(root, 'host', 'dudu-plugin'));
    const runtimeFolder = join(dshHome, 'dudu');
    if (running && !restartRequired) await assertHotRuntime();
    // Earlier names of this plugin that may still be installed: dsbot, then dudu (before the npm package became dsh-dudu).
    const legacy = [];
    for (const name of ['dsbot', 'dudu']) if (await hasDependency(profile, name)) legacy.push(name);
    const installed = join(profile, 'node_modules', 'dsh-dudu');
    const current = await waitForDesktopRuntime({ folder: runtimeFolder, expected, timeoutMs: 0, probe });
    if (!restartRequired && current && running) {
      const identity = await desktopPackageIdentity(installed);
      if (identity.fingerprint === expected.fingerprint) {
        console.log(`dudu ${expected.version} is already running with this exact build.`);
        return;
      }
    }
    if (running && !restartRequired && runsInsideDesktop(process.pid, await processes(), executable)) {
      if (!force) throw new Error('Cannot hot reload dudu from a task running inside DSH: this would remove its adapter mid-turn. The source is packaged; run npm run desktop:update from a terminal outside DSH after the task finishes, or pass --force to reload anyway (every running Claude and Codex session, this task included, is cut).');
      console.log('--force: hot reloading from a task inside DSH; this task and any other running session end when the plugin reloads.');
    }
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
      try {
        await copyFile(join(profile, file), join(logFolder, file));
        const saved = await open(join(logFolder, file), 'r+');
        try { await saved.chmod(0o600); } finally { await saved.close(); }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const after = Date.now();
    const release = join(root, '.local', 'release');
    const archive = join(release, `dsh-dudu-${expected.version}-${expected.fingerprint}.tgz`);
    // pnpm caches file: tarballs by path; a changed build must never reuse the previous path.
    await copyFile(join(release, `dsh-dudu-${expected.version}.tgz`), archive);
    console.log(`Installing dudu ${expected.version} using Desktop's bundled CLI...`);
    await run(carrier, ['plugin', '--profile', 'desktop', 'add', `file:${archive}`], 'install');
    const identity = await desktopPackageIdentity(installed);
    if (identity.fingerprint !== expected.fingerprint) throw new Error('Installed package differs from the packaged source.');
    for (const name of legacy) {
      // The plugin was called dsbot, then dudu; two copies would fight over the same port, so an old one leaves in this same update.
      console.log(`Removing the former ${name} plugin...`);
      try { await run(carrier, ['plugin', '--profile', 'desktop', 'remove', name], `remove-${name}`); }
      catch (error) {
        await run(carrier, ['plugin', '--profile', 'desktop', 'remove', 'dsh-dudu'], 'rollback-dsh-dudu').catch(() => {});
        throw error;
      }
    }
    console.log('Applying the update and checking the running code...');
    const result = await activateDesktopUpdate({
      running, restartRequired, assertHotRuntime,
      requestReload: () => requestDesktopReload(profile, expected.fingerprint),
      waitForRuntime: (timeoutMs, assertRunning) => waitForDesktopRuntime({ folder: runtimeFolder, expected, after, timeoutMs, probe, assertRunning }),
      restart: async () => {
        if ((await mainPids()).length) {
          console.log('Restart requested; asking DSH to quit normally...');
          await run('osascript', [
            '-e', 'on run argv', '-e', 'tell application (item 1 of argv) to quit', '-e', 'end run', app,
          ], 'quit', 45_000);
          const deadline = Date.now() + 45_000;
          while ((await mainPids()).length) {
            if (Date.now() >= deadline) {
              throw new Error('DSH has not quit. Its task confirmation may still be open; no process was forced to stop.');
            }
            await delay(250);
          }
        }
        console.log('Opening DSH...');
        await run('open', ['-a', app], 'open', 15_000);
      },
    });
    await writeReceipt(logFolder, result);
    console.log(`dudu ${expected.version} is running and ready (${result.mode === 'hot' ? 'hot reload; DSH stayed open' : 'DSH restarted'}).`);
  } catch (error) {
    if (logFolder) {
      try {
        await writeReceipt(logFolder, {
          mode: 'failed', error: { code: error.code ?? 'DESKTOP_UPDATE_FAILED', message: error.message },
          ...(error.processes ? { processes: error.processes } : {}), ...(error.runtime ? { runtime: error.runtime } : {}),
        });
      } catch (receiptError) { console.error(`Could not write the update result: ${receiptError.message}`); }
      console.error(`Update diagnostics: ${logFolder}`);
    }
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
