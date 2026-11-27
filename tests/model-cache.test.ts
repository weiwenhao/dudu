import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelCache } from '../host/providers/model-cache.mjs';

const MODELS = [{ id: 'gemini-4-neon', displayName: 'Gemini 4 Neon', effortLevels: ['low', 'high'], defaultEffort: 'high', default: true }, { id: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)' }];

async function folder(t: { after: (cleanup: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'dudu-models-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'state', 'model-lists.json');
}

test('what a harness said of its models is kept across restarts, with what it was said for', async (t) => {
  const file = await folder(t);
  const first = createModelCache(file);
  assert.equal(await first.get('antigravity'), undefined, 'nothing is known at first');
  await first.set('antigravity', { mark: 'abc', version: '1.5.18', command: '/home/me/.local/bin/agy', models: MODELS });
  const second = createModelCache(file);
  assert.deepEqual(await second.get('antigravity'), { mark: 'abc', version: '1.5.18', command: '/home/me/.local/bin/agy', models: MODELS });
  assert.equal(await second.get('grok'), undefined);
  await second.set('grok', { mark: 'x', version: '1', models: [{ id: 'grok-4' }] });
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file, 'utf8'))).sort(), ['antigravity', 'grok'], 'one harness does not replace another');
});

test('a file that is not what was written is nothing known, and is written over', async (t) => {
  const file = await folder(t);
  const cache = createModelCache(file);
  await cache.set('antigravity', { mark: 'abc', version: '1', models: MODELS });
  for (const text of ['not json', '[]', 'null', JSON.stringify({ antigravity: { mark: 5, version: '1', models: MODELS } }), JSON.stringify({ antigravity: { mark: 'a', version: '1', models: 'x' } }), JSON.stringify({ antigravity: { mark: 'a', version: '1', models: [{ name: 'no id' }] } })]) {
    await writeFile(file, text);
    assert.equal(await createModelCache(file).get('antigravity'), undefined, text);
  }
  await writeFile(file, 'not json');
  const again = createModelCache(file);
  await again.set('antigravity', { mark: 'b', version: '2', models: MODELS });
  assert.equal((await createModelCache(file).get('antigravity'))?.mark, 'b');
});
