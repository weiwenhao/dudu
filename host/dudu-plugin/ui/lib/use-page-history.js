import { useCallback, useEffect, useState } from 'react';

// Keep the host's URL and history state intact; only this field belongs to the Dudu panel.
const KEY = 'duduPage';
const dashboard = () => ({ name: 'dashboard' });
const entryOf = (state) => {
  const entry = state?.[KEY];
  if (entry?.version !== 1 || !Number.isSafeInteger(entry.depth) || entry.depth < 0) return null;
  if (entry.route?.name === 'dashboard') return entry;
  if (entry.route?.name !== 'issue' || !Number.isSafeInteger(entry.route.id) || entry.route.id < 1) return null;
  return { ...entry, route: { ...entry.route, ids: Array.isArray(entry.route.ids) ? entry.route.ids : [] } };
};
const stateWith = (route, depth) => ({
  ...window.history.state,
  [KEY]: { version: 1, depth, route },
});

/** The sidebar is an explicit home action, including when the panel is currently unmounted. */
export function requestDashboard() {
  const next = dashboard();
  const current = entryOf(window.history.state);
  if (current?.route.name !== 'dashboard') window.history.pushState(stateWith(next, 0), '');
  window.dispatchEvent(new Event('dudu:home'));
}

/** Same-document history lets browser Back, Forward and mouse side buttons navigate the panel's detail pages. */
export function usePageHistory() {
  const [route, setRoute] = useState(() => entryOf(window.history.state)?.route ?? dashboard());
  useEffect(() => {
    const restore = (event) => setRoute(entryOf(event.state)?.route ?? dashboard());
    const home = () => setRoute(dashboard());
    window.addEventListener('popstate', restore);
    window.addEventListener('dudu:home', home);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('dudu:home', home);
    };
  }, []);
  const openIssue = useCallback((id, ids) => {
    let current = entryOf(window.history.state);
    if (!current) {
      current = { depth: 0, route: dashboard() };
      window.history.replaceState(stateWith(current.route, 0), '');
    }
    const next = { name: 'issue', id, ids: ids ?? current.route.ids ?? [] };
    if (current.route.name === 'issue' && current.route.id === id) {
      window.history.replaceState(stateWith(next, current.depth), '');
    } else {
      window.history.pushState(stateWith(next, current.depth + 1), '');
    }
    setRoute(next);
  }, []);
  const backToDashboard = useCallback(() => {
    const current = entryOf(window.history.state);
    if (current?.route.name !== 'issue') return;
    if (current.depth > 0) {
      window.history.go(-current.depth);
    } else {
      const next = dashboard();
      window.history.replaceState(stateWith(next, 0), '');
      setRoute(next);
    }
  }, []);
  return { route, openIssue, backToDashboard };
}
