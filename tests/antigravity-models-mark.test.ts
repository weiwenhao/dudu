import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { antigravityModelsMark } from '../host/providers/drivers/antigravity-models.mjs';

// `agy models` prints every model the account has, one line for each model and effort, and makes no conversation. It is stood in for here by a script that prints what the test says.
const LINES = 'gemini-4-neon-high\tGemini 4 Neon (High)\ngemini-4-neon-low\tGemini 4 Neon (Low)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n';

async function agy(t: { after: (cleanup: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'dudu-agy-bin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const command = join(dir, 'agy');
  await writeFile(command, '#!/bin/sh\n[ "$1" = "models" ] || exit 2\n[ -n "$FAKE_AGY_EXIT" ] && exit "$FAKE_AGY_EXIT"\nprintf "%b" "$FAKE_AGY_OUT"\n');
  await chmod(command, 0o755);
  return { via: 'executable', command };
}

test('the models agy has are told by a mark of what it says: the same text the same mark, any change another', async (t) => {
  const installation = await agy(t);
  const mark = await antigravityModelsMark({ installation, env: { FAKE_AGY_OUT: LINES.replaceAll('\n', '\\n').replaceAll('\t', '\\t') } });
  assert.match(String(mark), /^[0-9a-f]{64}$/);
  assert.equal(await antigravityModelsMark({ installation, env: { FAKE_AGY_OUT: LINES.replaceAll('\n', '\\n').replaceAll('\t', '\\t') } }), mark);
  const more = `${LINES}claude-opus-5-5-high\tClaude Opus 5.5 (High)\n`;
  assert.notEqual(await antigravityModelsMark({ installation, env: { FAKE_AGY_OUT: more.replaceAll('\n', '\\n').replaceAll('\t', '\\t') } }), mark, 'a model more');
});

test('nothing is said when agy cannot say, or says what this was not written for', async (t) => {
  const installation = await agy(t);
  const out = LINES.replaceAll('\n', '\\n').replaceAll('\t', '\\t');
  assert.equal(await antigravityModelsMark({ installation, env: { FAKE_AGY_EXIT: '1', FAKE_AGY_OUT: out } }), null, 'signed out: it refuses');
  assert.equal(await antigravityModelsMark({ installation, env: { FAKE_AGY_OUT: '' } }), null, 'nothing printed');
  assert.equal(await antigravityModelsMark({ installation, env: { FAKE_AGY_OUT: 'Please sign in\\n' } }), null, 'a line that is not `id<TAB>name`');
  assert.equal(await antigravityModelsMark({ installation, env: { FAKE_AGY_OUT: out, GEMINI_HOME: '/somewhere/else' } }), null, 'agy models cannot be told which gemini folder to read');
  assert.equal(await antigravityModelsMark({ installation: { via: 'bundled' }, env: {} }), null);
  assert.equal(await antigravityModelsMark({ installation: { via: 'executable', command: join(tmpdir(), 'no-such-agy') }, env: {} }), null);
});
