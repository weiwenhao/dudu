import { useEffect, useState } from 'react';
import { Box, Check, Plus } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Checkbox } from '../components/checkbox.jsx';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from '../components/command.jsx';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/dialog.jsx';
import { Input } from '../components/input.jsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.jsx';
import { T } from '../strings.js';

export function ProjectChoices({ request, project, onSelect, onCreate, allowClear = false }) {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState('loading');
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
  return <Command>
    <CommandInput placeholder={T.projects.choose} aria-label={T.projects.choose} />
    <CommandSeparator />
    <CommandList>
      <CommandEmpty>{status === 'error' ? T.projects.failed : status === 'loading' ? T.projects.loading : T.projects.empty}</CommandEmpty>
      {allowClear && <CommandItem onSelect={() => onSelect(null)} value={T.noProject}><Box />{T.noProject}{!project && <Check className="ml-auto" />}</CommandItem>}
      {projects.map((item) => <CommandItem key={item.id ?? item.path} value={`${item.name} ${item.path}`} onSelect={() => onSelect({ name: item.name, path: item.path })}
        className="h-auto min-h-10 py-2">
        <Box /><span className="min-w-0 flex-1"><span className="block truncate">{item.name}</span><span className="block truncate text-xs text-muted-foreground">{item.path}</span></span>
        {project?.path === item.path && <Check />}
      </CommandItem>)}
    </CommandList>
    <CommandSeparator />
    <CommandItem value={T.projects.create} forceMount onSelect={onCreate}><Plus />{T.projects.create}</CommandItem>
  </Command>;
}

export function CreateProjectDialog({ request, open, onOpenChange, onCreated }) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [createDirectory, setCreateDirectory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  useEffect(() => { if (open) { setName(''); setPath(''); setCreateDirectory(false); setProblem(false); } }, [open]);
  const submit = async (event) => {
    event.preventDefault();
    if (busy || !path.trim()) return;
    setBusy(true);
    setProblem(false);
    try {
      const result = await request('projects/create', { ...(name.trim() ? { name: name.trim() } : {}), path: path.trim(), createDirectory });
      if (result.outcome !== 'success') { setProblem(true); return; }
      onOpenChange(false);
      onCreated({ name: result.project.name, path: result.project.path });
    } catch { setProblem(true); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined}>
      <DialogTitle>{T.projects.create}</DialogTitle>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">{T.projects.name}<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="flex flex-col gap-2">{T.projects.path}<Input autoFocus value={path} onChange={(event) => setPath(event.target.value)} /></label>
        <label className="flex items-center gap-2"><Checkbox checked={createDirectory} onCheckedChange={(value) => setCreateDirectory(value === true)} />{T.projects.createFolder}</label>
        {problem && <p role="alert" className="text-sm text-danger-foreground">{T.projects.createFailed}</p>}
        <div className="flex justify-end gap-2"><DialogClose asChild><Button variant="ghost" type="button">{T.newIssue.cancel}</Button></DialogClose><Button type="submit" disabled={busy || !path.trim()}>{T.projects.create}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function ProjectMenu({ request, project, onSelect, locked = false, children }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  if (locked) return children;
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80" aria-label={T.detail.project}>
        <ProjectChoices request={request} project={project} allowClear onSelect={(value) => { setOpen(false); onSelect(value); }} onCreate={() => { setOpen(false); setCreating(true); }} />
      </PopoverContent>
    </Popover>
    <CreateProjectDialog request={request} open={creating} onOpenChange={setCreating} onCreated={onSelect} />
  </>;
}
