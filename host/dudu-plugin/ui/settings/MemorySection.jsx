import { useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { Badge } from '../components/badge.jsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { when } from '../issues/activity.js';
import { T } from '../strings.js';
import { DangerButton, Empty, Field, Group, IconAction, Loading, Page, PrimaryButton, Problem, QuietButton, Row, TextField } from './kit.jsx';
import { useLoaded } from './use-loaded.js';

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
      <DialogContent aria-describedby={undefined} className="gap-3 rounded-[20px] sm:max-w-[440px]">
        <DialogTitle className="font-semibold">{M.willDelete}</DialogTitle>
        <p className="rounded-[12px] bg-muted px-3.5 py-2.5 [overflow-wrap:anywhere]">{record.text}</p>
        <p className="text-sm text-muted-foreground">{M.scope}</p>
        <Problem>{problem || (preview.status === 'error' ? T.settings.failed : '')}</Problem>
        <ul className="text-sm text-muted-foreground">
          {counts.map(([name, count]) => <li key={name}>{count} {M.counts[name] ?? name}</li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><QuietButton>{M.cancel}</QuietButton></DialogClose>
          <DangerButton disabled={preview.status !== 'ready' || busy} onClick={confirm}>{M.confirmForget}</DangerButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One thing that is remembered: the words, which file holds them and since when; edit them in place, or forget them. */
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
  if (editing) {
    return (
      <Row as="li" block>
        <form
          data-inline-form="" className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (text.trim() && text !== record.text) void save(); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setText(record.text); setEditing(false); } }}
        >
          <TextField value={text} onChange={(event) => setText(event.target.value)} aria-label={M.edit} rows={3} autoFocus className="min-h-[84px] resize-y" />
          <Problem>{problem}</Problem>
          <div className="flex justify-end gap-2">
            <QuietButton onClick={() => { setText(record.text); setEditing(false); setProblem(''); }}>{M.cancel}</QuietButton>
            <PrimaryButton type="submit" disabled={!text.trim() || text === record.text}>{M.save}</PrimaryButton>
          </div>
        </form>
      </Row>
    );
  }
  const superseded = record.status === 'superseded';
  return (
    <Row
      as="li"
      title={<span className={superseded ? 'font-normal text-muted-foreground line-through' : 'font-normal'}>{record.text}</span>}
      meta={<span className="inline-flex flex-wrap items-center gap-x-1.5">{record.file}<span aria-hidden="true">·</span>{M.since(record.since)}{superseded && <Badge className="ml-0.5">{M.superseded}</Badge>}</span>}
    >
      <IconAction label={M.editOf(record.text.slice(0, 40))} onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></IconAction>
      <IconAction label={M.forgetOf(record.text.slice(0, 40))} onClick={() => setForgetting(true)}><Trash2 aria-hidden="true" /></IconAction>
      {forgetting && <ForgetDialog request={request} record={record} onClose={() => setForgetting(false)} onDone={() => { setForgetting(false); reload(); }} />}
    </Row>
  );
}

/** Everything remembered: the entries of USER.md and MEMORY.md (search, edit, forget with a preview), and the tidy runs. */
export function MemorySection({ request }) {
  const [query, setQuery] = useState('');
  const records = useLoaded(request, 'memory/records', query.trim() ? { q: query.trim() } : {});
  const reviews = useLoaded(request, 'memory/reviews', { limit: 10 });
  const search = (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Field
        type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={M.search} aria-label={M.search}
        className={records.value ? 'w-[240px] pr-14 pl-8' : 'w-[240px] pl-8'}
      />
      {records.value && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{M.count(records.value.records.length)}</span>}
    </div>
  );
  return (
    <Page title={T.settings.nav.memory} action={search}>
      <Loading state={records} rows={3}>
        {(value) => (value.records.length === 0
          ? (query.trim() ? null : <Group><Empty>{M.empty}</Empty></Group>) // a search that finds nothing is not "nothing is remembered": the count in the field says 0
          : <Group label={T.settings.nav.memory}><ul>{value.records.map((record) => <Record key={record.id} request={request} record={record} reload={records.reload} />)}</ul></Group>)}
      </Loading>
      <Loading state={reviews} rows={1}>
        {(value) => (
          <Group title={M.reviews}>
            {!value.reviews?.length
              ? <Row title={<span className="font-normal text-muted-foreground">{M.noReviews}</span>} />
              : <ul>{value.reviews.map((review) => (
                <Row as="li" key={review.id} title={<span className="font-normal">{M.summary(review.summary ?? {})}</span>} meta={review.at ? when(review.at) : ''} />
              ))}</ul>}
          </Group>
        )}
      </Loading>
    </Page>
  );
}
