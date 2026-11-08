import { useCallback, useState } from 'react';

// Saved views (owner, 2026-11-05, after Linear's views): a name for a way of looking at the issues. A saved view is a tab of its own: it has a base (Active, Backlog or
// All issues: which issues it draws from) and keeps its own filter and display options the way every tab does (view.js), under the key `view:<id>`. Like those
// options, the list of them is remembered in this browser.

const STORAGE_KEY = 'dudu.issues.saved-views.v1';
export const MAX_NAME = 60;
export const BASES = ['active', 'backlog', 'all'];

/** The tab key of a saved view. */
export const viewKey = (id) => `view:${id}`;
export const cleanName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);

/** What was stored, kept only where it is a well-formed view: `[{ id, name, base }]`. */
export function readSaved(text) {
  try {
    const list = JSON.parse(text ?? '[]');
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter((entry) => entry && typeof entry.id === 'string' && entry.id && !seen.has(entry.id) && seen.add(entry.id)
      && typeof entry.name === 'string' && cleanName(entry.name) && BASES.includes(entry.base)).map((entry) => ({ id: entry.id, name: cleanName(entry.name), base: entry.base }));
  } catch { return []; }
}

const store = (list) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* private window or blocked storage: it just is not remembered */ } return list; };
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function useSavedViews() {
  const [saved, setSaved] = useState(() => { try { return readSaved(localStorage.getItem(STORAGE_KEY)); } catch { return []; } });
  /** Adds a view named `name` on `base`; returns its id. */
  const add = useCallback((name, base) => {
    const id = newId();
    setSaved((previous) => store([...previous, { id, name: cleanName(name), base }]));
    return id;
  }, []);
  const rename = useCallback((id, name) => setSaved((previous) => store(previous.map((entry) => (entry.id === id ? { ...entry, name: cleanName(name) || entry.name } : entry)))), []);
  const remove = useCallback((id) => setSaved((previous) => store(previous.filter((entry) => entry.id !== id))), []);
  return { saved, add, rename, remove };
}
