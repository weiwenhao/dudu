// shadcn/ui Textarea, in the forwardRef form React 18 needs. The size and the look of a field are the caller's (a settings form sets its own).
import * as React from 'react';
import { cn } from '../lib/cn.js';

export const Textarea = React.forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} data-slot="textarea" className={cn('flex min-h-16 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />;
});
