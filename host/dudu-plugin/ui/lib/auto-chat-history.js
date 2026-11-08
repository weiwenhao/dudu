// DSH owns paging and its semantic reading anchor. Use its existing Load earlier action rather than
// calling Session.loadOlder directly, which bypasses the viewport's position-preservation step.
const OLDER_LABELS = new Set(['加载更早', 'Load earlier']);
const LOADING_LABELS = new Set(['载入历史…', 'Loading history…']);
const FLOW = '[data-chat-flow]';
const PAGING_STYLES = `
[data-chat-flow]>[data-dudu-history-paging]{position:sticky;top:0;z-index:1;display:flex;justify-content:center;height:0;padding:0;margin:0}
[data-dudu-history-paging]>button[data-dudu-auto-history]{display:flex;align-items:center;justify-content:center;width:100%;height:0;min-height:0;padding:0;border:0;background:none;box-shadow:none;font-size:0;line-height:0;overflow:hidden;pointer-events:none}
[data-dudu-history-paging]>button[data-dudu-auto-history]:disabled{position:absolute;top:0;left:0;height:28px;opacity:1}
[data-chat-flow]>[data-dudu-history-loading]{display:flex;align-items:center;justify-content:center;min-height:28px;font-size:0;line-height:0}
[data-dudu-auto-history]:disabled::before,[data-dudu-history-loading]::before{content:"";display:block;width:16px;height:16px;box-sizing:border-box;border:1.5px solid var(--dsw-alias-label-secondary);border-right-color:transparent;border-radius:50%;animation:dudu-chat-history-spin 1s linear infinite}
@keyframes dudu-chat-history-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){[data-dudu-auto-history]:disabled::before,[data-dudu-history-loading]::before{animation:none}}
`;

function scrollport(flow, view) {
  const shared = flow.closest('[data-conversation-scroll]');
  if (shared) return shared;
  for (let node = flow.parentElement; node; node = node.parentElement) {
    if (/^(auto|scroll)$/.test(view.getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

function olderButton(flow) {
  // The host's paging action precedes its flow slot. Never match message, tool or Markdown buttons.
  for (const row of flow.children) {
    if (row.matches('[data-slot="conversation.chat.flow"]')) break;
    if (row.childElementCount !== 1) continue;
    const button = row.firstElementChild;
    if (button.tagName === 'BUTTON' && OLDER_LABELS.has(button.textContent.trim())) return button;
  }
  return null;
}

function observePaging(flow, button, port, view) {
  let frame = 0;
  let armed = false;
  let pending = false;
  let sawBusy = false;
  let previousTop = port.scrollTop;
  const check = () => {
    frame = 0;
    if (!armed || pending || button.disabled || !button.isConnected || port.scrollTop > 96) return;
    armed = false;
    pending = true;
    button.click();
    // A cached page can finish without painting an intermediate disabled state.
    frame = view.requestAnimationFrame(() => {
      frame = 0;
      if (!sawBusy && !button.disabled) pending = false;
    });
  };
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(check); };
  const arm = () => {
    if (!pending && !button.disabled) armed = true;
  };
  const onScroll = () => {
    const top = port.scrollTop;
    if (top < previousTop) schedule();
    previousTop = top;
  };
  const onWheel = (event) => {
    if (event.deltaY >= 0) return;
    // Scrolling an open tool's own history should not page the outer conversation.
    for (let node = event.target?.parentElement; node && node !== port; node = node.parentElement) {
      if (node.scrollTop > 0 && /^(auto|scroll)$/.test(view.getComputedStyle(node).overflowY)) return;
    }
    arm();
    schedule(); // Also handles a short history whose scrollTop is already zero.
  };
  const onKey = (event) => {
    if (!['ArrowUp', 'PageUp', 'Home'].includes(event.key)
      || event.target.closest('input, textarea, [contenteditable="true"]')) return;
    arm();
    schedule();
  };
  const updateBusy = () => {
    button.setAttribute('aria-busy', String(button.disabled));
    if (button.disabled) { pending = true; sawBusy = true; }
    else if (sawBusy) { pending = false; sawBusy = false; armed = false; }
  };
  const busy = new view.MutationObserver(updateBusy);
  busy.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  const row = button.parentElement;
  row.setAttribute('data-dudu-history-paging', '');
  button.setAttribute('data-dudu-auto-history', '');
  updateBusy();
  port.addEventListener('scroll', onScroll, { passive: true });
  port.addEventListener('wheel', onWheel, { passive: true });
  port.addEventListener('pointerdown', arm, { passive: true });
  port.addEventListener('touchstart', arm, { passive: true });
  port.addEventListener('keydown', onKey);
  return () => {
    view.cancelAnimationFrame(frame);
    busy.disconnect();
    button.removeAttribute('data-dudu-auto-history');
    button.removeAttribute('aria-busy');
    row.removeAttribute('data-dudu-history-paging');
    port.removeEventListener('scroll', onScroll);
    port.removeEventListener('wheel', onWheel);
    port.removeEventListener('pointerdown', arm);
    port.removeEventListener('touchstart', arm);
    port.removeEventListener('keydown', onKey);
  };
}

/** Enhance the original full and embedded DSH chat without replacing its UI or paging controller. */
export function installChatAutoHistory(document) {
  const view = document.defaultView;
  if (!view?.MutationObserver || !view.requestAnimationFrame) return undefined;
  const style = document.createElement('style');
  style.textContent = PAGING_STYLES;
  document.head.appendChild(style);
  const watching = new Map();
  const loading = new Set();
  const attach = (flow) => {
    for (const row of flow.children) {
      if (row.matches('[data-slot="conversation.chat.flow"]')) break;
      if (!row.childElementCount && LOADING_LABELS.has(row.textContent.trim())) {
        row.setAttribute('data-dudu-history-loading', '');
        row.setAttribute('role', 'status');
        loading.add(row);
      }
    }
    const current = watching.get(flow);
    if (current?.button.isConnected) return;
    current?.stop();
    watching.delete(flow);
    const button = olderButton(flow);
    const port = button && scrollport(flow, view);
    if (button && port) watching.set(flow, { button, stop: observePaging(flow, button, port, view) });
  };
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches(FLOW)) attach(node);
    for (const flow of node.querySelectorAll(FLOW)) attach(flow);
  };
  for (const flow of document.querySelectorAll(FLOW)) attach(flow);
  const observer = new view.MutationObserver((changes) => {
    for (const row of loading) if (!row.isConnected) loading.delete(row);
    for (const [flow, current] of watching) {
      if (!flow.isConnected || !current.button.isConnected) { current.stop(); watching.delete(flow); }
    }
    for (const change of changes) {
      const flow = change.target.nodeType === 1 && change.target.closest(FLOW);
      if (flow && (change.target === flow || change.target.parentElement === flow || change.type === 'attributes')) attach(flow);
      for (const node of change.addedNodes) scan(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  return () => {
    observer.disconnect();
    style.remove();
    for (const row of loading) {
      row.removeAttribute('data-dudu-history-loading');
      row.removeAttribute('role');
    }
    for (const current of watching.values()) current.stop();
    watching.clear();
  };
}
