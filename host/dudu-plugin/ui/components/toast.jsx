// A short message with an action, at the bottom of the page: "Marked as Done · Undo". Radix Toast does the timing, the focus
// and the announcing; the bar is ours: a capsule, as the edit-layout toolbar is (`dashboard/Dashboard.jsx`: `rounded-full`, the same border, background and shadow, the same
// distance from the bottom), owner 2026-11-09: "靠近底部，然后使用胶囊类型的卡片吧，参考面板管理那个弧度". It lives inside the `.dudu` root (not in a portal), so it sits on the page, not the window.
import * as React from 'react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { getLocale } from '../lib/locale.mjs';
import { T } from '../strings.js';
import { Button } from './button.jsx';

const SHOWN_MS = 1500;
const ACTION_SHOWN_MS = 6000;
const ToastContext = React.createContext(() => {});

// While the edit-layout toolbar is on the page the toasts stay above it (the Undo of a removed or moved widget must not cover "Add widget"); otherwise they sit at the bottom.
let above = 0;
const watchers = new Set();
const subscribeAbove = (watch) => { watchers.add(watch); return () => watchers.delete(watch); };
const isAbove = () => above > 0;
/** Called by the thing that stands at the bottom of the page: `useToastAbove(editing)`. */
export function useToastAbove(on) {
  React.useEffect(() => {
    if (!on) return undefined;
    above += 1;
    watchers.forEach((watch) => watch());
    return () => { above -= 1; watchers.forEach((watch) => watch()); };
  }, [on]);
}

/** `toast({ message, action: { label, run } })` from anywhere under the provider. */
export const useToast = () => React.useContext(ToastContext);

export function ToastProvider({ children }) {
  const [item, setItem] = React.useState(null);
  const locale = getLocale();
  const lifted = React.useSyncExternalStore(subscribeAbove, isAbove);
  React.useEffect(() => setItem(null), [locale]);
  const counter = React.useRef(0);
  // The newest notice replaces the previous one, including its timer and paused state.
  const toast = React.useCallback((notice) => setItem({ ...notice, id: ++counter.current }), []);
  const remove = (id) => setItem((current) => current?.id === id ? null : current);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* A replacement starts fresh, even if the previous Undo button held focus. */}
      {item && <ToastPrimitive.Provider key={item.id} duration={item.action ? ACTION_SHOWN_MS : SHOWN_MS} swipeDirection="down" label={T.toast.region}>
        <ToastPrimitive.Root
          onOpenChange={(open) => { if (!open) remove(item.id); }}
          className={`flex min-h-12 items-center gap-2 rounded-full border border-border/50 bg-popover py-2 pl-5 text-popover-foreground shadow-lg ${item.action ? 'pr-2' : 'pr-5'}`}
        >
          <ToastPrimitive.Description className="text-sm">{typeof item.message === 'function' ? item.message() : item.message}</ToastPrimitive.Description>
          {item.action && (
            <ToastPrimitive.Action altText={item.action.label} asChild>
              <Button variant="ghost" size="sm" className="rounded-full font-medium" onClick={item.action.run}>{item.action.label}</Button>
            </ToastPrimitive.Action>
          )}
        </ToastPrimitive.Root>
        <ToastPrimitive.Viewport className={`pointer-events-none absolute ${lifted ? 'bottom-24' : 'bottom-5'} left-1/2 z-[1100] m-0 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 list-none items-center p-0 [&>*]:pointer-events-auto`} />
      </ToastPrimitive.Provider>}
    </ToastContext.Provider>
  );
}
