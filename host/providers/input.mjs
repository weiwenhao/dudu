import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { GOAL_ROUND_NOTE } from './goal.mjs';

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Resolve DSH's durable images into OAR's native image input. A failed read rejects the whole input. */
export function createHarnessInput({ attachments, folder }) {
  return async (messages, { signal } = {}) => {
    const images = [];
    const texts = [];
    for (const message of messages) {
      const text = [];
      for (const block of message.content ?? []) {
        signal?.throwIfAborted();
        if (block.type === 'text') text.push(block.text);
        else if (block.type === 'image') {
          const store = attachments();
          const stored = await store.readImage(block.attachment, signal);
          const mediaType = stored.ref?.mediaType ?? block.attachment.mediaType;
          let path = store.imageHostPath?.(block.attachment);
          if (!isAbsolute(path ?? '')) {
            // Older/non-file-backed stores need a durable file: Codex's resumed history keeps this path.
            const name = createHash('sha256').update(stored.data).digest('hex');
            await mkdir(folder, { recursive: true, mode: 0o700 });
            path = join(folder, `${name}.${EXTENSIONS[mediaType] ?? 'img'}`);
            await writeFile(path, stored.data, { mode: 0o600, flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
          }
          images.push({ path, mediaType });
        }
      }
      if (text.length && message.source?.kind === 'goal') text.push(`\n\n${GOAL_ROUND_NOTE}`);
      if (text.length) texts.push(text.join(''));
    }
    return { prompt: texts.filter(Boolean).join('\n\n'), ...(images.length ? { images } : {}) };
  };
}
