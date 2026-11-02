import { useEffect, useState } from 'react';

/** The time, moved on every half minute, so "27m ago" stays true while the dialog is open. */
export function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
