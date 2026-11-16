import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createConversationReads } from '../host/native-conversation-reads.mjs';
import { videoFromBlock } from '../host/native-videos.mjs';

test('video reads accept only bounded durable movie references and preserve exact bytes', async () => {
  const data = Buffer.from('verbatim video');
  const attachment = { attachmentId: `sha256:${createHash('sha256').update(data).digest('hex')}`, name: 'clip.mp4', bytes: data.length };
  let readCount = 0;
  const reads = createConversationReads({ peer: { principal: { kind: 'owner' } }, attachments: () => ({
    async *readFileStream(ref, signal) {
      readCount++;
      assert.deepEqual(ref, attachment);
      signal.throwIfAborted();
      yield data.subarray(0, 4);
      yield data.subarray(4);
    },
  }) });
  assert.deepEqual(await reads.read('video', { attachment }), { name: 'clip.mp4', mediaType: 'video/mp4', dataBase64: data.toString('base64') });
  for (const change of [
    { name: '../clip.mp4' }, { name: 'clip.svg' }, { name: 'clip.constructor' }, { name: 'clip.__proto__' }, { attachmentId: '/private/file.mp4' },
    { bytes: 0 }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { bytes: 1.5 },
  ]) {
    assert.equal(videoFromBlock({ type: 'file', attachment: { ...attachment, ...change } }), undefined);
    await assert.rejects(reads.read('video', { attachment: { ...attachment, ...change } }), { code: 'BAD_REQUEST' });
  }
  await assert.rejects(reads.read('video', { attachment, path: '/private/file.mp4' }), { code: 'BAD_REQUEST' });
  assert.equal(readCount, 1);
  const oversized = createConversationReads({ peer: { principal: { kind: 'owner' } }, attachments: () => ({
    async *readFileStream() { yield Buffer.alloc(data.length + 1); },
  }) });
  await assert.rejects(oversized.read('video', { attachment }), { code: 'LIMIT_EXCEEDED' });
  const short = createConversationReads({ peer: { principal: { kind: 'owner' } }, attachments: () => ({
    async *readFileStream() { yield data.subarray(0, 1); },
  }) });
  await assert.rejects(short.read('video', { attachment }), { code: 'NOT_FOUND' });
});

test('native video streaming preserves a movie larger than the legacy JSON limit without aggregating it', async () => {
  const chunk = Buffer.alloc(64 * 1024, 0x7a);
  const bytes = 20 * 1024 * 1024;
  const attachment = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'large.mov', bytes };
  let emitted = 0;
  const reads = createConversationReads({ peer: { principal: { kind: 'owner' } }, attachments: () => ({
    async *readFileStream(ref) {
      assert.deepEqual(ref, attachment);
      while (emitted < bytes) { emitted += chunk.length; yield chunk; }
    },
  }) });
  assert.ok(videoFromBlock({ type: 'file', attachment }));
  const video = reads.openVideo({ attachment });
  assert.equal(emitted, 0, 'opening does not eagerly read the movie');
  assert.equal(video.bytes, bytes);
  let received = 0;
  for await (const part of video.data) { received += part.length; assert.equal(received, emitted); }
  assert.equal(received, bytes);
  await assert.rejects(reads.read('video', { attachment }), { code: 'LIMIT_EXCEEDED' });
});
