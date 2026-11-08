import { useEffect, useRef, useState } from 'react';
import { Globe, Pencil, Plus, QrCode, Trash2, Wifi } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { intlLocale } from '../lib/locale.mjs';
import { diagnostic, T } from '../strings.js';
import { ActionButton, DangerButton, Failed, Field, Group, IconAction, Page, PrimaryButton, Problem, QuietButton, Reading, Row } from './kit.jsx';
import { PairingDialog } from './PairingDialog.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';

const S = T.shell;
const MAX_ADDRESSES = 32; // this computer's own address and up to 31 more
const POLL_MS = 4000;

// An address as the phone is given it: http or https (older versions wrote ws and wss), and the bare address of a server without the
// path the plugin used to add.
function normalize(address) {
  if (typeof address !== 'string' || !address) return '';
  try {
    const url = new URL(address);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    else if (url.protocol === 'wss:') url.protocol = 'https:';
    if (['/', '', '/dsbot'].includes(url.pathname) && !url.search && !url.hash) return url.origin;
    return url.href;
  } catch { return address; }
}
function same(left, right) {
  try { return new URL(left).href === new URL(right).href; } catch { return left === right; }
}
/** This computer's own address (the first one the plugin found) and the others, each once. */
function addressesFrom(value) {
  const all = Array.isArray(value.addresses) ? value.addresses.filter((address) => typeof address === 'string').map(normalize) : [];
  const lanAddress = normalize(typeof value.lanAddress === 'string' ? value.lanAddress : (all[0] || ''));
  const seen = new Set([lanAddress]);
  return {
    lanAddress,
    addresses: all.filter((address) => {
      if (same(address, lanAddress) || seen.has(address)) return false;
      seen.add(address);
      return true;
    }),
    kinds: Object.fromEntries((value.routes ?? []).map((route) => [normalize(route.url), route.kind])),
  };
}

/**
 * How the phone finds this computer: its name and addresses (saved, or used at once for a QR code), and who is paired. Opening this page
 * never makes a pairing code; one manually requested code contains every saved route of this computer.
 */
