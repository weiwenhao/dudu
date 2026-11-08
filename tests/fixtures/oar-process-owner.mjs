import { setTimeout as delay } from 'node:timers/promises';
import { killEntries, readProcessTable, spawnLineProcess, trackPendingCleanup } from '@dudu/oar-adapter/testing';

const handled = process.argv.includes('--handle-term');
const pending = process.argv.includes('--pending-cleanup');
if (handled) process.on('SIGTERM', () => process.send({ kind: 'handled' }));
const signals = ['exit', 'SIGTERM', 'SIGINT', 'SIGHUP'];
const listeners = () => signals.map((signal) => process.listenerCount(signal));
const before = listeners();
const child = spawnLineProcess(process.execPath, ['--input-type=module', '--eval', `
  import { spawn } from 'node:child_process';
  const descendant = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], {
    detached: process.platform !== 'win32', stdio: 'ignore',
  });
  descendant.once('spawn', () => console.log(JSON.stringify({ pid: process.pid, descendant: descendant.pid })));
  process.stdin.on('data', () => process.exit(0));
  setInterval(() => {}, 1000);
`], { killTree: true });
let releasePending;
let captured;
child.onLine(async (line) => {
  const ready = JSON.parse(line);
  if (pending) {
    captured = readProcessTable().get(ready.descendant);
    if (!captured) throw new Error('The test descendant was not observed');
    releasePending = trackPendingCleanup((read) => {
      const observation = read();
      if (observation.ok) killEntries([captured], observation.table);
      return { status: observation.ok ? 'observed' : 'unverified', observations: [] };
    });
    // Simulate upstream's captured ownership surviving the root and its pipes.
    child.write('exit\n');
    await child.exited;
    await new Promise(resolve => setImmediate(resolve));
  }
  process.send({ kind: 'ready', ...ready, before, after: listeners() });
});
await child.spawned;
process.on('message', async (message) => {
  if (message === 'exit') process.exit(0);
  if (message === 'dispose') {
    if (pending) {
      killEntries([captured], readProcessTable());
      releasePending();
    }
    child.kill();
    await child.exited;
    // The ownership ends on close, after all the child's output pipes close.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && String(listeners()) !== String(before)) await delay(5);
    process.send({ kind: 'disposed', before, after: listeners() });
  }
});
