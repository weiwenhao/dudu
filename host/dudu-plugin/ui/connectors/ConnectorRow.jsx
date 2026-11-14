import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { ActionButton } from '../settings/kit.jsx';
import { ConnectorMark } from './ConnectorMark.jsx';

/** The state of a connector in its row: a spinner while it waits, otherwise a dot (amber: it needs something from you, red: it did not work) and the words. */
function State({ tone, spin, words }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
      {spin ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" /> : <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', tone === 'wait' ? 'bg-warning' : 'bg-destructive')} />}
      {words && <span className="max-w-[160px] truncate" title={words}>{words}</span>}
    </span>
  );
}

/**
 * One row of the list: its icon, its name, one grey line and, at the right, its state and the one thing to do. A row that opens (`onOpen`) is a button
 * for the keyboard and lights up under the pointer; a click anywhere on it but on its own button opens it. In a narrow window the name and the line keep
 * a width of their own and the words of the state give way (they are cut, whole in their tooltip), never the button.
 */
export function ConnectorRow({ icon, name, line, bad, state, verb, busy, onOpen }) {
  const head = (
    <>
      <ConnectorMark icon={icon} name={name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className={cn('truncate text-xs/[18px]', bad ? 'text-danger-foreground' : 'text-muted-foreground')}>{line}</div>
      </div>
    </>
  );
  return (
    <li
      className={cn(
        'flex min-h-[40px] items-center gap-3 border-t border-border/60 py-3 first:border-t-0',
        onOpen && 'cursor-pointer hover:-mx-2 hover:rounded-xl hover:border-transparent hover:bg-accent/60 hover:px-2 [&:hover+li]:border-transparent',
      )}
      onClick={onOpen}
    >
      {onOpen ? (
        <button type="button" aria-label={name} className="flex min-w-[120px] flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">{head}</button>
      ) : <div className="flex min-w-[120px] flex-1 items-center gap-3">{head}</div>}
      {(state || verb) && (
        <div className="ml-auto flex min-w-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {state && <State {...state} />}
          {verb && <ActionButton disabled={busy} onClick={verb.run}>{verb.label}</ActionButton>}
        </div>
      )}
    </li>
  );
}
