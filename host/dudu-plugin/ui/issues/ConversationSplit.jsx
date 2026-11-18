import { useEffect, useRef, useState } from 'react';
import { T } from '../strings.js';
import { useSessionReturnState } from '../lib/session-return.jsx';

const INITIAL = 360;
const MINIMUM = 280;
const MAXIMUM = 520;
const MESSAGE_MINIMUM = 480;
const COMPACT_BELOW = 760;
const RAIL = 72;
const GUTTER = 8;

/**
 * Resize only this shell: the sidebar and host conversation remain the same React
 * children while dragging or crossing the compact breakpoint.
 */
export function ConversationSplit({ sidebar, children }) {
  const root = useRef(null);
  const drag = useRef(null);
  const [available, setAvailable] = useState(null);
  const [preferred, setPreferred] = useSessionReturnState('conversation.width', INITIAL);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setAvailable(Math.round(entry.contentRect.width) - GUTTER));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const compact = available !== null && available < COMPACT_BELOW;
  const maximum = available === null ? MAXIMUM : Math.max(MINIMUM, Math.min(MAXIMUM, available - MESSAGE_MINIMUM));
  const clamp = value => Math.max(MINIMUM, Math.min(maximum, Math.round(value)));
  const width = compact ? RAIL : clamp(preferred);
  const position = event => {
    const element = root.current;
    const bounds = element.getBoundingClientRect();
    return (event.clientX - bounds.left) * element.clientWidth / bounds.width;
  };
  const finish = event => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={root} className="dudu-conversations" data-issues-layout="chat"
    data-compact={compact || undefined} data-resizing={dragging || undefined}
    style={{ '--dudu-conversation-sidebar-width': `${width}px` }}>
    {sidebar(compact)}
    <div className="dudu-conversation-splitter" role="separator" aria-label={T.widgets.titles.sessions}
      aria-orientation="vertical" aria-hidden={compact || undefined} tabIndex={compact ? -1 : 0}
      aria-valuemin={compact ? undefined : MINIMUM} aria-valuemax={compact ? undefined : maximum}
      aria-valuenow={compact ? undefined : width}
      onPointerDown={event => {
        if (compact || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, offset: position(event) - width };
        setDragging(true);
      }}
      onPointerMove={event => {
        if (compact || drag.current?.pointerId !== event.pointerId) return;
        event.preventDefault();
        setPreferred(clamp(position(event) - drag.current.offset));
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => setPreferred(INITIAL)}
      onKeyDown={event => {
        if (compact || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        setPreferred(clamp(event.key === 'Home' ? MINIMUM : event.key === 'End' ? maximum : width + (event.key === 'ArrowLeft' ? -8 : 8)));
      }}
    />
    <div className="dudu-conversation-pane">{children}</div>
  </div>;
}
