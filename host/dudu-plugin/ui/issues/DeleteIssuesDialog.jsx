import { useEffect, useState } from 'react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';

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
  return <Dialog open={Boolean(ids)} onOpenChange={(value) => { if (!value && !busy) onClose(); }}>
    <DialogContent className="rounded-2xl p-6 sm:max-w-[520px]" aria-describedby={undefined}>
      <DialogTitle>{T.settings.memory.willDelete}</DialogTitle>
      <ul className="max-h-48 overflow-auto text-sm text-muted-foreground">
        {previews?.map(({ issue }) => <li key={issue.id} className="py-1">{issue.ref ? `${issue.ref} — ` : ''}{issue.title}</li>)}
      </ul>
      {problem && <p role="alert" className="text-sm text-danger-foreground">{T.toast.failed}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <DialogClose asChild><Button variant="outline" className="rounded-full" disabled={busy}>{T.settings.memory.cancel}</Button></DialogClose>
        <Button className="rounded-full bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500/40" disabled={busy || !previews?.length} onClick={remove}>{T.settings.skills.delete}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
