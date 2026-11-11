import { useEffect, useRef, useState } from 'react';
import { Box, Check, LoaderCircle, Plus } from 'lucide-react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { useToast } from '../components/toast.jsx';
import { useServices } from '../services.jsx';
import { T } from '../strings.js';
import { pickProject } from './pick-project.js';

export function ProjectChoices({ request, project, onSelect, allowClear = false }) {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState('loading');
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const { pickProjectDirectory } = useServices();
  const toast = useToast();
  useEffect(() => () => pending.current?.abort(), []);
  const create = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const chosen = await pickProject({ pickDirectory: pickProjectDirectory, request, signal: controller.signal });
      if (chosen) onSelect(chosen);
    } catch {
      if (!controller.signal.aborted) toast({ message: T.toast.failed });
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    request('projects/list').then((result) => {
      if (!active) return;
      if (result.outcome !== 'success') { setStatus('error'); return; }
      const list = result.projects ?? [];
      setProjects(project?.path && !list.some((item) => item.path === project.path) ? [project, ...list] : list);
      setStatus('ready');
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [request, project?.path, project?.name]);
  return <Command aria-busy={busy || undefined}>
    <CommandInput placeholder={T.projects.choose} aria-label={T.projects.choose} readOnly={busy} />
    <CommandSeparator />
    <CommandList>
      <CommandEmpty>{status === 'error' ? T.projects.failed : status === 'loading' ? T.projects.loading : T.projects.empty}</CommandEmpty>
      {allowClear && <CommandItem disabled={busy} onSelect={() => onSelect(null)} value={T.noProject}><Box />{T.noProject}{!project && <Check className="ml-auto" />}</CommandItem>}
      {projects.map((item) => <CommandItem disabled={busy} key={item.id ?? item.path} value={`${item.name} ${item.path}`} onSelect={() => onSelect({ name: item.name, path: item.path })}
        className="h-auto min-h-10 py-2">
        <Box /><span className="min-w-0 flex-1"><span className="block truncate">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{item.path}</span></span>
        {project?.path === item.path && <Check />}
      </CommandItem>)}
    </CommandList>
    <CommandSeparator />
    <CommandItem value={T.projects.create} disabled={busy} forceMount onSelect={create}>
      {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Plus />}{T.projects.create}
    </CommandItem>
  </Command>;
}

export function ProjectMenu({ request, project, onSelect, locked = false, children }) {
  const [open, setOpen] = useState(false);
  if (locked) return children;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent className="w-80" aria-label={T.detail.project}>
      <ProjectChoices request={request} project={project} allowClear onSelect={(value) => { setOpen(false); onSelect(value); }} />
    </PopoverContent>
  </Popover>;
}
