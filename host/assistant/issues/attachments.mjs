import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const problem = (status, code) => Response.json({ outcome: 'error', code }, { status, headers: noStore });
const disposition = (mode, name) => `${mode}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (part) => `%${part.charCodeAt(0).toString(16)}`)}`;

/** Issue-owned references over DSH's immutable attachment service. These routes use DSH's authenticated connection. */
export function createIssueAttachmentApi({ issues, attachments }) {
  return {
    async upload(request) {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (issues.get(id, { logLimit: 1 }).outcome !== 'success') return problem(404, 'issue_unavailable');
      const store = attachments();
      if (!store?.saveFileStream || !request.body) return problem(503, 'attachments_unavailable');
      const type = url.searchParams.get('type');
      const name = (url.searchParams.get('name') ?? '').split(/[\\/]/).pop();
      try {
        let ref;
        if (type === 'image') {
          const mediaType = request.headers.get('content-type')?.split(';')[0];
          if (!imageTypes.has(mediaType)) return problem(415, 'invalid_attachment');
          const chunks = [];
          let size = 0;
          for await (const chunk of request.body) {
            size += chunk.length;
            if (size > store.imageLimits.maxImageBytes) return problem(413, 'invalid_attachment');
            chunks.push(chunk);
          }
          ref = await store.saveImage({ data: Buffer.concat(chunks), mediaType, name });
        } else if (type === 'file') {
          ref = await store.saveFileStream({ data: request.body, name, signal: request.signal });
        } else return problem(400, 'invalid_attachment');
        const result = issues.stageAttachment(id, type, ref);
        return Response.json(result, { status: result.outcome === 'success' ? 200 : 409, headers: noStore });
      } catch { return problem(400, 'invalid_attachment'); }
    },
    async read(request) {
      const url = new URL(request.url);
      const result = issues.attachment(url.searchParams.get('id'), url.searchParams.get('key'));
      if (result.outcome !== 'success') return problem(404, 'attachment_unavailable');
      const { type, attachment: ref } = result.item;
      const store = attachments();
      if (!store) return problem(503, 'attachments_unavailable');
      const headers = {
        ...noStore,
        'content-disposition': disposition(url.searchParams.has('download') || type === 'file' ? 'attachment' : 'inline', ref.name || 'image'),
        'content-type': type === 'image' ? ref.mediaType : 'application/octet-stream',
        'content-security-policy': "default-src 'none'; sandbox",
      };
      try {
        if (type === 'image') {
          const stored = await store.readImage(ref, request.signal);
          return new Response(stored.data, { headers });
        }
        return new Response(Readable.toWeb(Readable.from(store.readFileStream(ref, request.signal))), { headers });
      } catch { return problem(404, 'attachment_unavailable'); }
    },
    /** Promote only references owned by this issue into the existing session-scoped prompt protocol. */
    async promptParts(issue, entry, sessionId, fileUploads) {
      const parts = [];
      const store = attachments();
      for (const item of entry.data?.attachments ?? []) {
        const got = issues.attachment(issue.id, item.id);
        if (got.outcome !== 'success') throw new Error('Issue attachment is unavailable.');
        const { type, attachment: ref } = got.item;
        if (type === 'image') {
          const stored = await store.readImage(ref);
          parts.push({ type: 'image', mediaType: ref.mediaType, data: Buffer.from(stored.data).toString('base64'), name: ref.name });
        } else {
          if (!fileUploads?.uploadStream) throw new Error('File upload is unavailable.');
          const receipt = await fileUploads.uploadStream({ sessionId, data: store.readFileStream(ref), name: ref.name });
          parts.push({ type: 'file', receiptId: receipt.receiptId });
        }
      }
      return parts;
    },
  };
}
