import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { Readable } from 'node:stream';

const imageType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const missing = (code) => ({ outcome: 'needs_clarification', code });

/** Reuse immutable owner attachments or the UI's upload handler. Local paths require the actual session's full-access preset. */
export async function addIssueAttachment({ api, issues, args, exec, permissionOf }) {
  const issue = issues.get(args.id, { logLimit: 1 });
  if (issue.outcome !== 'success') return issue;
  if (!api) return { outcome: 'error', code: 'unavailable' };
  if (args.path !== undefined) {
    if (permissionOf(exec) !== 'danger-full-access') return missing('local_file_requires_full_access');
    if (!isAbsolute(args.path)) return missing('invalid_path');
    const info = await stat(args.path);
    if (!info.isFile()) return missing('invalid_path');
    const mediaType = args.mediaType ?? imageType[extname(args.path).toLowerCase()];
    const type = args.type ?? (mediaType ? 'image' : 'file');
    const query = new URLSearchParams({ id: String(args.id), type, name: args.name ?? basename(args.path) });
    const response = await api.upload(new Request(`http://dudu.local/attachment-upload?${query}`, {
      method: 'POST', headers: { 'content-type': mediaType ?? 'application/octet-stream' },
      body: Readable.toWeb(createReadStream(args.path)), duplex: 'half', signal: exec?.signal,
    }));
    return response.json();
  }
  if (!args.name) return missing('name_or_path_required');
  let found;
  for (const event of exec?.agent?.session?.snapshotEvents?.() ?? []) {
    if (event.type !== 'user/message') continue;
    const content = event.data?.message?.content ?? event.data?.content;
    for (const part of Array.isArray(content) ? content : []) {
      if (['image', 'file'].includes(part.type) && part.attachment?.name === args.name) found = part;
    }
  }
  return found ? issues.stageAttachment(args.id, found.type, found.attachment) : missing('attachment_not_in_conversation');
}

export async function readIssueAttachment({ api, issues, args, signal }) {
  const got = issues.attachment(args.id, args.key);
  if (got.outcome !== 'success') return got;
  const ref = got.item.attachment;
  if (got.item.type === 'image') return { ...got, binary: true };
  if (!api) return { outcome: 'error', code: 'unavailable' };
  const query = new URLSearchParams({ id: String(args.id), key: args.key });
  const response = await api.read(new Request(`http://dudu.local/attachment?${query}`, { signal }));
  if (!response.ok || !response.body) return { outcome: 'error', code: 'attachment_unavailable' };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (bytes < 300_000) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value).subarray(0, 300_000 - bytes);
      chunks.push(chunk);
      bytes += chunk.length;
    }
  } finally { await reader.cancel(); }
  const data = Buffer.concat(chunks);
  if (data.includes(0)) return { ...got, binary: true };
  const content = data.toString('utf8');
  return { ...got, text: content.slice(0, 60_000), truncated: ref.bytes > bytes || content.length > 60_000 };
}
