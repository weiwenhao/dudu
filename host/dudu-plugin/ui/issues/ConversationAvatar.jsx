import { LoaderCircle } from 'lucide-react';
import { AgentLogo } from './AgentLogo.jsx';
import { cn } from '../lib/cn.js';

// Same UTF-16 FNV/mix and six text/outline tones as BoardConversationAvatar.
function referenceColor(reference) {
  let hash = 2166136261;
  for (let i = 0; i < reference.length; i++) hash = Math.imul(hash ^ reference.charCodeAt(i), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return ['#338d29', '#22a58f', '#753fcf', '#9eb126', '#c4821c', '#3a83ba'][(hash >>> 0) % 6];
}

/** One local coordinate system for the avatar and its shared upper-right state mark. Idle/sleep have no mark. */
export function ConversationAvatar({ reference = '', assistant = false, state = 'idle', size = 48, busy = false }) {
  const parts = /^(.*)-(\d+)$/.exec(reference)?.slice(1) ?? [reference];
  const mark = Math.max(6, size * 13 / 49);
  const center = size / 2 + (size / 2 - .5) / Math.SQRT2;
  return <span className="dudu-conversation-avatar" aria-hidden="true" style={{ width: size, height: size, color: referenceColor(reference) }}>
    {assistant ? <AgentLogo agent="dudu" className="size-full" /> : <span className="dudu-conversation-avatar-ref">
      {parts.map((part, index) => <span key={index} style={{
        fontSize: size * (index === 0 ? .2625 : part.length >= 4 ? .3125 : .35),
        lineHeight: `${size * .305}px`,
      }}>{part}</span>)}
    </span>}
    <span className={cn('dudu-conversation-mark', state === 'unread' && 'dudu-conversation-unread')}
      style={{ width: mark, height: mark, left: center - mark / 2, top: size - center - mark / 2, opacity: ['unread', 'processing'].includes(state) ? 1 : 0, boxShadow: `0 0 0 ${Math.max(1, size * 1.6 / 49)}px var(--background)` }}>
      {state === 'processing' && <svg className="dudu-conversation-working" viewBox="0 0 20 20" fill="none" strokeWidth={1.5 * 20 / mark}>
        <circle cx="10" cy="10" r={10 - .75 * 20 / mark} stroke="#96989d" opacity=".3" />
        <circle className="dudu-conversation-working-arc" cx="10" cy="10" r={10 - .75 * 20 / mark}
          stroke="#96989d" strokeLinecap="round" pathLength="100" strokeDasharray="28 72" />
      </svg>}
    </span>
    {busy && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/90 text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
    </span>}
  </span>;
}
