import { useCallback, useEffect, useRef } from 'react';
import { isTyping } from '../lib/typing.js';

export function useIssueShortcuts() {
  const hovered = useRef(null);
  const onHover = useCallback((action) => { hovered.current = action; }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing || isTyping(event.target) || !hovered.current ||
          document.querySelector('.dudu [role="dialog"], .dudu [role="menu"], .dudu [data-slot="popover-content"]')) return;
      const key = event.key.toLowerCase();
      const action = (event.metaKey || event.ctrlKey) && key === 'backspace' ? 'delete'
        : event.metaKey || event.ctrlKey || event.altKey ? null
        : event.shiftKey ? { d: 'due', p: 'project' }[key] : { s: 'status', p: 'priority', a: 'agent' }[key];
      if (action) { event.preventDefault(); hovered.current(action); }
    };
    window.addEventListener('keydown', onKey);
    return () => { hovered.current = null; window.removeEventListener('keydown', onKey); };
  }, []);
  return onHover;
}
