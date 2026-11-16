import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownFromLine, ArrowUpToLine, Box, CircleDot, Copy, CopyPlus, CornerDownRight, ListTodo, LoaderCircle, Pencil, Signal, SquareArrowOutUpRight, Tag, Trash2, User } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '../components/context-menu.jsx';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverAnchor, PopoverContent } from '../components/popover.jsx';
import { COPY_KINDS } from './copy.js';
import { useCopyIssue } from './use-copy.js';
import { T } from '../strings.js';
import { AGENT_NAMES } from './model.js';
import { useAgentIds } from './agents.js';
import { AgentAvatar, DueIcon } from './icons.jsx';
import { DueChoices, DueDateDialog } from './DueMenu.jsx';
import { ProjectChoices } from './ProjectMenu.jsx';
import { StatusChoices } from './StatusMenu.jsx';
import { PriorityChoices } from './PriorityMenu.jsx';
import { LabelChoices } from './LabelMenu.jsx';
import { IssueRenameDialog } from './IssueRenameDialog.jsx';

function AssignmentChoices({ issue, request, onSelect }) {
  const [selected, setSelected] = useState(issue.project);
  const [choosing, setChoosing] = useState(!selected?.path);
  const agents = useAgentIds(issue.agent, request);
  if (choosing) return <ProjectChoices request={request} project={selected}
    onSelect={(value) => { setSelected(value); setChoosing(false); }} />;
  return <>
    <button type="button" onClick={() => setChoosing(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent">
      <Box className="size-3.5" />{selected.name}
    </button>
    <Command>
      <CommandInput placeholder={T.detail.setAgent} aria-label={T.detail.setAgent} />
      <CommandSeparator />
      <CommandList>
        {agents.map((agent) => <CommandItem key={agent} value={AGENT_NAMES[agent]} onSelect={() => onSelect(agent, selected)}>
          <AgentAvatar agent={agent} state="idle" />{AGENT_NAMES[agent]}
        </CommandItem>)}
      </CommandList>
    </Command>
  </>;
}

/** Cards and list rows share the same single-issue actions and property pickers. */
export function IssueMenu({ issue, request, onChange, onAssign, onDelete, onOpenIssue, onAddSub, onDuplicate, onPin, pinning = false, selected = false, onSelectIssue, children }) {
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState(null);
  const [customDue, setCustomDue] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const card = useRef(null);
  const currentAction = useRef(null);
  const copy = useCopyIssue(request);
  const close = () => { setOpen(false); setShortcut(null); };
  const change = (patch) => { close(); onChange(issue, patch); };
  // A hovered row keeps its callback across refreshes; shortcuts must still read the latest assignment and menu state.
  useLayoutEffect(() => {
    currentAction.current = (field) => {
      if (open || customDue || renaming || (issue.agent && ['agent', 'project'].includes(field))) return;
      if (field === 'delete') { onDelete(issue); return; }
      setShortcut(field);
    };
  });
  // A card that moves to another lane (an issue given an agent leaves Unassigned) is a new element: the old one must not answer for a pointer that still thinks it is on it.
  useEffect(() => () => { currentAction.current = null; }, []);
  const action = useCallback((field) => currentAction.current?.(field), []);
  const choices = (field) => {
    if (field === 'status') return <StatusChoices status={issue.status} shortcut={Boolean(shortcut)} onSelect={(status) => change({ status })} />;
    if (field === 'priority') return <PriorityChoices priority={issue.priority} onSelect={(priority) => change({ priority })} />;
    if (field === 'agent') return <AssignmentChoices issue={issue} request={request}
      onSelect={(agent, project) => { close(); onAssign(issue, agent, project); }} />;
    if (field === 'project') return <ProjectChoices request={request} project={issue.project} allowClear
      onSelect={(project) => change({ project })} />;
    if (field === 'labels') return <LabelChoices request={request} value={(issue.labels ?? []).map((label) => label.id)} onChange={(labels) => onChange(issue, { labels })} />;
    return <DueChoices dueAt={issue.dueAt} onSelect={(dueAt) => change({ dueAt })}
      onCustom={() => { close(); setCustomDue(true); }} />;
  };
  // Let cmdk own navigation and text in its search box; Escape and Left still close the surrounding menu.
  const pickerKeys = (event) => {
    if (event.target.closest('[cmdk-root]') && !['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) event.stopPropagation();
  };
  return <>
    <Popover open={Boolean(shortcut)} onOpenChange={(value) => { if (!value) setShortcut(null); }}>
      <ContextMenu open={open} onOpenChange={(value) => { setOpen(value); if (value) setShortcut(null); }}>
        <PopoverAnchor asChild>
          <ContextMenuTrigger asChild ref={card}>
            {/* eslint-disable-next-line react-hooks/refs -- The render prop binds this callback to events; it never invokes it. */}
            {children(action)}
          </ContextMenuTrigger>
        </PopoverAnchor>
        <ContextMenuContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!renaming && !customDue) card.current?.focus({ preventScroll: true });
        }}>
          {/* Select begins the menu of a row of the list, as it does in the Collector (owner, 2026-11-16): it ticks this row for bulk changes, and the boxes appear on every row. The board has none. */}
          {onSelectIssue && <>
            <ContextMenuItem onSelect={() => onSelectIssue()}><ListTodo aria-hidden="true" />{selected ? T.bulk.clear : T.collector.select}</ContextMenuItem>
            <ContextMenuSeparator />
          </>}
          {onPin && <>
            <ContextMenuItem disabled={pinning} onSelect={() => onPin(issue)}>
              {pinning ? <LoaderCircle className="animate-spin" /> : issue.pinned ? <ArrowDownFromLine strokeWidth={1.8} /> : <ArrowUpToLine strokeWidth={1.8} />}
              {issue.pinned ? T.issuePin.off : T.issuePin.on}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>}
          {[
            ['status', T.fields.status, CircleDot, 'S'],
            ['priority', T.fields.priority, Signal, 'P'],
            ['agent', T.fields.agent, User, 'A'],
            ['due', T.detail.dueDate, DueIcon, '⇧ D'],
            ['labels', T.labels.name, Tag, 'L'],
            ['project', T.detail.project, Box, '⇧ P'],
          ].map(([field, label, Icon, key]) => <ContextMenuSub key={field}>
            <ContextMenuSubTrigger disabled={(Boolean(issue.agent) && ['agent', 'project'].includes(field))} shortcut={key}>
              <Icon aria-hidden="true" /><span>{label}</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className={field === 'due' ? 'w-auto overflow-hidden p-0' : field === 'project' ? 'w-80' : field === 'labels' ? 'w-[272px]' : ['status', 'priority'].includes(field) ? 'w-[180px]' : undefined}
              onKeyDown={pickerKeys}>{choices(field)}</ContextMenuSubContent>
          </ContextMenuSub>)}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => { close(); setRenaming(true); }}><Pencil aria-hidden="true" />{T.views.rename}</ContextMenuItem>
          {onAddSub && <ContextMenuItem onSelect={() => onAddSub(issue)}><CornerDownRight aria-hidden="true" />{T.subIssues.add}</ContextMenuItem>}
          <ContextMenuSub>
            <ContextMenuSubTrigger><Copy aria-hidden="true" /><span>{T.copy.menu}</span></ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-[240px]">
              {COPY_KINDS.map((kind) => <ContextMenuItem key={kind} disabled={kind === 'id' && !issue.ref} onSelect={() => { void copy(kind, issue); }}>
                {kind === 'id' ? T.detail.copyId : T.copy[kind]}
              </ContextMenuItem>)}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {onDuplicate && <ContextMenuItem onSelect={() => onDuplicate(issue)}><CopyPlus aria-hidden="true" />{T.copy.duplicate}</ContextMenuItem>}
          {onOpenIssue && <ContextMenuItem onSelect={() => onOpenIssue(issue)}><SquareArrowOutUpRight aria-hidden="true" />{T.detail.menuDetails}</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem shortcut={/Mac/.test(navigator.platform) ? '⌘ ⌫' : 'Ctrl ⌫'} onSelect={() => onDelete(issue)}><Trash2 aria-hidden="true" />{T.settings.skills.delete}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent className={shortcut === 'due' ? 'w-auto overflow-hidden p-0' : shortcut === 'project' ? 'w-80' : shortcut === 'labels' ? 'w-[272px]' : 'w-[232px]'}
        aria-label={shortcut === 'due' ? T.detail.dueDate : shortcut === 'labels' ? T.labels.name : T.fields[shortcut]}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (!customDue && !renaming) card.current?.focus({ preventScroll: true }); }}>
        {shortcut && choices(shortcut)}
      </PopoverContent>
    </Popover>
    {customDue && <DueDateDialog dueAt={issue.dueAt} onClose={() => setCustomDue(false)} onSelect={(dueAt) => change({ dueAt })}
      onCloseAutoFocus={(event) => { event.preventDefault(); card.current?.focus({ preventScroll: true }); }} />}
    {renaming && <IssueRenameDialog issue={issue} onClose={() => setRenaming(false)} onSave={(title) => onChange(issue, { title })}
      onCloseAutoFocus={(event) => { event.preventDefault(); card.current?.focus({ preventScroll: true }); }} />}
  </>;
}
