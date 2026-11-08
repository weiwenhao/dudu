import { useCallback } from 'react';
import { useToast } from '../components/toast.jsx';
import { T } from '../strings.js';
import { copyText } from './copy.js';

/** The conversation of an issue, newest first, as many pages as there are (a copy takes all of it). */
async function wholeLog(request, id) {
  let first = null;
  let log = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await request('issues/get', cursor ? { id, logCursor: cursor } : { id });
    if (result.outcome !== 'success') throw new Error('The issue could not be read.');
    first ??= result;
    log = [...log, ...result.log];
    cursor = result.nextLogCursor;
    if (!cursor) break;
  }
  return { issue: first.issue, log };
}

/**
 * `copy(kind, issue)` puts one kind of copy of an issue on the clipboard and says so at the bottom (Linear's Copy menu). The id, title and branch name need
 * only what the row has; the Markdown of everything and the prompt read the issue again for its links and conversation.
 */
export function useCopyIssue(request) {
  const toast = useToast();
  return useCallback(async (kind, issue) => {
    try {
      let text;
      if (kind === 'everything' || kind === 'prompt') {
        const { issue: whole, log } = await wholeLog(request, issue.id);
        text = copyText(kind, whole, { log, links: whole.links ?? [] });
      } else text = copyText(kind, issue);
      if (!text) throw new Error('Nothing to copy.');
      await navigator.clipboard.writeText(text);
      toast({ message: T.toast.copied(kind === 'id' ? issue.ref : T.copy.done[kind]) });
    } catch { toast({ message: T.toast.failed }); }
  }, [request, toast]);
}
