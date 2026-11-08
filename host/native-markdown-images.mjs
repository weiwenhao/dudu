import { fromMarkdown } from 'mdast-util-from-markdown';
import { isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConversationError } from './native-conversation.mjs';

const fail = () => { throw new ConversationError('NOT_FOUND'); };

// A URL supplied by the phone is only a selector: the persisted message grants the file read.
export function markdownImagePath(event, source, cwd) {
  if (event?.type !== 'assistant/message' || event.surfaceOp !== 'append'
    || typeof source !== 'string' || !source || source.length > 8192) fail();
  const content = event.data?.message?.content;
  if (!Array.isArray(content)) fail();
  const text = content.filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text).join('').slice(0, 60_000);
  const root = fromMarkdown(text);
  const definitions = new Map();
  const images = [];
  const references = [];
  const nodes = [root];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    if (node.type === 'image') images.push(node.url);
    if (node.type === 'imageReference') references.push(node.identifier);
    if (node.children) nodes.push(...node.children.toReversed());
  }
  images.push(...references.map((id) => definitions.get(id)).filter(Boolean));
  const identity = (value) => {
    try { return new URL(value, 'dudu-markdown:/').href; } catch { return undefined; }
  };
  const wanted = identity(source);
  // Foundation can re-encode existing % escapes when repairing a URL with unescaped Unicode.
  const original = wanted && images.find((image) => {
    if (identity(image) === wanted) return true;
    try { return identity(encodeURI(image)) === wanted; } catch { return false; }
  });
  if (!original) fail();
  try {
    const base = typeof cwd === 'string' && isAbsolute(cwd) ? pathToFileURL(cwd + sep) : undefined;
    if (!base && !isAbsolute(original) && !original.startsWith('file:')) fail();
    const url = new URL(original, base ?? 'file:///');
    if (url.protocol !== 'file:' || url.hostname && url.hostname !== 'localhost') fail();
    const path = fileURLToPath(url);
    if (path.includes('\0')) fail();
    return path;
  } catch { fail(); }
}
