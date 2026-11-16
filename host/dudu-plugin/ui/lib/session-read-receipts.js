import { attentionForEvent, contentDigest, EMPTY_ATTENTION } from '../../../assistant/sessions/session-state.mjs';

/** A cut of the host's already-rendered event feed, including its transient Assistant prefix. */
export function displayedReadPosition(entries, projected) {
  let attention = EMPTY_ATTENTION;
  let through = -1;
  let stream;
  let attempt;
  let blocks = new Map();
  for (const entry of entries ?? []) {
    const event = entry.event;
    if (entry.type === 'transient' && event?.type === 'assistant/live-chunk') {
      const data = event.data;
      if (attempt !== data.attemptId) {
        attempt = data.attemptId;
        blocks = new Map();
      }
      const chunk = data.chunk;
      const index = chunk?.index ?? 0;
      if (chunk?.type === 'block-start') blocks.set(index, { type: chunk.blockType, text: '' });
      if (chunk?.type?.startsWith('text-')) {
        const block = blocks.get(index) ?? { type: 'text', text: '' };
        block.text += chunk.text ?? chunk.texts?.join('') ?? '';
        blocks.set(index, block);
      }
      if (chunk?.type === 'block-end' && chunk.block) blocks.set(index, chunk.block);
      const digest = contentDigest([...blocks.values()]);
      if (digest && Number.isSafeInteger(data.turn) && Number.isSafeInteger(data.step)) stream = { turn: data.turn, step: data.step, digest };
      continue;
    }
    if (Number.isSafeInteger(event?.seq)) through = Math.max(through, event.seq);
    attention = attentionForEvent(event) ?? attention;
  }
  if (projected && projected.seq <= through && projected.seq > attention.seq) attention = projected;
  return { seq: attention.seq, ...(stream ? { stream } : {}) };
}

/** Reading requires an actual foreground viewport at its latest content, never a retain/cache/watch alone. */
export function installSessionReadReceipts(sessions, request) {
  const watched = new Map();
  let frame;
  let throttle;
  let closed = false;
  let lastSentAt = -Infinity;
  const seen = new Map();
  const visible = (root) => {
    if (document.visibilityState !== 'visible' || !document.hasFocus() || !root.checkVisibility()) return false;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const hit = document.elementFromPoint(Math.max(0, rect.left) + Math.min(rect.width, window.innerWidth - rect.left) / 2,
      Math.max(0, rect.top) + Math.min(rect.height, window.innerHeight - rect.top) / 2);
    return hit && root.contains(hit);
  };
  const inspect = () => {
    frame = undefined;
    if (closed) return;
    for (const root of document.querySelectorAll('[data-conversation-content][data-conversation-session]')) {
      const id = root.dataset.conversationSession;
      const binding = sessions.binding(id);
      const scroller = root.querySelector('[data-conversation-scroll]');
      const previous = watched.get(root);
      if (previous && (previous.id !== id || previous.source !== binding?.eventSource || previous.scroller !== scroller)) {
        previous.dispose();
        watched.delete(root);
      }
      if (!binding?.eventSource || !scroller) continue;
      if (!watched.has(root)) {
        const unsubscribe = binding.eventSource.subscribe(schedule);
        const resize = new ResizeObserver(schedule);
        resize.observe(scroller);
        if (scroller.firstElementChild) resize.observe(scroller.firstElementChild);
        scroller.addEventListener('scroll', schedule, { passive: true });
        watched.set(root, {
          id, source: binding.eventSource, scroller,
          dispose: () => { unsubscribe(); resize.disconnect(); scroller.removeEventListener('scroll', schedule); },
        });
      }
      if (binding.session.getSnapshot().openState !== 'open' || !visible(root)
        || scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1) continue;
      // Fold the rendered history at the submission cadence, not for every streaming DOM mutation.
      if (performance.now() - lastSentAt < 300) {
        throttle ??= setTimeout(() => { throttle = undefined; schedule(); }, 300);
        continue;
      }
      const values = binding.session.projections?.faceOf('duduSessionActivity').getSnapshot();
      const watch = watched.get(root);
      const feed = binding.eventSource.getSnapshot();
      if (watch.feed !== feed || watch.projected !== values) {
        watch.position = displayedReadPosition(feed.entries, values);
        watch.feed = feed;
        watch.projected = values;
      }
      const position = watch.position;
      if (position.seq < 0 && !position.stream) continue;
      const key = JSON.stringify(position);
      if (seen.get(id) === key) continue;
      lastSentAt = performance.now();
      seen.set(id, key);
      void request('sessions/mark-read', { sessionId: id, position }).then(() => {
        window.dispatchEvent(new Event('dudu:session-read'));
      }, () => { if (seen.get(id) === key) seen.delete(id); });
    }
    for (const [root, watch] of watched) {
      if (root.isConnected) continue;
      watch.dispose();
      watched.delete(root);
    }
  };
  function schedule() {
    if (!frame && !closed) frame = requestAnimationFrame(inspect);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-conversation-session', 'data-content-phase', 'hidden', 'style'] });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('focus', schedule);
  schedule();
  return () => {
    closed = true;
    cancelAnimationFrame(frame);
    clearTimeout(throttle);
    observer.disconnect();
    document.removeEventListener('visibilitychange', schedule);
    window.removeEventListener('focus', schedule);
    for (const watch of watched.values()) watch.dispose();
    watched.clear();
  };
}
