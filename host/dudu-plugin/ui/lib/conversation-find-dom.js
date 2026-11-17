import { findOccurrences } from './conversation-find.js';

const highlightsByDocument = new WeakMap();
// File links are buttons too; keep their visible labels while omitting code toolbar chrome.
const EXCLUDED = 'svg,input,textarea,script,style,.sr-only,[aria-hidden="true"],[data-message-attachments],[data-text-interaction-exclude],[data-code-block-banner]';
const BLOCK = 'p,li,pre,h1,h2,h3,h4,h5,h6,tr,td,th,blockquote';

/** Preserve the React-owned text tree; CSS Highlight ranges carry all visual marks. */
export function textRanges(root, query) {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 5); // SHOW_ELEMENT | SHOW_TEXT
  const pieces = [];
  let text = '';
  let previousBlock;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (element.closest(EXCLUDED)) continue;
    if (node.nodeType === 1) { if (node.tagName === 'BR') text += '\n'; continue; }
    if (!node.textContent) continue;
    const block = node.parentElement.closest(BLOCK);
    if (pieces.length && block !== previousBlock) text += '\n';
    previousBlock = block;
    pieces.push({ node, start: text.length, end: text.length + node.textContent.length });
    text += node.textContent;
  }
  const containing = offset => {
    let low = 0, high = pieces.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (pieces[middle].end <= offset) low = middle + 1;
      else high = middle;
    }
    return pieces[low];
  };
  return findOccurrences(text, query).flatMap(match => {
    const first = containing(match.start), last = containing(match.end - 1);
    if (!first || !last) return [];
    const range = document.createRange();
    range.setStart(first.node, Math.max(0, match.start - first.start));
    range.setEnd(last.node, match.end - last.start);
    return [range];
  });
}

function contentRoots(row, part) {
  return [...row.querySelectorAll('[data-text-interaction-source]')].filter(element => {
    if (Boolean(element.closest('[data-variant="think"]')) !== (part === 'reasoning')) return false;
    return !element.parentElement.closest('[data-text-interaction-source]');
  });
}

function rangesInRows(rows, query, part) {
  return rows.flatMap(row => contentRoots(row, part).flatMap(element => textRanges(element, query)));
}

export function findNodeRows(root, nodes) {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const rows = new Map();
  for (const element of root.querySelectorAll('[data-chat-node-key]')) {
    const node = byKey.get(element.dataset.chatNodeKey);
    if (!node || !['user', 'steering', 'assistant-step'].includes(node.kind)) continue;
    const seq = node.data.finalNode?.seq ?? node.data.seq;
    if (seq === undefined) continue;
    if (!rows.has(seq)) rows.set(seq, []);
    rows.get(seq).push(element);
  }
  return rows;
}

/** Start near the reader, rather than automatically mounting history back to its oldest match. */
export function conversationFindAnchor(root, nodes) {
  const port = root.querySelector('[data-conversation-scroll]');
  if (!port) return undefined;
  const bounds = port.getBoundingClientRect();
  const point = root.ownerDocument.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + Math.min(64, bounds.height / 2));
  const row = point?.closest('[data-chat-node-key]');
  if (!row || !port.contains(row)) return undefined;
  const node = nodes.find(node => node.key === row.dataset.chatNodeKey);
  return node?.data.finalNode?.seq ?? node?.data.seq;
}

export function conversationHighlights(root) {
  const document = root.ownerDocument, view = document.defaultView;
  if (!view.CSS?.highlights || !view.Highlight) throw new Error('CSS Highlights are unavailable.');
  if (!highlightsByDocument.has(document)) {
    // The CSS optimizer predates ::highlight. Register these API-owned rules with the registry's lifetime.
    const style = document.createElement('style');
    style.textContent = `
      .dudu .dudu-host-conversation ::highlight(dudu-find-match) {
        background-color: var(--dudu-find-match-bg); color: var(--dudu-find-match-fg);
      }
      .dudu .dudu-host-conversation ::highlight(dudu-find-current) {
        background-color: var(--dudu-find-current-bg); color: var(--dudu-find-current-fg);
      }`;
    document.head.appendChild(style);
    highlightsByDocument.set(document, { style, owners: new Map() });
  }
  const { owners, style } = highlightsByDocument.get(document), owner = Symbol('conversation-find');
  owners.set(owner, { all: [], current: [] });
  let disposed = false;
  const publish = () => {
    for (const [name, field] of [['dudu-find-match', 'all'], ['dudu-find-current', 'current']]) {
      const ranges = [...owners.values()].flatMap(value => value[field]);
      if (ranges.length) {
        const highlight = new view.Highlight();
        highlight.priority = field === 'current' ? 1 : 0;
        for (const range of ranges) highlight.add(range);
        view.CSS.highlights.set(name, highlight);
      } else view.CSS.highlights.delete(name);
    }
  };
  return {
    paint(nodes, query, active) {
      if (disposed) return;
      const rows = findNodeRows(root, nodes);
      const all = [...rows.values()].flatMap(elements =>
        ['text', 'reasoning'].flatMap(part => rangesInRows(elements, query, part)));
      const current = active ? rangesInRows(rows.get(active.seq) ?? [], query, active.part)[active.ordinal] : null;
      owners.set(owner, { all, current: current ? [current] : [] });
      publish();
    },
    clear() {
      if (disposed) return;
      disposed = true;
      owners.delete(owner);
      publish();
      if (!owners.size) { style.remove(); highlightsByDocument.delete(document); }
    },
  };
}

