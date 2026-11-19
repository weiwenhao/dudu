import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { analyzeActions, describeActions } from './lib/device-actions.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
};

async function main() {
  if (args.includes('--help')) {
    console.log('npm run logs:pull -- [--device <name-or-UUID>] [--output <directory>] [--minutes <number>]');
    console.log('npm run logs:pull -- --android [--device <adb serial>] [--output <directory>] [--minutes <number>]');
    return;
  }
  const minutes = Number(option('--minutes') ?? 30);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes must be positive.');
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const destination = path.resolve(option('--output') ?? path.join(root, '.local', 'device-logs', timestamp));
  if (args.includes('--android')) {
    await pullAndroid(destination);
    await summarize(destination, minutes);
    return;
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'dudu-logs-'));
  try {
    let device = option('--device');
    if (!device) {
      const index = path.join(temporary, 'devices.json');
      await exec('xcrun', ['devicectl', 'list', 'devices', '--timeout', '20', '--json-output', index], { timeout: 25_000 });
      const data = JSON.parse(await readFile(index, 'utf8'));
      const available = (data.result?.devices ?? []).filter((item) =>
        item.connectionProperties?.pairingState === 'paired'
        && item.deviceProperties?.developerModeStatus === 'enabled',
      );
      if (available.length !== 1) {
        throw new Error('Pass --device with the paired iPhone name or UUID; exactly one reachable development device is required for automatic selection.');
      }
      device = available[0].identifier;
    }
    await mkdir(destination, { recursive: true });
    const receipt = path.join(destination, 'devicectl-copy.json');
    await exec('xcrun', ['devicectl', 'device', 'copy', 'from', '--device', device,
      '--domain-type', 'appDataContainer', '--domain-identifier', 'com.harnessmobile.app',
      '--source', 'Documents/diagnostics', '--destination', path.join(destination, 'diagnostics'),
      '--timeout', '60', '--json-output', receipt], { timeout: 65_000 });
    await summarize(destination, minutes);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * The Android app's diagnostics (`Diagnostics.kt`): the files of `no_backup/diagnostics` in the app's own storage, read over adb as the app
 * (`run-as`, so a debug build), and what the app wrote to logcat under its tag. Nothing else of the app's storage is read.
 */
async function pullAndroid(destination) {
  const adb = path.join(process.env.ANDROID_HOME || path.join(homedir(), 'Library/Android/sdk'), 'platform-tools/adb');
  let serial = option('--device') ?? process.env.ANDROID_SERIAL;
  if (!serial) {
    const { stdout } = await exec(adb, ['devices'], { timeout: 20_000 });
    const ready = stdout.split('\n').map((line) => line.trim().split(/\s+/)).filter((item) => item[1] === 'device').map((item) => item[0]);
    if (ready.length !== 1) throw new Error('Pass --device with the adb serial; exactly one connected Android device is required for automatic selection.');
    serial = ready[0];
  }
  const asApp = (...command) => exec(adb, ['-s', serial, 'exec-out', 'run-as', 'app.dudu.android', ...command],
    { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
  const folder = path.join(destination, 'diagnostics');
  await mkdir(folder, { recursive: true });
  const names = (await asApp('ls', 'no_backup/diagnostics')).stdout.toString('utf8').split('\n').map((name) => name.trim())
    .filter((name) => /^(events(\.\d)?\.jsonl|crash-\d+\.txt)$/.test(name));
  if (!names.length) throw new Error('The app has written no diagnostics yet (or this is not a debug build).');
  for (const name of names) await writeFile(path.join(folder, name), (await asApp('cat', `no_backup/diagnostics/${name}`)).stdout);
  const logcat = await exec(adb, ['-s', serial, 'logcat', '-d', '-v', 'threadtime', '-s', 'Dudu:V', 'AndroidRuntime:E'],
    { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }).catch(() => null);
  if (logcat) await writeFile(path.join(destination, 'logcat.txt'), logcat.stdout);
}

async function summarize(destination, minutes) {
  {
    const entries = [];
    let incompleteLines = 0;
    const readLogs = async (directory) => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const name = path.join(directory, item.name);
        if (item.isDirectory()) await readLogs(name);
        else if (item.name.endsWith('.jsonl')) {
          for (const line of (await readFile(name, 'utf8')).split('\n')) {
            if (!line.trim()) continue;
            try { entries.push(JSON.parse(line)); }
            catch { incompleteLines++; }
          }
        }
      }
    };
    await readLogs(path.join(destination, 'diagnostics'));
    const timeOf = (entry) => {
      const value = entry.sourceTime ?? entry.time ?? entry.timestamp ?? entry.at;
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
      }
      return Date.parse(value ?? '');
    };
    entries.sort((a, b) => timeOf(a) - timeOf(b) || (a.sequence ?? 0) - (b.sequence ?? 0));
    await writeFile(path.join(destination, 'timeline.jsonl'), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    const cutoff = Date.now() - minutes * 60_000;
    const recent = entries.filter((entry) => timeOf(entry) >= cutoff);
    const counts = {};
    for (const entry of recent) counts[entry.event] = (counts[entry.event] ?? 0) + 1;
    const issues = recent.filter((entry) => ['error', 'fatal', 'fault', 'warn', 'warning'].includes(entry.level));
    const summary = {
      fetchedAt: new Date().toISOString(), minutes, totalRecords: entries.length,
      recentRecords: recent.length, incompleteLines,
      firstRecord: entries[0]?.sourceTime ?? entries[0]?.time ?? entries[0]?.timestamp,
      lastRecord: entries.at(-1)?.sourceTime ?? entries.at(-1)?.time ?? entries.at(-1)?.timestamp,
      events: counts, recentIssues: issues.slice(-100),
      // which taps were followed by a wait, and what the main thread did meanwhile (the app logs `user.tap`, `user.hold`, `ui.main_thread_stall`)
      actions: (({ slow, stalls }) => ({ slowTaps: slow.slice(0, 50), mainThreadStalls: stalls.slice(-50) }))(analyzeActions(recent, { since: cutoff })),
    };
    await writeFile(path.join(destination, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`Logs: ${destination}`);
    console.log(`${entries.length} records; ${recent.length} in the last ${minutes} minutes; ${issues.length} warnings/errors.`);
    console.log(describeActions(analyzeActions(recent, { since: cutoff })));
    console.log('Read timeline.jsonl for the full timeline and summary.json for event counts, recent issues and the slow taps.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
