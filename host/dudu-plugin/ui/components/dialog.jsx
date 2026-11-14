// shadcn/ui Dialog (Radix): a modal window in the middle of the page. Portaled into our `.dudu` root like every overlay.
import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '../lib/cn.js';
import { usePortalContainer } from '../lib/scope.jsx';

const ModalContext = React.createContext(true);
export function Dialog({ modal = true, ...props }) {
  return <ModalContext.Provider value={modal}><DialogPrimitive.Root modal={modal} {...props} /></ModalContext.Provider>;
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = React.forwardRef(function DialogContent({ className, overlayClassName, overlayRef, children, ...props }, ref) {
  const container = usePortalContainer();
  const modal = React.useContext(ModalContext);
  const shade = cn('fixed inset-0 z-[1000] bg-black/50', overlayClassName);
  return (
    <DialogPrimitive.Portal container={container}>
      {modal ? <DialogPrimitive.Overlay ref={overlayRef} data-slot="dialog-overlay" data-window-drag-exclude className={shade} />
        : <div ref={overlayRef} data-slot="dialog-overlay" data-window-drag-exclude className={shade} />}
      <DialogPrimitive.Content
        ref={ref} data-slot="dialog-content" data-window-drag-exclude
        className={cn('fixed top-1/2 left-1/2 z-[1000] flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg outline-hidden sm:max-w-[560px]', className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
