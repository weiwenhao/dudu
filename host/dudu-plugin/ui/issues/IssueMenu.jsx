import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Box, CalendarDays, CircleDot, Copy, Expand, Signal, Trash2, User } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '../components/context-menu.jsx';
import { Command, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Calendar } from '../components/calendar.jsx';
import { Button } from '../components/button.jsx';
import { Popover, PopoverAnchor, PopoverContent } from '../components/popover.jsx';
import { useToast } from '../components/toast.jsx';
import { T } from '../strings.js';
import { AGENT_NAMES } from './model.js';
import { AgentAvatar } from './icons.jsx';
import { CreateProjectDialog, ProjectChoices } from './ProjectMenu.jsx';
import { StatusChoices } from './StatusMenu.jsx';
import { PriorityChoices } from './PriorityMenu.jsx';

function AssignmentChoices({ issue, project, request, onSelect, onCreate }) {
  const [selected, setSelected] = useState(project ?? issue.project);
  const [choosing, setChoosing] = useState(!selected?.path);
  if (choosing) return <ProjectChoices request={request} project={selected}
    onSelect={(value) => { setSelected(value); setChoosing(false); }} onCreate={onCreate} />;
  return <>
    <button type="button" onClick={() => setChoosing(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent">
      <Box className="size-3.5" />{selected.name}
    </button>
    <Command>
      <CommandInput placeholder={T.detail.setAgent} aria-label={T.detail.setAgent} />
      <CommandSeparator />
      <CommandList>
        {Object.entries(AGENT_NAMES).map(([agent, name]) => <CommandItem key={agent} value={name} onSelect={() => onSelect(agent, selected)}>
          <AgentAvatar agent={agent} state="idle" />{name}
        </CommandItem>)}
      </CommandList>
    </Command>
  </>;
}

function DueChoices({ dueAt, onSelect }) {
  const selected = dueAt == null ? undefined : new Date(dueAt);
  return <>
    <Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(date) => {
      if (date) onSelect(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime());
    }} />
    {dueAt != null && <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={() => onSelect(null)}>{T.detail.clearDue}</Button>}
  </>;
}

/** Cards and list rows share the same single-issue actions and property pickers. */
export function IssueMenu({ issue, request, onChange, onAssign, onDelete, onOpenSession, children }) {
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState(null);
  const [creating, setCreating] = useState(null);
  const [createdProject, setCreatedProject] = useState(null);
  const card = useRef(null);
  const currentAction = useRef(null);
  const toast = useToast();
  const close = () => { setOpen(false); setShortcut(null); };
  const change = (patch) => { close(); onChange(issue, patch); };
  const createProject = (field) => { close(); setCreating(field); };
  // A hovered row keeps its callback across refreshes; shortcuts must still read the latest assignment and menu state.
  useLayoutEffect(() => {
    currentAction.current = (field) => {
      if (open || creating || (issue.agent && ['agent', 'project'].includes(field))) return;
      if (field === 'delete') { onDelete(issue); return; }
      setCreatedProject(null);
      setShortcut(field);
    };
  });
  const action = useCallback((field) => currentAction.current?.(field), []);
  const choices = (field) => {
    if (field === 'status') return <StatusChoices status={issue.status} shortcut={Boolean(shortcut)} onSelect={(status) => change({ status })} />;
    if (field === 'priority') return <PriorityChoices priority={issue.priority} onSelect={(priority) => change({ priority })} />;
    if (field === 'agent') return <AssignmentChoices issue={issue} project={createdProject} request={request}
      onCreate={() => createProject(field)} onSelect={(agent, project) => { close(); onAssign(issue, agent, project); }} />;
    if (field === 'project') return <ProjectChoices request={request} project={issue.project} allowClear
      onCreate={() => createProject(field)} onSelect={(project) => change({ project })} />;
    return <DueChoices dueAt={issue.dueAt} onSelect={(dueAt) => change({ dueAt })} />;
  };
  // Let cmdk own navigation and text in its search box; Escape and Left still close the surrounding menu.
  const pickerKeys = (event) => {
    if (event.target.closest('[cmdk-root]') && !['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) event.stopPropagation();
  };
  return <>
    <Popover open={Boolean(shortcut)} onOpenChange={(value) => { if (!value) setShortcut(null); }}>
      <ContextMenu open={open} onOpenChange={(value) => { setOpen(value); if (value) { setShortcut(null); setCreatedProject(null); } }}>
        <PopoverAnchor asChild>
          <ContextMenuTrigger asChild ref={card}>
            {/* eslint-disable-next-line react-hooks/refs -- The render prop binds this callback to events; it never invokes it. */}
            {children(action)}
          </ContextMenuTrigger>
        </PopoverAnchor>
        <ContextMenuContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!creating) card.current?.focus({ preventScroll: true });
        }}>
          {[
            ['status', T.fields.status, CircleDot, 'S'],
            ['priority', T.fields.priority, Signal, 'P'],
            ['agent', T.fields.agent, User, 'A'],
            ['due', T.detail.dueDate, CalendarDays, '⇧ D'],
            ['project', T.detail.project, Box, '⇧ P'],
          ].map(([field, label, Icon, key]) => <ContextMenuSub key={field}>
            <ContextMenuSubTrigger disabled={Boolean(issue.agent) && ['agent', 'project'].includes(field)} shortcut={key}>
              <Icon aria-hidden="true" /><span>{label}</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className={field === 'due' ? 'w-auto p-2' : field === 'project' ? 'w-80' : ['status', 'priority'].includes(field) ? 'w-[180px]' : undefined}
              onKeyDown={pickerKeys}>{choices(field)}</ContextMenuSubContent>
          </ContextMenuSub>)}
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!issue.ref} onSelect={async () => {
            try { await navigator.clipboard.writeText(issue.ref); toast({ message: T.toast.copied(issue.ref) }); }
            catch { toast({ message: T.toast.failed }); }
          }}><Copy aria-hidden="true" />{T.detail.copyId}</ContextMenuItem>
          {issue.session && <ContextMenuItem onSelect={async () => {
            try { await onOpenSession(issue); } catch { toast({ message: T.widgets.sessions.openFailed }); }
          }}><Expand aria-hidden="true" />{T.detail.openSession}</ContextMenuItem>}
          <ContextMenuSeparator />
          <ContextMenuItem shortcut={/Mac/.test(navigator.platform) ? '⌘ ⌫' : 'Ctrl ⌫'} onSelect={() => onDelete(issue)}><Trash2 aria-hidden="true" />{T.settings.skills.delete}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent className={shortcut === 'due' ? 'w-auto p-2' : shortcut === 'project' ? 'w-80' : 'w-[232px]'}
        aria-label={shortcut === 'due' ? T.detail.dueDate : T.fields[shortcut]}
        onCloseAutoFocus={(event) => { event.preventDefault(); card.current?.focus({ preventScroll: true }); }}>
        {shortcut && choices(shortcut)}
      </PopoverContent>
    </Popover>
    <CreateProjectDialog request={request} open={Boolean(creating)} onOpenChange={(value) => { if (!value) setCreating(null); }}
      onCreated={(project) => {
        const next = creating;
        setCreating(null);
        if (next === 'agent') { setCreatedProject(project); setShortcut('agent'); }
        else change({ project });
      }} />
  </>;
}
