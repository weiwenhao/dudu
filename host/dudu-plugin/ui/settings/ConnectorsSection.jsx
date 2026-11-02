import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { T } from '../strings.js';
import { Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';

const C = T.settings.connectors;
export function ConnectorsSection({ request }) {
  const state = useLoaded(request, 'connectors/list');
  const [removed, setRemoved] = useState(null);
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(null);
  const remove = async (connector) => {
    setBusy(connector.id);
    setProblem(false);
    try {
      const result = await request('connectors/remove', { id: connector.id });
      if (!['success', 'no_op'].includes(result.outcome)) { setProblem(true); return; }
      setRemoved({ name: connector.name, token: result.undo });
      state.reload();
    } catch { setProblem(true); }
    finally { setBusy(null); }
  };
  return <Loading state={state}>{(value) => <div className="flex flex-col gap-3">
    {removed && <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/50 py-1 pr-1 pl-3">
      <span className="flex-1">{C.removed(removed.name)}</span>
      {removed.token && <Button variant="ghost" size="sm" onClick={async () => {
        try {
          const result = await request('connectors/undo', { token: removed.token });
          if (result.outcome !== 'success') { setProblem(true); return; }
          setRemoved(null);
          state.reload();
        } catch { setProblem(true); }
      }}>{C.undo}</Button>}
    </div>}
    <p className="mx-1 text-muted-foreground">{C.note}</p>
    {problem && <p role="alert" className="text-sm text-danger-foreground">{T.toast.failed}</p>}
    {!value.connectors?.length ? <p className="py-10 text-center text-muted-foreground">{C.empty}</p> : <ul className="rounded-[20px] border px-5">
      {value.connectors.map((connector) => <li key={connector.id} className="flex items-start gap-4 border-t border-border/50 py-4 first:border-t-0">
        <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{connector.name}</h3><p className="mt-1 break-words whitespace-pre-wrap text-sm/6 text-muted-foreground">{connector.prompt ?? connector.description}</p></div>
        <Button variant="ghost" size="icon-sm" disabled={busy === connector.id} aria-label={C.removeOf(connector.name)} title={C.remove} onClick={() => remove(connector)}><Trash2 /></Button>
      </li>)}
    </ul>}
  </div>}</Loading>;
}
