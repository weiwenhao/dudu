import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { flatten, SIZES, withEmptyGroups } from './flatten.js';
import { GroupBar, SubGroupBar } from './groups.jsx';
import { IssueRow } from './IssueRow.jsx';
import { isTyping } from '../lib/typing.js';


/**
 * The rows of a view in one virtualized column, flat or grouped (a bar for each group, a line for each sub-group). Only the
 * visible rows are in the DOM, so tens of thousands of issues do not slow it. S opens the status menu of the row under the mouse.
 */
export function IssueList({ list, view, tab, show, collapsed, onToggleGroup, onAddToGroup, selected, onSelect, onStatus, onOpen }) {
  const scroller = useRef(null);
  const now = useMemo(() => Date.now(), [list.items, list.groups]); // eslint-disable-line react-hooks/exhaustive-deps -- recomputed when the data is
  const [menuFor, setMenuFor] = useState(null);
  const hovered = useRef(null);
  const field = view.group ?? (view.layout === 'board' ? 'status' : null);
  const entries = useMemo(() => {
    if (!field || !list.groups) return list.items.map((issue) => ({ type: 'issue', id: `i:${issue.id}`, issue }));
    let groups = view.showEmpty ? withEmptyGroups(list.groups, field, tab) : list.groups;
    if (view.reverseGroups) groups = [...groups].reverse().map((group) => (group.groups ? { ...group, groups: [...group.groups].reverse() } : group));
    return flatten(groups, { collapsed, group: field, subGroup: view.subGroup });
  }, [list.items, list.groups, field, tab, view.showEmpty, view.reverseGroups, view.subGroup, collapsed]);

  const virtual = useVirtualizer({
    count: entries.length, getScrollElement: () => scroller.current, estimateSize: (index) => SIZES[entries[index].type], overscan: 8,
    getItemKey: (index) => entries[index].id,
  });
  const visible = virtual.getVirtualItems();
  const last = visible.length ? visible[visible.length - 1].index : -1;
  const { hasMore, loadMore, loadMoreIn } = list;
  useEffect(() => {
    if (!field && hasMore && last >= entries.length - 10) loadMore();
    for (const row of visible) if (entries[row.index]?.type === 'more') loadMoreIn(entries[row.index].path);
  }, [field, hasMore, last, entries, visible, loadMore, loadMoreIn]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key.toLowerCase() !== 's' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (hovered.current == null) return;
      event.preventDefault();
      setMenuFor(hovered.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const hover = useCallback((id) => { hovered.current = id; }, []);
  const ids = useMemo(() => entries.filter((entry) => entry.type === 'issue').map((entry) => entry.issue.id), [entries]);
  const total = ids.length;
  return (
    <div ref={scroller} className="mx-3 mt-1 min-h-0 flex-1 overflow-auto pb-6" role="list">
      <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
        {visible.map((row) => {
          const entry = entries[row.index];
          const place = { height: row.size, transform: `translateY(${row.start}px)` };
          const frame = 'absolute top-0 left-0 w-full';
          if (entry.type === 'group') return <div key={row.key} className={frame} style={place}><GroupBar entry={entry} onToggle={() => onToggleGroup(entry.id)} onAdd={() => onAddToGroup(entry)} /></div>;
          if (entry.type === 'subgroup') return <div key={row.key} className={frame} style={place}><SubGroupBar entry={entry} onToggle={() => onToggleGroup(entry.id)} /></div>;
          if (entry.type === 'more') return <div key={row.key} className={frame} style={place} aria-hidden="true" />;
          const issue = entry.issue;
          return (
            <div key={row.key} role="listitem" aria-posinset={field ? undefined : row.index + 1} aria-setsize={field ? undefined : total} className={frame} style={place}>
              <IssueRow
                issue={issue} now={now} show={show} menuOpen={menuFor === issue.id} onHover={hover} onStatus={onStatus} onOpen={() => onOpen(issue.id, ids)}
                selected={selected.has(issue.id)} selecting={selected.size > 0} onSelect={(id, shift) => onSelect(id, shift, ids)}
                onMenuOpenChange={(open) => setMenuFor(open ? issue.id : (current) => (current === issue.id ? null : current))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
