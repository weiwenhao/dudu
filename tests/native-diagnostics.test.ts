import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createNativeDiagnostics } from '../host/native-diagnostics.mjs';

test('upstream diagnostics retain bounded categories without upstream messages or request content', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-diagnostics-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const diagnostics = createNativeDiagnostics(folder);
  diagnostics.failure({
    endpoint: 'session/follow', stage: 'next',
    error: Object.assign(new Error('private message with token=secret'), {
      code: 'gateway/internal', cause: { code: 'SESSION_QUERY_READ_FAILED', path: '/private/session' },
    }),
    params: { text: 'private draft' },
  });
  diagnostics.failure({ endpoint: 'token=secret', stage: 'next', error: new Error('private') });
  await diagnostics.flush();
  const file = join(folder, 'diagnostics/upstream.jsonl');
  const body = await readFile(file, 'utf8');
  const entry = JSON.parse(body);
  assert.deepEqual({ ...entry, timestamp: 0 }, {
    timestamp: 0, event: 'gateway.failure', endpoint: 'session/follow', stage: 'next',
    codes: ['gateway/internal', 'SESSION_QUERY_READ_FAILED'],
  });
  assert.doesNotMatch(body, /private|secret|token/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(folder, 'diagnostics'))).mode & 0o777, 0o700);
});

test('upstream diagnostics rotate privately and bound pending writes', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsbot-diagnostics-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await mkdir(join(folder, 'diagnostics'));
  const file = join(folder, 'diagnostics/upstream.jsonl');
  await writeFile(file, 'x'.repeat(256 * 1024), { mode: 0o600 });
  const diagnostics = createNativeDiagnostics(folder);
  for (let index = 0; index < 200; index++) {
    diagnostics.failure({ endpoint: 'session/follow', stage: 'next', error: { code: 'session/not-found' } });
  }
  await diagnostics.flush();
  assert.equal((await stat(file + '.1')).size, 256 * 1024);
  assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 128);
});
