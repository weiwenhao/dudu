import { useEffect, useState } from 'react';

/**
 * How narrow an element is, in steps: the number of `limits` (px, a list that does not change between draws) its width is below. State changes only
 * when a limit is crossed, so a widget being pulled to a new size is not drawn again at every pixel. The first answer comes with the first
 * observation (an observer reports once when it starts to watch), so it is the same code that answers then and later.
 */
export function useNarrowness(ref, limits) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setLevel(limits.filter((limit) => entry.contentRect.width < limit).length));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, limits]);
  return level;
}
