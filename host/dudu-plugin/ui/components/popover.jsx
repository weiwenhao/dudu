import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '../lib/cn.js';
import { usePortalContainer } from '../lib/scope.jsx';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

// z-index above DSH's own chrome; the content is portaled into our `.dudu` root, not <body>, so our CSS reaches it.
export const PopoverContent = React.forwardRef(function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }, ref) {
  const container = usePortalContainer();
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        ref={ref} data-slot="popover-content" align={align} sideOffset={sideOffset}
        className={cn('z-[1000] rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-hidden', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
