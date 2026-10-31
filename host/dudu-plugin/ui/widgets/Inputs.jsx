import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { useServices } from '../services.jsx';
import { when } from '../issues/activity.js';
import { Empty, Frame } from './Frame.jsx';
import { usePolled } from './use-polled.js';

const I = T.widgets.inputs;

const Dot = ({ tone }) => <span className={cn('size-2 shrink-0 rounded-full', tone === 'bad' ? 'bg-destructive' : tone === 'ok' ? 'bg-success' : 'bg-muted-foreground/40')} aria-hidden="true" />;

/** What a connector is doing, in one line: a red dot and when it failed, a green one and how much it read, a grey one if it has not read yet. */
function Row({ connector }) {
  const last = connector.lastRead;
  const bad = last && !last.ok;
  return (
    <li className="flex h-8 items-center gap-2 px-2">
      <Dot tone={bad ? 'bad' : last ? 'ok' : 'none'} />
      <span className="min-w-0 flex-1 truncate">{connector.name}</span>
      <span className={cn('shrink-0 text-xs', bad ? 'text-danger-foreground' : 'text-muted-foreground')}>
        {bad ? I.failed(when(last.at)) : last ? I.count(connector.readToday ?? 0) : I.never}
      </span>
    </li>
  );
}

/**
 * Whether what comes in works, and how much came: the connectors that are on (the owner turned them on) with a dot each, the number
 * read today and the issues made from them. A short widget keeps two summary lines and the connectors that fail, a tall one lists them all.
 */
export function Inputs({ size }) {
  const { request } = useServices();
  const { status, value } = usePolled(request, 'dispatch/state', {}, { every: 30_000 });
  const connectors = (value?.connectors ?? []).filter((connector) => connector.enabled);
  const failing = connectors.filter((connector) => connector.lastRead && !connector.lastRead.ok);
  const read = connectors.reduce((sum, connector) => sum + (connector.readToday ?? 0), 0);
  const tall = (size?.rows ?? 2) >= 3;
  return (
    <Frame title={T.widgets.titles.inputs}>
      {status !== 'loading' && connectors.length === 0 ? <Empty>{I.empty}</Empty> : (
        <div className="flex flex-col gap-1">
          <dl className="grid grid-cols-2 gap-2 px-2 pb-1">
            <div><dt className="text-xs text-muted-foreground">{I.readToday}</dt><dd className="text-xl/7 font-semibold tabular-nums">{read}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{I.made}</dt><dd className="text-xl/7 font-semibold tabular-nums">{value?.createdToday ?? 0}</dd></div>
          </dl>
          <ul>{(tall ? connectors : failing).map((connector) => <Row key={connector.id} connector={connector} />)}</ul>
          {!tall && failing.length === 0 && connectors.length > 0 && (
            <p className="flex items-center gap-2 px-2 text-xs text-muted-foreground"><Dot tone="ok" />{I.allWorking}</p>
          )}
        </div>
      )}
    </Frame>
  );
}
