import { fromMarkdown } from 'mdast-util-from-markdown';
import { isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SAY_COMMAND } from './assistant/home/group.mjs';
import { ConversationError } from './native-conversation.mjs';

const fail = () => { throw new ConversationError('NOT_FOUND'); };
const MAX_TEXT = 60_000;

/**
 * The markdown a selector may name an image of: an assistant message of the watched session, or a line of 嘟嘟's group chat that says what an agent said (an issue's answer, a task's result; owner,
 * 2026-11-11: "图片无法展示"): that line is its command's pair of events, with the text kept by the plugin (`lookup(commandId)`), so the event alone has no text and `lookup` gives it.
 */
function markdownOf(event, lookup) {
  if (event?.type === 'assistant/message' && event.surfaceOp === 'append') {
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) fail();
    return content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('').slice(0, MAX_TEXT);
  }
  if (event?.type === 'command/run' && event.data?.name === SAY_COMMAND && typeof event.data.commandId === 'string' && typeof lookup === 'function') {
    const record = lookup(event.data.commandId);
    if (record && ['reply', 'task'].includes(record.kind) && typeof record.text === 'string') return record.text.slice(0, MAX_TEXT);
  }
  return fail();
}

// A URL supplied by the phone is only a selector: the persisted message (or the group line the plugin kept) grants the file read.
export function markdownImagePath(event, source, cwd, lookup) {
  if (typeof source !== 'string' || !source || source.length > 8192) fail();
  const text = markdownOf(event, lookup);
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
