import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    return;
  }
  const minutes = Number(option('--minutes') ?? 30);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes must be positive.');
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const destination = path.resolve(option('--output') ?? path.join(root, '.local', 'device-logs', timestamp));
  const temporary = await mkdtemp(path.join(tmpdir(), 'dsbot-logs-'));
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
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
