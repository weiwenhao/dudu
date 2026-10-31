import { cn } from '../lib/cn.js';

/** What every small widget is made of: a title and a body that fills the rest, scrolling when its rows do not fit. */
export function Frame({ title, children, className, action }) {
  return (
    <section aria-label={title} className="@container flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 px-4 pt-1">
        <h2 className="font-semibold">{title}</h2>
        <span className="flex-1" />
        {action}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-auto px-2 pb-2', className)}>{children}</div>
    </section>
  );
}

export const Empty = ({ children }) => <div className="flex h-full items-center justify-center px-4 pb-4 text-center text-muted-foreground">{children}</div>;