export function PhoneSection({ request }) {
  const [snapshot, setSnapshot] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState(null);
  const [copyState, setCopyState] = useState('');
  const [confirming, setConfirming] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [trigger, setTrigger] = useState(null); // the button that asked for the code: focus goes back to it
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState(null);
  const rowId = useRef(0);
  const rows = (addresses, kinds = {}) => addresses.map((value) => ({
    id: ++rowId.current, value, kind: kinds[value] ?? 'public',
  }));

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const value = await request('state');
        if (!active) return;
        setFailed(false);
        setSnapshot(value);
        const next = addressesFrom(value);
        setDraft((previous) => (previous === null ? { name: value.name, lanAddress: next.lanAddress, addresses: rows(next.addresses, next.kinds) } : { ...previous, lanAddress: next.lanAddress }));
        // a code the phone has used (a device with its id is there now) or that ran out is not shown any more
        setCode((previous) => (previous && (previous.expiresAt < Date.now() || value.devices.some((device) => device.id === previous.id)) ? null : previous));
      } catch (failure) { if (active) { setFailed(true); setError(diagnostic(failure.message)); } }
    };
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [request, attempt]);

  if (!draft || !snapshot) {
    return (
      <Page title={S.phone}>
        {failed ? <Failed onRetry={() => { setFailed(false); setError(''); setAttempt((value) => value + 1); }} /> : <Reading rows={3} />}
      </Page>
    );
  }

  const edit = (change) => { setDraft((previous) => ({ ...previous, ...change(previous) })); setSaved(false); setError(''); };
  const config = (addresses = draft.addresses) => ({
    name: draft.name, addresses: [draft.lanAddress, ...addresses.map((row) => row.value)],
    addressKinds: Object.fromEntries(addresses.map((row) => [row.value, row.kind])),
  });
  const known = addressesFrom(snapshot);
  const dirty = draft.name !== snapshot.name || JSON.stringify(config().addresses) !== JSON.stringify([known.lanAddress, ...known.addresses]);

  const run = async (action, body) => {
    setBusy(true); setSaved(false); setError('');
    try {
      const value = await request(action, body);
      if (action === 'generate') {
        setCode(value);
        setCopyState('');
        setSnapshot((previous) => previous && ({
          ...previous, name: draft.name, lanAddress: draft.lanAddress, addresses: config().addresses,
          routes: [{ kind: 'lan', url: draft.lanAddress }, ...draft.addresses.map((row) => ({ kind: row.kind, url: row.value }))],
        }));
        setSaved(true);
      } else {
        setSnapshot(value);
        if (action === 'save') { const next = addressesFrom(value); setDraft({ name: value.name, lanAddress: next.lanAddress, addresses: rows(next.addresses, next.kinds) }); setSaved(true); }
      }
      if (action === 'revoke') setConfirming(null);
      return true;
    } catch (failure) { setError(diagnostic(failure.message)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code.url); setCopyState('copied'); } catch { setCopyState('failed'); }
  };
  const saveAddress = async () => {
    const value = editor.value.trim();
    const addresses = editor.id === null
      ? [...draft.addresses, ...(value ? [{ id: ++rowId.current, kind: editor.kind, value }] : [])]
      : draft.addresses.flatMap((row) => row.id !== editor.id ? [row] : value ? [{ ...row, value }] : []);
    if (await run('save', config(addresses))) setEditor(null);
  };

  return (
    <Page
      title={S.phone}
      action={<>
        {saved && !dirty && <span role="status" className="text-xs text-muted-foreground">{S.saved}</span>}
        {dirty && <PrimaryButton disabled={busy} onClick={() => run('save', config())}>{S.save}</PrimaryButton>}
        <ActionButton disabled={busy || Boolean(editor)} aria-label={S.generate} onClick={(event) => {
          setTrigger(event.currentTarget);
          void run('generate', config());
        }}><QrCode aria-hidden="true" />{busy ? S.busy : S.generate}</ActionButton>
      </>}
    >
      <Problem>{error}</Problem>
      <Group label={S.computerName}>
        <Row title={S.computerName}>
          <Field aria-label={S.computerName} maxLength={80} value={draft.name} disabled={busy} className="w-[280px]" onChange={(event) => edit(() => ({ name: event.target.value }))} />
        </Row>
      </Group>
      <Group
        title={S.addresses}
        action={(
          <Popover open={adding} onOpenChange={setAdding}>
            <PopoverTrigger asChild><QuietButton disabled={busy || draft.addresses.length >= MAX_ADDRESSES - 1}>
              <Plus aria-hidden="true" />{S.addAddress}
            </QuietButton></PopoverTrigger>
            <PopoverContent align="end" className="w-[160px] p-1" role="menu" aria-label={S.addAddress}>
              {[['lan', S.lan, Wifi], ['public', S.publicAddress, Globe]].map(([kind, label, Icon]) => (
                <button key={kind} type="button" role="menuitem" className="flex min-h-[34px] w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent"
                  onClick={() => { setAdding(false); setEditor({ id: null, kind, value: '' }); setError(''); }}>
                  <Icon className="size-4" aria-hidden="true" />{label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      >
        <Row title={<span className="flex items-center gap-2"><Wifi className="size-4 text-muted-foreground" aria-hidden="true" />{S.lan}</span>}>
          <code className="max-w-[240px] truncate font-mono text-xs text-muted-foreground" title={draft.lanAddress}>{draft.lanAddress}</code>
        </Row>
        {draft.addresses.map((row, index) => (
          <Row key={row.id} title={<span className="flex items-center gap-2">
            {row.kind === 'lan' ? <Wifi className="size-4 text-muted-foreground" aria-hidden="true" /> : <Globe className="size-4 text-muted-foreground" aria-hidden="true" />}
            {row.kind === 'lan' ? S.lan : S.publicAddress}
          </span>}>
            <code className="max-w-[240px] truncate font-mono text-xs text-muted-foreground" title={row.value}>{row.value}</code>
            <IconAction label={row.kind === 'public' ? S.editPublicAddress : S.edit} disabled={busy}
              onClick={() => { setEditor({ ...row }); setError(''); }}><Pencil aria-hidden="true" /></IconAction>
            {index > 0 && <IconAction label={S.removeRoute} disabled={busy} onClick={() => run('save', config(draft.addresses.filter((item) => item.id !== row.id)))}><Trash2 aria-hidden="true" /></IconAction>}
          </Row>
        ))}
        {editor && <Row block>
          <div className="flex flex-col gap-2.5">
            <label htmlFor="dudu-connection-address" className="text-sm font-medium">{editor.kind === 'lan' ? S.lan : S.publicAddress}</label>
            <Field autoFocus id="dudu-connection-address" type="url" value={editor.value} maxLength={2048} disabled={busy} spellCheck={false} autoCapitalize="none" autoCorrect="off"
              onChange={(event) => setEditor((previous) => ({ ...previous, value: event.target.value }))} />
            <div className="flex justify-end gap-2">
              <QuietButton disabled={busy} onClick={() => setEditor(null)}>{S.cancel}</QuietButton>
              <PrimaryButton disabled={busy || (editor.id === null && !editor.value.trim())} onClick={saveAddress}>{busy ? S.busy : S.save}</PrimaryButton>
            </div>
          </div>
        </Row>}
      </Group>
      <Group title={S.devices}>
        {snapshot.devices.length
          ? <ul>{snapshot.devices.map((device) => (
            <Row as="li" key={device.id} title={device.name} meta={S.paired(new Date(device.pairedAt).toLocaleDateString(intlLocale()))}>
              <ActionButton className="text-danger-foreground" disabled={busy} onClick={() => setConfirming(device)}>{S.revoke}</ActionButton>
            </Row>
          ))}</ul>
          : <Row title={<span className="font-normal text-muted-foreground">{S.noDevices}</span>} />}
      </Group>
      {code && <PairingDialog code={code} copyState={copyState} onCopy={copy} onClose={() => setCode(null)} returnFocus={trigger} />}
      {confirming && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setConfirming(null); }}>
          <DialogContent className="w-[400px] gap-4 rounded-[20px] sm:max-w-[400px]">
            <DialogTitle className="text-base font-semibold [overflow-wrap:anywhere]">{S.revokeQuestion(confirming.name)}</DialogTitle>
            <DialogDescription className="sr-only">{S.revokePairing}</DialogDescription>
            <div className="flex justify-end gap-2">
              <QuietButton autoFocus disabled={busy} onClick={() => setConfirming(null)}>{S.cancel}</QuietButton>
              <DangerButton disabled={busy} onClick={() => run('revoke', { id: confirming.id })}>{S.revokePairing}</DangerButton>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Page>
  );
}
