import { useCallback, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { diagnostic, T } from '../strings.js';
import { ActionButton, Empty, Field, Group, Loading, Page, Problem } from '../settings/kit.jsx';
import { ConnectDialog } from './ConnectDialog.jsx';
import { ConnectorDetail } from './ConnectorDetail.jsx';
import { ConnectorRow } from './ConnectorRow.jsx';
import { CustomConnector } from './CustomConnector.jsx';
import { aboutLine, describeState } from './describe.js';
import { useConnectors } from './use-connectors.js';

const P = T.settings.connectorsPage;
const S = P.sheet;
const C = T.settings.connectors;
const ORDER = ['here', 'work', 'projects', 'dev', 'web']; // the catalog's groups, in the order they are drawn

const succeeded = (answer) => ['success', 'no_op'].includes(answer?.outcome);
const matches = (needle, ...fields) => fields.some((field) => String(field ?? '').toLowerCase().includes(needle));
const stateOf = (shown) => (shown.spin || shown.tone ? { tone: shown.tone, spin: shown.spin, words: shown.words } : null);

/**
 * The connectors page, after Muse's (owner, 2026-11-23; .local/designs/connectors-muse-2026-11-23): one list. What is connected comes first, each with 查看 (its page);
 * one that worked once and has stopped (its sign-in ran out) stays there, in red, with the one thing that brings it back. Below, the catalog by group, 发现 first (the MCP
 * servers found in the owner's other tools), each with 连接, which opens a window that says what connecting it means and walks through it. A first connection that does not
 * work leaves nothing behind: the item is to connect again (connections.mjs). Search and 添加 (a connector made by hand) are at the top.
 */
export function ConnectorsPage({ request }) {
  const [connecting, setConnecting] = useState(null); // the catalog item whose window is open
  const connectors = useConnectors(request, { keepReading: Boolean(connecting) });
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(() => new Set()); // the ids a call is out about

  const value = connectors.value;
  const list = value?.connectors ?? [];
  const hold = (id, on) => setBusy((ids) => { const next = new Set(ids); if (on) next.add(id); else next.delete(id); return next; });
  /** What one button of a connected row asks of the host (sign in again, retry); the row says what came of it when the list is read again. */
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
  const begin = (next) => { setProblem(''); next(); };
  const reload = connectors.reload;
  const closeDialog = useCallback(() => setConnecting(null), []);

  const wrap = (node) => <div className="@container">{node}</div>;
  if (adding) {
    return wrap(
      <CustomConnector
        request={request} onBack={() => setAdding(false)}
        onAdded={(here) => { void connectors.reload(); if (here) { setAdding(false); setQuery(''); } }}
      />,
    );
  }
  const opened = openId && list.find((connector) => connector.id === openId);
  if (opened) {
    return wrap(
      <ConnectorDetail
        connector={opened} request={request} onBack={() => setOpenId(null)} onSaved={connectors.reload}
        onDisconnected={() => { setOpenId(null); void connectors.reload(); }}
      />,
    );
  }

  const needle = query.trim().toLowerCase();
  // A first connection that is going on is not a connector yet: its item stays where it is in the catalog, with a spinner.
  const connected = list.filter((connector) => !connector.fresh);
  const byGroup = new Map((value?.groups ?? []).map((group) => [group.id, [...(group.items ?? [])]]));
  for (const item of value?.trying ?? []) {
    if (!byGroup.has(item.group)) byGroup.set(item.group, []);
    byGroup.get(item.group).push({ ...item, trying: item.connector });
  }
  const groups = [...ORDER, ...[...byGroup.keys()].filter((id) => !ORDER.includes(id))].filter((id) => byGroup.has(id)).map((id) => ({
    id, items: byGroup.get(id).filter((item) => !needle || matches(needle, item.name, item.line)),
  })).filter((group) => group.items.length > 0);

  const connectedRow = (connector) => {
    const open = () => begin(() => setOpenId(connector.id));
    const status = connector.state?.status;
    // Signed in once, and the sign-in has run out: it says so in red and signs in again from here.
    if (status === 'needs-auth' && !connector.legacy) {
      return <ConnectorRow key={connector.id} icon={connector.icon} name={connector.name} line={S.expired} bad busy={busy.has(connector.id)}
        verb={{ label: S.relogin, run: () => act(connector.id, 'connectors/authorize') }} onOpen={open} />;
    }
    const shown = connector.legacy ? { ...describeState(connector.state, aboutLine(connector.about)), verb: null } : describeState(connector.state, aboutLine(connector.about));
    const verb = shown.verb === 'retry' ? { label: S.retry, run: () => act(connector.id, 'connectors/retry') }
      : shown.verb === 'cancel' ? { label: T.settings.general.cancel, run: () => act(connector.id, 'connectors/cancel') }
        : { label: S.view, run: open };
    return <ConnectorRow key={connector.id} icon={connector.icon} name={connector.name} line={shown.line} bad={shown.bad} state={stateOf(shown)} verb={verb} busy={busy.has(connector.id)} onOpen={open} />;
  };
  const connectedRows = connected.filter((connector) => !needle || matches(needle, connector.name, aboutLine(connector.about)));

  const search = (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Field type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={P.search} aria-label={P.search} className="w-[180px] pl-8 @max-[480px]:w-[132px]" />
    </div>
  );
  const add = (
    <ActionButton aria-label={P.addCustom} title={P.addCustom} onClick={() => begin(() => setAdding(true))}>
      <Plus aria-hidden="true" /><span className="@max-[480px]:hidden">{S.add}</span>
    </ActionButton>
  );

  return wrap(
    <Page title={T.settings.nav.connectors} action={<>{search}{add}</>}>
      <Loading state={connectors} rows={3}>{() => (
        <>
          <Problem>{problem}</Problem>
          {connectedRows.length === 0 && groups.length === 0 ? <Group><Empty>{C.empty}</Empty></Group> : null}
          {connectedRows.length > 0 && <Group title={P.views.connected}><ul>{connectedRows.map(connectedRow)}</ul></Group>}
          {groups.map((group) => (
            <Group key={group.id} title={P.groups[group.id] ?? group.id}>
              <ul>
                {group.items.map((item) => (
                  <ConnectorRow
                    key={item.id} icon={item.icon} name={item.name} line={item.line} state={item.trying ? { spin: true } : null}
                    verb={{ label: P.connect, run: () => begin(() => setConnecting(item)) }}
                  />
                ))}
              </ul>
            </Group>
          ))}
          {connecting && <ConnectDialog item={connecting} value={value} request={request} onClose={closeDialog} onChanged={reload} />}
        </>
      )}</Loading>
    </Page>,
  );
}
