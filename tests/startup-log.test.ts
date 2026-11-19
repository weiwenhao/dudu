import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStartupLog } from '../host/startup-log.mjs';

async function withLog(run: (log: ReturnType<typeof createStartupLog>, read: () => Promise<any[]>, clock: { wall: number; perf: number }) => Promise<void>) {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-startup-log-'));
  const clock = { wall: 1_000_000, perf: 0 };
  const log = createStartupLog(folder, { now: () => clock.wall, perf: () => clock.perf, hostUptime: () => 4.2, heapMB: () => 400, identity: { version: '0.1.0', fingerprint: 'abcdef0123456789' } });
  const read = async () => {
    await log.flush();
    return (await readFile(join(folder, 'diagnostics', 'startup.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  };
  try { await run(log, read, clock); } finally { await rm(folder, { recursive: true, force: true }); }
}

// 2026-11-19: after a plugin update the page failed for ~13 s and nothing said which part of the start took the time.
test('the startup log writes each phase, each route and the first answers, and nothing the person typed', async () => {
  await withLog(async (log, read, clock) => {
    log.begin();
    let started = log.now();
    clock.perf += 1200; clock.wall += 1200;
    log.phase('providers', started);
    started = log.now();
    clock.perf += 50;
    log.phase('issues', started, Object.assign(new Error('could not open /Users/someone/secret.db'), { code: 'SCHEMA_TOO_NEW' }));
    log.route('/api/dudu/home/list');

    const secret = 'token=sk-live-123';
    const answer = new Response('{}', { status: 200 });
    const handler = log.wrap('/api/dudu/home/list', async function (this: unknown, request: Request, extra: string) {
      assert.equal(extra, 'second argument');
      clock.perf += 2500; // a slow answer
      assert.match(request.url, /sk-live/);
      return answer;
    });
    assert.equal(await handler(new Request(`http://dudu.invalid/api/dudu/home/list?${secret}`, { method: 'POST', body: 'a prompt the person typed' }), 'second argument'), answer);
    await assert.rejects(log.wrap('/api/dudu/issues/list', async () => { throw Object.assign(new Error('failed at /Users/someone/x'), { name: 'TypeError' }); })(), /failed at/);
    for (let call = 0; call < 6; call++) await log.wrap('/api/dudu/inbox/list', async () => new Response('{}'))();
    for (let run = 0; run < 8; run++) log.step('home.warm', log.now());
    const slowStep = log.now();
    clock.perf += 2000;
    log.step('home.warm', slowStep);
    log.ready();

    const lines = await read();
    assert.deepEqual(lines.map((line) => line.event), ['apply', 'phase', 'phase', 'route', 'request', 'request', 'request', 'request', 'request', 'step', 'step', 'step', 'step', 'step', 'step', 'ready']);
    assert.deepEqual(lines.filter((line) => line.event === 'step').map((line) => [line.name, line.n, line.ms]), [['home.warm', 1, 0], ['home.warm', 2, 0], ['home.warm', 3, 0], ['home.warm', 4, 0], ['home.warm', 5, 0], ['home.warm', 9, 2000]], 'a step is written its first five times and whenever it is slow');
    assert.equal(lines[0].build, 'abcdef01');
    assert.equal(lines[0].hostUpSec, 4);
    assert.deepEqual([lines[1].name, lines[1].ms, lines[1].ok], ['providers', 1200, true]);
    assert.deepEqual([lines[2].name, lines[2].ok, lines[2].error], ['issues', false, 'SCHEMA_TOO_NEW']);
    assert.equal(lines[4].path, '/api/dudu/home/list');
    assert.equal(lines[4].ms, 2500);
    assert.equal(lines[4].status, 200);
    assert.equal(lines[5].error, 'TypeError');
    assert.equal(lines.filter((line) => line.path === '/api/dudu/inbox/list').length, 3, 'only the first three answers of a route are written');
    const everything = JSON.stringify(lines);
    for (const private_ of ['sk-live', 'a prompt', '/Users/someone', 'secret.db']) assert.ok(!everything.includes(private_), `the log must not hold ${private_}`);
  });
});

test('the startup log stays small and private, and a failing disk cannot break the plugin', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-startup-log-'));
  try {
    const log = createStartupLog(folder);
    log.begin();
    for (let line = 0; line < 3000; line++) log.route(`/api/dudu/${'x'.repeat(200)}${line}`);
    await log.flush();
    const sizes = [(await stat(join(folder, 'diagnostics', 'startup.jsonl'))).size, (await stat(join(folder, 'diagnostics', 'startup.jsonl.1')).catch(() => ({ size: 0 }))).size];
    assert.ok(sizes[0] <= 256 * 1024 && sizes[1] <= 256 * 1024);
    assert.equal((await stat(join(folder, 'diagnostics', 'startup.jsonl'))).mode & 0o777, 0o600);
  } finally { await rm(folder, { recursive: true, force: true }); }

  const unwritable = createStartupLog('/dev/null/not-a-folder');
  unwritable.begin();
  unwritable.route('/api/dudu/x');
  await unwritable.flush();
  assert.equal(await unwritable.wrap('/api/dudu/x', async () => 'answer')(), 'answer');
});
