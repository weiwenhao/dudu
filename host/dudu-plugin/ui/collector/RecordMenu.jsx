import { Check, ExternalLink, EyeOff, ListPlus, MessageSquarePlus, Plus, RotateCcw, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '../components/context-menu.jsx';
import { T } from '../strings.js';
import { hasSession, IssuePicker } from './IssuePicker.jsx';

// Let cmdk own navigation and text in its search box; Escape and Left still close the surrounding menu (the same as the issue menu).
const pickerKeys = (event) => {
  if (event.target.closest('[cmdk-root]') && !['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) event.stopPropagation();
};

/**
 * What a right click on a row of the Collector offers, as the issue menu does for an issue. To handle: share to an issue or to the session of one
 * (a list to search), a new issue, the source, then handled, ignore, delete. Handled: its issue and the source; one handled on its own: restore, the source, delete.
 * Ignored: restore, then what To handle offers but ignore.
 * `actions`: { share(record, issue), shareSession(record, issue), makeIssue(record), openSource(record), openIssue(record), ignore(record), restore(record) }.
 */
export function RecordMenu({ record, tab, request, actions, children }) {
  const source = record.url ? <>
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={() => actions.openSource(record)}><ExternalLink aria-hidden="true" />{T.detail.openSource}</ContextMenuItem>
  </> : null;
  const share = <>
    <ContextMenuSub>
      <ContextMenuSubTrigger><ListPlus aria-hidden="true" /><span>{T.collector.share}</span></ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-80" onKeyDown={pickerKeys}>
        <IssuePicker request={request} onSelect={(issue) => actions.share(record, issue)} />
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSub>
      <ContextMenuSubTrigger><MessageSquarePlus aria-hidden="true" /><span>{T.collector.shareSession}</span></ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-80" onKeyDown={pickerKeys}>
        <IssuePicker request={request} eligible={hasSession} onSelect={(issue) => actions.shareSession(record, issue)} />
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuItem onSelect={() => actions.makeIssue(record)}><Plus aria-hidden="true" />{T.newIssue.title}</ContextMenuItem>
  </>;
  const remove = <ContextMenuItem onSelect={() => actions.remove(record)}><Trash2 aria-hidden="true" />{T.collector.remove}</ContextMenuItem>;
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      {tab === 'done' && (record.issue ? <>
        <ContextMenuItem onSelect={() => actions.openIssue(record)}><SquareArrowOutUpRight aria-hidden="true" />{T.widgets.sessions.openIssue}</ContextMenuItem>
        {source}
      </> : <>
        <ContextMenuItem onSelect={() => actions.restore(record)}><RotateCcw aria-hidden="true" />{T.collector.restore}</ContextMenuItem>
        {source}
        <ContextMenuSeparator />
        {remove}
      </>)}
      {tab === 'todo' && <>
        {share}
        {source}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.done(record)}><Check aria-hidden="true" />{T.collector.markDone}</ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.ignore(record)}><EyeOff aria-hidden="true" />{T.collector.ignore}</ContextMenuItem>
        {remove}
      </>}
      {tab === 'ignored' && <>
        <ContextMenuItem onSelect={() => actions.restore(record)}><RotateCcw aria-hidden="true" />{T.collector.restore}</ContextMenuItem>
        {share}
        {source}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.done(record)}><Check aria-hidden="true" />{T.collector.markDone}</ContextMenuItem>
        {remove}
      </>}
    </ContextMenuContent>
  </ContextMenu>;
}
