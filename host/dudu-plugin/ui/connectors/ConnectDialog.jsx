import { useEffect, useRef, useState } from 'react';
import { Copy, Loader2, LogIn, Sparkles, SquareTerminal, Unplug } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { useToast } from '../components/toast.jsx';
import { diagnostic, T } from '../strings.js';
import { PrimaryButton, QuietButton } from '../settings/kit.jsx';
import { ConnectorMark } from './ConnectorMark.jsx';

const P = T.settings.connectorsPage;
const S = P.sheet;
const SIGNS_IN = new Set(['oauth', 'open', 'device']);

/** What connecting means, in three points (Muse's card): where it signs in or runs, who can use it, and how it is undone. */
function Points({ item }) {
  const points = [
    item.how === 'local' ? [SquareTerminal, S.local, S.localText(item.name)] : [LogIn, S.signIn(item.name), S.signInText(item.name)],
    [Sparkles, S.usable, S.usableText(item.name)],
    [Unplug, S.anytime, S.anytimeText(item.name)],
  ];
  return (
    <div className="mt-5 flex flex-col gap-3.5">
      {points.map(([Icon, title, text]) => (
        <div key={title} className="flex gap-3">
          <Icon className="mt-0.5 size-[18px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <div><div className="text-sm font-medium">{title}</div><div className="text-xs/[18px] text-muted-foreground">{text}</div></div>
        </div>
      ))}
    </div>
  );
}

/** A command to run in a terminal, with its copy button. */
function Command({ text }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-[10px] bg-muted px-3 py-2.5">
      <SquareTerminal className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <code className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">{text}</code>
      <QuietButton className="h-7 px-2 text-xs" onClick={() => { void navigator.clipboard?.writeText(text).catch(() => {}); }}><Copy aria-hidden="true" />{S.copy}</QuietButton>
    </div>
  );
}

/**
 * Connecting one item of the catalog (owner, 2026-11-23, after Muse's connectors; .local/designs/connectors-muse-2026-11-23): a window that says what connecting it means and
 * asks once, then shows the one thing the connection waits for (the browser, a code, a command to run) until it is connected (the window closes and says so) or did not
 * work (it says why, with 重试). Closing it gives up a first connection: nothing is left in the list (connections.mjs lets go of it). A command-line item is checked at once.
 */
export function ConnectDialog({ item, value, request, onClose, onChanged }) {
  const toast = useToast();
  const [connectorId, setConnectorId] = useState(null);
  const [since, setSince] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState('');

  const start = async () => {
    setBusy(true);
    setRefused('');
    try {
      const at = Date.now();
      // the connector being made, while it is there; once a first try was let go of, the item again
      const live = connectorId && value?.connectors?.some((entry) => entry.id === connectorId);
      const answer = await request('connectors/connect', { id: live ? connectorId : item.id });
      if (!['success', 'no_op'].includes(answer?.outcome)) { setRefused(diagnostic(answer?.message) ?? T.toast.failed); return; }
      setSince(at);
      setConnectorId(answer.id ?? item.id);
      await onChanged();
    } catch { setRefused(T.toast.failed); }
    finally { setBusy(false); }
  };
  // A command-line item has nothing to explain: it is checked as soon as the window opens.
  const opened = useRef(false);
  useEffect(() => {
    if (item.how !== 'cli' || opened.current) return;
    opened.current = true;
    void start();
  });

  const connector = connectorId ? value?.connectors?.find((entry) => entry.id === connectorId) : null;
  const attempt = connectorId ? value?.attempts?.find((entry) => (entry.id === connectorId || entry.from === item.id) && entry.at >= since - 2000) : null;
  const status = connector?.state?.status;
  const done = connector && !connector.fresh && !connector.state;
  const announced = useRef(false);
  useEffect(() => {
    if (!done || announced.current) return;
    announced.current = true;
    toast({ message: S.connected(item.name) });
    onClose();
  }, [done, item.name, onClose, toast]);

  const close = async () => {
    if (connector?.fresh) { try { await request('connectors/cancel', { id: connector.id }); } catch { /* the list says what is left */ } }
    onClose();
    void onChanged();
  };

  let body = <Points item={item} />;
  let primary = { label: P.connect, run: start };
  if (attempt && !connector) {
    body = <><Points item={item} /><p className="mt-4 text-sm text-danger-foreground">{SIGNS_IN.has(item.how) ? S.failed : S.failedWith(diagnostic(attempt.message) || T.toast.failed)}</p></>;
    primary = { label: S.retry, run: start };
  } else if (status === 'needs-login' || status === 'missing') {
    const missing = status === 'missing';
    const command = connector.state.command ?? '';
    const line = missing ? connector.state.install : connector.state.login;
    body = (
      <div className="mt-5">
        <div className="text-sm font-medium">{missing ? S.notFound(command) : S.notSignedIn(command)}</div>
        {line && <><div className="text-xs/[18px] text-muted-foreground">{missing ? S.runInstall : S.runLogin}</div><Command text={line} /></>}
      </div>
    );
    primary = { label: S.recheck, run: start };
  } else if (status === 'waiting' && connector.state.code) {
    body = (
      <div className="mt-5 text-center">
        <div className="font-mono text-[28px] font-semibold tracking-[4px]">{connector.state.code}</div>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden="true" />{S.code(item.name)}</div>
      </div>
    );
    primary = null;
  } else if (connector && SIGNS_IN.has(item.how) && (status === 'waiting' || connector.busy)) {
    body = <div className="mt-5 flex items-center gap-2.5 rounded-[12px] bg-muted px-4 py-3.5 text-sm"><Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />{S.waiting(item.name)}</div>;
    primary = null;
  }
  const working = busy || (connector && (connector.busy || status === 'waiting') && !attempt);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void close(); }}>
      <DialogContent className="gap-0 rounded-[20px] p-6 sm:max-w-[420px]">
        <div className="flex items-center gap-3">
          <ConnectorMark icon={item.icon} name={item.name} size={44} />
          <div className="min-w-0">
            <DialogTitle className="text-[17px] font-semibold">{item.name}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">{item.line}</DialogDescription>
          </div>
        </div>
        {body}
        {refused && <p className="mt-4 text-sm text-danger-foreground">{refused}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <QuietButton onClick={() => { void close(); }}>{T.settings.general.cancel}</QuietButton>
          {primary && <PrimaryButton disabled={working} onClick={primary.run}>{working ? <Loader2 className="animate-spin" aria-hidden="true" /> : primary.label}</PrimaryButton>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
