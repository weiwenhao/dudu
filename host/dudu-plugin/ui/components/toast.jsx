// A short message with an action, at the bottom of the page: "Marked as Done · Undo". Radix Toast does the timing, the focus
// and the announcing; the bar is ours. It lives inside the `.dudu` root (not in a portal), so it sits on the page, not the window.
import * as React from 'react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { Button } from './button.jsx';

const SHOWN_MS = 6000;
const AT_MOST = 3;
const ToastContext = React.createContext(() => {});

/** `toast({ message, action: { label, run } })` from anywhere under the provider. */
export const useToast = () => React.useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = React.useState([]);
  const counter = React.useRef(0);
  const toast = React.useCallback((item) => setItems((list) => [...list.slice(1 - AT_MOST), { id: ++counter.current, ...item }]), []);
  const remove = (id) => setItems((list) => list.filter((item) => item.id !== id));
  return (
    <ToastContext.Provider value={toast}>
      <ToastPrimitive.Provider duration={SHOWN_MS} swipeDirection="down" label="Notifications">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id} onOpenChange={(open) => { if (!open) remove(item.id); }}
            className="flex min-h-10 items-center gap-1 rounded-lg border bg-popover py-1 pr-1 pl-3.5 text-popover-foreground shadow-lg"
          >
            <ToastPrimitive.Description className="text-sm">{item.message}</ToastPrimitive.Description>
            {item.action && (
              <ToastPrimitive.Action altText={item.action.label} asChild>
                <Button variant="ghost" size="sm" className="font-medium" onClick={item.action.run}>{item.action.label}</Button>
              </ToastPrimitive.Action>
            )}
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="pointer-events-none absolute bottom-5 left-1/2 z-[1100] m-0 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 list-none flex-col items-center gap-2 p-0 [&>*]:pointer-events-auto" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
