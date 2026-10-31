import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { groupLabel, withEmptyGroups } from './flatten.js';
import { GroupIcon } from './groups.jsx';
import { IssueCard } from './IssueCard.jsx';
import { PRIORITY_ORDER, STATUS_ORDER } from './model.js';

// A lane asks for its next page when its last card is this close (px) to the bottom of what it shows.
const NEAR_END = 240;

function Lane({ column, field, subField, now, show, menuFor, setMenuFor, onStatus, onOpen, loadMoreIn }) {
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
  return (
    <section aria-label={label} className="flex w-[296px] shrink-0 flex-col rounded-xl bg-muted/50 p-2">
      <div className="flex h-9 shrink-0 items-center gap-2 px-1.5">
        <GroupIcon field={field} groupKey={column.key} />
        <h2 className="font-medium">{label}</h2>
        <span className="text-muted-foreground">{column.count}</span>
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
export function Board({ list, view, tab, show, onStatus, onOpen }) {
  const field = view.group ?? 'status';
  const now = useMemo(() => Date.now(), [list.groups]); // eslint-disable-line react-hooks/exhaustive-deps -- recomputed when the data is
  const [menuFor, setMenuFor] = useState(null);
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
        />
      ))}
    </div>
  );
}
