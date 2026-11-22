import { LoaderCircle } from 'lucide-react';
import { AgentLogo } from './AgentLogo.jsx';
import { cn } from '../lib/cn.js';
import { conversationInitials, conversationTone } from './conversation-identity.js';

/**
 * The state mark in an avatar's upper-right corner: solid red when unread, a grey working ring while it works, nothing when idle. The anchor is the phone's (a tile: its centre 2px in from the corner; the round Dudu
 * logo: on the circle's edge). The board, the pickers and the inbox's rows draw this one mark (owner, 2026-11-21: the inbox's unread dot is "the same as the board's"); it needs a positioned parent of the avatar's size.
 */
export function ConversationMark({ state = 'idle', size = 48, assistant = false }) {
  const mark = Math.max(6, size * 13 / 49);
  const center = size / 2 + (size / 2 - .5) / Math.SQRT2;
  const markX = assistant ? center : size - 2;
  const markY = assistant ? size - center : 2;
  return <span className={cn('dudu-conversation-mark', state === 'unread' && 'dudu-conversation-unread')}
    style={{ width: mark, height: mark, left: markX - mark / 2, top: markY - mark / 2, opacity: ['unread', 'processing'].includes(state) ? 1 : 0, boxShadow: `0 0 0 ${Math.max(1, size * 1.6 / 49)}px var(--background)` }}>
    {state === 'processing' && <svg className="dudu-conversation-working" viewBox="0 0 20 20" fill="none" strokeWidth={1.5 * 20 / mark}>
      <circle cx="10" cy="10" r={10 - .75 * 20 / mark} stroke="#96989d" opacity=".3" />
      <circle className="dudu-conversation-working-arc" cx="10" cy="10" r={10 - .75 * 20 / mark}
        stroke="#96989d" strokeLinecap="round" pathLength="100" strokeDasharray="28 72" />
    </svg>}
  </span>;
}

/** One local coordinate system for the avatar and its shared upper-right state mark. Idle/sleep have no mark. */
export function ConversationAvatar({ title = '', assistant = false, state = 'idle', size = 48, busy = false }) {
  const initials = conversationInitials(title);
  const tone = conversationTone(title);
  const radius = Math.round(size * .25);
  return <span className="dudu-conversation-avatar" aria-hidden="true" style={{ width: size, height: size }}>
    {assistant ? <AgentLogo agent="dudu" className="size-full" /> : <span className="dudu-conversation-avatar-title" style={{
      borderRadius: radius, background: `var(--tone-${tone}-bg)`, color: `var(--tone-${tone}-fg)`,
      fontSize: size * ([...initials].length > 2 ? .32 : .37),
    }}>
      <span style={{ transform: `translateY(${size * .015}px)` }}>{initials}</span>
    </span>}
    <ConversationMark state={state} size={size} assistant={assistant} />
    {busy && <span className="absolute inset-0 flex items-center justify-center bg-background/90 text-muted-foreground"
      style={{ borderRadius: assistant ? '50%' : radius }}>
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
    </span>}
  </span>;
}
