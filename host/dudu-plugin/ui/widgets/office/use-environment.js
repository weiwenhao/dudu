import { useEffect, useState } from 'react';

/** Whether DSH is in its dark theme: it marks <body> with `data-ds-dark-theme`. */
export function useDarkTheme() {
  const read = () => typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
    setDark(read());
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Whether the person asked the system for less motion. */
export function useReducedMotion() {
  const query = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null);
  const [reduced, setReduced] = useState(() => !!query()?.matches);
  useEffect(() => {
    const media = query();
    if (!media) return undefined;
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    change();
    return () => media.removeEventListener('change', change);
  }, []);
  return reduced;
}
