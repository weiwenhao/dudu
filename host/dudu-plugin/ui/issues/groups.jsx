import { Box, Plus } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { AgentAvatar, AgentStateIcon, PriorityIcon, projectColor, StatusIcon, Triangle } from './icons.jsx';
import { groupLabel } from './flatten.js';
import { NeedsYouColorPicker } from './NeedsYouColor.jsx';

/** `count`: how many issues the group has; a Working group turns its icon only when it is not empty. */
export function GroupIcon({ field, groupKey, className = 'size-4', count = 0, pickColor = false }) {
  if (field === 'status') return <StatusIcon status={groupKey} className={className} />;
  if (field === 'agentState') {
    const icon = <AgentStateIcon state={groupKey} className={className} active={count > 0} />;
    return pickColor && groupKey === 'blocked' ? <NeedsYouColorPicker className={className}>{icon}</NeedsYouColorPicker> : icon;
  }
  if (field === 'priority') return <PriorityIcon priority={groupKey} className={className} />;
  if (field === 'agent') return <AgentAvatar agent={groupKey} state="idle" />;
  if (groupKey == null) return <Box className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
  return <Box className={className} style={{ color: projectColor(groupKey) }} aria-hidden="true" />;
}

/** The grey bar of a group: the triangle folds it, then its icon, name and how many rows it has; + adds an issue to the group. */
export function GroupBar({ entry, onToggle, onAdd }) {
  return (
    <div className="h-full pt-1">
      <div className="flex h-9 items-center gap-3 rounded-lg bg-muted pr-2 pl-3">
        <button
          type="button" aria-expanded={!entry.folded} aria-label={(entry.folded ? T.expand : T.collapse)(entry.label)} onClick={onToggle}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Triangle direction={entry.folded ? 'right' : 'down'} />
        </button>
        <span className="flex items-center gap-2">
          <GroupIcon field={entry.field} groupKey={entry.groupKey} count={entry.count} pickColor />
          <h2 className="font-medium">{entry.label}</h2>
          <span className="text-muted-foreground">{entry.count}</span>
        </span>
        <Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" aria-label={T.addTo(entry.label)} onClick={onAdd}><Plus /></Button>
      </div>
    </div>
  );
}

/** A sub-group: no bar, only the triangle, icon, name, count and a thin line. */
export function SubGroupBar({ entry, onToggle }) {
  return (
    <div className="h-full pt-1">
      <div className="flex h-8 items-center gap-3 pr-2 pl-3">
        <button
          type="button" aria-expanded={!entry.folded} aria-label={(entry.folded ? T.expand : T.collapse)(entry.label)} onClick={onToggle}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Triangle direction={entry.folded ? 'right' : 'down'} />
        </button>
        <span className="flex items-center gap-2">
          <GroupIcon field={entry.field} groupKey={entry.groupKey} count={entry.count} pickColor />
          <h3 className="font-medium">{entry.label}</h3>
          <span className="text-muted-foreground">{entry.count}</span>
        </span>
        <span className="ml-1 h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
