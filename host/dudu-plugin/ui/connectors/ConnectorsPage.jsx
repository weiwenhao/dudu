import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { cn } from '../lib/cn.js';
import { diagnostic, T } from '../strings.js';
import { ActionButton, Empty, Field, Group, Loading, Page, Problem, QuietButton } from '../settings/kit.jsx';
import { ConnectorDetail } from './ConnectorDetail.jsx';
import { ConnectorRow } from './ConnectorRow.jsx';
import { CustomConnector } from './CustomConnector.jsx';
import { aboutLine, describeState } from './describe.js';
import { iconFor } from './icons.js';
import { useConnectors } from './use-connectors.js';

const P = T.settings.connectorsPage;
const C = T.settings.connectors;
const ORDER = ['here', 'work', 'projects', 'dev', 'web']; // the catalog's groups, in the order they are drawn
const VIEWS = ['available', 'connected'];

const succeeded = (answer) => ['success', 'no_op'].includes(answer?.outcome);
const matches = (needle, ...fields) => fields.some((field) => String(field ?? '').toLowerCase().includes(needle));
const verbLabel = (verb) => ({ authorize: P.authorize, cancel: T.settings.general.cancel, retry: T.settings.retry })[verb];
const stateOf = (shown) => (shown.spin || shown.tone ? { tone: shown.tone, spin: shown.spin, words: shown.words } : null);
/**
 * An item of the catalog that was connected from this page stays in its row, with what the connection says, until it is connected (then it is in the
 * other view) or given up (then it is the catalog's again): while a call about it is out, or its connector still has a state to show.
 */
const isTrying = (entry, list, busy) => busy.has(entry.id) || list.some((connector) => connector.id === entry.connectorId && (connector.state || connector.busy));

/** The pills that choose the view, as the tabs of Issues draw their choice; the number is how many are connected. */
function Views({ value, count, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      {VIEWS.map((id) => (
        <Button
          key={id} type="button" variant={value === id ? 'secondary' : 'outline'} size="sm" aria-pressed={value === id}
          className={cn('h-7 rounded-full px-3 text-xs', value === id && 'font-medium')} onClick={() => onChange(id)}
        >
          {P.views[id]}{id === 'connected' && <span className="ml-1 text-muted-foreground">{count}</span>}
        </Button>
      ))}
    </div>
  );
}

/**
 * The connectors page, after Claude's and Muse's: what Dudu ships (a catalog, each with its icon, one click to connect), what is connected (a view of
 * its own; a click opens one, and the one thing to do there is disconnect), and, for what is in neither, a page with one box.
 */
