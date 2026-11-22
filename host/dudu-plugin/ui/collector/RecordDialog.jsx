import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, LoaderCircle, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { MenuIcon } from '../components/menu-icon.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { when } from '../issues/activity.js';
import { StatusIcon } from '../issues/icons.jsx';
import { T } from '../strings.js';
import { ConversationPicker, issueRef } from './ConversationPicker.jsx';

const IssueMark = ({ issue }) => <span className="inline-flex items-center gap-1.5 align-bottom"><StatusIcon status={issue.status} />{issueRef(issue)}</span>;

/**
 * The line under the meta line that says which issue the record went to, or nothing when it went nowhere. 嘟嘟 judges nothing and says nothing of a
 * record it did not make an issue of (owner, 2026-11-05); a record it made an issue of before that still says so.
 */
function verdictLine(record) {
  const V = T.collector.verdict;
  const { issue } = record;
  if (!issue) return null;
  if (record.byOwner) return <span>{record.verdict === 'issue' ? V.created : V.shared} <IssueMark issue={issue} /></span>;
  if (record.verdict === 'issue') return <span><b className="font-semibold">{T.brand}</b> {V.made} <IssueMark issue={issue} /></span>;
  return <span>{V.shared} <IssueMark issue={issue} /></span>;
}

/**
 * The lines of a conversation record, as the phone's record page sets them (owner, 2026-11-18; `messages` of `inbox/get`: { at: 'MM-DD HH:mm', from, text }): a small date between days, the
 * sender's name once above a run of their lines, each line with its time at the right. A record without `messages` (a mail, an alert) keeps its text as it is.
 */
function Transcript({ messages }) {
  const rows = [];
  let day = null;
  let sender = null;
  for (const message of messages) {
    const [date, time] = message.at.split(' ');
    if (date !== day) { rows.push({ kind: 'day', text: date }); day = date; sender = null; }
    if (message.from !== sender) { rows.push({ kind: 'from', text: message.from }); sender = message.from; }
    rows.push({ kind: 'line', text: message.text, time });
  }
  return <div className="rounded-xl border px-4 py-1.5">
    {rows.map((row, index) => row.kind === 'day'
      ? <div key={index} className="py-1.5 text-center text-xs text-muted-foreground tabular-nums">{row.text}</div>
      : row.kind === 'from'
        ? <div key={index} className="pt-1.5 text-[13px]/5 font-semibold">{row.text}</div>
        : <div key={index} className="flex items-baseline gap-3"><span className="min-w-0 flex-1 text-sm/[22px] break-words whitespace-pre-wrap">{row.text}</span><span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.time}</span></div>)}
  </div>;
}

/**
 * A record in full: what it says, what was around it, who and where from, and what the owner can do with it (the actions are the row menu's).
 * `card` is the row that was clicked; the rest is read when the dialog opens, and again when a completion of its context has ended (`finished` counts them; `completing` says one runs:
 * the button is busy and the window stays open). A completion that was running when the window opened is waited for too (`actions.follow`).
 */
