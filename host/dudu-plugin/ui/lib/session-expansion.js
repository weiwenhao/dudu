/** A return address only for a conversation opened from Dudu. DSH still owns its main view and tools. */
export function createSessionExpansion({ layout, panelId }) {
  const listeners = new Set();
  let expanded = null;
  let pageState = new Map();
  let restoring = null;
  const publish = value => {
    if (expanded === value) return;
    expanded = value;
    for (const listener of listeners) listener();
  };
  const clear = () => { restoring = null; publish(null); };
  const off = layout.panelInfo?.subscribe(() => {
    const active = layout.panelInfo.getSnapshot().activePanelId;
    if (active !== null) {
      if (active !== panelId) restoring = null;
      publish(null);
    }
  });
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => expanded,
    capturePage(state) { pageState = state; if (restoring === state) restoring = null; },
    takePage: () => restoring ?? new Map(),
    begin(sessionId) { restoring = null; publish({ sessionId, pageState }); },
    visit(sessionId) { if (expanded && expanded.sessionId !== sessionId) clear(); },
    clear,
    restore(sessionId) {
      if (expanded?.sessionId !== sessionId || layout.panelInfo.getSnapshot().activePanelId !== null) return false;
      const previous = expanded;
      restoring = previous.pageState;
      try { layout.selectPanel(panelId); }
      catch (error) { restoring = null; throw error; }
      if (expanded === previous) publish(null);
      return true;
    },
    dispose() { off?.(); clear(); listeners.clear(); pageState.clear(); },
  };
}

/** Capture before DSH's double-Escape stop handler, while leaving overlays, IME and terminal input alone. */
export function installSessionReturnEscape({ view, restore, blocked }) {
  const options = { capture: true };
  let composing = false;
  const start = () => { composing = true; };
  const end = () => { composing = false; };
  const keyboard = event => {
    if (event.key !== 'Escape' && event.code !== 'Escape') return;
    if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || composing
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || blocked(event)) return;
    if (!restore()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  view.addEventListener('compositionstart', start, options);
  view.addEventListener('compositionend', end, options);
  view.addEventListener('keydown', keyboard, options);
  return () => {
    view.removeEventListener('compositionstart', start, options);
    view.removeEventListener('compositionend', end, options);
    view.removeEventListener('keydown', keyboard, options);
  };
}

/** Native menus can portal outside the conversation. They get the first Escape. */
export function sessionReturnBlocked(document, target) {
  if (target?.closest?.('.xterm, iframe, [inert]')) return true;
  const overlays = document.querySelectorAll('[role="dialog"], [role="menu"], [aria-modal="true"], [data-context-menu], [data-team-panel], [data-subagent-panel], [data-dudu-session-overlay], [data-popup-select-shell]');
  if ([...overlays].some(node => node.getClientRects().length > 0)) return true;
  if ([...document.querySelectorAll('button[aria-haspopup][aria-expanded="true"]')].some(node => node.getClientRects().length > 0)) return true;
  return [...document.querySelectorAll('[aria-expanded="true"][aria-controls]')]
    .some(trigger => trigger.getClientRects().length > 0 && document.getElementById(trigger.getAttribute('aria-controls'))?.getClientRects().length > 0);
}
