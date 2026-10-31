// shadcn/ui Command: cmdk with shadcn's classes (the menus' filter box and rows). forwardRef form, see button.jsx.
import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { cn } from '../lib/cn.js';

export const Command = React.forwardRef(function Command({ className, ...props }, ref) {
  return <CommandPrimitive ref={ref} data-slot="command" className={cn('flex w-full flex-col overflow-hidden', className)} {...props} />;
});

/** The filter box. `children` is whatever sits at its right end (a shortcut hint). */
export const CommandInput = React.forwardRef(function CommandInput({ className, children, ...props }, ref) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-9 items-center gap-2 px-2">
      <CommandPrimitive.Input
        ref={ref} data-slot="command-input"
        className={cn('flex h-9 w-full min-w-0 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground disabled:opacity-50', className)}
        {...props}
      />
      {children}
    </div>
  );
});

export const CommandList = React.forwardRef(function CommandList({ className, ...props }, ref) {
  return <CommandPrimitive.List ref={ref} data-slot="command-list" className={cn('max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto', className)} {...props} />;
});

export const CommandEmpty = React.forwardRef(function CommandEmpty(props, ref) {
  return <CommandPrimitive.Empty ref={ref} data-slot="command-empty" className="py-6 text-center text-sm text-muted-foreground" {...props} />;
});

/** A run of rows under a small heading (the Dates part of the filter menu has three). */
export const CommandGroup = React.forwardRef(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref} data-slot="command-group"
      className={cn('overflow-hidden text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground', className)}
      {...props}
    />
  );
});

export const CommandSeparator = React.forwardRef(function CommandSeparator({ className, ...props }, ref) {
  return <CommandPrimitive.Separator ref={ref} data-slot="command-separator" className={cn('-mx-1.5 my-1.5 h-px bg-border', className)} {...props} />;
});

export const CommandItem = React.forwardRef(function CommandItem({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Item
      ref={ref} data-slot="command-item"
      className={cn(
        "relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
});