export function RecordDialog({ card, tab, request, actions, marking, completing, finished, onClose, onRead }) {
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);
  const [pickingSession, setPickingSession] = useState(false);
  const { follow } = actions;
  useEffect(() => {
    let live = true;
    request('inbox/get', { id: card.id }).then((result) => {
      if (!live) return;
      if (result?.outcome !== 'success') { setFailed(true); return; }
      setDetail(result);
      setFailed(false);
      if (result.record?.completing) follow(card.id);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [request, card.id, finished, follow]);
  useEffect(() => {
    const record = detail?.record;
    if (!record?.unread || !Number.isSafeInteger(record.revision)) return;
    let live = true;
    let sent = false;
    const acknowledge = () => {
      if (sent || document.visibilityState === 'hidden') return;
      sent = true;
      request('inbox/read', { id: record.id, revision: record.revision }).then((result) => {
        if (live && ['success', 'no_op'].includes(result?.outcome)) onRead?.();
      }).catch(() => {}); // Reading stays unacknowledged on failure; no handling mark or retry.
    };
    acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    return () => { live = false; document.removeEventListener('visibilitychange', acknowledge); };
  }, [request, detail?.record, onRead]);
  const record = detail?.record ?? card;
  const meta = [record.ref, record.from, record.connectorName, record.at ? when(record.at) : ''].filter(Boolean).join(' · ');
  const verdict = verdictLine(record);
  const then = (work) => async (...args) => { await work(...args); onClose(); };
  const markThen = (work) => () => { void work(record); onClose(); };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[min(640px,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-[720px]" aria-describedby={undefined}>
      <div className="flex shrink-0 items-start gap-3 pt-4 pr-3.5 pl-5">
        <DialogTitle className="min-w-0 flex-1 text-base/6 font-semibold break-words">{record.title}</DialogTitle>
        <DialogClose asChild><Button variant="ghost" size="icon-sm" className="-mt-0.5 size-7 rounded-md text-muted-foreground" aria-label={T.pet.close}><X /></Button></DialogClose>
      </div>
      <DialogDescription className="sr-only">{meta}</DialogDescription>
      <div className="flex shrink-0 items-center gap-2 pr-3.5 pl-5 text-[13px]/5 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{meta}</span>
        {record.url && <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground" onClick={() => actions.openSource(record)}><MenuIcon icon={ExternalLink} slot={14} />{T.detail.openSource}</Button>}
      </div>
      {verdict && <div className="shrink-0 px-5 pt-3 text-[13px]/5">{verdict}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4">
        {failed && <p className="text-muted-foreground" role="alert">{T.collector.loadFailed}</p>}
        {detail?.record.messages?.length > 0 ? <Transcript messages={detail.record.messages} />
          : detail?.record.text && <div className="text-sm/[22px] break-words whitespace-pre-wrap">{detail.record.text}</div>}
        {detail?.record.context?.length > 0 && <>
          <div className="mt-5 text-xs/4 text-muted-foreground">{T.pet.context}</div>
          {detail.record.context.map((entry, index) => <div key={index} className="mt-3">
            <div className="flex items-baseline gap-2 text-[13px]/5"><b className="font-semibold">{entry.from}</b>{Number.isFinite(entry.at) && <span className="text-xs text-muted-foreground">{when(entry.at)}</span>}</div>
            <div className="text-[13px]/5 break-words whitespace-pre-wrap text-muted-foreground">{entry.text}</div>
          </div>)}
        </>}
      </div>
      {/* The buttons on the left carry the icons of the same actions in the row's menu (owner, 2026-11-18): delete with its icon and the destructive colour, fill in the context with its icon (a spinner while it runs), restore with its icon. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-5 py-3">
        {!record.issue && <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={marking} onClick={markThen(actions.remove)}><MenuIcon icon={Trash2} />{T.collector.remove}</Button>}
        {tab === 'done' && !record.issue && <Button variant="ghost" disabled={marking} onClick={markThen(actions.restore)}><MenuIcon icon={RotateCcw} />{T.collector.restore}</Button>}
        <Button variant="ghost" disabled={completing} aria-busy={completing || undefined} onClick={() => { void actions.complete(record); }}>{completing ? <LoaderCircle className="animate-spin" /> : <MenuIcon icon={RefreshCw} />}{T.collector.complete}</Button>
        <span className="flex-1" />
        {tab !== 'done' && <>
          <Button variant="outline" disabled={marking} onClick={markThen(actions.done)}>{T.collector.markDone}</Button>
          <Popover open={pickingSession} onOpenChange={setPickingSession}>
            <PopoverTrigger asChild><Button variant="outline">{T.collector.shareSession}<ChevronDown className="text-muted-foreground" /></Button></PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-80" aria-label={T.collector.shareSession}
              onKeyDown={(event) => { if (event.target.closest('[cmdk-root]') && !['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) event.stopPropagation(); }}>
              <ConversationPicker request={request} onSelect={(issue) => { setPickingSession(false); then(actions.shareSession)(record, issue); }} />
            </PopoverContent>
          </Popover>
          <Button onClick={() => { actions.makeIssue(record, detail?.draft); onClose(); }}>{T.newIssue.title}</Button>
        </>}
        {tab === 'done' && record.issue && <Button onClick={then(() => actions.openIssue(record))}>{T.widgets.sessions.openIssue}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
