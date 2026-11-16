import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../lib/cn.js';
import { DragChip } from './DragChip.jsx';
import { canDrag, canDrop, wouldMove } from './drag.js';
import { flatten, SIZES, withEmptyGroups } from './flatten.js';
import { GroupBar, SubGroupBar } from './groups.jsx';
import { IssueRow } from './IssueRow.jsx';
import { useIssueShortcuts } from './use-issue-shortcuts.js';

const FRAME = 'absolute top-0 left-0 w-full';

// A bar, a line and a row of a group are all places a row can be dropped: on that group.
const zoneOf = (entry, field) => ({ id: `z:${entry.id}`, disabled: !canDrop(field, entry.top), data: { groupKey: entry.top } });

/** The frame of a bar or a line of a group in the virtualized column. */
function Frame({ entry, field, place, children }) {
  const { setNodeRef } = useDroppable(zoneOf(entry, field));
  return <div ref={setNodeRef} className={FRAME} style={place}>{children}</div>;
}

/** The frame of a row: a place to drop on, and (once the pointer has moved a few pixels) a row to take up. */
function RowFrame({ entry, field, place, children, ...props }) {
  const { setNodeRef: zone } = useDroppable(zoneOf(entry, field));
  const { setNodeRef: take, listeners, isDragging } = useDraggable({ id: entry.id, disabled: !canDrag(field, entry.issue), data: { issue: entry.issue } });
  return (
    <div ref={(node) => { zone(node); take(node); }} role="listitem" {...listeners} {...props} className={cn(FRAME, isDragging && 'opacity-50')} style={place}>
      {children}
    </div>
  );
}

// The frames are placed with a transform (the virtualizer's way), and dnd-kit measures a place to drop on without its transform unless told.
const measuring = {
  droppable: { measure: (element) => { const { top, left, width, height, bottom, right } = element.getBoundingClientRect(); return { top, left, width, height, bottom, right }; } },
};

// The chip is as wide as what is in it, so it is the chip, not the row it came from, that is centred on the pointer.
const centreOnPointer = ({ transform, activatorEvent, draggingNodeRect, overlayNodeRect }) => {
  if (!activatorEvent || !draggingNodeRect || !('clientX' in activatorEvent)) return transform;
  const width = overlayNodeRect?.width ?? draggingNodeRect.width;
  const height = overlayNodeRect?.height ?? draggingNodeRect.height;
  return { ...transform, x: transform.x + activatorEvent.clientX - draggingNodeRect.left - width / 2, y: transform.y + activatorEvent.clientY - draggingNodeRect.top - height / 2 };
};

/**
 * The rows of a view in one virtualized column, flat or grouped (a bar for each group, a line for each sub-group). Only the
 * visible rows are in the DOM, so tens of thousands of issues do not slow it. S opens the status menu of the row under the mouse.
 * In a grouped list a row can be dragged to another group, which gives it that group's status, priority or (the boss's word for the)
 * agent state: the group under the pointer gets a blue outline, as in Linear, and the row is held up as a small card.
 */
