import { useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { Input } from '../components/input.jsx';
import { useToast } from '../components/toast.jsx';
import { T } from '../strings.js';

/** The small naming window used by views, with the issue's title and its existing update path. */
export function IssueRenameDialog({ issue, onSave, onClose, onCloseAutoFocus }) {
  const [title, setTitle] = useState(issue.title);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const field = useRef(null);
  const toast = useToast();
  const ready = Boolean(title.trim()) && title.trim().length <= 300;
  const save = async () => {
    if (!ready || saving.current) return;
    const next = title.trim();
    saving.current = true;
    setBusy(true);
    try {
      const result = await onSave(next);
      if (result?.outcome === 'success' || result?.outcome === 'no_op') onClose();
    } catch { toast({ message: T.toast.failed }); } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving.current) onClose(); }}>
    <DialogContent className="gap-3 sm:max-w-[420px]" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}
      onOpenAutoFocus={(event) => { event.preventDefault(); field.current?.focus(); field.current?.select(); }}>
      <DialogTitle className="text-sm font-medium text-muted-foreground">{T.views.rename}</DialogTitle>
      <Input ref={field} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} readOnly={busy}
        placeholder={T.newIssue.titlePlaceholder} aria-label={T.newIssue.titlePlaceholder} className="px-2"
        onKeyDown={(event) => {
          const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
          if (composing) { event.stopPropagation(); return; }
          if (event.key === 'Enter') { event.preventDefault(); void save(); }
        }} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>{T.newIssue.cancel}</Button>
        <Button size="sm" disabled={!ready || busy} aria-busy={busy || undefined} onClick={() => { void save(); }}>
          {busy && <LoaderCircle className="animate-spin" />}{T.views.save}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
