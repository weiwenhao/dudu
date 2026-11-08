export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const mediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Keep durable DSH references opaque; only session/attachment may resolve their bytes. */
export function imageFromBlock(block) {
  if (!block || block.type !== 'image') return undefined;
  const ref = block.attachment;
  if (ref && typeof ref.attachmentId === 'string' && ref.attachmentId.length > 0
    && ref.attachmentId.length <= 512 && mediaTypes.has(ref.mediaType)) {
    return { attachment: { ...ref }, mediaType: ref.mediaType };
  }
  if (!mediaTypes.has(block.mediaType) || typeof block.data !== 'string' || !block.data.length
    || block.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return undefined;
  return { mediaType: block.mediaType, data: block.data };
}
