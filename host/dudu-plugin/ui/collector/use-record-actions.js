import { useCallback, useMemo } from 'react';
import { abortable } from '../lib/abortable.js';
import { T } from '../strings.js';
import { issueRef } from './ConversationPicker.jsx';

const ok = (result) => ['success', 'no_op'].includes(result?.outcome);

/**
 * What can be done with a collected record, for everything that opens `RecordDialog` (the Collector widget and the search page): `call(action, body, signal)` is the plugin's `inbox/*` call that answers
 * null when it fails, `actions` the dialog's and the row menu's own. `beginMark(action, records)` is how the list shows a mark before it is saved (`change.settle(saved, record)` says it was); `refresh()` reads the list
 * again; `startCompletion` and `followCompletion` are those of `useCompletion`; `setCreating({ record, draft })` opens the New issue window for a record.
 */
export function useRecordActions({ request, toast, openIssue, beginMark, refresh, startCompletion, followCompletion, setCreating }) {
  const call = useCallback(async (action, body, signal) => {
    try { return await (signal ? abortable(request(action, body, { signal }), signal) : request(action, body)); } catch { return null; }
  }, [request]);
  const actions = useMemo(() => {
    // One mark (restore, handled, delete) on one or several records, and a line at the bottom that says so. No Undo (owner, 2026-11-12): Restore is the way back for a row
    // handled, and a delete is for a row that is wrong (the message is still where it came from).
    const saveMark = async (action, records) => {
      const change = beginMark(action, records);
      if (!change) return null;
      const ids = records.map((record) => record.id);
      const result = await call(action, { ids }, AbortSignal.timeout(15_000));
      const saved = ok(result);
      change.settle(saved, result?.record);
      refresh();
      if (!saved) { toast({ message: T.toast.failed }); return null; }
      return change.records;
    };
    const mark = async (action, records, message) => {
      if (await saveMark(action, records)) toast({ message });
    };
    // One or several records shared to the session of an issue (a message to its agent). Sharing to the issue itself is gone from this widget (owner, 2026-11-10).
    const shareTo = async (records, issue) => {
      const ids = records.map((record) => record.id);
      if (!ok(await call('inbox/share', { ids, issue: issue.id, to: 'session' }))) { toast({ message: T.toast.failed }); return; }
      refresh();
      toast({ message: T.collector.toast.sharedSession(issueRef(issue)) });
    };
    return {
      openSource: (record) => window.open(record.url, '_blank', 'noopener,noreferrer'),
      openIssue: (record) => { if (record.issue) openIssue?.(record.issue.id); },
      // Restore takes the mark off.
      restore: (record) => mark('inbox/restore', [record], T.collector.toast.restored),
      // Handled on their own (no issue needed), or wrong.
      done: (record) => mark('inbox/done', [record], T.collector.toast.done),
      doneMany: (records) => mark('inbox/done', records, T.collector.toast.done),
      remove: (record) => mark('inbox/delete', [record], T.collector.toast.deleted),
      removeMany: (records) => mark('inbox/delete', records, T.collector.toast.deleted),
      shareSession: (record, issue) => shareTo([record], issue),
      shareSessionMany: (records, issue) => shareTo(records, issue),
      // Fill in context (completion.js): `complete` has the collector's session read the conversation around the record; `follow` waits for one that is running already.
      complete: startCompletion,
      follow: followCompletion,
      // The New issue dialog opens with the record's title and text; the issue it makes is marked as the record's, and the record is linked to it.
      async makeIssue(record, draft) {
        const found = draft ?? (await call('inbox/get', { id: record.id }))?.draft;
        if (found) setCreating({ record, draft: found }); else toast({ message: T.toast.failed });
      },
    };
  }, [beginMark, call, followCompletion, openIssue, refresh, setCreating, startCompletion, toast]);
  return { call, actions };
}
