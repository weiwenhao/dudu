/** Session-owned DSH upload receipts. No phone-supplied path or durable reference is accepted. */
export function createNativeFileTransfers({ uploads, attachments, agent }) {
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  return {
    async upload({ sessionId, name, data, signal }) {
      const service = uploads();
      if (typeof service?.uploadStream !== 'function') fail('UNSUPPORTED');
      signal?.throwIfAborted();
      return service.uploadStream({ sessionId, name, data, signal });
    },
    resolve(sessionId, receiptId) {
      const owner = agent(sessionId);
      const ref = owner && uploads()?.resolve(owner, receiptId);
      if (!ref || typeof ref.attachmentId !== 'string' || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1) fail('INVALID_ATTACHMENT');
      return ref;
    },
    async forward(sessionId, ref) {
      const store = attachments();
      const service = uploads();
      if (typeof store?.readFileStream !== 'function' || typeof service?.uploadStream !== 'function') fail('UNSUPPORTED');
      return service.uploadStream({ sessionId, name: ref.name, data: store.readFileStream(ref) });
    },
  };
}
