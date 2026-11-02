import { Button } from '../components/button.jsx';
import { T } from '../strings.js';

/** A titled card of a settings page (DSH's settings are cards too): title, an optional action at its right, the body. */
export function Card({ title, action, children }) {
  return (
    <section aria-label={title}>
      <h3 className="mx-1 mb-2 font-semibold">{title}</h3>
      <div className="rounded-[20px] border px-5">
        {action ? <div className="flex min-h-[60px] items-center gap-3.5 py-3">
          <div className="min-w-0 flex-1">{children}</div>{action}
        </div> : children}
      </div>
    </section>
  );
}

/** The shell of a section that loads: its failure with Retry. */
export function Loading({ state, children }) {
  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <span>{T.settings.failed}</span>
        <Button variant="outline" size="sm" onClick={state.reload}>{T.settings.retry}</Button>
      </div>
    );
  }
  return state.value ? children(state.value) : null;
}
