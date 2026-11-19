import { Buffer } from 'node:buffer';
import { appendFile, chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { join } from 'node:path';
import { getHeapStatistics } from 'node:v8';

const MAX_BYTES = 256 * 1024;
const MAX_PENDING = 256;
const MAX_REQUEST_LINES = 200;
const MAX_STEP_LINES = 200;
const EARLY_MS = 3 * 60_000; // the first minutes of a start: each route's first answers are written
const EARLY_PER_ROUTE = 3;
const EARLY_PER_STEP = 5;
const SLOW_MS = 1500;
const LOOP_RESOLUTION_MS = 10;

// An error's code or name, when it is a short plain token; never its message (messages carry paths).
const errorName = (error) => {
  const name = String(error?.code ?? error?.name ?? 'Error');
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(name) ? name : 'Error';
};

/**
 * A bounded local log of how the plugin starts (`<state folder>/diagnostics/startup.jsonl`): how long each start phase took and how busy the host's event
 * loop was meanwhile, when each route became available, the first answers each route gave, and any slow or failed one; and how long each part took to stop.
 * Times, route paths and error names only: never a request's address or body, an id, a prompt, a file path or an error message.
 * Every line carries `t` (epoch milliseconds) and `up` (milliseconds since the start began). 0600, at most 256 KiB, the current file and the one before it;
 * written asynchronously and never able to hold up or fail the plugin.
 */
export function createStartupLog(folder, {
  now = Date.now, perf = () => performance.now(), hostUptime = () => process.uptime(),
  heapMB = () => Math.round(getHeapStatistics().used_heap_size / 1048576), identity = {},
} = {}) {
  const directory = join(folder, 'diagnostics');
  const file = join(directory, 'startup.jsonl');
  const imported = now();
  let began = 0;
  let tail = Promise.resolve();
  let pending = 0;
  let requestLines = 0;
  let stepLines = 0;
  let loop = null;
  const answers = new Map(); // route path -> how many answers it has given
  const runs = new Map(); // step name -> how many times it has run

  const up = () => (began ? now() - began : 0);
  function record(event, fields = {}) {
    if (pending >= MAX_PENDING) return;
    const line = JSON.stringify({ t: now(), up: up(), event, ...fields }) + '\n';
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
  }

  // The longest the event loop was late since the last look: about the resolution when idle, long when something kept the loop busy.
  const loopMaxMs = () => {
    if (!loop) return undefined;
    const ms = Math.round(loop.max / 1e6);
    loop.reset();
    return ms;
  };

  function answered(path, ms, status, error) {
    const count = (answers.get(path) ?? 0) + 1;
    answers.set(path, count);
    const early = began > 0 && now() - began < EARLY_MS && count <= EARLY_PER_ROUTE;
    if (!(early || error || ms >= SLOW_MS || status >= 400) || requestLines >= MAX_REQUEST_LINES) return;
    requestLines++;
    record('request', { path, n: count, ms: Math.round(ms), ...(status ? { status } : {}), ...(error ? { error: errorName(error) } : {}) });
  }

  return {
    /** The reading of the clock `phase` and `stop` are given. */
    now: perf,
    /** The plugin's start begins. */
    begin() {
      began = now();
      loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
      loop.enable();
      record('apply', {
        pid: process.pid, version: identity.version, build: identity.fingerprint?.slice(0, 8), hostUpSec: Math.round(hostUptime()),
        sinceImportMs: began - imported, heapMB: heapMB(), loopResolutionMs: LOOP_RESOLUTION_MS,
      });
    },
    /** One start phase ended, `startedAt` being the clock's reading when it began; `error` when it failed. */
    phase(name, startedAt, error) {
      record('phase', { name, ms: Math.round(perf() - startedAt), ok: !error, ...(error ? { error: errorName(error) } : {}), loopMaxMs: loopMaxMs(), heapMB: heapMB() });
    },
    /** A route became available to DSH. */
    route(path) { record('route', { path }); },
    /** A part of a phase (or of what a route does) ended: its first few runs are written, and any later one that is slow. */
    step(name, startedAt) {
      const ms = perf() - startedAt;
      const count = (runs.get(name) ?? 0) + 1;
      runs.set(name, count);
      if ((count > EARLY_PER_STEP && ms < SLOW_MS) || stepLines >= MAX_STEP_LINES) return;
      stepLines++;
      record('step', { name, n: count, ms: Math.round(ms) });
    },
    /** The handler of a route, timing what it answers. It answers and throws exactly as `fetch` does. */
    wrap(path, fetch) {
      return async function timed(...args) {
        const started = perf();
        let response;
        try { response = await fetch.apply(this, args); } catch (error) {
          answered(path, perf() - started, undefined, error);
          throw error;
        }
        answered(path, perf() - started, response?.status);
        return response;
      };
    },
    /** The start is over. */
    ready() {
      record('ready', { ms: now() - began, loopMaxMs: loopMaxMs(), heapMB: heapMB() });
      loop?.disable();
      loop = null;
    },
    /** One part of the plugin stopped. */
    stop(name, startedAt) { record('stop', { name, ms: Math.round(perf() - startedAt) }); },
    /** A line of its own (the plugin has finished stopping). */
    mark(event) { record(event); },
    flush: () => tail,
  };
}
