// The latest message of each issue's session, for the 待办 card (owner, 2026-11-10: "我应该可以快速看到这个消息最新的内容是什么").
//
// Nothing here reads a transcript to answer a question. DSH tells the plugin about every message of every live session (`session/event`), and the plugin keeps the last one of each side for
// the sessions that belong to an issue: the owner's words (`me`) and the agent's (`agent`), the newer of the two being "the latest". A session that was never seen speak since this started is
// read once from what DSH stored of it (`read`, with a time budget, never on the thread of a tap that must answer), and then it is kept like the others. The texts are cut to what a card can
// use (MAX_TEXT): the whole message is in the session, one tap away.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const VERSION = 1;
const MAX_TEXT = 2000;
const KEEP = 300;
const SAVE_AFTER_MS = 1500;

const textOf = (content) => (typeof content === 'string' ? content : (Array.isArray(content) ? content : []).filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n'));
const cut = (value) => {
  const flat = String(value ?? '').trim();
  return flat.length <= MAX_TEXT ? flat : `${flat.slice(0, MAX_TEXT - 1)}…`;
};
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const valid = (side) => isRecord(side) && typeof side.text === 'string' && side.text && Number.isFinite(side.at);

/**
 * `relevant(sessionId)` says whether a session is one an issue gave an agent (the others are none of this cache's business). `read(sessionId, signal)` answers `{ me?, agent? }`, each
 * `{ text, at }`, from the stored session, or null.
 */
export function createLatest({ file = null, relevant = () => true, read = null, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const kept = new Map();
  if (file && existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8'));
      if (stored?.version === VERSION && Array.isArray(stored.sessions)) {
        for (const [id, sides] of stored.sessions) if (typeof id === 'string' && isRecord(sides)) kept.set(id, { ...(valid(sides.me) ? { me: sides.me } : {}), ...(valid(sides.agent) ? { agent: sides.agent } : {}) });
      }
    } catch { /* an unreadable file is a memory that is gone: what the sessions said is read again */ }
  }
  let timer = null;
  let disposed = false;
  const asked = new Set(); // sessions already read for this run, whatever the answer was: a session with nothing to say is not read again and again

  function save() {
    timer = null;
    if (!file || disposed) return;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ version: VERSION, sessions: [...kept] })}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch { /* a cache that cannot be written is only slower the next time */ }
  }
  function later() {
    if (!file || timer !== null || disposed) return;
    timer = setTimer(save, SAVE_AFTER_MS);
    timer?.unref?.();
  }
  function remember(sessionId, side, message) {
    const sides = kept.get(sessionId) ?? {};
    if (sides[side] && sides[side].at > message.at) return; // an older message that arrived late
    kept.delete(sessionId);
    kept.set(sessionId, { ...sides, [side]: message });
    while (kept.size > KEEP) kept.delete(kept.keys().next().value);
    later();
  }

  /**
   * What one message of a session changes: the owner's own words, or a message of the agent. Anything else is not a message to show. Answers the side it kept (`'me'` or `'agent'`), or null,
   * so that a caller can tell the board that the owner just said something (the conversation list shows it: `mine`).
   */
  function observe(sessionId, event) {
    if (typeof sessionId !== 'string' || !sessionId || !event) return null;
    const data = event.data ?? {};
    const message = data.message ?? data;
    let side = null;
    if (event.type === 'user/message' && message?.source?.kind === 'user') side = 'me';
    else if (event.type === 'assistant/message') side = 'agent';
    if (!side) return null;
    const text = cut(textOf(message?.content ?? data.content));
    if (!text) return null;
    try { if (!relevant(sessionId)) return null; } catch { return null; }
    remember(sessionId, side, { text, at: Number.isFinite(event.time) ? event.time : now() });
    return side;
  }

  /** The owner's own last words in a session, `{ text, at }`, or null: the conversation list shows them when they are newer than the agent's last answer (owner, 2026-11-22). */
  function mine(sessionId) {
    const side = kept.get(sessionId)?.me;
    return side ? { text: side.text, at: side.at } : null;
  }

  /** The latest message of a session, whoever said it: `{ who: 'me' | 'agent', text, at }`, or null. */
  function get(sessionId) {
    const sides = kept.get(sessionId);
    if (!sides) return null;
    const side = sides.me && (!sides.agent || sides.me.at >= sides.agent.at) ? 'me' : sides.agent ? 'agent' : null;
    return side ? { who: side, text: sides[side].text, at: sides[side].at } : null;
  }

  /**
   * Reads the sessions that have nothing kept yet, a few at a time, for no longer than `budgetMs` in all: the ones that are not done by then are simply not on the card this time (they are
   * read in the background and the next card has them). Never throws.
   */
  async function ensure(sessionIds, { budgetMs = 2500, concurrency = 3 } = {}) {
    if (typeof read !== 'function') return;
    const missing = [...new Set(sessionIds)].filter((id) => typeof id === 'string' && id && !kept.has(id) && !asked.has(id));
    if (!missing.length) return;
    const stop = new AbortController();
    const budget = setTimer(() => stop.abort(), budgetMs);
    budget?.unref?.();
    const queue = [...missing];
    const work = async () => {
      while (queue.length && !stop.signal.aborted && !disposed) {
        const id = queue.shift();
        asked.add(id);
        try {
          const said = await read(id, stop.signal);
          for (const side of ['me', 'agent']) if (valid(said?.[side])) remember(id, side, { text: cut(said[side].text), at: said[side].at });
        } catch { /* a session that cannot be read has no latest message yet */ }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, work)); }
    finally { clearTimer(budget); }
  }

  return {
    observe, get, mine, ensure,
    forget(sessionId) { if (kept.delete(sessionId)) later(); },
    flush() { if (timer !== null) { clearTimer(timer); save(); } },
    dispose() { if (timer !== null) { clearTimer(timer); save(); } disposed = true; },
  };
}
