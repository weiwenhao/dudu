import { Buffer } from 'node:buffer';
import { ConversationError } from './native-conversation.mjs';

// Only the legacy JSON reader aggregates bytes. The native file route streams without this cap.
const MAX_ENCODED_BYTES = 16 * 1024 * 1024;
const types = Object.freeze({ mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime' });
const fail = (code) => { throw new ConversationError(code); };

/** Only durable file references from the owning user-message event are eligible. */
export function videoFromBlock(block) {
  const ref = block?.type === 'file' ? block.attachment : undefined;
  if (!ref || !/^sha256:[a-f0-9]{64}$/u.test(ref.attachmentId ?? '')
    || typeof ref.name !== 'string' || /[/\\\x00-\x1f]/u.test(ref.name)
    || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1) return undefined;
  const extension = ref.name.split('.').at(-1).toLowerCase();
  const mediaType = Object.hasOwn(types, extension) ? types[extension] : undefined;
  return mediaType ? { attachment: { attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes }, mediaType } : undefined;
}

/** Read through DSH's integrity-checking attachment provider, never a phone-supplied path. */
export async function readVideoFile(coordinates, store, signal) {
  const video = openVideoFile(coordinates, store, signal);
  if (video.bytes > MAX_ENCODED_BYTES) fail('LIMIT_EXCEEDED');
  const chunks = [];
  for await (const chunk of video.data) chunks.push(chunk);
  return { name: video.name, mediaType: video.mediaType, dataBase64: Buffer.concat(chunks, video.bytes).toString('base64') };
}

export function openVideoFile(coordinates, store, signal) {
  if (!coordinates || Object.keys(coordinates).some((key) => key !== 'attachment')) fail('BAD_REQUEST');
  const video = videoFromBlock({ type: 'file', attachment: coordinates.attachment });
  if (!video) fail('BAD_REQUEST');
  if (typeof store?.readFileStream !== 'function') fail('UNSUPPORTED');
  return {
    name: video.attachment.name, mediaType: video.mediaType, bytes: video.attachment.bytes,
    data: (async function* () {
      let size = 0;
      for await (const chunk of store.readFileStream(video.attachment, signal)) {
        signal?.throwIfAborted();
        size += chunk.byteLength;
        if (size > video.attachment.bytes) fail('LIMIT_EXCEEDED');
        yield chunk;
      }
      signal?.throwIfAborted();
      if (size !== video.attachment.bytes) fail('NOT_FOUND');
    })(),
  };
}
