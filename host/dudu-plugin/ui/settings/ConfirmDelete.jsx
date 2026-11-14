import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';
import { DangerButton, QuietButton } from './kit.jsx';

const C = T.settings.confirmDelete;

/**
 * What is asked before something is deleted that nothing brings back (a connector, a collector; the owner took their Undo off, 2026-11-12, "加" to the question of a confirmation):
 * the same window and words as forgetting a memory: "will be deleted", what it is called, Cancel, Delete. `busy` holds both buttons while the deletion is on its way.
 */
export function ConfirmDelete({ name, busy = false, onConfirm, onClose }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="gap-3 rounded-[20px] sm:max-w-[440px]">
        <DialogTitle className="font-semibold">{C.title}</DialogTitle>
        <p className="rounded-[12px] bg-muted px-3.5 py-2.5 [overflow-wrap:anywhere]">{name}</p>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><QuietButton autoFocus disabled={busy}>{C.cancel}</QuietButton></DialogClose>
          <DangerButton disabled={busy} onClick={onConfirm}>{C.delete}</DangerButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
