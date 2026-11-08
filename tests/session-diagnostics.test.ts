import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionDiagnostics } from '../host/session-diagnostics.mjs';

test('session diagnostics retain read identity and timing without persisting upstream content or credentials', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-session-log-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const log = createSessionDiagnostics(folder);
  log.record({ event: 'session.index.failure', provider: 'codex', id: 'one', error: new Error('ENOENT: no such file /private/secret; Bearer credential; user message') });
  log.record({ event: 'session.preview.read', provider: 'dsh', id: 'two', source: 'sqlite', outcome: 'success', elapsedMs: 3, count: 20 });
  await log.flush();
  const file = join(folder, 'diagnostics', 'sessions.jsonl');
  const text = await readFile(file, 'utf8');
  assert.doesNotMatch(text, /private|secret|Bearer|credential|user message|ENOENT/);
  const rows = text.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows[0].reason, 'missing_transcript');
  assert.equal(rows[0].id, 'one');
  assert.deepEqual([rows[1].source, rows[1].elapsedMs, rows[1].count], ['sqlite', 3, 20]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});
