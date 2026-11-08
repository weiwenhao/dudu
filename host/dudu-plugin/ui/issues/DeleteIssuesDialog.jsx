import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';

/**
 * Linear's delete confirmation, measured on theirs (2026-11-05): a 15px question in semibold with the issue in it, a 15px grey sentence of what happens, and
 * Cancel and Delete as pills 8px apart, Delete red and holding the focus (with its own thin red frame). The panel is 24px of padding round a 422px column (472px with the border).
 */
export function DeleteConfirm({ open, onClose, title, description, busy = false, problem = false, ready = true, onDelete }) {
  const button = useRef(null);
  useEffect(() => { if (open && ready) button.current?.focus(); }, [open, ready]);
  return <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
    <DialogContent className="gap-0 p-6 sm:max-w-[472px]" onOpenAutoFocus={(event) => event.preventDefault()}>
      <DialogTitle className="text-[15px]/[23px] font-semibold">{title}</DialogTitle>
      <DialogDescription className="mt-1.5 text-[15px]/[23px] font-[450] text-muted-foreground">{description}</DialogDescription>
      {problem && <p role="alert" className="mt-2 text-sm text-danger-foreground">{T.toast.failed}</p>}
      <div className="mt-[19px] flex justify-end gap-2">
        <DialogClose asChild><Button variant="outline" size="sm" className="rounded-full text-[13px] font-medium" disabled={busy}>{T.settings.memory.cancel}</Button></DialogClose>
        <Button ref={button} size="sm" disabled={busy || !ready} onClick={onDelete}
          className="rounded-full bg-red-500 text-[13px] font-medium text-white hover:bg-red-600 focus:outline-solid focus:outline-1 focus:outline-offset-2 focus:outline-red-600 focus-visible:ring-0">{T.settings.skills.delete}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

/** What the question calls an issue: its id and title, Linear's way. */
export const issueName = (issue) => `${issue.ref ? `${issue.ref} \u2012 ` : ''}${issue.title}`;

export function DeleteIssuesDialog({ request, ids, onClose, onDeleted }) {
  const [previews, setPreviews] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    if (!ids) return;
    let active = true;
    setPreviews(null); setProblem(false);
    Promise.all(ids.map(async (id) => {
      const result = await request('issues/delete', { id });
      if (!result.preview) throw new Error();
      return result;
    })).then((values) => { if (active) setPreviews(values); }).catch(() => { if (active) setProblem(true); });
    return () => { active = false; };
  }, [ids, request]);
  const remove = async () => {
    if (busy || !previews) return;
    setBusy(true); setProblem(false);
    const remaining = [];
    for (const preview of previews) {
      try {
        const result = await request('issues/delete', { id: preview.issue.id, token: preview.token });
        if (result.outcome !== 'success' || !result.forgotten) {
          const next = await request('issues/delete', { id: preview.issue.id });
          remaining.push(next.preview ? next : preview);
        }
      } catch { remaining.push(preview); }
    }
    setBusy(false);
    if (remaining.length !== previews.length) onDeleted();
    if (remaining.length) { setPreviews(remaining); setProblem(true); } else onClose();
  };
  const many = (ids?.length ?? 0) > 1;
  const first = previews?.[0]?.issue;
  return <DeleteConfirm
    open={Boolean(ids)} onClose={onClose} busy={busy} problem={problem} ready={Boolean(previews?.length)} onDelete={remove}
    title={many ? T.deleteIssue.titleMany(ids.length) : first ? T.deleteIssue.title(issueName(first)) : '\u00a0'}
    description={many ? T.deleteIssue.scopeMany : T.deleteIssue.scope}
  />;
}
