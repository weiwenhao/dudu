import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsRight, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';
import { groupLabel, withEmptyGroups } from './flatten.js';
import { GroupIcon } from './groups.jsx';
import { IssueCard } from './IssueCard.jsx';
import { PRIORITY_ORDER, STATUS_ORDER } from './model.js';
import { useIssueShortcuts } from './use-issue-shortcuts.js';

// A lane asks for its next page when its last card is this close (px) to the bottom of what it shows.
const NEAR_END = 240;

/** The "···" of a column: for now one thing, to fold the column into a narrow strip (the strip opens it again). */
function LaneMenu({ label, onCollapse }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={T.lane.options}><MoreHorizontal /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-[184px]" align="end">
        <button
          type="button" className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
          onClick={() => { setOpen(false); onCollapse(); }}
        >
          {T.lane.collapse}
        </button>
      </PopoverContent>
    </Popover>
  );
}

function Lane({ column, field, subField, now, show, menuFor, setMenuFor, onStatus, onOpen, loadMoreIn, collapsed, onToggle, onAdd, onHover, request, onChange, onAssign, onDelete, onOpenSession, onPreviewSession }) {
  const scroller = useRef(null);
  const label = groupLabel(field, column.key);
  const leaves = column.groups ?? [{ ...column, key: undefined }];
  const fill = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END;
    if (!near) return;
    for (const leaf of leaves) if (leaf.cursor) loadMoreIn(leaf.key === undefined ? { key: column.key } : { key: column.key, subKey: leaf.key });
  }, [column.key, leaves, loadMoreIn]);
  // A lane that is not full yet has nothing to scroll, so it must fetch on its own until it is.
  useEffect(fill);
  if (collapsed) {
    return (
      <section aria-label={label} className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl bg-muted/50 py-2">
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`${T.lane.expand}: ${label}`} aria-expanded="false" onClick={onToggle}><ChevronsRight /></Button>
        <GroupIcon field={field} groupKey={column.key} />
        <span className="text-muted-foreground">{column.count}</span>
        <h2 className="font-medium [writing-mode:vertical-rl]">{label}</h2>
      </section>
    );
  }
  return (
    <section aria-label={label} className="flex w-[296px] shrink-0 flex-col rounded-xl bg-muted/50 p-2">
      <div className="flex h-9 shrink-0 items-center gap-1 px-1.5">
        <span className="flex items-center gap-2">
          <GroupIcon field={field} groupKey={column.key} />
          <h2 className="font-medium">{label}</h2>
          <span className="text-muted-foreground">{column.count}</span>
        </span>
        <span className="flex-1" />
        <LaneMenu label={label} onCollapse={onToggle} />
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={T.addTo(label)} onClick={onAdd}><Plus /></Button>
      </div>
      <div ref={scroller} onScroll={fill} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" role="list">
        {leaves.map((leaf) => (
          <div key={String(leaf.key)} className="flex flex-col gap-2">
            {column.groups && (
              <div className="flex h-7 items-center gap-2 px-1.5 text-xs">
                <GroupIcon field={subField} groupKey={leaf.key} className="size-3.5" />
                <h3 className="font-medium">{groupLabel(subField, leaf.key)}</h3>
                <span className="text-muted-foreground">{leaf.count}</span>
              </div>
            )}
            {leaf.items.map((issue) => (
              <div key={issue.id} role="listitem">
                <IssueCard
                  issue={issue} now={now} show={show} menuOpen={menuFor === issue.id} onStatus={onStatus} onOpen={() => onOpen(issue.id)}
                  onHover={onHover} request={request} onChange={onChange} onAssign={onAssign} onDelete={onDelete} onOpenSession={onOpenSession} onPreviewSession={onPreviewSession}
                  onMenuOpenChange={(open) => setMenuFor(open ? issue.id : (current) => (current === issue.id ? null : current))}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The Board: a lane for each group of the Columns field (by default Status), the cards of a lane scrolling inside it and
 * fetched as they are scrolled to. Rows, when set, split each lane into sections. There is no dragging between lanes: the
 * status icon of a card changes its status.
 */
export function Board({ list, view, tab, show, collapsed, onToggleLane, onAddToLane, onStatus, onOpen, request, onChange, onAssign, onDelete, onOpenSession, onPreviewSession }) {
  const field = view.group ?? 'status';
  const now = useMemo(() => Date.now(), [list.groups]); // eslint-disable-line react-hooks/exhaustive-deps -- recomputed when the data is
  const [menuFor, setMenuFor] = useState(null);
  const onHover = useIssueShortcuts();
  let columns = list.groups ?? [];
  if (view.showEmpty) columns = withEmptyGroups(columns, field, tab);
  // Lanes follow the workflow (Todo, In Progress, In Review …), not the list's "what is being done first" order.
  const workflow = field === 'status' ? STATUS_ORDER : field === 'priority' ? PRIORITY_ORDER : null;
  if (workflow) columns = [...columns].sort((a, b) => workflow.indexOf(a.key) - workflow.indexOf(b.key));
  if (view.reverseGroups) columns = [...columns].reverse();
  // The cards in the order they are on screen, left to right, for the previous/next arrows of an issue's page.
  const ids = columns.flatMap((column) => (column.groups ?? [column]).flatMap((leaf) => leaf.items.map((issue) => issue.id)));
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 pt-1 pb-6">
      {columns.map((column) => (
        <Lane
          key={String(column.key)} column={column} field={field} subField={view.subGroup} now={now} show={show}
          menuFor={menuFor} setMenuFor={setMenuFor} onStatus={onStatus} onOpen={(id) => onOpen(id, ids)} loadMoreIn={list.loadMoreIn}
          onHover={onHover} request={request} onChange={onChange} onAssign={onAssign} onDelete={onDelete} onOpenSession={onOpenSession} onPreviewSession={onPreviewSession}
          collapsed={collapsed.has(`lane:${String(column.key)}`)} onToggle={() => onToggleLane(`lane:${String(column.key)}`)}
          onAdd={() => onAddToLane({ field, groupKey: column.key })}
        />
      ))}
    </div>
  );
}
