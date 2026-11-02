import { useState } from 'react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { T } from '../strings.js';
import { ProjectMenu } from './ProjectMenu.jsx';
import { AgentMenu } from './AgentMenu.jsx';
import { AGENT_NAMES } from './model.js';

/**
 * "New issue": a title and, if you like, a description. The issue starts in Todo with no project and no agent (the store's
 * defaults), or with the value of the group it was added from (`preset`); everything else is set from its own page.
 */
export function NewIssueDialog({ open, onOpenChange, onCreate, request, preset = {} }) {
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [project, setProject] = useState(undefined);
  const [agent, setAgent] = useState(undefined);
  const chosenProject = project === undefined ? preset.project : project;
  const chosenAgent = agent === undefined ? preset.agent : agent;
  const reset = () => { setTitle(''); setBrief(''); setProblem(''); setBusy(false); setProject(undefined); setAgent(undefined); };
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setProblem('');
    try {
      const result = await onCreate({ ...preset, project: chosenProject ?? null, agent: chosenProject?.path ? chosenAgent ?? null : null, title: title.trim(), ...(brief.trim() ? { brief: brief.trim() } : {}) });
      if (result?.outcome !== 'success') throw new Error(result?.message || T.newIssue.failed);
      reset();
      onOpenChange(false);
    } catch {
      setProblem(T.newIssue.failed);
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent>
        <DialogTitle className="font-semibold">{T.newIssue.title}</DialogTitle>
        <DialogDescription className="sr-only">{T.newIssue.description}</DialogDescription>
        <input
          value={title} onChange={(event) => setTitle(event.target.value)} placeholder={T.newIssue.titlePlaceholder} aria-label={T.newIssue.titlePlaceholder} autoFocus
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); create(); } }}
          className="h-9 w-full rounded-md bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground"
        />
        {request && <div className="flex gap-2">
          <ProjectMenu request={request} project={chosenProject} onSelect={(value) => { setProject(value); if (!value) setAgent(null); }}>
            <Button variant="outline" size="sm">{chosenProject?.name ?? T.projects.choose}</Button>
          </ProjectMenu>
          <AgentMenu request={request} project={chosenProject} agent={chosenAgent} onSelect={(value, selectedProject) => { setProject(selectedProject); setAgent(value); }}>
            <Button variant="outline" size="sm">{AGENT_NAMES[chosenAgent] ?? T.noAgent}</Button>
          </AgentMenu>
        </div>}
        <textarea
          value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={T.newIssue.briefPlaceholder} aria-label={T.newIssue.briefPlaceholder} rows={4}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); create(); } }}
          className="block min-h-24 w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {problem && <p className="text-xs text-danger-foreground" role="alert">{problem}</p>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="ghost" size="sm">{T.newIssue.cancel}</Button></DialogClose>
          <Button size="sm" disabled={!title.trim() || busy} onClick={create}>{T.newIssue.create}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
