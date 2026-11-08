// shadcn/ui Badge (the outline variant): a small tag beside a name, such as a file name or "Default".
import * as React from 'react';
import { cn } from '../lib/cn.js';

export const Badge = React.forwardRef(function Badge({ className, ...props }, ref) {
  return <span ref={ref} data-slot="badge" className={cn('inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[11px]/[18px] font-normal whitespace-nowrap text-muted-foreground', className)} {...props} />;
});
