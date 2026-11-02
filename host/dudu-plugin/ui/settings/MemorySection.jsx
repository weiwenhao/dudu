import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { when } from '../issues/activity.js';
import { T } from '../strings.js';
import { Card, Loading } from './Card.jsx';
import { useLoaded } from './use-loaded.js';
import { Pencil, Trash } from './icons.jsx';

const M = T.settings.memory;

/** Forgetting is a preview first: what would be deleted, and only then the deletion. */
function ForgetDialog({ request, record, onClose, onDone }) {
  const preview = useLoaded(request, 'memory/forget', { source: `record:${record.id}`, preview: true });
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const counts = Object.entries(preview.value?.counts ?? {}).filter(([, count]) => count > 0);
  const confirm = async () => {
    setBusy(true);
    setProblem('');
    try {
      const result = await request('memory/forget', { source: `record:${record.id}`, preview: false });
      if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
      onDone();
    } catch { setProblem(T.toast.failed); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle className="font-semibold">{M.willDelete}</DialogTitle>
        <p className="rounded-lg bg-muted px-3 py-2">{record.text}</p>
        <p className="text-sm text-muted-foreground">{M.scope}</p>
        {(problem || preview.status === 'error') && <p role="alert" className="text-danger-foreground">{problem || T.settings.failed}</p>}
        <ul className="text-sm text-muted-foreground">
          {counts.map(([name, count]) => <li key={name}>{count} {M.counts[name] ?? name}</li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="ghost" size="sm">{M.cancel}</Button></DialogClose>
          <Button size="sm" disabled={preview.status !== 'ready' || busy} onClick={confirm}>{M.confirmForget}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Record({ request, record, reload }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(record.text);
  const [forgetting, setForgetting] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async () => {
    setProblem('');
    try {
      const result = await request('memory/update', { id: record.id, text });
      if (!['success', 'no_op'].includes(result.outcome)) throw new Error();
      setEditing(false);
      reload();
    } catch { setProblem(T.toast.failed); }
  };
  return (
    <li className="flex min-h-[60px] items-center gap-3.5 border-t border-border/50 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        {editing ? (
          <textarea value={text} onChange={(event) => setText(event.target.value)} aria-label={M.edit} rows={3} className="w-full resize-none rounded-md border bg-background p-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" />
        ) : <p className={`text-[14px]/[22px]${record.status === 'superseded' ? ' text-muted-foreground line-through' : ''}`}>{record.text}</p>}
        {problem && <p role="alert" className="text-danger-foreground">{problem}</p>}
        <div className="flex flex-wrap items-center gap-x-1.5 text-[12px]/[18px] text-muted-foreground">
          <span>{record.file}</span>
          <span>·</span>
          <span>{M.since(record.since)}</span>
          {record.status === 'superseded' && <span className="rounded-full border px-2">{M.superseded}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {editing ? (
          <>
            <Button variant="ghost" size="xs" onClick={() => { setText(record.text); setEditing(false); }}>{M.cancel}</Button>
            <Button size="xs" onClick={save}>{M.save}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label={M.editOf(record.text.slice(0, 40))} onClick={() => setEditing(true)}><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" className="size-7" aria-label={M.forgetOf(record.text.slice(0, 40))} onClick={() => setForgetting(true)}><Trash /></Button>
          </>
        )}
      </div>
      {forgetting && <ForgetDialog request={request} record={record} onClose={() => setForgetting(false)} onDone={() => { setForgetting(false); reload(); }} />}
    </li>
  );
}

/** Everything remembered: the entries of USER.md and MEMORY.md (search, edit, forget with a preview), and the tidy runs, each undoable. */
export function MemorySection({ request }) {
  const [query, setQuery] = useState('');
  const records = useLoaded(request, 'memory/records', query.trim() ? { q: query.trim() } : {});
  const reviews = useLoaded(request, 'memory/reviews', { limit: 10 });
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={M.search} aria-label={M.search}
          className="h-9 w-full rounded-xl border bg-background pr-24 pl-8 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {records.value && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{M.count(records.value.records.length)}</span>}
      </div>
      <Loading state={records}>
        {(value) => (value.records.length === 0
          ? <p className="py-8 text-center text-muted-foreground">{M.empty}</p>
          : <ul className="rounded-[20px] border px-5">{value.records.map((record) => <Record key={record.id} request={request} record={record} reload={records.reload} />)}</ul>)}
      </Loading>
      <Card title={M.reviews}>
        <Loading state={reviews}>
          {(value) => (!value.reviews?.length ? <p className="flex min-h-[60px] items-center py-3 text-muted-foreground">{M.noReviews}</p> : (
            <ul className="flex flex-col gap-2">
              {value.reviews.map((review) => (
                <li key={review.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{M.summary(review.summary ?? {})}</span>
                  <span className="text-xs text-muted-foreground">{review.at ? when(review.at) : ''}</span>
                  {!review.undone && <Button variant="ghost" size="xs" onClick={async () => { await request('memory/undo', { id: review.id }); reviews.reload(); records.reload(); }}>{M.undo}</Button>}
                </li>
              ))}
            </ul>
          ))}
        </Loading>
      </Card>
    </div>
  );
}
