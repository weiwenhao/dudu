import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHarnessInput } from '../host/providers/input.mjs';
import { claudeUsage, codexUsage } from '../host/providers/usage.mjs';

const ref = { attachmentId: 'image-id', mediaType: 'image/png' };
const message = (content: any[]) => ({ content });

test('image-only input reaches the harness as an image, and fallback files remain durable and private', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dudu-images-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const data = Buffer.from('stored image bytes');
  const input = createHarnessInput({ folder, attachments: () => ({ readImage: async () => ({ ref, data }) }) });
  const messages = [message([{ type: 'image', attachment: ref }])];
  const value = await input(messages);
  assert.equal(value.prompt, '');
  assert.equal(value.images[0].mediaType, 'image/png');
  assert.deepEqual(await readFile(value.images[0].path), data);
  assert.equal((await stat(value.images[0].path)).mode & 0o777, 0o600);
  assert.deepEqual(await input(messages), value, 'repeated sends reuse the same durable path');
});

test('DSH host paths are used after reading the image; a missing image rejects the entire message', async () => {
  const input = createHarnessInput({ folder: '/unused', attachments: () => ({
    readImage: async () => ({ ref, data: Buffer.from('x') }), imageHostPath: () => '/durable/dsh/image.png',
  }) });
  assert.deepEqual(await input([message([{ type: 'text', text: 'Look.' }, { type: 'image', attachment: ref }])]), {
    prompt: 'Look.', images: [{ path: '/durable/dsh/image.png', mediaType: 'image/png' }],
  });
  const missing = createHarnessInput({ folder: '/unused', attachments: () => ({ readImage: async () => { throw new Error('not found'); } }) });
  await assert.rejects(missing([message([{ type: 'text', text: 'Look.' }, { type: 'image', attachment: ref }])]), /not found/);
});

test('provider usage keeps DSH input/cache counts disjoint without inventing unknown measurements', () => {
  assert.deepEqual(codexUsage({ input_tokens: 100, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 10 }), {
    inputTokens: 40, cacheReadTokens: 60, outputTokens: 20, reasoningTokens: 10, totalTokens: 120,
  });
  assert.deepEqual(claudeUsage({ input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 }), {
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 30, cacheWriteTokens: 20, totalTokens: 65,
  });
  assert.equal(codexUsage(undefined), undefined);
});
