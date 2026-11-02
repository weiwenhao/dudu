import { useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';
import { useWidgetData } from '../widgets/data.jsx';
import { Sessions } from './Sessions.jsx';

/** The session manager the sessions icon of the entry opens: the list on the left, the session chosen on the right (docs/assistant.md 4.1). */
export function SessionsDialog({ open, onOpenChange }) {
  const data = useWidgetData();
  const trigger = useRef(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="h-[min(680px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:h-[min(640px,calc(100dvh-2rem))] sm:max-w-[960px]" aria-describedby={undefined}
      onOpenAutoFocus={() => { trigger.current = document.activeElement; }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const icon = trigger.current;
        icon?.focus?.();
        // If the original entry was replaced while the dialog was open, return to another available action.
        if (icon && document.activeElement !== icon) icon.closest('[role="toolbar"]')?.querySelector('button')?.focus();
      }}>
      <div className="flex h-14 shrink-0 items-center border-b pr-3.5 pl-5">
        <DialogTitle className="text-[16px] font-semibold">{T.widgets.titles.sessions}</DialogTitle>
        <DialogClose asChild><Button variant="ghost" size="icon-sm" className="ml-auto size-7 rounded-md text-muted-foreground" aria-label={T.pet.close}><X /></Button></DialogClose>
      </div>
      <Sessions {...data}
        openIssue={(...args) => { onOpenChange(false); data.openIssue(...args); }}
        openSession={async (session) => { await data.openSession(session); onOpenChange(false); }} />
    </DialogContent>
  </Dialog>;
}