export function IssueList({ list, view, tab, show, collapsed, onToggleGroup, onAddToGroup, selected, onSelect, onStatus, onMove, onOpen,
  request, onChange, onAssign, onDelete, onOpenSession, onAddSub, onDuplicate, onPreviewSession, onPin, pinning }) {
  const scroller = useRef(null);
  const now = useMemo(() => Date.now(), [list.items, list.groups]); // eslint-disable-line react-hooks/exhaustive-deps -- recomputed when the data is
  const [menuFor, setMenuFor] = useState(null);
  const [lifted, setLifted] = useState(null); // the issue the pointer holds
  const [over, setOver] = useState(null); // { key }: the group the pointer is over
  const hover = useIssueShortcuts();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const field = view.group ?? (view.layout === 'board' ? 'status' : null);
  const entries = useMemo(() => {
    if (!field || !list.groups) return list.items.map((issue) => ({ type: 'issue', id: `i:${issue.id}`, issue }));
    let groups = view.showEmpty ? withEmptyGroups(list.groups, field, tab) : list.groups;
    if (view.reverseGroups) groups = [...groups].reverse().map((group) => (group.groups ? { ...group, groups: [...group.groups].reverse() } : group));
    return flatten(groups, { collapsed, group: field, subGroup: view.subGroup });
  }, [list.items, list.groups, field, tab, view.showEmpty, view.reverseGroups, view.subGroup, collapsed]);

  // The row that is held stays mounted when it is scrolled out of view, or the drag would lose it.
  const heldIndex = lifted ? entries.findIndex((entry) => entry.id === `i:${lifted.id}`) : -1;
  const rangeExtractor = useCallback((range) => {
    const shown = defaultRangeExtractor(range);
    return heldIndex >= 0 && !shown.includes(heldIndex) ? [...shown, heldIndex].sort((a, b) => a - b) : shown;
  }, [heldIndex]);
  const virtual = useVirtualizer({
    count: entries.length, getScrollElement: () => scroller.current, estimateSize: (index) => SIZES[entries[index].type], overscan: 8,
    getItemKey: (index) => entries[index].id, rangeExtractor,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.length ? visible[visible.length - 1].index : -1;
  const { hasMore, loadMore, loadMoreIn } = list;
  useEffect(() => {
    if (!field && hasMore && last >= entries.length - 10) loadMore();
    for (const row of visible) if (entries[row.index]?.type === 'more') loadMoreIn(entries[row.index].path);
  }, [field, hasMore, last, entries, visible, loadMore, loadMoreIn]);

  // Where the group under the pointer is (its bar and everything under it), to outline it. The sizes are fixed, so the starts add up.
  const outline = useMemo(() => {
    if (!field || !lifted || !over || !canDrop(field, over.key) || !wouldMove(field, lifted, over.key)) return null;
    const first = entries.findIndex((entry) => entry.type === 'group' && entry.groupKey === over.key);
    if (first < 0) return null;
    const start = (index) => entries.slice(0, index).reduce((sum, entry) => sum + SIZES[entry.type], 0);
    let end = entries.findIndex((entry, index) => index > first && entry.type === 'group');
    if (end < 0) end = entries.length;
    const top = start(first) + 4; // the 4px of air above a bar
    return { top, height: start(end) - top };
  }, [entries, field, lifted, over]);

  const ids = useMemo(() => entries.filter((entry) => entry.type === 'issue').map((entry) => entry.issue.id), [entries]);
  const total = ids.length;

  // The id column is as wide as the widest id (Linear's), not a fixed width: the titles line up and the gap after a short id stays small. Digits are the same width
  // (tabular), so one sample for each kind of id (a key and its number of digits) is enough to measure; the width goes on the list as `--issue-id-w`.
  const idKinds = useMemo(() => {
    const kinds = new Set();
    for (const entry of entries) if (entry.type === 'issue' && entry.issue.ref) kinds.add(entry.issue.ref.replace(/\d/g, '0'));
    return [...kinds].slice(0, 40);
  }, [entries]);
  const probe = useRef(null);
  useLayoutEffect(() => {
    const box = scroller.current;
    const samples = probe.current;
    if (!box || !samples) return undefined;
    const measure = () => box.style.setProperty('--issue-id-w', `${Math.ceil(Math.max(0, ...[...samples.children].map((sample) => sample.getBoundingClientRect().width)))}px`);
    measure();
    let stale = false;
    document.fonts?.ready.then(() => { if (!stale) measure(); });
    return () => { stale = true; };
  }, [idKinds, show.id]);
  return (
    <DndContext
      sensors={sensors} collisionDetection={pointerWithin} measuring={measuring}
      onDragStart={({ active }) => setLifted(active.data.current?.issue ?? null)}
      onDragOver={({ over: target }) => setOver(target ? { key: target.data.current?.groupKey } : null)}
      onDragCancel={() => { setLifted(null); setOver(null); }}
      onDragEnd={({ active, over: target }) => {
        setLifted(null);
        setOver(null);
        const issue = active.data.current?.issue;
        const key = target?.data.current?.groupKey;
        if (issue && target && canDrop(field, key) && wouldMove(field, issue, key)) onMove(issue, field, key);
      }}
    >
      <div ref={scroller} className="mx-3 mt-1 min-h-0 flex-1 overflow-auto pb-6" role="list">
        {show.id && <div ref={probe} aria-hidden="true" className="invisible absolute h-0 overflow-hidden whitespace-nowrap">
          {idKinds.map((kind) => <span key={kind} className="inline-block tracking-[-0.02em] tabular-nums">{kind}</span>)}
        </div>}
        <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
          {visible.map((row) => {
            const entry = entries[row.index];
            const place = { height: row.size, transform: `translateY(${row.start}px)` };
            if (entry.type === 'group') return <Frame key={row.key} entry={entry} field={field} place={place}><GroupBar entry={entry} onToggle={() => onToggleGroup(entry.id)} onAdd={() => onAddToGroup(entry)} /></Frame>;
            if (entry.type === 'subgroup') return <Frame key={row.key} entry={entry} field={field} place={place}><SubGroupBar entry={entry} onToggle={() => onToggleGroup(entry.id)} /></Frame>;
            if (entry.type === 'more') return <div key={row.key} className={FRAME} style={place} aria-hidden="true" />;
            const issue = entry.issue;
            return (
              <RowFrame key={row.key} entry={entry} field={field} place={place} aria-posinset={field ? undefined : row.index + 1} aria-setsize={field ? undefined : total}>
                <IssueRow
                  issue={issue} now={now} show={show} menuOpen={menuFor === issue.id} onHover={hover} onStatus={onStatus} onOpen={() => onOpen(issue.id, ids)} onNavigate={(id) => onOpen(id, ids)}
                  selected={selected.has(issue.id)} selecting={selected.size > 0} onSelect={(id, shift) => onSelect(id, shift, ids)}
                  request={request} onChange={onChange} onAssign={onAssign} onDelete={onDelete} onOpenSession={onOpenSession} onAddSub={onAddSub} onDuplicate={onDuplicate} onPreviewSession={onPreviewSession}
                  onPin={onPin} pinning={pinning?.has(`issue:${issue.id}`)}
                  onMenuOpenChange={(open) => setMenuFor(open ? issue.id : (current) => (current === issue.id ? null : current))}
                />
              </RowFrame>
            );
          })}
          {outline && <div aria-hidden="true" data-group-drop className="pointer-events-none absolute left-0 w-full rounded-lg ring-2 ring-ring ring-inset" style={outline} />}
        </div>
      </div>
      <DragOverlay dropAnimation={null} modifiers={[centreOnPointer]} style={{ width: 'max-content', height: 'auto' }}>
        {lifted ? <DragChip issue={lifted} show={show} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
