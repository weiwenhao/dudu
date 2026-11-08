import { useState } from 'react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';
import { cleanName, MAX_NAME } from './saved-views.js';

/** The window that names a view: for a new one, and for renaming. */
export function ViewNameDialog({ open, title, initial = '', confirm, onSubmit, onClose }) {
  const [name, setName] = useState(initial);
  const ready = Boolean(cleanName(name));
  const submit = () => { if (ready) onSubmit(cleanName(name)); };
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="gap-3 sm:max-w-[420px]">
      <DialogTitle className="text-sm font-medium text-muted-foreground">{title}</DialogTitle>
      <DialogDescription className="sr-only">{title}</DialogDescription>
      <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_NAME} placeholder={T.views.name} aria-label={T.views.name}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
        className="h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      <div className="flex justify-end gap-2">
        <DialogClose asChild><Button variant="ghost" size="sm">{T.newIssue.cancel}</Button></DialogClose>
        <Button size="sm" disabled={!ready} onClick={submit}>{confirm}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