/** Mutation-driven, cancellable wait for the host's React commit; no polling or whole-log mounting. */
function rendered(root, read, signal) {
  const view = root.ownerDocument.defaultView;
  return new Promise((resolve, reject) => {
    let frame;
    const cleanup = () => {
      observer.disconnect();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
    };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const check = () => {
      frame = undefined;
      try {
        signal.throwIfAborted();
        const value = read();
        if (value) { cleanup(); resolve(value); }
      } catch (error) { cleanup(); reject(error); }
    };
    const observer = new view.MutationObserver(() => {
      if (frame === undefined) frame = view.requestAnimationFrame(check);
    });
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Conversation match did not render.')); }, 10_000);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-expanded'] });
    signal.addEventListener('abort', aborted, { once: true });
    frame = view.requestAnimationFrame(check);
  });
}

export async function revealFindHit(root, reference, getNodes, query, hit, signal) {
  const session = reference.binding.session;
  // An ordinary older-page read may already own the loader. Wait for that one before requesting the jump.
  if (session.getSnapshot().loadingOlder) await new Promise((resolve, reject) => {
    const off = session.subscribe(() => {
      if (!session.getSnapshot().loadingOlder) { off(); signal.removeEventListener('abort', aborted); resolve(); }
    });
    const aborted = () => { off(); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
  signal.throwIfAborted();
  await session.loadThrough(hit.seq);
  signal.throwIfAborted();
  if (!reference.binding.eventSource.getSnapshot().entries.some(entry => entry.type === 'event' && entry.event.seq === hit.seq)) {
    throw new Error('Conversation history could not reach the selected message.');
  }
  const range = await rendered(root, () => {
    const rows = findNodeRows(root, getNodes()).get(hit.seq) ?? [];
    for (const row of rows) {
      const hidden = [];
      for (let element = row; element && root.contains(element); element = element.parentElement) {
        if (element.getAttribute('hidden') === 'until-found') hidden.unshift(element);
      }
      for (const element of [...hidden, ...row.querySelectorAll('[hidden="until-found"]')]) {
        element.dispatchEvent(new root.ownerDocument.defaultView.Event('beforematch'));
      }
      if (hit.part === 'reasoning') {
        for (const think of row.querySelectorAll('[data-variant="think"]:not([data-expanded])')) {
          think.querySelector('[data-disclosure-row]')?.click();
        }
      }
    }
    const found = rangesInRows(rows, query, hit.part)[hit.ordinal];
    return found?.getBoundingClientRect().width > 0 ? found : null;
  }, signal);
  signal.throwIfAborted();
  const port = root.querySelector('[data-conversation-scroll]');
  if (!port) throw new Error('Conversation viewport is unavailable.');
  const bounds = range.getBoundingClientRect(), viewport = port.getBoundingClientRect();
  port.scrollTop += bounds.top - viewport.top - Math.max(56, (port.clientHeight - bounds.height) / 2);
  // A code fence may have a horizontal viewport of its own.
  for (let element = range.startContainer.parentElement; element && element !== port; element = element.parentElement) {
    if (element.scrollWidth <= element.clientWidth) continue;
    const box = element.getBoundingClientRect();
    if (bounds.left < box.left) element.scrollLeft -= box.left - bounds.left;
    else if (bounds.right > box.right) element.scrollLeft += bounds.right - box.right;
  }
}

/** Only the foreground conversation owns the shortcut, including when an issue dialog covers the board. */
export function ownsConversationFind(root, target) {
  if (!root?.isConnected || !root.checkVisibility()) return false;
  const document = root.ownerDocument;
  const dialog = [...document.querySelectorAll('[role="dialog"]')].filter(element => element.checkVisibility()).at(-1);
  if (dialog && dialog !== root && !root.contains(dialog) && !dialog.contains(root)) return false;
  const surfaces = [...document.querySelectorAll('[data-dudu-find-surface]')].filter(element => element.checkVisibility());
  const focused = target?.closest?.('[data-dudu-find-surface]');
  return (focused ?? surfaces.at(-1)) === root;
}
