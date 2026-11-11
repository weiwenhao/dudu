import { Check, ExternalLink, EyeOff, ListTodo, MessageSquarePlus, Plus, RefreshCw, RotateCcw, SquareArrowOutUpRight, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '../components/context-menu.jsx';
import { T } from '../strings.js';
import { hasSession, IssuePicker } from './IssuePicker.jsx';

// Let cmdk own navigation and text in its search box; Escape and Left still close the surrounding menu (the same as the issue menu).
const pickerKeys = (event) => {
  if (event.target.closest('[cmdk-root]') && !['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) event.stopPropagation();
};

/**
 * What a right click on a row of the Collector offers, as the issue menu does for an issue. To handle: share to the session of an issue
 * (a list to search), a new issue, the source, then handled, ignore, delete (red: the destructive colour, as the delete of the tasks window). Handled: its issue and the source; one handled on its own: restore, the source, delete.
 * Ignored: restore, then what To handle offers but ignore. To handle and Ignored begin with Select, which toggles this row for bulk actions.
 * The source is a group of its own: open it (when the record has a link) and fill in the context (every record, in every tab; not while `completing`: the plugin is at it already).
 * `actions`: { shareSession(record, issue), makeIssue(record), openSource(record), openIssue(record), ignore(record), restore(record), complete(record) }.
 */
export function RecordMenu({ record, tab, request, actions, selected = false, completing = false, onSelectRecord, children }) {
  const source = <>
    <ContextMenuSeparator />
    {record.url && <ContextMenuItem onSelect={() => actions.openSource(record)}><ExternalLink aria-hidden="true" />{T.detail.openSource}</ContextMenuItem>}
    <ContextMenuItem disabled={completing} onSelect={() => { void actions.complete(record); }}><RefreshCw aria-hidden="true" />{T.collector.complete}</ContextMenuItem>
  </>;
  const share = <>
    <ContextMenuSub>
      <ContextMenuSubTrigger><MessageSquarePlus aria-hidden="true" /><span>{T.collector.shareSession}</span></ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-80" onKeyDown={pickerKeys}>
        <IssuePicker request={request} eligible={hasSession} onSelect={(issue) => actions.shareSession(record, issue)} />
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuItem onSelect={() => actions.makeIssue(record)}><Plus aria-hidden="true" />{T.newIssue.title}</ContextMenuItem>
  </>;
  const remove = <ContextMenuItem className="text-destructive" onSelect={() => actions.remove(record)}><Trash2 aria-hidden="true" />{T.collector.remove}</ContextMenuItem>;
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      {tab !== 'done' && <>
        <ContextMenuItem onSelect={() => onSelectRecord(record.id)}><ListTodo aria-hidden="true" />{selected ? T.bulk.clear : T.collector.select}</ContextMenuItem>
        <ContextMenuSeparator />
      </>}
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
