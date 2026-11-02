import { Buffer } from 'node:buffer';
import { open, stat } from 'node:fs/promises';

// The pictures a person pasted into a Claude Code or Codex session. The readers (claude-history.mjs, codex-history.mjs) keep
// them in order next to the words, as `parts` of a turn:
//
//   { type: 'text', text }
//   { type: 'image', mediaType, data }   the bytes, when the transcript holds them
//   { type: 'image', path }              Codex hands over a file it wrote the picture to
//   { type: 'image', skipped: true }     a picture that cannot be had (a link, a file that is gone, too many)
//
// Loading a session into DSH turns each picture into one of DSH's own: the bytes go to DSH's attachment store (the same
// call DSH makes for a picture pasted into its composer) and the message holds `{ type: 'image', attachment }`, so DSH's chat
// shows it. A picture that cannot be stored stays the one-line marker it always was. Nothing here may fail a load.

export const IMAGE_MARKER = '[image]';

const FORMATS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// What is read from a transcript or a file at all, before DSH's own limits say more.
const READ_LIMIT = 25 * 1024 * 1024;
// What one session may keep in memory while its conversation is being read (the rest become markers).
export const SESSION_IMAGE_BUDGET = 256 * 1024 * 1024;
const DEFAULT_LIMITS = { maxImageBytes: 20 * 1024 * 1024, maxImagesPerMessage: 10, maxMessageImageBytes: 40 * 1024 * 1024, mediaTypes: FORMATS };

/** What kind of picture these bytes are, from the bytes themselves (a name or a declared type is only a hint). */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const head = Buffer.from(bytes.subarray(0, 12)).toString('latin1');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/** A picture part from base64 text, or a marker when it is not one worth keeping. */
export function imageFromBase64(data, mediaType, budget) {
  if (typeof data !== 'string' || !data) return { type: 'image', skipped: true };
  const size = Math.floor((data.length * 3) / 4);
  if (size > READ_LIMIT || (budget && size > budget.left)) return { type: 'image', skipped: true };
  const bytes = Buffer.from(data, 'base64');
  const type = sniffImageType(bytes) ?? (FORMATS.includes(mediaType) ? mediaType : undefined);
  if (!type || !bytes.length) return { type: 'image', skipped: true };
  if (budget) budget.left -= bytes.length;
  return { type: 'image', mediaType: type, data: bytes };
}

/** A picture part from a `data:image/...;base64,` link. Any other link is not fetched: it is a marker. */
export function imageFromUrl(url, budget) {
  const match = typeof url === 'string' ? /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(url) : null;
  return match ? imageFromBase64(url.slice(match[0].length), match[1].toLowerCase(), budget) : { type: 'image', skipped: true };
}

/** The bytes of a picture file the harness wrote, or undefined: it is not there, not a plain file, or too big. */
async function readPicture(path, limit) {
  if (typeof path !== 'string' || !path) return undefined;
  let handle;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > limit || info.size === 0) return undefined;
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
    return buffer.subarray(0, bytesRead);
  } catch { return undefined; } finally { await handle?.close().catch(() => {}); }
}

/** The text of a run of parts as one block: a marker for each picture that could not be kept, lines apart. */
const textOfRun = (run) => run.map((piece) => piece.text).join('\n').trim();

/**
 * What the person's message holds, as the content of DSH's `user/message`: the words, and the pictures that were stored as
 * DSH's own, in the order they were sent. Words and markers that sit together are one text part. A turn that has no parts
 * says what it said as `prompt`.
 */
export function userContent(turn) {
  const parts = Array.isArray(turn.parts) ? turn.parts : [];
  if (!parts.length) return [{ type: 'text', text: turn.prompt }];
  const content = [];
  let run = [];
  const flush = () => { const text = textOfRun(run); if (text) content.push({ type: 'text', text }); run = []; };
  for (const part of parts) {
    if (part.type === 'image' && part.attachment) { flush(); content.push({ type: 'image', attachment: part.attachment }); }
    else if (part.type === 'image') run.push({ text: IMAGE_MARKER });
    else if (typeof part.text === 'string') run.push(part);
  }
  flush();
  return content.length ? content : [{ type: 'text', text: turn.prompt }];
}

/** The pictures of one message that DSH's limits allow, in order; the rest stay markers. */
function admissible(images, limits) {
  const taken = [];
  let total = 0;
  for (const image of images) {
    const fits = taken.length < limits.maxImagesPerMessage && image.data.length <= limits.maxImageBytes
      && total + image.data.length <= limits.maxMessageImageBytes && limits.mediaTypes.includes(image.mediaType);
    if (!fits) { image.skipped = true; continue; }
    taken.push(image);
    total += image.data.length;
  }
  return taken;
}

/** Save these through DSH: together first (one call, as DSH does for a message); one by one when that is refused. */
async function store(attachments, images) {
  if (!images.length) return;
  const input = images.map(({ data, mediaType }) => ({ data, mediaType }));
  try {
    const refs = await attachments.saveImages(input);
    if (Array.isArray(refs) && refs.length === images.length) { images.forEach((image, index) => { image.attachment = refs[index]; }); return; }
  } catch { /* one of them may be the reason: the rest are tried alone below */ }
  for (const [index, image] of images.entries()) {
    try { image.attachment = await attachments.saveImage(input[index]); } catch { image.skipped = true; }
  }
}

/** One turn with its pictures stored: a copy, so a conversation that is kept for reuse is never changed. */
async function keepTurnImages(turn, attachments) {
  if (!(turn.parts ?? []).some((part) => part.type === 'image' && !part.skipped)) return turn;
  const parts = turn.parts.map((part) => (part.type === 'image' ? { ...part } : part));
  const images = parts.filter((part) => part.type === 'image' && !part.skipped);
  try {
    const limits = { ...DEFAULT_LIMITS, ...(attachments?.imageLimits ?? {}) };
    for (const image of images) {
      if (image.data || !image.path) continue;
      const bytes = await readPicture(image.path, Math.min(READ_LIMIT, limits.maxImageBytes));
      const type = sniffImageType(bytes);
      if (!bytes || !type) image.skipped = true;
      else Object.assign(image, { data: bytes, mediaType: type });
    }
    const ready = images.filter((image) => !image.skipped);
    if (!attachments || typeof attachments.saveImages !== 'function') for (const image of ready) image.skipped = true;
    else await store(attachments, admissible(ready, limits));
  } catch {
    for (const image of images) if (!image.attachment) image.skipped = true;
  }
  for (const image of images) { delete image.data; delete image.path; }
  return { ...turn, parts };
}

/**
 * The conversation with the pictures of its turns put in DSH's attachment store. After this every picture part holds either
 * `attachment` (it is stored) or `skipped` (it stays a marker); the bytes are let go. It never throws: without the attachment
 * service, or when DSH refuses a picture, the conversation loads with the markers it used to have.
 */
export async function keepImages(history, { attachments } = {}) {
  const turns = [];
  for (const turn of history?.turns ?? []) {
    const saved = await keepTurnImages(turn, attachments);
    if (!saved.steps.some((step) => step.input)) { turns.push(saved); continue; }
    const steps = [];
    for (const step of saved.steps) steps.push(step.input ? { ...step, input: await keepTurnImages(step.input, attachments) } : step);
    turns.push({ ...saved, steps });
  }
  return { ...history, turns };
}
