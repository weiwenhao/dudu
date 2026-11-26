import { createPortal } from 'react-dom';
import { Button } from '../components/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { Scope, usePortalContainer } from '../lib/scope.jsx';
import { T } from '../strings.js';

function PairingContent({ code, copyState, onCopy, onClose, returnFocus }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="bg-black/25 dark:bg-black/65"
        className="w-[360px] max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto sm:max-w-[360px]"
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected) { event.preventDefault(); returnFocus.focus(); }
        }}
      >
        <div className="flex flex-col items-center gap-0.5 text-center">
          <DialogTitle className="text-sm font-medium">{T.shell.scan}</DialogTitle>
          <p className="text-xs text-muted-foreground">{T.shell.scanHint}</p>
        </div>
        <div data-pairing-qr="" className="rounded-lg bg-white p-3">
          <img alt={T.shell.pair} className="block h-auto w-full" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(code.svg)}`} />
        </div>
        {code.addresses?.length ? <div className="flex flex-col gap-2">
          {code.addresses.map((address) => <div key={address.url} className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">{address.kind === 'lan' ? T.shell.lanLabel : T.shell.publicLabel}</span>
            <code className="min-w-0 text-right break-all">{new URL(address.url).host}</code>
          </div>)}
        </div> : <p className="text-center text-xs break-all text-muted-foreground">{new URL(code.url).host}</p>}
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className="h-[30px] rounded-[10px] px-3.5 shadow-none" onClick={onCopy}>
            {copyState === 'copied' ? T.shell.copied : T.shell.copyPairing}
          </Button>
        </div>
        {copyState === 'failed' && <p role="alert" className="text-center text-xs text-danger-foreground">{T.shell.copyFailed}</p>}
        <DialogDescription className="text-center text-xs text-muted-foreground">{T.shell.expiry}</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

// Inside the page the dashboard provides an untransformed portal root; a dialog opened where there is none gets a scope of its own.
export function PairingDialog(props) {
  const container = usePortalContainer();
  return container ? <PairingContent {...props} />
    : createPortal(<Scope floating><PairingContent {...props} /></Scope>, document.body);
}
