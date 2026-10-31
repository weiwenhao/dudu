// shadcn/ui Button, in the forwardRef form of the `new-york` style. DSH's web client is React 18, where a plain function
// component cannot receive the ref Radix hands it through `asChild`; the React 19 form shadcn now generates would lose it.
import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export const Button = React.forwardRef(function Button({ className, variant, size, asChild = false, type, ...props }, ref) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp ref={ref} data-slot="button" type={asChild ? type : (type ?? 'button')} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});
