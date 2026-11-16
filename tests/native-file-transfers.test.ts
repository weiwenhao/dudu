import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeFileTransfers } from '../host/native-file-transfers.mjs';

test('file transfers resolve receipts on their owning live agent and restage through DSH streams', async () => {
  const owner = {};
  const ref = { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'large.mov', bytes: 32 * 1024 * 1024 };
  const uploads = [];
  const transfers = createNativeFileTransfers({
    agent: (id) => id === 'source' ? owner : undefined,
    attachments: () => ({ async *readFileStream(file) { assert.equal(file, ref); yield Buffer.from('bytes'); } }),
    uploads: () => ({
      resolve(agent, receipt) { return agent === owner && receipt === 'owned' ? ref : undefined; },
      async uploadStream({ sessionId, data }) {
        let size = 0;
        for await (const chunk of data) size += chunk.length;
        uploads.push([sessionId, size]);
        return { receiptId: 'target-receipt' };
      },
    }),
  });
  for (const [session, receipt] of [['source', 'foreign'], ['other', 'owned']]) {
    assert.throws(() => transfers.resolve(session, receipt), { code: 'INVALID_ATTACHMENT' });
  }
  assert.equal(transfers.resolve('source', 'owned'), ref);
  assert.deepEqual(await transfers.forward('target', ref), { receiptId: 'target-receipt' });
  assert.deepEqual(uploads, [['target', 5]]);
});
