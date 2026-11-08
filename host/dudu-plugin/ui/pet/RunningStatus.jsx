import { useEffect, useState } from 'react';
import { T } from '../strings.js';
import whaleTail from './whale-tail.png';
import { formatRunDuration } from './running.mjs';

// DSH's own running line (the blue "Deep diving for 9s ···" under a conversation's last message), made the way DSH makes it: its whale tail,
// which is an animation used as a mask over the text colour (the still outline when motion is reduced), and its text with a highlight that
// sweeps over it. The sizes, the colours (DSH's `--dsw-alias-label-deep-diving`) and the animations are in pet.css, from DSH's chat view.
const WHALE_OUTLINE = 'M8.844 13.742C8.967 12.328 8.45 10.4 8.45 9.65C8.45 8.94 8.88 8.43 9.6 8.43C11.285 8.43 12.106 8.281 12.685 8.104C13.71 7.791 14.585 6.768 15.055 5.945C15.137 5.803 14.99 5.641 14.829 5.671C13.829 5.86 12.828 5.376 11.827 4.978C10.659 4.514 9.491 4.707 8.935 4.876C8.805 4.915 8.658 4.819 8.636 4.686C8.468 3.643 7.405 2.615 5.498 2.238C4.54 2.048 3.748 1.574 3.347 1.202C3.252 1.113 3.088 1.125 3.03 1.242C2.628 2.059 2.168 3.82 5.248 6.115C5.82 6.494 6.31 6.785 6.574 7.637C6.72 8.104 6.157 9.168 6.061 9.368C5.157 11.27 5.089 12.19 4.926 13.742';

function WhaleTail() {
  return (
    <span className="dudu-running-icon" aria-hidden="true">
      <span className="dudu-running-whale" style={{ '--dudu-whale': `url("${whaleTail}")` }} />
      <svg className="dudu-running-still" width="100%" height="100%" viewBox="0 0 16 16" fill="none"><path d={WHALE_OUTLINE} stroke="currentColor" strokeWidth="1" /></svg>
    </span>
  );
}

/** The text, and a copy of it over it (what the highlight is cut out of) that a bright band sweeps across. */
function Shimmer({ children }) {
  return (
    <span className="dudu-shimmer" data-shimmer="true">
      <span className="dudu-shimmer-content"><span>{children}</span></span>
      <span className="dudu-shimmer-decoration" aria-hidden="true" inert="">
        <span className="dudu-shimmer-sweep"><span className="dudu-shimmer-content dudu-shimmer-highlight"><span>{children}</span></span></span>
      </span>
    </span>
  );
}

/**
 * Shown while Dudu works, under the last message. `since` is when the work began (the owner's message that is not answered yet), if the page
 * knows it; else it is counted from when this line appeared. The clock ticks every second, and screen readers hear the words once, not the ticks.
 */
export function RunningStatus({ since }) {
  const [appeared] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const words = T.pet;
  return (
    <div className="dudu-running" data-pet-running="">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{words.running}</span>
      <span className="dudu-running-content">
        <WhaleTail />
        <Shimmer>{words.runningFor(formatRunDuration(Math.max(1000, now - (since ?? appeared)), words.duration))}</Shimmer>
      </span>
    </div>
  );
}
