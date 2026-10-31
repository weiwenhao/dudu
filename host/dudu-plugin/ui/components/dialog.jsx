// shadcn/ui Dialog (Radix): a modal window in the middle of the page. Portaled into our `.dudu` root like every overlay.
import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '../lib/cn.js';
import { usePortalContainer } from '../lib/scope.jsx';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = React.forwardRef(function DialogContent({ className, children, ...props }, ref) {
  const container = usePortalContainer();
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-[1000] bg-black/50" />
      <DialogPrimitive.Content
        ref={ref} data-slot="dialog-content"
        className={cn('fixed top-1/2 left-1/2 z-[1000] flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg outline-hidden sm:max-w-[560px]', className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
