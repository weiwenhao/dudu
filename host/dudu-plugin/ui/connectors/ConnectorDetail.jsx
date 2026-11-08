import { useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { diagnostic, T } from '../strings.js';
import { Field, Group, IconAction, Page, PrimaryButton, Problem, QuietButton, Row, TextField, useFocusAfterRefusal } from '../settings/kit.jsx';
import { iconFor } from './icons.js';
import { Tile } from './Tile.jsx';

const P = T.settings.connectorsPage;
const C = T.settings.connectors;
const G = T.settings.general;

/** What the connector's box holds, when the owner can change it: the text they pasted or wrote for a custom connector. */
const boxOf = (connector) => (connector.custom ? (connector.text ?? (connector.about?.kind === 'sentence' ? connector.about.text : undefined)) : undefined);

/**
 * One connector, opened: what it is, and the one thing to do with it (disconnect). A connector the owner added by hand can also be renamed and its
 * box changed; there is nothing to save until something differs. A connector that collectors read through is not disconnected: the page says which.
 */
export function ConnectorDetail({ connector, request, onBack, onSaved, onDisconnected }) {
  const form = useRef(null);
  const box = boxOf(connector);
  const [name, setName] = useState(connector.name);
  const [text, setText] = useState(box ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(''); // why a change was not saved
  const [guard, setGuard] = useState(''); // why it was not disconnected
  useFocusAfterRefusal(form, problem, busy);

  const { about = {} } = connector;
  const address = about.host ?? about.command ?? connector.address ?? '';
  const nameChanged = name.trim() !== connector.name;
  const textChanged = box !== undefined && text.trim() !== box.trim();
  const dirty = nameChanged || textChanged;
  const valid = name.trim() !== '' && (box === undefined || text.trim() !== '');
  const revert = () => { setName(connector.name); setText(box ?? ''); setProblem(''); };

  const save = async () => {
    if (!dirty || !valid || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const result = await request('connectors/update', { id: connector.id, ...(nameChanged ? { name: name.trim() } : {}), ...(textChanged ? { text: text.trim() } : {}) });
      if (['success', 'no_op'].includes(result.outcome)) await onSaved(); else setProblem(diagnostic(result.message) ?? T.toast.failed);
    } catch { setProblem(T.toast.failed); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    setGuard('');
    try {
      const result = await request('connectors/remove', { id: connector.id });
      if (result.code === 'in_use') { setGuard(C.inUse(result.collectors ?? [])); return; }
      if (!['success', 'no_op'].includes(result.outcome)) { setGuard(diagnostic(result.message) ?? T.toast.failed); return; }
      onDisconnected({ name: connector.name, token: result.undo });
    } catch { setGuard(T.toast.failed); }
    finally { setBusy(false); }
  };

  return (
    <Page
      title={connector.name}
      back={<IconAction label={P.back} onClick={onBack}><ChevronLeft aria-hidden="true" /></IconAction>}
      action={dirty && (
        <>
          <QuietButton disabled={busy} onClick={revert}>{G.cancel}</QuietButton>
          <PrimaryButton disabled={busy || !valid} onClick={save}>{G.save}</PrimaryButton>
        </>
      )}
    >
      <Group label={connector.name}>
        <Row block>
          <div className="flex items-center gap-3">
            <Tile icon={iconFor(connector.icon, about.kind === 'remote' ? 'remote' : 'local')} size={48} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{connector.name}</div>
              {connector.line && <div className="text-xs/[18px] text-muted-foreground [overflow-wrap:anywhere]">{connector.line}</div>}
            </div>
          </div>
        </Row>
        {address && <Row title={P.address}><span className="block max-w-[360px] truncate text-sm text-muted-foreground" title={address}>{address}</span></Row>}
        {typeof about.tools === 'number' && <Row title={P.tools}><span className="text-sm text-muted-foreground">{P.toolsValue(about.tools)}</span></Row>}
        {connector.custom && (
          <Row block>
            <form
              ref={form} data-inline-form="" className="flex flex-col gap-3"
              onSubmit={(event) => { event.preventDefault(); void save(); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); revert(); }
                else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); }
              }}
            >
              <Field aria-label={C.name} placeholder={C.name} maxLength={100} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
              {box !== undefined && (
                <TextField
                  aria-label={P.custom.placeholder} placeholder={P.custom.placeholder} rows={3} value={text} disabled={busy} spellCheck={false}
                  className="min-h-[88px] resize-y" onChange={(event) => setText(event.target.value)}
                />
              )}
              <Problem>{problem}</Problem>
            </form>
          </Row>
        )}
      </Group>
      <Group label={P.disconnect}>
        <Row block>
          <button
            type="button" disabled={busy} onClick={disconnect}
            className="rounded-md text-left text-sm text-danger-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {P.disconnect}
          </button>
          <Problem className="mt-2">{guard}</Problem>
        </Row>
      </Group>
    </Page>
  );
}
