import { Check, ExternalLink, Forward, Plus, RefreshCw, RotateCcw, SquareArrowOutUpRight, SquareCheckBig, Trash2 } from 'lucide-react';
import { MenuIcon } from '../components/menu-icon.jsx';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '../components/context-menu.jsx';
import { T } from '../strings.js';
import { ConversationPicker } from './ConversationPicker.jsx';

// Let cmdk own navigation and text in its search box; Escape and Left still close the surrounding menu (the same as the issue menu).
const pickerKeys = (event) => {
  if (event.target.closest('[cmdk-root]') && !['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) event.stopPropagation();
};

/**
 * What a right click on a row of the Collector offers, as the issue menu does for an issue. To handle: forward to a conversation
 * (a list to search, with avatars), a new issue, the source, then handled, delete (red: the destructive colour, as the delete of the tasks window). Handled: its issue and the source; one handled on its own: restore, the source, delete.
 * To handle begins with Select, which toggles this row for bulk actions.
 * The source is a group of its own: open it (when the record has a link) and fill in the context (every record, in every tab; not while `completing`: the plugin is at it already).
 * `actions`: { shareSession(record, issue), makeIssue(record), openSource(record), openIssue(record), restore(record), complete(record) }.
 */
export function RecordMenu({ record, tab, request, actions, selected = false, completing = false, onSelectRecord, children }) {
  const source = <>
    <ContextMenuSeparator />
    {record.url && <ContextMenuItem onSelect={() => actions.openSource(record)}><MenuIcon icon={ExternalLink} />{T.detail.openSource}</ContextMenuItem>}
    <ContextMenuItem disabled={completing} onSelect={() => { void actions.complete(record); }}><MenuIcon icon={RefreshCw} />{T.collector.complete}</ContextMenuItem>
  </>;
  const share = <>
    <ContextMenuSub>
      <ContextMenuSubTrigger><MenuIcon icon={Forward} /><span>{T.collector.shareSession}</span></ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-80" onKeyDown={pickerKeys}>
        <ConversationPicker request={request} onSelect={(issue) => actions.shareSession(record, issue)} />
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuItem onSelect={() => actions.makeIssue(record)}><MenuIcon icon={Plus} />{T.newIssue.title}</ContextMenuItem>
  </>;
  const remove = <ContextMenuItem className="text-destructive" onSelect={() => actions.remove(record)}><MenuIcon icon={Trash2} />{T.collector.remove}</ContextMenuItem>;
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent>
      {tab !== 'done' && <>
        <ContextMenuItem onSelect={() => onSelectRecord(record.id)}><MenuIcon icon={SquareCheckBig} />{selected ? T.bulk.clear : T.collector.select}</ContextMenuItem>
        <ContextMenuSeparator />
      </>}
      {tab === 'done' && (record.issue ? <>
        <ContextMenuItem onSelect={() => actions.openIssue(record)}><MenuIcon icon={SquareArrowOutUpRight} />{T.widgets.sessions.openIssue}</ContextMenuItem>
        {source}
      </> : <>
        <ContextMenuItem onSelect={() => actions.restore(record)}><MenuIcon icon={RotateCcw} />{T.collector.restore}</ContextMenuItem>
        {source}
        <ContextMenuSeparator />
        {remove}
      </>)}
      {tab === 'todo' && <>
        {share}
        {source}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.done(record)}><MenuIcon icon={Check} />{T.collector.markDone}</ContextMenuItem>
        {remove}
      </>}
    </ContextMenuContent>
  </ContextMenu>;
}
