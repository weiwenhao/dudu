import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readCodexMetrics } from '../host/providers/native/codex-metrics.mjs';

test('Codex native counters and item times survive duplicate polling; authoritative turn usage wins', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-codex-metrics-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'rollout.jsonl');
  const count = (input: number, output: number) => ({
    type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: 0 } } },
  });
  await writeFile(file, [
    { type: 'turn_context', payload: { turn_id: 'one' } }, count(100, 10), count(100, 10),
    { type: 'event_msg', timestamp: '2026-11-01T00:00:03.000Z', payload: { type: 'item_completed', turn_id: 'one', item: { id: 'tool' }, started_at_ms: 1000, completed_at_ms: 3000 } },
    { type: 'token_usage_record', payload: { turn_id: 'one', turn_token_usage: { input_tokens: 90, output_tokens: 8 } } },
    { type: 'event_msg', timestamp: '2026-11-01T00:00:04.000Z', payload: { type: 'task_complete', turn_id: 'one' } },
    { type: 'turn_context', payload: { turn_id: 'two' } }, count(140, 15), count(140, 15),
  ].map((row) => JSON.stringify(row)).join('\n') + '\n{partial');
  const turns = await readCodexMetrics(file);
  assert.equal(turns.get('one').usage.totalTokens, 98);
  assert.equal(turns.get('one').fallbackUsage.totalTokens, 110);
  assert.deepEqual(turns.get('one').items.get('tool'), { start: 1000, end: 3000 });
  assert.equal(turns.get('one').endedAt, Date.parse('2026-11-01T00:00:04.000Z'));
  assert.equal(turns.get('two').fallbackUsage.totalTokens, 45);
  assert.equal(turns.get('two').endedAt, undefined, 'an active turn remains unfinished');
  assert.equal((await readCodexMetrics('/missing/rollout.jsonl')).size, 0);
});
