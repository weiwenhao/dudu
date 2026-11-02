import * as React from 'react';
import { ContextMenu as Primitive } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { usePortalContainer } from '../lib/scope.jsx';

export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuSub = Primitive.Sub;

const panel = 'z-[1000] max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-hidden';
const row = 'relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-hidden select-none focus:bg-accent data-[highlighted]:bg-accent data-[state=open]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export const ContextMenuContent = React.forwardRef(function ContextMenuContent({ className, ...props }, ref) {
  const container = usePortalContainer();
  return <Primitive.Portal container={container}>
    <Primitive.Content ref={ref} data-slot="context-menu-content" collisionPadding={8} className={cn(panel, 'w-[180px]', className)} {...props} />
  </Primitive.Portal>;
});

export const ContextMenuSubContent = React.forwardRef(function ContextMenuSubContent({ className, ...props }, ref) {
  const container = usePortalContainer();
  return <Primitive.Portal container={container}>
    <Primitive.SubContent ref={ref} data-slot="context-menu-sub-content" sideOffset={2} alignOffset={-6}
      collisionPadding={8} className={cn(panel, 'w-[232px]', className)} {...props} />
  </Primitive.Portal>;
});

export const ContextMenuItem = React.forwardRef(function ContextMenuItem({ className, children, shortcut, ...props }, ref) {
  return <Primitive.Item ref={ref} className={cn(row, className)} {...props}>
    {children}
    {shortcut && <kbd aria-hidden="true" className="ml-auto text-xs text-muted-foreground">{shortcut}</kbd>}
  </Primitive.Item>;
});

export const ContextMenuSubTrigger = React.forwardRef(function ContextMenuSubTrigger({ className, children, shortcut, ...props }, ref) {
  return <Primitive.SubTrigger ref={ref} className={cn(row, className)} {...props}>
    {children}
    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
      {shortcut && <kbd>{shortcut}</kbd>}
      <ChevronRight className="!size-3" aria-hidden="true" />
    </span>
  </Primitive.SubTrigger>;
});

export function ContextMenuSeparator() {
  return <Primitive.Separator className="-mx-1.5 my-1.5 h-px bg-border" />;
}
