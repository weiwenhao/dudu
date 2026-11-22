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

/** How long after the person last pressed, scrolled or typed in a conversation a reply that comes in is still taken as read: they are there. */
export const ENGAGED_MS = 6000;
/** A conversation that comes into view this soon after the person's own press was opened by that press (a row of the list, a tab). */
export const OPENED_BY_PRESS_MS = 1500;

/**
 * Whether the person has had their part in the unread content of a conversation being read (owner, 2026-11-22: "电脑点一下，或者滚动消息，才算已读", as WeChat's window on the Mac
 * works, where a conversation that is open and in front stays unread until a click; and two conversations on screen at once cannot both be read). `unreadSince` is when the
 * content that is not read yet first showed, `touchedAt` the last time the person pressed, scrolled or typed in that conversation, or opened it by a press. They were there if that
 * was after the content came, or only just before it (they were still working in it).
 */
export function mayRead({ unreadSince, touchedAt }) {
  return Number.isFinite(unreadSince) && Number.isFinite(touchedAt) && touchedAt >= unreadSince - ENGAGED_MS;
}

const CONVERSATION = '[data-conversation-content][data-conversation-session]';
const PERSON = ['pointerdown', 'wheel', 'keydown', 'touchstart'];
/** What the person did, as the read log says it (`host/read-log.mjs`). */
const HOW = { pointerdown: 'press', wheel: 'wheel', keydown: 'key', touchstart: 'touch' };

/**
 * Reading requires an actual foreground viewport at its latest content, never a retain/cache/watch alone, and the person: a press, a scroll or a key in that conversation
 * (`mayRead`). What arrives while nobody does anything stays unread, on the computer and so on the phone, until they do.
 */
export function installSessionReadReceipts(sessions, request) {
  const watched = new Map();
  let frame;
  let throttle;
  let closed = false;
  const seen = new Map();
  const touched = new WeakMap(); // conversation -> the last time the person pressed, scrolled or typed in it
  const touchedHow = new WeakMap(); // conversation -> what that was, for the read log
  const states = new WeakMap(); // conversation -> { unreadSince, shown, lookedAt }
  let pressedAt = -Infinity; // the last such act anywhere in the window
  const touch = (event) => {
    if (!event.isTrusted) return;
    const now = performance.now();
    pressedAt = now;
    const root = event.target instanceof Element ? event.target.closest(CONVERSATION) : null;
    if (root) { touched.set(root, now); touchedHow.set(root, HOW[event.type] ?? 'unknown'); schedule(); }
  };
  for (const type of PERSON) window.addEventListener(type, touch, { capture: true, passive: true });
  /** In the window and not hidden: neither focus nor what lies on top is asked, so that coming back to the window or closing a menu is not an opening. */
  const shownIn = (root) => {
    if (document.visibilityState !== 'visible' || !root.checkVisibility()) return false;
    const rect = root.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
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
      const state = states.get(root) ?? { unreadSince: null, shown: false, lookedAt: -Infinity };
      states.set(root, state);
      const shown = shownIn(root);
      if (shown && !state.shown && performance.now() - pressedAt < OPENED_BY_PRESS_MS) { touched.set(root, performance.now()); touchedHow.set(root, 'opened'); }
      state.shown = shown;
      if (binding.session.getSnapshot().openState !== 'open' || !visible(root)
        || scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop > 1) continue;
      // Fold the rendered history at the submission cadence, not for every streaming DOM mutation: each conversation looks at its position at most every 300 ms, whether it sends or not.
      if (performance.now() - state.lookedAt < 300) {
        throttle ??= setTimeout(() => { throttle = undefined; schedule(); }, 300);
        continue;
      }
      state.lookedAt = performance.now();
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
      if (seen.get(id) === key) { state.unreadSince = null; continue; }
      state.unreadSince ??= performance.now();
      // What is shown but nobody has touched stays unread; the next press, scroll or key in this conversation reads it (the listener schedules a look at once).
      if (!mayRead({ unreadSince: state.unreadSince, touchedAt: touched.get(root) })) continue;
      const since = state.unreadSince;
      state.unreadSince = null;
      seen.set(id, key);
      // For the read log on the computer: which of the panes on screen this is, and what the person did that let it be read (when, and how long the content had been waiting).
      const now = performance.now();
      const shownRoots = [...document.querySelectorAll(CONVERSATION)].filter(shownIn);
      const source = {
        how: touchedHow.get(root) ?? 'unknown', panes: shownRoots.length, pane: Math.max(0, shownRoots.indexOf(root)), embedded: Boolean(root.closest('.dudu-host-conversation')),
        sinceTouchMs: Math.round(now - touched.get(root)), unreadForMs: Math.round(now - since),
      };
      void request('sessions/mark-read', { sessionId: id, position, source }).then(() => {
        window.dispatchEvent(new Event('dudu:session-read'));
      }, () => { if (seen.get(id) === key) { seen.delete(id); state.unreadSince ??= since; } });
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
    for (const type of PERSON) window.removeEventListener(type, touch, { capture: true });
    for (const watch of watched.values()) watch.dispose();
    watched.clear();
  };
}
