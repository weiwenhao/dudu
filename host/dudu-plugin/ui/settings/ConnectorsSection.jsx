import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Checkbox } from '../components/checkbox.jsx';
import { Switch } from '../components/switch.jsx';
import { when } from '../issues/activity.js';
import { T } from '../strings.js';
import { Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const C = T.settings.connectors;

function Badge({ children }) {
  return <span className="rounded-full border px-2 text-xs text-muted-foreground">{children}</span>;
}

/** One connector: its name, where it came from, the switch only the owner has, and (opened) what it may do. */
function Connector({ request, connector, reload, onRemoved }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState('');
  const act = async (action, body, after) => {
    setProblem('');
    try {
      const result = await request(`connectors/${action}`, { id: connector.id, ...body });
      if (result.outcome !== 'success') setProblem(result.message ?? T.settings.failed);
      else after?.(result);
    } catch { setProblem(T.settings.failed); }
    reload();
  };
  const test = connector.lastTest;
  return (
    <li className="rounded-xl border">
      <div className="flex items-center gap-3 p-3">
        <Button variant="ghost" size="icon-xs" aria-expanded={open} aria-label={C.expand(connector.name)} onClick={() => setOpen(!open)}>{open ? <ChevronDown /> : <ChevronRight />}</Button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{connector.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{C.kind[connector.kind] ?? connector.kind}</span>
            <span>·</span>
            <span>{C.source[connector.source] ?? connector.source}</span>
            <span>·</span>
            <span>{test ? (test.ok ? C.testedOk(when(test.at)) : C.testedFailed(when(test.at))) : C.never}</span>
          </div>
        </div>
        <Switch checked={connector.enabled} aria-label={C.turnOn(connector.name)} onCheckedChange={(on) => act(on ? 'enable' : 'disable', on ? { digest: connector.digest } : {})} />
      </div>
      {problem && <p className="px-4 pb-2 text-xs text-danger-foreground" role="alert">{problem}</p>}
      {open && (
        <div className="flex flex-col gap-3 border-t p-4">
          {connector.description && <p>{connector.description}</p>}
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">{C.allowed}</h4>
            <ul className="flex flex-col gap-1">
              {connector.operations.map((operation) => (
                <li key={operation.name} className="flex items-center gap-2">
                  {connector.tools !== undefined && connector.kind !== 'cli' && (
                    <Checkbox
                      checked={operation.ticked} aria-label={operation.label}
                      onCheckedChange={() => act('tick', { tools: connector.operations.filter((other) => (other.name === operation.name ? !other.ticked : other.ticked)).map((other) => other.label) })}
                    />
                  )}
                  <code className="min-w-0 flex-1 truncate" title={operation.description}>{operation.label}</code>
                  <Badge>{operation.readOnly ? C.read : C.write}</Badge>
                </li>
              ))}
            </ul>
          </div>
          {test && !test.ok && <p className="text-xs text-danger-foreground">{test.message}</p>}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => act('test')}>{C.test}</Button>
            <Button
              variant="ghost" size="sm" className="text-danger-foreground"
              onClick={() => act('remove', {}, (result) => onRemoved({ name: connector.name, token: result.undo }))}
            >
              {C.remove}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The connectors in CONNECTORS.md: every one starts off, and only the switch here turns one on. There is no form to add one. */
export function ConnectorsSection({ request }) {
  const state = useLoaded(request, 'connectors/list');
  const [removed, setRemoved] = useState(null); // { name, token }: the last one removed, which can be put back
  return (
    <Loading state={state}>
      {(value) => (
        <div className="flex flex-col gap-4">
          {removed && (
            <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/50 py-1 pr-1 pl-3">
              <span className="flex-1">{C.removed(removed.name)}</span>
              {removed.token && <Button variant="ghost" size="sm" onClick={async () => { await request('connectors/undo', { token: removed.token }); setRemoved(null); state.reload(); }}>{C.undo}</Button>}
            </div>
          )}
          {value.connectors.length === 0 && <p className="py-10 text-center text-muted-foreground">{C.empty}</p>}
          <ul className="flex flex-col gap-3">
            {value.connectors.map((connector) => <Connector key={connector.id} request={request} connector={connector} reload={state.reload} onRemoved={setRemoved} />)}
          </ul>
          {value.diagnostics?.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">{C.skipped}</h4>
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {value.diagnostics.map((item) => <li key={`${item.line}-${item.reason}`}>{C.line(item.line)}: {item.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Loading>
  );
}
