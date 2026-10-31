// shadcn/ui Progress (Radix), with the bar's colour chosen by the caller (the Quota widget colours it by how much is used).
import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '../lib/cn.js';

export const Progress = React.forwardRef(function Progress({ className, indicatorClassName, value, ...props }, ref) {
  return (
    <ProgressPrimitive.Root ref={ref} data-slot="progress" value={value} className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20', className)} {...props}>
      <ProgressPrimitive.Indicator data-slot="progress-indicator" className={cn('h-full w-full flex-1 rounded-full bg-primary transition-all', indicatorClassName)} style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
    </ProgressPrimitive.Root>
  );
});