export function ConnectorsPage({ request }) {
  const connectors = useConnectors(request);
  const [view, setView] = useState('available');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [removed, setRemoved] = useState(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(() => new Set()); // the ids a call is out about
  const [trying, setTrying] = useState([]); // { id, connectorId, groupId, index, item }: the items connected from here that have not got there

  const value = connectors.value;
  const list = value?.connectors ?? [];
  // What was tried and is over (connected, or given up) is forgotten as soon as the list or the calls say so, so that a later state of the same connector
  // (its authorization running out, a month on) does not draw its row back into Available.
  const [seen, setSeen] = useState({ value: null, busy });
  if (seen.value !== value || seen.busy !== busy) {
    setSeen({ value, busy });
    const kept = value ? trying.filter((entry) => isTrying(entry, value.connectors, busy)) : trying;
    if (kept.length !== trying.length) setTrying(kept);
  }

  const hold = (id, on) => setBusy((ids) => { const next = new Set(ids); if (on) next.add(id); else next.delete(id); return next; });
  /** What one button asks of the host. The row says what came of it when the list is read again; what the host refused is said on the page. */
  const act = async (id, method) => {
    hold(id, true);
    setProblem('');
    try {
      const answer = await request(method, { id });
      if (!succeeded(answer)) setProblem(diagnostic(answer?.message) ?? T.toast.failed);
    } catch { setProblem(T.toast.failed); }
    await connectors.reload();
    hold(id, false);
  };
  const connect = async ({ item, index, groupId }) => {
    hold(item.id, true);
    setProblem('');
    setTrying((entries) => [...entries.filter((entry) => entry.id !== item.id), { id: item.id, connectorId: item.id, groupId, index, item }]);
    try {
      const answer = await request('connectors/connect', { id: item.id });
      if (!succeeded(answer)) setProblem(diagnostic(answer?.message) ?? T.toast.failed);
      else {
        // the connector made from an item may have an id of its own (one found on this computer does): it is the one to follow in the list
        const made = answer.connector?.id ?? answer.id;
        if (made) setTrying((entries) => entries.map((entry) => (entry.id === item.id ? { ...entry, connectorId: made } : entry)));
      }
    } catch { setProblem(T.toast.failed); }
    await connectors.reload();
    hold(item.id, false);
  };
  const undo = async () => {
    setProblem('');
    try {
      const answer = await request('connectors/undo', { token: removed.token });
      if (answer.outcome !== 'success') { setProblem(T.toast.failed); return; }
      setRemoved(null);
      void connectors.reload();
    } catch { setProblem(T.toast.failed); }
  };
  const verbOf = (shown, id) => (shown.verb ? { label: verbLabel(shown.verb), run: () => act(id, `connectors/${shown.verb}`) } : null);
  const begin = (next) => { setProblem(''); setRemoved(null); next(); };

  const wrap = (node) => <div className="@container">{node}</div>;
  if (adding) {
    return wrap(
      <CustomConnector
        request={request} onBack={() => setAdding(false)}
        onAdded={(here) => { void connectors.reload(); if (here) { setAdding(false); setView('connected'); setQuery(''); } }}
      />,
    );
  }
  const opened = openId && list.find((connector) => connector.id === openId);
  if (opened) {
    return wrap(
      <ConnectorDetail
        connector={opened} request={request} onBack={() => setOpenId(null)} onSaved={connectors.reload}
        onDisconnected={(gone) => { setOpenId(null); setRemoved(gone); void connectors.reload(); }}
      />,
    );
  }

  const needle = query.trim().toLowerCase();
  const held = new Set(trying.flatMap((entry) => [entry.id, entry.connectorId]));
  const connected = list.filter((connector) => !trying.some((entry) => entry.connectorId === connector.id));

  // the catalog's groups; an item being connected is put back where it was, so that its row changes where it stands and does not jump
  const byGroup = new Map((value?.groups ?? []).map((group) => [group.id, (group.items ?? []).filter((item) => !held.has(item.id))]));
  for (const entry of [...trying].sort((a, b) => a.index - b.index)) {
    if (!byGroup.has(entry.groupId)) byGroup.set(entry.groupId, []);
    const items = byGroup.get(entry.groupId);
    items.splice(Math.min(entry.index, items.length), 0, { ...entry.item, trying: entry });
  }
  const groups = [...ORDER, ...[...byGroup.keys()].filter((id) => !ORDER.includes(id))].filter((id) => byGroup.has(id)).map((id) => ({
    id,
    rows: byGroup.get(id).map((item, index) => ({ item, index, groupId: id })).filter(({ item }) => !needle || matches(needle, item.name, item.line)),
  })).filter((group) => group.rows.length > 0);
  const connectedRows = connected
    // an entry from before (a server of DSH) has nothing to retry: it is opened to be disconnected
    .map((connector) => ({ connector, shown: connector.legacy ? { ...describeState(connector.state, aboutLine(connector.about)), verb: null } : describeState(connector.state, aboutLine(connector.about)) }))
    .filter(({ connector, shown }) => !needle || matches(needle, connector.name, shown.line));

  const search = (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Field type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={P.search} aria-label={P.search} className="w-[180px] pl-8 @max-[480px]:w-[132px]" />
    </div>
  );
  const add = (
    <ActionButton aria-label={P.addCustom} title={P.addCustom} onClick={() => begin(() => setAdding(true))}>
      <Plus aria-hidden="true" /><span className="@max-[480px]:hidden">{P.addCustom}</span>
    </ActionButton>
  );

  return wrap(
    <Page title={T.settings.nav.connectors} action={<>{search}{add}</>}>
      <Loading state={connectors} rows={3}>{() => (
        <>
          {removed && (
            <div role="status" className="flex items-center gap-2 rounded-[14px] bg-muted py-1 pr-1.5 pl-4 text-sm">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{C.removed(removed.name)}</span>
              {removed.token && <QuietButton onClick={undo}>{C.undo}</QuietButton>}
            </div>
          )}
          <Problem>{problem}</Problem>
          <Views value={view} count={connected.length} onChange={setView} />
          {view === 'available' ? (
            groups.length === 0 ? <Group><Empty>{C.empty}</Empty></Group> : groups.map((group) => (
              <Group key={group.id} title={P.groups[group.id] ?? group.id}>
                <ul>
                  {group.rows.map(({ item, index, groupId }) => {
                    const entry = item.trying && list.find((connector) => connector.id === item.trying.connectorId);
                    const shown = describeState(entry?.state ?? null, item.line);
                    const id = item.trying?.connectorId ?? item.id;
                    return (
                      <ConnectorRow
                        key={item.id} icon={iconFor(item.icon, groupId === 'here' ? 'local' : 'remote')} name={item.name} line={shown.line} bad={shown.bad} state={stateOf(shown)}
                        verb={verbOf(shown, id) ?? { label: P.connect, run: () => connect({ item, index, groupId }) }} busy={busy.has(item.id) || busy.has(id)}
                      />
                    );
                  })}
                </ul>
              </Group>
            ))
          ) : connectedRows.length === 0 ? <Group><Empty>{C.empty}</Empty></Group> : (
            <Group label={P.views.connected}>
              <ul>
                {connectedRows.map(({ connector, shown }) => (
                  <ConnectorRow
                    key={connector.id} icon={iconFor(connector.icon, connector.about?.kind === 'remote' ? 'remote' : 'local')} name={connector.name}
                    line={shown.line} bad={shown.bad} state={stateOf(shown)} verb={verbOf(shown, connector.id)} busy={busy.has(connector.id)}
                    onOpen={() => begin(() => setOpenId(connector.id))}
                  />
                ))}
              </ul>
            </Group>
          )}
        </>
      )}</Loading>
    </Page>,
  );
}
