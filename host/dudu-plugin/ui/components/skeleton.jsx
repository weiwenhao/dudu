// shadcn/ui Skeleton: a grey bar that pulses where something is still being read.
import { cn } from '../lib/cn.js';

export function Skeleton({ className, ...props }) {
  return <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)} {...props} />;
}
