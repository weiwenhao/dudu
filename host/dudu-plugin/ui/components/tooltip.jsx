// shadcn/ui Tooltip (Radix): a small dark bar pointing at what it explains. Portaled into our `.dudu` root like every overlay.
import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '../lib/cn.js';
import { usePortalContainer } from '../lib/scope.jsx';

export const TooltipProvider = ({ delayDuration = 150, ...props }) => <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef(function TooltipContent({ className, sideOffset = 6, children, ...props }, ref) {
  const container = usePortalContainer();
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        ref={ref} data-slot="tooltip-content" sideOffset={sideOffset}
        className={cn('z-[1100] w-fit max-w-[280px] rounded-md bg-foreground px-3 py-1.5 text-xs text-background', className)}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
