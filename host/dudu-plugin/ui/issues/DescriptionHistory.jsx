import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { cn } from '../lib/cn.js';
import { formatDateTime } from '../lib/locale.mjs';
import { T } from '../strings.js';
import { actorName, when } from './activity.js';
import { descriptionVersions } from './description-history.js';
import { RichText } from './RichText.jsx';

/** Every event of an issue, newest first (a long-lived issue has several pages of them). */
async function wholeHistory(request, issueId) {
  let events = [];
  let cursor;
  for (let page = 0; page < 10; page += 1) {
    const result = await request('issues/events', { issueId, limit: 500, ...(cursor ? { cursor } : {}) });
    if (result.outcome !== 'success') throw new Error('The history could not be read.');
    events = [...events, ...result.events];
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return events;
}

/**
 * "Show description history": the versions of the description, the newest on top, each with when and by whom, and the text of the one chosen as the page shows it. A version
 * other than the current one can be put back; that is one more change of the description, so it is in the history too.
 */
export function DescriptionHistory({ request, issue, onClose, onRestored }) {
  const [versions, setVersions] = useState(null);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    if (!issue) return undefined;
    let active = true;
    wholeHistory(request, issue.id).then((events) => { if (active) { setVersions(descriptionVersions(events, issue)); setPicked(null); } }).catch(() => { if (active) { setVersions([]); setProblem(true); } });
    return () => { active = false; };
  }, [issue?.id, request]); // eslint-disable-line react-hooks/exhaustive-deps -- the history of this issue; its fields do not change what was written before
  const chosen = versions?.find((version) => version.id === picked) ?? versions?.[0] ?? null;
  const restore = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    setProblem(false);
    try {
      const result = await request('issues/update', { id: issue.id, patch: { brief: chosen.brief } });
      if (result?.outcome !== 'success' && result?.outcome !== 'no_op') throw new Error();
      onRestored();
      onClose();
    } catch { setProblem(true); setBusy(false); }
  };
  return <Dialog open={Boolean(issue)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="h-[min(560px,80vh)] gap-0 p-0 sm:max-w-[780px]" aria-describedby={undefined}>
      <DialogTitle className="border-b px-5 py-3 text-sm font-medium">{T.descriptionHistory.title}</DialogTitle>
      <DialogDescription className="sr-only">{T.descriptionHistory.title}</DialogDescription>
      {versions === null ? <div className="flex flex-1 items-center justify-center text-muted-foreground"><LoaderCircle className="animate-spin" aria-hidden="true" /></div>
        : !versions.length ? <p className="p-5 text-sm text-muted-foreground" data-description-history-empty="">{T.descriptionHistory.none}</p>
        : <div className="flex min-h-0 flex-1">
          <ul className="w-[220px] shrink-0 overflow-auto border-r p-2" aria-label={T.descriptionHistory.title}>
            {versions.map((version, position) => <li key={version.id}>
              <button type="button" data-description-version={version.id} aria-current={version === chosen || undefined} onClick={() => setPicked(version.id)}
                className={cn('flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', version === chosen && 'bg-accent')}>
                <span title={formatDateTime(version.at)}>{position === 0 ? T.descriptionHistory.current : when(version.at)}</span>
                <span className="text-xs text-muted-foreground">{position === 0 ? `${when(version.at)} · ` : ''}{actorName(version.actor)}</span>
              </button>
            </li>)}
          </ul>
          <div className="min-w-0 flex-1 overflow-auto p-5" data-description-preview="">
            {chosen && (chosen.brief.trim() ? <RichText key={chosen.id} value={chosen.brief} editable={false} /> : <p className="text-sm text-muted-foreground">{T.descriptionHistory.empty}</p>)}
          </div>
        </div>}
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        {problem && <p role="alert" className="mr-auto text-xs text-danger-foreground">{T.toast.failed}</p>}
        <DialogClose asChild><Button variant="ghost" size="sm">{T.descriptionHistory.close}</Button></DialogClose>
        <Button size="sm" disabled={busy || !chosen || chosen === versions?.[0]} aria-busy={busy || undefined} onClick={() => { void restore(); }}>{busy && <LoaderCircle className="animate-spin" />}{T.descriptionHistory.restore}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
