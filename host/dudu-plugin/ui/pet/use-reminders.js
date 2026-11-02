// What the pet says by itself: an agent waiting for the owner, a due date gone by, a session that stopped with an error. The plugin
// answers `assistant/reminders` from the issue list (no model); this reads it now and then and picks the one to show.
//
// One reminder at a time, the first the owner has not closed. A closed one stays closed until its key changes (a new question, a new
// due date, a new session), and that is remembered across reloads. After a close the next one waits for the next read.
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestIssue } from '../lib/where.js';

export const CLOSED_KEY = 'dudu:reminders:closed';
export const KEEP = 200;
export const FIRST_READ_MS = 3_000;
export const READ_EVERY_MS = 3 * 60_000;
export const STALE_MS = 60_000;

/** The closed keys, newest last. Kept in memory and written through to `getStorage()`; a storage that throws leaves it memory only. */
export function createClosed(getStorage) {
  let keys = [];
  try {
    const stored = JSON.parse(getStorage().getItem(CLOSED_KEY) ?? '[]');
    if (Array.isArray(stored)) keys = stored.filter((key) => typeof key === 'string').slice(-KEEP);
  } catch { /* memory only */ }
  return {
    keys: () => keys,
    has: (key) => keys.includes(key),
    add(key) {
      if (keys.includes(key)) return;
      keys = [...keys, key].slice(-KEEP);
      try { getStorage().setItem(CLOSED_KEY, JSON.stringify(keys)); } catch { /* memory only */ }
    },
  };
}

/** The reminder to show (the first not closed) and how many more are waiting behind it. */
export function chooseNext(reminders, closedKeys) {
  const open = (Array.isArray(reminders) ? reminders : []).filter((item) => item && typeof item.key === 'string' && !closedKeys.includes(item.key));
  return { current: open[0] ?? null, more: Math.max(0, open.length - 1) };
}

/**
 * `active`: the pet is on and nothing modal covers it; reads happen only then. `quiet`: nothing else is speaking (the conversation is
 * closed, nobody is dictating, no reply or problem bubble). The reminder is shown only when both hold and the page is visible.
 */
export function useReminders({ request, actions, active, quiet }) {
  const [store] = useState(() => createClosed(() => window.localStorage));
  const [closedKeys, setClosedKeys] = useState(() => store.keys());
  const [list, setList] = useState([]);
  const [shown, setShown] = useState(null);
  const [seen, setSeen] = useState(() => document.visibilityState !== 'hidden');
  const lastRead = useRef(0);

  useEffect(() => {
    const change = () => setSeen(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    let timer;
    lastRead.current = Date.now();
    const read = async () => {
      lastRead.current = Date.now();
      let result;
      try { result = await request('assistant/reminders'); } catch { return; }
      if (!alive || result?.outcome !== 'success' || !Array.isArray(result.reminders)) return;
      setList(result.reminders);
      // What is on show stays while it is still true; otherwise (closed, or the trouble is over) the next one takes its place.
      setShown((current) => (current && result.reminders.some((item) => item.key === current) && !store.has(current)
        ? current : chooseNext(result.reminders, store.keys()).current?.key ?? null));
    };
    const later = (wait) => {
      timer = setTimeout(async () => {
        if (document.visibilityState !== 'hidden') await read();
        if (alive) later(READ_EVERY_MS);
      }, wait);
    };
    later(FIRST_READ_MS);
    const wake = () => { if (document.visibilityState !== 'hidden' && Date.now() - lastRead.current > STALE_MS) void read(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); };
  }, [active, request, store]);

  const reminder = list.find((item) => item.key === shown) ?? null;
  const more = reminder ? list.filter((item) => item.key !== reminder.key && !closedKeys.includes(item.key)).length : 0;
  const close = useCallback(() => {
    if (!shown) return;
    store.add(shown);
    setClosedKeys(store.keys());
    setShown(null);
  }, [shown, store]);
  const open = useCallback(() => {
    if (!reminder) return;
    requestIssue(reminder.id);
    try { actions?.openPanel?.(); } catch { /* the page takes the request when it next shows */ }
    close();
  }, [actions, close, reminder]);
  return { reminder: active && quiet && seen ? reminder : null, more, close, open };
}
