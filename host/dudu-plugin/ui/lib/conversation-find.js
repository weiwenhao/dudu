import { fromMarkdown } from 'mdast-util-from-markdown';
import remarkGfm from 'remark-gfm';

// Use the same GFM vocabulary as our Markdown renderer, without mounting a renderer.
const markdownExtensions = {};
remarkGfm.call({ data: () => markdownExtensions });

/** Literal, case-insensitive phrases; whitespace may cross a rendered line. */
export function findOccurrences(text, query) {
  const words = query.trim().split(/\s+/u);
  if (!words[0]) return [];
  const expression = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return [...text.matchAll(new RegExp(expression, 'giu'))].map(match => ({
    start: match.index, end: match.index + match[0].length,
  }));
}

function markdownText(source) {
  const tree = fromMarkdown(source, {
    extensions: markdownExtensions.micromarkExtensions,
    mdastExtensions: markdownExtensions.fromMarkdownExtensions,
  });
  const footnotes = new Map(), references = [];
  const collect = node => {
    if (node.type === 'footnoteDefinition') footnotes.set(node.identifier.toUpperCase(), node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(tree);
  const visit = node => {
    if (node.type === 'image' || node.type === 'definition' || node.type === 'footnoteDefinition') return '';
    if (node.type === 'footnoteReference') {
      const id = node.identifier.toUpperCase();
      if (!references.includes(id)) references.push(id);
      return String(references.indexOf(id) + 1);
    }
    if (node.type === 'break') return '\n';
    if (typeof node.value === 'string') return node.value;
    const separator = ['root', 'list', 'listItem', 'blockquote', 'table', 'tableRow'].includes(node.type) ? '\n' : '';
    return (node.children ?? []).map(visit).join(separator);
  };
  const parts = [visit(tree)];
  for (const id of references) {
    const note = footnotes.get(id);
    if (note) parts.push(note.children.map(visit).join('\n'));
  }
  return parts.join('\n');
}

function reasoningText(text) {
  // DSH's reasoning view omits provider signatures. They are not readable message text.
  if (!text.startsWith('<signature>')) return text;
  const end = text.indexOf('</signature>');
  return end === -1 ? '' : text.slice(end + '</signature>'.length).replace(/^(?:\r?\n)+/u, '');
}

/** Append-origin human transcript, never compaction's replacement copies or tool arguments. */
export function findDocument(event) {
  if (event.surfaceOp !== 'append' || !Number.isSafeInteger(event.seq)) return null;
  const assistant = event.type === 'assistant/message';
  if (!assistant && event.type !== 'user/message') return null;
  const message = event.data?.message ?? event.data;
  // System injections have their own structured Context views, rather than this message's prose.
  if (!assistant && message?.source?.kind !== 'user') return null;
  const content = typeof message?.content === 'string' ? [{ type: 'text', text: message.content }] : message?.content ?? [];
  const parts = { text: [], reasoning: [] };
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') parts.text.push(assistant ? markdownText(block.text) : block.text);
    if (assistant && block.type === 'reasoning' && typeof block.text === 'string') parts.reasoning.push(markdownText(reasoningText(block.text)));
  }
  // Each assistant block owns a separate Markdown root. A hit cannot cross those roots.
  return { seq: event.seq, text: assistant ? parts.text : [parts.text.join('\n')], reasoning: parts.reasoning };
}

export function matchDocuments(documents, query) {
  return [...documents].sort((a, b) => a.seq - b.seq).flatMap(document =>
    ['reasoning', 'text'].flatMap(part => document[part].flatMap(text => findOccurrences(text, query))
      .map((range, ordinal) => ({ seq: document.seq, part, ordinal, ...range }))));
}

export const sameFindHit = (left, right) => Boolean(left && right && left.seq === right.seq && left.part === right.part && left.ordinal === right.ordinal);
export const nextFindIndex = (index, count, direction) => count ? (index + direction + count) % count : -1;
export function initialFindIndex(hits, anchorSeq) {
  if (!hits.length) return -1;
  const after = anchorSeq === undefined ? -1 : hits.findIndex(hit => hit.seq >= anchorSeq);
  return after === -1 ? hits.length - 1 : after;
}

/** A binding owns its text cache. Pages never populate the visible transcript until a hit is selected. */
export function createConversationFinder(readPage, { yieldWork = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const caches = new WeakMap();
  const cacheFor = binding => {
    if (!caches.has(binding)) caches.set(binding, { documents: new Map(), complete: false, before: undefined, pending: null });
    return caches.get(binding);
  };
  const remember = (cache, records) => {
    for (const { event } of records) {
      if (!event || cache.documents.has(event.seq)) continue;
      const document = findDocument(event);
      if (document) cache.documents.set(document.seq, document);
    }
  };
  async function prepare(binding, signal) {
    const cache = cacheFor(binding);
    while (cache.pending) {
      try { await cache.pending; } catch { /* A superseded query may have cancelled that page; the cursor did not advance. */ }
      signal.throwIfAborted();
    }
    const window = binding.eventSource.getSnapshot();
    const entries = window.entries.filter(entry => entry.type === 'event');
    remember(cache, entries);
    if (!window.hasMore) cache.complete = true;
    if (cache.complete) return cache;
    const sequences = entries.map(entry => entry.event.seq).filter(Number.isSafeInteger);
    const throughSeq = sequences.length ? sequences.reduce((max, seq) => Math.max(max, seq)) : undefined;
    cache.before ??= sequences.length ? sequences.reduce((min, seq) => Math.min(min, seq)) : undefined;
    const task = (async () => {
      while (!cache.complete) {
        signal.throwIfAborted();
        const page = await readPage(binding.sessionId, { throughSeq, beforeSeq: cache.before }, signal);
        signal.throwIfAborted();
        const records = page.records ?? [];
        const positions = records.map(record => record.event?.seq).filter(Number.isSafeInteger);
        const before = positions.length ? Math.min(...positions) : undefined;
        if (page.hasMore && (before === undefined || cache.before !== undefined && before >= cache.before)) {
          throw new Error('Conversation history did not advance.');
        }
        remember(cache, records);
        cache.before = before;
        cache.complete = !page.hasMore;
        await yieldWork();
      }
    })();
    cache.pending = task;
    try { await task; } finally { if (cache.pending === task) cache.pending = null; }
    return cache;
  }
  return async (reference, query, signal) => {
    signal.throwIfAborted();
    if (!query.trim()) return [];
    const cache = await prepare(reference.binding, signal);
    signal.throwIfAborted();
    // Let the opened bar / spinner paint before scanning the cache.
    await yieldWork();
    signal.throwIfAborted();
    const documents = [...cache.documents.values()].sort((a, b) => a.seq - b.seq);
    const hits = [];
    // Give typing and cancellation a turn during long histories, including cached searches.
    for (let index = 0; index < documents.length; index += 32) {
      signal.throwIfAborted();
      for (const hit of matchDocuments(documents.slice(index, index + 32), query)) hits.push(hit);
      if (index + 32 < documents.length) await yieldWork();
    }
    return hits;
  };
}
