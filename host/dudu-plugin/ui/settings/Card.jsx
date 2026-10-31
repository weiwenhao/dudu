import { Button } from '../components/button.jsx';
import { T } from '../strings.js';

/** A titled card of a settings page (DSH's settings are cards too): title, an optional action at its right, the body. */
export function Card({ title, action, children }) {
  return (
    <section aria-label={title} className="rounded-xl border">
      <header className="flex h-11 items-center gap-2 px-4">
        <h3 className="font-medium">{title}</h3>
        <span className="flex-1" />
        {action}
      </header>
      <div className="border-t px-4 py-3">{children}</div>
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
