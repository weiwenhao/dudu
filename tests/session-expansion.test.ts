import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionExpansion, installSessionReturnEscape } from '../host/dudu-plugin/ui/lib/session-expansion.js';

function host() {
  let activePanelId: string | null = 'dudu';
  const listeners = new Set<() => void>();
  const selected: (string | null)[] = [];
  const layout = {
    panelInfo: {
      getSnapshot: () => ({ activePanelId }),
      subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    selectPanel(id: string | null) {
      activePanelId = id;
      selected.push(id);
      for (const listener of listeners) listener();
    },
  };
  return { layout, selected, expansion: createSessionExpansion({ layout, panelId: 'dudu' }), listeners };
}

test('returning from the expanded native conversation restores only its originating page state', () => {
  const h = host();
  const state = new Map<string, unknown>([
    ['page/board/issues.tab', 'backlog'],
    ['page/board/conversation.selection', { scope: 'backlog', id: 'issue:12', outsideIssue: { id: 12 } }],
    ['page/board/conversation.width', 420],
    ['page/previewIssue', { id: 12 }],
  ]);
  assert.equal(h.expansion.getSnapshot(), null, 'ordinary native sessions have no return address');
  h.expansion.capturePage(state);
  h.layout.selectPanel(null);
  h.expansion.begin('native-12');
  assert.equal(h.expansion.restore('other-session'), false);
  assert.equal(h.layout.panelInfo.getSnapshot().activePanelId, null);
  assert.equal(h.expansion.restore('native-12'), true);
  assert.equal(h.layout.panelInfo.getSnapshot().activePanelId, 'dudu');
  assert.equal(h.expansion.getSnapshot(), null);
  assert.equal(h.expansion.takePage(), state);
  assert.equal(h.expansion.takePage(), state, 'a speculative React render must not consume the return state');
  h.expansion.capturePage(state);
  assert.notEqual(h.expansion.takePage(), state, 'a later ordinary visit does not restore an old expansion');
  assert.equal(h.expansion.restore('native-12'), false);
  h.expansion.dispose();
  assert.equal(h.listeners.size, 0);
});

test('changing the native conversation or selecting a different main panel discards the return address', () => {
  const h = host();
  h.layout.selectPanel(null);
  h.expansion.begin('first');
  h.expansion.visit('second');
  assert.equal(h.expansion.restore('first'), false);
  h.expansion.begin('second');
  h.layout.selectPanel('settings');
  assert.equal(h.expansion.getSnapshot(), null);
  assert.equal(h.expansion.restore('second'), false);
  assert.equal(h.layout.panelInfo.getSnapshot().activePanelId, 'settings');
  h.expansion.dispose();
});

test('Escape returns without reaching native stop; menus, composition and consumed keys retain their input', () => {
  const view = new EventTarget();
  let restores = 0, nativeInput = 0, blocked = false, available = true;
  const stop = installSessionReturnEscape({
    view,
    restore: () => { if (!available) return false; restores++; return true; },
    blocked: () => blocked,
  });
  view.addEventListener('keydown', () => { nativeInput++; });
  const key = (props: Record<string, unknown> = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: 'Escape', code: 'Escape', ...props });
    view.dispatchEvent(event);
    return event;
  };
  for (const props of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    assert.equal(key(props).defaultPrevented, false);
  }
  view.dispatchEvent(new Event('compositionstart'));
  key();
  view.dispatchEvent(new Event('compositionend'));
  blocked = true;
  key();
  blocked = false;
  const consumed = new Event('keydown', { cancelable: true });
  Object.assign(consumed, { key: 'Escape' });
  consumed.preventDefault();
  view.dispatchEvent(consumed);
  assert.equal(restores, 0);
  const before = nativeInput;
  assert.equal(key().defaultPrevented, true);
  assert.equal(restores, 1);
  assert.equal(nativeInput, before, 'the expansion Escape must not arm DSH double-Escape cancellation');
  available = false;
  assert.equal(key().defaultPrevented, false);
  stop();
  available = true;
  key();
  assert.equal(restores, 1, 'unloading releases the keyboard listener');
});
