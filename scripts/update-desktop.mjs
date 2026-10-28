import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, open, readFile, realpath, rm, stat, utimes } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { desktopPackageIdentity, waitForDesktopRuntime } from '../host/desktop-runtime.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function activateDesktopUpdate({ running, restartRequired, touchProfile, waitForRuntime, restart }) {
  if (running && !restartRequired) {
    await touchProfile();
    const runtime = await waitForRuntime(20_000);
    if (runtime) return { mode: 'hot', runtime };
  }
  await restart();
  const runtime = await waitForRuntime(90_000);
  if (!runtime) throw new Error('The new desktop plugin did not become ready after restarting DSH.');
  return { mode: 'restart', runtime };
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
    console.log('npm run desktop:update -- [--app "/Applications/DeepSeek Harness.app"] [--restart]');
    console.log('Packages and installs dudu through Desktop, tries hot reload, and restarts DSH if needed.');
    return;
  }
  let app = '/Applications/DeepSeek Harness.app';
  let restartRequired = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--restart') restartRequired = true;
    else if (args[index] === '--app' && args[index + 1] && !args[index + 1].startsWith('--')) app = args[++index];
    else throw new Error(`Unknown or incomplete option: ${args[index]}`);
  }
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
  const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST') throw new Error(`Another desktop update holds ${lockPath}.`);
    throw error;
  });
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
    const mainPids = async () => {
      const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,comm=']);
      const candidates = stdout.split('\n').flatMap((line) => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
        return match?.[3] === executable ? [{ pid: Number(match[1]), parent: Number(match[2]) }] : [];
      });
      return candidates.filter((entry) => !candidates.some((other) => other.pid === entry.parent));
    };
    console.log('Packaging dudu...');
    await run(process.execPath, ['scripts/package-desktop.mjs'], 'package');
    const expected = await desktopPackageIdentity(join(root, 'host', 'dudu-plugin'));
    const runtimeFolder = join(dshHome, 'dudu');
    const running = (await mainPids()).length > 0;
    const legacy = await hasDependency(profile, 'dsbot');
    const installed = join(profile, 'node_modules', 'dudu');
    const current = await waitForDesktopRuntime({ folder: runtimeFolder, expected, timeoutMs: 0, probe });
    if (!restartRequired && current && running) {
      const identity = await desktopPackageIdentity(installed);
      if (identity.fingerprint === expected.fingerprint) {
        console.log(`dudu ${expected.version} is already running with this exact build.`);
        return;
      }
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
    const archive = join(release, `dudu-${expected.version}-${expected.fingerprint}.tgz`);
    // pnpm caches file: tarballs by path; a changed build must never reuse the previous path.
    await copyFile(join(release, `dudu-${expected.version}.tgz`), archive);
    console.log(`Installing dudu ${expected.version} using Desktop's bundled CLI...`);
    await run(carrier, ['plugin', '--profile', 'desktop', 'add', `file:${archive}`], 'install');
    const identity = await desktopPackageIdentity(installed);
    if (identity.fingerprint !== expected.fingerprint) throw new Error('Installed package differs from the packaged source.');
    if (legacy) {
      // dudu was called dsbot; two copies would fight over the same port, so the old one leaves in this same update.
      console.log('Removing the former dsbot plugin...');
      try { await run(carrier, ['plugin', '--profile', 'desktop', 'remove', 'dsbot'], 'remove-dsbot'); }
      catch (error) {
        await run(carrier, ['plugin', '--profile', 'desktop', 'remove', 'dudu'], 'rollback-dudu').catch(() => {});
        throw error;
      }
    }
    console.log('Applying the update and checking the running code...');
    const result = await activateDesktopUpdate({
      running, restartRequired,
      touchProfile: async () => {
        // DSH watches this patch. Updating its timestamp requests official profile recomposition.
        const now = new Date();
        await utimes(join(profile, 'cordis.patch.yml'), now, now);
      },
      waitForRuntime: (timeoutMs) => waitForDesktopRuntime({ folder: runtimeFolder, expected, after, timeoutMs, probe }),
      restart: async () => {
        if ((await mainPids()).length) {
          console.log('Hot reload is unavailable; asking DSH to quit normally...');
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
    const receipt = await open(join(logFolder, 'result.json'), 'w', 0o600);
    try { await receipt.writeFile(JSON.stringify(result, null, 2) + '\n'); }
    finally { await receipt.close(); }
    console.log(`dudu ${expected.version} is running and ready (${result.mode === 'hot' ? 'hot reload; DSH stayed open' : 'DSH restarted'}).`);
  } catch (error) {
    if (logFolder) console.error(`Update diagnostics: ${logFolder}`);
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
